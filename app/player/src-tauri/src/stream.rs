//! Range-capable, CORS-clean `stream://` URI scheme protocol.
//!
//! The frontend references a local video file as
//! `stream://localhost/<percent-encoded-absolute-path>` (see the exact
//! encoding contract in the crate docs / report). On Windows WebView2 rewrites
//! this to `http://stream.localhost/<...>`, so both origins are handled.
//!
//! Design goals:
//! * Honor HTTP `Range` requests (`206 Partial Content`) so the `<video>`
//!   element can seek within multi-gigabyte files without buffering them whole.
//! * Never read an entire large file into memory: every response body is
//!   bounded by [`MAX_CHUNK`]; oversized requests are answered with a partial
//!   slice and the browser transparently requests the next chunk.
//! * Emit permissive CORS headers so `video.crossOrigin = "anonymous"` yields
//!   an untainted frame source for WebGPU `copyExternalImageToTexture`.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use tauri::http::{header, HeaderValue, Request, Response, StatusCode};
use tauri::UriSchemeResponder;

/// Maximum number of bytes returned in a single response body. Bounds memory
/// for huge videos: open-ended / oversized ranges are truncated to this size
/// and the webview's media stack fetches the continuation via further ranges.
const MAX_CHUNK: u64 = 8 * 1024 * 1024; // 8 MiB

/// Entry point wired into `register_asynchronous_uri_scheme_protocol`.
///
/// Runs the (blocking) file I/O on a dedicated thread and resolves the async
/// responder when done, keeping the UI thread responsive.
pub fn handle(request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    std::thread::spawn(move || {
        let response = build_response(&request);
        responder.respond(response);
    });
}

fn build_response(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // Compare the method as a string to avoid `&Method` vs `Method` PartialEq
    // ambiguity.
    let method = request.method().as_str();

    // CORS preflight — answer before touching the filesystem.
    if method == "OPTIONS" {
        return preflight();
    }

    let path = match decode_request_path(request) {
        Some(p) => p,
        None => return simple_error(StatusCode::BAD_REQUEST, "invalid stream path"),
    };

    let metadata = match std::fs::metadata(&path) {
        Ok(meta) if meta.is_file() => meta,
        _ => return simple_error(StatusCode::NOT_FOUND, "file not found"),
    };
    let file_size = metadata.len();
    let content_type = content_type_for(&path);

    // HEAD — advertise size + range support without a body.
    if method == "HEAD" {
        return head_response(file_size, content_type);
    }

    if method != "GET" {
        return simple_error(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }

    // Empty file: nothing to slice.
    if file_size == 0 {
        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, "0")
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
        apply_cors(&mut response);
        return response;
    }

    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());

    let (start, requested_end, had_range) = match range_header {
        Some(raw) => match parse_range(raw, file_size) {
            Some((start, end)) => (start, end, true),
            // A syntactically present but unsatisfiable range → 416.
            None => return range_not_satisfiable(file_size, content_type),
        },
        None => (0, file_size - 1, false),
    };

    // Bound the served slice so we never allocate more than MAX_CHUNK.
    let capped_end = requested_end.min(start.saturating_add(MAX_CHUNK - 1));

    let body = match read_slice(&path, start, capped_end - start + 1) {
        Ok(bytes) => bytes,
        Err(_) => return simple_error(StatusCode::NOT_FOUND, "failed to read file"),
    };

    // Derive the real served range from what we actually read (guards against a
    // file being truncated between metadata and read).
    let actual_len = body.len() as u64;
    let actual_end = start + actual_len.saturating_sub(1);

    // Partial whenever the client asked for a range, or when we served less than
    // the whole file (capped / offset).
    let is_partial = had_range || start > 0 || actual_end < file_size - 1;

    let status = if is_partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, actual_len.to_string());

    if is_partial {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, actual_end, file_size),
        );
    }

    let mut response = builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()));
    apply_cors(&mut response);
    response
}

