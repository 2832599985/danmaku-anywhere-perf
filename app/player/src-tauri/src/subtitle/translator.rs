//! Translation: Japanese lines → Simplified Chinese via the llama-server
//! sidecar running Murasaki-4B (an ACGN-tuned ja→zh model).
//!
//! A/B on the 300 s test segment (CONTRACT §34): Murasaki got names and ranks
//! right without any glossary (ゼートゥア→杰图亚, デグレチャフ中佐→提古雷查夫中校);
//! TranslateGemma-4B got names, ranks and even polarity wrong. Speed per
//! 8-line batch: GPU (Vulkan) 2.6 s, CPU (4 threads) 7.8 s.
//!
//! No glossary: the remaining errors came from recognition, which a term
//! list cannot fix.
//!
//! Alignment discipline: lines carry explicit `N|` markers. A reply whose
//! markers do not line up is retried once; after that only the leading run of
//! correctly numbered lines is trusted, the rest stay untranslated (the
//! player shows the Japanese) — never guess which reply line belongs where.

use std::time::Duration;

use serde_json::json;

use super::sidecar::MT_CTX;

/// Lines per request: the system prompt is prompt-cached across batches, so
/// bigger is cheaper per line, but a malformed reply costs the whole batch.
pub const BATCH: usize = 8;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Kept IDENTICAL for every batch so llama.cpp's prompt cache reuses it.
const SYSTEM: &str = "你是一位精通中日双语的资深ACGN翻译家，擅长轻小说、动画与游戏台词的日译中。\
请使用简体中文，不要使用繁体。将每行日文译为流畅自然的中文，贴合二次元语境与人称。\
不要使用思维链，不要输出<think>标签、分析或解释，只输出译文。\
严格按行输出：序号|译文。不要合并行，不要编造人名。";

pub fn build_user(lines: &[String]) -> String {
    lines
        .iter()
        .enumerate()
        .map(|(i, line)| format!("{}|{}", i + 1, line.replace('\n', " ")))
        .collect::<Vec<_>>()
        .join("\n")
}

fn complete(base: &str, user: String, max_tokens: u32) -> Result<String, String> {
    let body = json!({
        "messages": [
            { "role": "system", "content": SYSTEM },
            { "role": "user", "content": user },
        ],
        "temperature": 0.3,
        "top_p": 0.6,
        "max_tokens": max_tokens,
        "stream": false,
        "cache_prompt": true,
    });
    let response: serde_json::Value = ureq::post(&format!("{base}/v1/chat/completions"))
        .timeout(REQUEST_TIMEOUT)
        .send_json(body)
        .map_err(|e| format!("翻译请求失败: {e}"))?
        .into_json()
        .map_err(|e| format!("翻译响应无法解析: {e}"))?;
    response["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "翻译响应缺少内容".to_string())
}

/// Translate one batch (≤ BATCH lines). `None` = keep the Japanese.
pub fn translate_batch(base: &str, lines: &[String]) -> Result<Vec<Option<String>>, String> {
    if lines.is_empty() {
        return Ok(Vec::new());
    }
    let user = build_user(lines);
    // ~1.5 tokens per Chinese char; translations run ≤ 1.5x the source length.
    let source_chars: usize = lines.iter().map(|l| l.chars().count()).sum();
    let budget = ((source_chars * 3 + lines.len() * 8 + 32) as u32).min(MT_CTX / 2);
    let mut parsed = parse_reply(&strip_think(&complete(base, user.clone(), budget)?), lines.len());
    if parsed.iter().any(Option::is_none) {
        let retry = parse_reply(&strip_think(&complete(base, user, budget)?), lines.len());
        if leading_run(&retry) > leading_run(&parsed) {
            parsed = retry;
        }
    }
    // Trust only the leading run of numbered lines (see module docs).
    let run = leading_run(&parsed);
    let mut out: Vec<Option<String>> = parsed
        .into_iter()
        .enumerate()
        .map(|(i, zh)| if i < run { zh } else { None })
        .collect();
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = slot.take().and_then(|zh| clean_translation(&lines[i], &zh));
    }
    // Different sources, same translation → the model slid; drop the later.
    for i in 1..out.len() {
        if out[i].is_some() && out[i] == out[i - 1] && lines[i] != lines[i - 1] {
            out[i] = None;
        }
    }
    Ok(out)
}

fn leading_run(parsed: &[Option<String>]) -> usize {
    parsed.iter().take_while(|p| p.is_some()).count()
}

