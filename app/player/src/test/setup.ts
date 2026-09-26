/**
 * Unit-test environment for the player.
 *
 * Node has no `localStorage`, and the player store persists to it; without a
 * stand-in, every store-backed module logs "storage is currently unavailable"
 * and skips persistence. An in-memory implementation lets those modules run in
 * tests exactly as they do in the app.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const data = new Map<string, string>()
  globalThis.localStorage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}
