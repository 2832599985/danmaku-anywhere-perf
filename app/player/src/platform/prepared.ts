/**
 * URLs already resolved by `prepareMediaUrl`, keyed by absolute source path.
 *
 * The `<video>` element resolves through the platform adapter; the progress
 * bar's hover thumbnail uses the same file and must not decode the original
 * FLV/TS/AVI (the webview cannot). A synchronous lookup is enough there: by the
 * time a user hovers the bar, the media has been opened and prepared.
 */
const prepared = new Map<string, string>()

export const rememberPreparedUrl = (path: string, url: string): void => {
  prepared.set(path, url)
}

export const preparedUrlForPath = (path: string): string | undefined =>
  prepared.get(path)
