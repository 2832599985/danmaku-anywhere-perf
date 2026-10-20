/** Last path component without its extension. */
export const basenameWithoutExt = (filePath: string): string =>
  filePath
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^./\\]+$/, '')
    .trim()