/// Remove `<think>…</think>` blocks and an unclosed trailing `<think>`.
pub fn strip_think(reply: &str) -> String {
    let mut out = String::with_capacity(reply.len());
    let mut rest = reply;
    while let Some(open) = rest.find("<think>") {
        out.push_str(&rest[..open]);
        match rest[open..].find("</think>") {
            Some(close) => rest = &rest[open + close + "</think>".len()..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// `N|text` lines → slot per index. Tolerates the separators small models
/// drift to (`｜ ． . 、 : ： - ) ）`) and a leading `#`; first answer wins.
pub fn parse_reply(reply: &str, expected: usize) -> Vec<Option<String>> {
    let mut out: Vec<Option<String>> = vec![None; expected];
    for line in reply.lines() {
        let line = line.trim().trim_start_matches('#').trim_start();
        let digits: String = line.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            continue;
        }
        let after = line[digits.len()..].trim_start();
        let Some(sep) = after.chars().next() else { continue };
        if !matches!(sep, '|' | '｜' | '．' | '.' | '、' | ':' | '：' | '-' | ')' | '）') {
            continue;
        }
        let text = after[sep.len_utf8()..].trim();
        let Ok(index) = digits.parse::<usize>() else { continue };
        if index == 0 || index > expected || text.is_empty() || out[index - 1].is_some() {
            continue;
        }
        out[index - 1] = Some(text.to_string());
    }
    out
}

/// Reject or tidy one translated line.
pub fn clean_translation(source: &str, zh: &str) -> Option<String> {
    let mut text = zh.trim();
    // Whole-line quotes the GPU run sometimes adds: “…” "…" 「…」
    for (open, close) in [('“', '”'), ('"', '"'), ('「', '」'), ('『', '』')] {
        if text.starts_with(open) && text.ends_with(close) && text.chars().count() >= 2 {
            let inner = &text[open.len_utf8()..text.len() - close.len_utf8()];
            if !inner.contains(open) && !inner.contains(close) {
                text = inner.trim();
            }
        }
    }
    if text.is_empty() {
        return None;
    }
    // Echo of the source = not translated.
    if text == source.trim() {
        return None;
    }
    // Still mostly kana = not translated (katakana names inside a Chinese
    // line are fine).
    let counted: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    let kana = counted
        .iter()
        .filter(|c| matches!(**c, '\u{3041}'..='\u{3096}' | '\u{30A1}'..='\u{30FA}'))
        .count();
    if !counted.is_empty() && kana * 2 > counted.len() {
        return None;
    }
    Some(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn user_prompt_is_numbered_one_per_line() {
        assert_eq!(build_user(&s(&["はい", "分かっ\nている"])), "1|はい\n2|分かっ ている");
    }

    #[test]
    fn parse_tolerates_separator_drift() {
        let reply = "1|是的\n2｜我知道\n3. 那帮家伙\n#4: 墙头草\n5、好\n6) 走\n";
        let out = parse_reply(reply, 6);
        assert_eq!(
            out,
            ["是的", "我知道", "那帮家伙", "墙头草", "好", "走"].map(|x| Some(x.to_string()))
        );
    }

    #[test]
    fn parse_ignores_out_of_range_duplicates_and_chatter() {
        let reply = "以下是译文：\n1|一\n1|重复\n3|三\n9|越界\n2|二";
        assert_eq!(
            parse_reply(reply, 3),
            vec![Some("一".into()), Some("二".into()), Some("三".into())]
        );
    }

    #[test]
    fn missing_marker_leaves_hole() {
        assert_eq!(parse_reply("1|一\n3|三", 3), vec![Some("一".into()), None, Some("三".into())]);
        assert_eq!(leading_run(&parse_reply("1|一\n3|三", 3)), 1);
    }

    #[test]
    fn think_blocks_are_stripped() {
        assert_eq!(strip_think("<think>嗯…</think>\n1|好"), "\n1|好");
        assert_eq!(strip_think("1|好\n<think>未闭合"), "1|好\n");
        assert_eq!(strip_think("1|好"), "1|好");
    }

    #[test]
    fn cleanup_rejects_untranslated_and_unwraps_quotes() {
        assert_eq!(clean_translation("分かっている", "“我知道。”"), Some("我知道。".into()));
        assert_eq!(clean_translation("分かっている", "分かっている"), None);
        assert_eq!(clean_translation("あのさ", "あのさ、それは"), None);
        assert_eq!(clean_translation("x", "   "), None);
        // a name in katakana inside a Chinese line is fine
        assert_eq!(clean_translation("ゼートゥア中将", "ゼートゥア中将来了吗"), Some("ゼートゥア中将来了吗".into()));
        // quotes inside the line are left alone
        assert_eq!(clean_translation("a", "“甲”和“乙”"), Some("“甲”和“乙”".into()));
    }
}
