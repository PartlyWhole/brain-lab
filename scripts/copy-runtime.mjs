/**
 * Copies the pinned Pyodide distribution into public/runtime/ so the deployed
 * site self-hosts its own runtime. Nothing is fetched from a CDN at play time:
 * the build is reproducible and the site keeps working if a CDN does not.
 *
 * Only the files the app actually loads are copied. The optional package
 * collection is deliberately left out; it would multiply the artifact size for
 * packages the supported subset never imports.
 */
import { createRequire } from 'node:module'
import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkgPath = require.resolve('pyodide/package.json')
const pyodideDir = dirname(pkgPath)
const version = JSON.parse(await readFile(pkgPath, 'utf8')).version

const FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
]

const outDir = join(process.cwd(), 'public', 'runtime', 'pyodide')
await mkdir(outDir, { recursive: true })

let total = 0
for (const file of FILES) {
  const from = join(pyodideDir, file)
  const to = join(outDir, file)
  await copyFile(from, to)
  total += (await stat(to)).size
}

await writeFile(
  join(process.cwd(), 'public', 'runtime', 'runtime-version.json'),
  JSON.stringify({ pyodideVersion: version, files: FILES, bytes: total }, null, 2) + '\n',
)

console.log(
  `runtime: pyodide ${version}, ${FILES.length} files, ${(total / 1024 / 1024).toFixed(1)} MB -> public/runtime/pyodide/`,
)
