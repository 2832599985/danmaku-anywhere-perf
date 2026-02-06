import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import packageJson from '../package.json' with { type: 'json' }
import { getBuildContext } from './getBuildContext.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const packageName = packageJson.name.replace(/@.*?\//, '') // Removing scope if present
const packageVersion = getBuildContext().appVersion

const buildPath = path.resolve(__dirname, '../build')
const packagePath = path.resolve(__dirname, '../package')

// create package folder
await fs.promises.mkdir(packagePath, { recursive: true })

const target = process.env.VITE_TARGET_BROWSER || 'chrome'

const tarFileName = `${packageName}-${packageVersion}-${target}.tar.gz`
const zipFileName = `${packageName}-${packageVersion}-${target}.zip`

// delete existing package files if name matches
const files = await fs.promises.readdir(packagePath)
for (const file of files) {
  if (file.startsWith(`${packageName}-${packageVersion}-${target}`)) {
    await fs.promises.unlink(path.resolve(packagePath, file))
  }
}

const run = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
  })

const tarPath = path.resolve(packagePath, tarFileName)
const zipPath = path.resolve(packagePath, zipFileName)

if (!(await fs.promises.stat(buildPath).catch(() => null))) {
  throw new Error(`Build output not found: ${buildPath}`)
}

// 1) .tar.gz
try {
  // Use argument arrays to avoid quoting issues on Windows paths with spaces.
  await run('tar', ['-czf', tarPath, '-C', buildPath, '.'])
  console.log(`Package created: ${tarPath}`)
} catch (e) {
  console.error('Error occurred:', e)
}

// 2) .zip
try {
  if (process.platform === 'win32') {
    // Windows built-in bsdtar supports "-a" to select archive format by extension.
    await run('tar', ['-a', '-c', '-f', zipPath, '-C', buildPath, '.'])
  } else {
    // On most Unix systems, "tar" is GNU tar and cannot create zip files.
    await run('zip', ['-r', zipPath, '.'], { cwd: buildPath })
  }
  console.log(`Package created: ${zipPath}`)
} catch (e) {
  console.error('Error occurred:', e)
  if (process.platform !== 'win32') {
    console.error(
      'Tip: install "zip" (e.g. apt/yum/brew) or use the .tar.gz package instead.'
    )
  }
}
