# Deployment

## What gets published

Two pages: `index.html` is the one-screen Memory Sandbox, and `lessons.html`
is the mission-based lesson game. They share the runtime and the renderer.

`dist/` contains the app bundle plus `runtime/pyodide/`, a pinned copy of the
Pyodide distribution. The site is fully self-hosted: nothing is fetched from a
CDN at play time, so a build is reproducible and the lab does not break when
someone else's CDN does.

| Part | Size |
|---|---|
| App JS | ~434 KB (~128 KB gzipped) |
| CSS | ~25 KB (~5 KB gzipped) |
| Pyodide wasm | 9.6 MB |
| Python stdlib | 2.5 MB |
| Pyodide loader + lock | 1.4 MB |
| **Total `dist/`** | **~17 MB** |

This is comfortably inside GitHub Pages' documented 1 GB site limit and 100 MB
per-file limit. Check the current limits against the built artifact rather than
assuming, since they can change:
<https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>

Only the runtime files the app actually loads are copied; the optional Pyodide
package collection is deliberately excluded.

## Base paths

`VITE_BASE` sets the deployment base path, and every asset, worker, runtime and
lesson URL is derived from it.

| Site | `VITE_BASE` |
|---|---|
| `https://partlywhole.github.io/brain-lab/` | `/brain-lab/` (derived from the repository name) |
| `https://OWNER.github.io/` | `/` (set repository variable `BASE_PATH`) |

Routing is hash-based (`#/mission/heavy-parcels`). Pages applies no rewrite
rules, so a path route would 404 on refresh; a hash route always requests the
existing `index.html`. Deep links and reloads therefore work with no server
configuration, and the browser journeys assert it.

## The workflows

`.github/workflows/checks.yml` runs on pull requests: type check, tests, a
production build at a project subpath, and the browser journeys. It publishes
nothing.

`.github/workflows/deploy.yml` runs on `main`: the same checks, then
`upload-pages-artifact`, then a separate deployment job using the
`github-pages` environment with narrowly scoped permissions. Deployments are
serialized and in-progress ones are allowed to finish.

After deploying it smoke-tests the **published URL**: the page itself, the
runtime version manifest, and that the wasm is served as `application/wasm`. A
green deploy therefore means the site actually serves, not merely that a build
succeeded.

## Rolling back

Re-run the deploy workflow on a known-good commit. The runtime assets are
pinned by the `pyodide` version in `package-lock.json`, so an older commit
redeploys with exactly the runtime it was tested against.

## Verifying a build locally

```bash
VITE_BASE=/brain-lab/ npm run build
npm run serve:subpath -- --base /brain-lab/   # http://localhost:4178/brain-lab/
```

`scripts/serve-subpath.mjs` serves `dist/` under a prefix with correct MIME
types for `.wasm` and `.mjs`, which is how Pages behaves. Visiting
`#/diagnostics` reports the resolved runtime URL, the real Python version and
measured startup, and can run the fixtures and a hard stop.

## Versions in the build

Every build embeds its commit and build time (visible on the diagnostics page),
and `runtime/runtime-version.json` records the pinned Pyodide version and the
files copied.