/// Decodes the absolute filesystem path carried by a `stream://` request.
///
/// Accepts every origin form the webview may produce:
/// * `stream://localhost/<enc>`         (macOS / Linux)
/// * `http://stream.localhost/<enc>`     (Windows / Android)
/// * `stream://<enc>`                    (host-less fallback)
fn decode_request_path(request: &Request<Vec<u8>>) -> Option<PathBuf> {
    let uri = request.uri();

    // `path()` already excludes query/fragment and works for the `localhost`
    // and `stream.localhost` host forms.
    let mut encoded = uri.path().trim_start_matches('/').to_string();

    // Host-less form `stream://<enc>` parses `<enc>` as the authority instead.
    if encoded.is_empty() {
        if let Some(authority) = uri.authority() {
            encoded = authority.as_str().to_string();
        }
    }

    if encoded.is_empty() {
        return None;
    }

    let decoded = urlencoding::decode(&encoded).ok()?.into_owned();
    if decoded.is_empty() {
        return None;
    }

    Some(PathBuf::from(decoded))
}

/// Parses a single-range `Range` header against the known file size.
///
/// Supports `bytes=start-end`, `bytes=start-` and the suffix form
/// `bytes=-suffix`. Returns an inclusive `(start, end)` pair, or `None` when
/// the range is malformed or unsatisfiable.
fn parse_range(header_value: &str, file_size: u64) -> Option<(u64, u64)> {
    let spec = header_value.trim().strip_prefix("bytes=")?;
    // Only the first range of a (rarely used) multi-range list is served.
    let first = spec.split(',').next()?.trim();
    let (start_str, end_str) = first.split_once('-')?;
    let start_str = start_str.trim();
    let end_str = end_str.trim();

    if start_str.is_empty() {
        // Suffix range: `bytes=-N` → final N bytes.
        let suffix: u64 = end_str.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let length = suffix.min(file_size);
        Some((file_size - length, file_size - 1))
    } else {
        let start: u64 = start_str.parse().ok()?;
        if start >= file_size {
            return None; // unsatisfiable
        }
        let end = if end_str.is_empty() {
            file_size - 1
        } else {
            end_str.parse::<u64>().ok()?.min(file_size - 1)
        };
        if end < start {
            return None;
        }
        Some((start, end))
    }
}

/// Reads at most `length` bytes starting at `start` without loading the whole
/// file into memory.
fn read_slice(path: &Path, start: u64, length: u64) -> std::io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let capacity = length.min(MAX_CHUNK) as usize;
    let mut buffer = Vec::with_capacity(capacity);
    file.take(length).read_to_end(&mut buffer)?;
    Ok(buffer)
}

/// Maps a file extension to a video MIME type.
fn content_type_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);

    match ext.as_deref() {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        Some("avi") => "video/x-msvideo",
        Some("ogv") => "video/ogg",
        Some("ts") => "video/mp2t",
        Some("flv") => "video/x-flv",
        _ => "application/octet-stream",
    }
}

/// 200 response for a `HEAD` request — headers only, no body.
fn head_response(file_size: u64, content_type: &str) -> Response<Vec<u8>> {
    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()));
    apply_cors(&mut response);
    response
}

/// 200 empty response answering a CORS preflight (`OPTIONS`).
fn preflight() -> Response<Vec<u8>> {
    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_LENGTH, "0")
        .header(header::ACCESS_CONTROL_MAX_AGE, "86400")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()));
    apply_cors(&mut response);
    response
}

/// 416 response for an unsatisfiable range.
fn range_not_satisfiable(file_size: u64, content_type: &str) -> Response<Vec<u8>> {
    let mut response = Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_RANGE, format!("bytes */{}", file_size))
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()));
    apply_cors(&mut response);
    response
}

/// Plain-text error response with CORS headers attached.
fn simple_error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()));
    apply_cors(&mut response);
    response
}

/// Injects the permissive CORS headers required for untainted WebGPU frames.
fn apply_cors(response: &mut Response<Vec<u8>>) {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Range, Content-Length, Accept-Ranges, Content-Type"),
    );
}
