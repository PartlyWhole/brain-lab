# Memory Sandbox

**<https://partlywhole.github.io/brain-lab/>**

One screen for teaching three things: **variable binding, object creation, and
operations**. Drag an object into memory, drop a name on it, drop something
onto a list, and watch what actually happens.

Every object is a real **Python 3.14** object running in a browser worker. The
diagram is not a drawing of what Python would do — it is a rendering of what
Python did. Two names on one list converge on one tile because they really are
one object.

Everything can be done by dragging or by clicking (pick up, put down), and it
works on a touch tablet. No accounts, no backend, no saving.

A larger mission-based lesson game is built from the same runtime and renderer
and lives at [`/lessons.html`](https://partlywhole.github.io/brain-lab/lessons.html).

## The two pages

| Page | What it is |
|---|---|
| `index.html` | **The sandbox.** One screen: make objects, name them, operate on them. No missions, no grading, no saving. |
| `lessons.html` | The mission-based game: manual memory puzzles, three student-built algorithms, playback and a Python reveal. Nothing links to it from the sandbox; open it by URL. |

Both are built from the same verified runtime and the same memory renderer, so
what they draw cannot disagree.

## Run it

```bash
npm install
npm run dev
```

The first load downloads the Python runtime (about 13 MB, served compressed)
and starts it in a worker; roughly 1.3 s once cached. The lesson game's
diagnostics page (`lessons.html#/diagnostics`) reports the real measurement on
your machine.

## Check it

```bash
npm run typecheck   # tsc over src, content, tests and tooling
npm run test        # 233 unit and semantic tests, real Python via Pyodide
npm run test:browser # 38 browser journeys against the production build
```

`npm run test:browser` builds the site, serves it at a repository subpath, and
drives it in Chromium. It covers the sandbox by dragging and by clicking, the manual-to-method
journey, building a method from nothing, the repair journey, keyboard-only
operation, save and restore, export/import, runtime failure and recovery, and
automated accessibility.

## Publish it

Nothing here assumes a particular GitHub owner or repository; both come from
wherever the workflow runs.

1. Push this repository to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. `.github/workflows/deploy.yml` type-checks, tests, builds
   with the base path set from the repository name, runs the browser journeys
   against that build, publishes, and then smoke-tests the published URL.

For a user or organisation site (`https://OWNER.github.io/`), set a repository
variable `BASE_PATH` to `/`. For a project site
(`https://partlywhole.github.io/brain-lab/`) the default is already correct.

To check the production artifact locally exactly as Pages will serve it:

```bash
VITE_BASE=/brain-lab/ npm run build && npm run serve:subpath --base /brain-lab/
```

## How it fits together

```
python/observe.py     object-graph serializer and statement tracer
python/session.py     manual operations on real Python objects
python/contracts.py   per-case grading and misconception diagnosis

src/program/          the program tree, its edits, and the Python emitter
src/runtime/          worker, client, and the JSON contract between them
src/brain/            object tiles, name tags, reference arrows, drag, layout
src/editor/           nested method editor and read-only code reveal
src/sandbox/          the one-screen sandbox
src/lessons/          mission shells, tool palette, playback, hints
src/persistence/      IndexedDB, export and import
content/lessons/      the missions
content/coverage/     all 214 source exercises and their adaptation status
```

Three ideas carry most of the weight:

- **One program tree.** The editor edits it, the emitter renders it as Python,
  and the worker runs that Python. The visual method and the code reveal
  cannot describe different behaviour because there is only one description.
- **Python owns the state.** The interface renders a serialized snapshot. It
  never edits the displayed graph directly, so it cannot draw something Python
  did not do.
- **Snapshots are immutable plain data.** A historical state cannot be
  rewritten by a later mutation, which is what makes stepping backwards
  trustworthy.

See [docs/supported-subset.md](docs/supported-subset.md) for exactly what
Python the lab supports, and [docs/execution-board.md](docs/execution-board.md)
for project state and the decisions behind it.

## What this release is not

Scope stops at a first useful release: manual memory missions, three
student-built algorithms, and the Python reveal.

- **No editable Python.** The code panel is read-only. Typing Python is a
  later milestone with its own parser and validation work.
- **No accounts, cloud sync, or teacher dashboards.** Work lives in this
  browser. Export is the backup, and the lab says so when storage is blocked.
- **No offline mode.** Ordinary HTTP caching only; a service worker needs an
  update-invalidation design first.
- **Not the whole curriculum.** All 214 source exercises are inventoried and
  mapped, but eight missions are built. The coverage manifest tracks the rest
  honestly rather than claiming them.
- **`while`, dictionaries, sets and functions** run correctly in the runtime
  and are covered by semantic tests, but the visual palette does not offer
  them yet.
- **Not a tamper-proof assessment platform.** Every test and answer ships in
  the static bundle, because a static site cannot hide them. Hidden-in-the-UI
  cases are not secret cases.
- **Not a security boundary.** The worker keeps the interface responsive. The
  supported language is bounded by a restricted builtins mapping and by the
  emitter, not by sandboxing.
- **Not yet piloted with a learner.** Every claim here is a product check.
  Whether children actually learn from it is an open question, and the
  intended age and reading level are still unresolved.

## Known limitations

- The lab teaches identity for lists, dictionaries and sets, where sharing is
  real. Equal numbers and strings are deliberately drawn as one object
  regardless of CPython interning, so the lab should not be used to teach `is`
  on scalars. The reasoning is in
  [docs/supported-subset.md](docs/supported-subset.md).
- A run is bounded (2,000 trace events, 500 visible objects, 20 KB of output).
  Exceeding a budget stops the run, keeps what was recorded, and says so.
- Stopping a method terminates the worker, so the runtime restarts (about
  1.1 s). The student's method is never in the worker, so nothing is lost.
- Dictionary and set tiles render correctly but have not been tuned, because
  no mission produces them yet.
- Browser journeys run in Chromium only.
