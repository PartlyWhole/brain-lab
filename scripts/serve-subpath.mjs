/**
 * Serves dist/ under a repository-style subpath, so the production artifact can
 * be checked the way GitHub Pages will actually serve it: prefixed URLs, real
 * MIME types for .wasm and .mjs, and index.html for unknown paths so hash
 * routing and deep links behave.
 *
 *   node scripts/serve-subpath.mjs [--base /robot-brain-lab/] [--port 4178]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const args = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}
const base = argOf('--base', '/robot-brain-lab/')
const port = Number(argOf('--port', '4178'))
const root = join(process.cwd(), 'dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  let path = decodeURIComponent(url.pathname)

  if (path === base.slice(0, -1)) {
    res.writeHead(301, { location: base })
    res.end()
    return
  }
  if (!path.startsWith(base)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end(`Not under ${base}`)
    return
  }
  path = path.slice(base.length)

  const resolve = async (rel) => {
    const full = join(root, normalize('/' + rel))
    if (!full.startsWith(root)) return null
    try {
      const s = await stat(full)
      return s.isFile() ? full : null
    } catch {
      return null
    }
  }

  const file = (await resolve(path)) ?? (await resolve('index.html'))
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Not found')
    return
  }
  const body = await readFile(file)
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  res.end(body)
}).listen(port, () => {
  console.log(`serving dist at http://localhost:${port}${base}`)
})
