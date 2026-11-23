import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'

const execFileAsync = promisify(execFile)
const extensionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const requiredFramegenAssets = [
  'assets/framegen/LICENSE',
  'assets/framegen/WEIGHTS_LICENSE.md',
  'assets/framegen/rt_v7s.bin',
  'assets/framegen/rt_v7s.json',
] as const

test('build and package include the Framegen model and licenses', async () => {
  test.setTimeout(120_000)

  for (const assetPath of requiredFramegenAssets) {
    const asset = await stat(path.join(extensionRoot, 'build', assetPath))
    expect(asset.isFile(), `${assetPath} should be a build file`).toBe(true)
    expect(asset.size, `${assetPath} should not be empty`).toBeGreaterThan(0)
  }

  await execFileAsync(process.execPath, ['./scripts/package.js'], {
    cwd: extensionRoot,
    env: {
      ...process.env,
      VERSION_SUFFIX: '',
      VITE_TARGET_BROWSER: 'chrome',
    },
  })

  const packageJson = JSON.parse(
    await readFile(path.join(extensionRoot, 'package.json'), 'utf8')
  ) as { name: string; version: string }
  const packageName = packageJson.name.replace(/@.*?\//, '')
  const archivePath = path.join(
    extensionRoot,
    'package',
    `${packageName}-${packageJson.version}-chrome.zip`
  )
  const archive = await JSZip.loadAsync(await readFile(archivePath))

  for (const assetPath of requiredFramegenAssets) {
    const entry = archive.file(assetPath)
    expect(
      entry,
      `${assetPath} should be present in the package`
    ).not.toBeNull()
    const contents = await entry?.async('uint8array')
    expect(
      contents?.byteLength,
      `${assetPath} should not be empty`
    ).toBeGreaterThan(0)
  }
})
