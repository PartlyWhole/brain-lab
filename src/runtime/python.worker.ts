/// <reference lib="webworker" />
/**
 * The Python worker.
 *
 * Loads the self-hosted, pinned Pyodide distribution and runs the same
 * `python/*.py` modules the semantic tests exercise. Only plain JSON crosses
 * back to the app: no Python proxies, no live object references.
 *
 * The worker is a responsiveness mechanism, not a security boundary. The
 * supported subset is bounded by the restricted builtins in observe.py and by
 * the emitter, not by this file.
 */
import observeSource from '../../python/observe.py?raw'
import sessionSource from '../../python/session.py?raw'
import contractsSource from '../../python/contracts.py?raw'

interface PyodideLike {
  runPython(code: string): unknown
  globals: { set(name: string, value: unknown): void }
  FS: { mkdirTree(p: string): void; writeFile(p: string, data: string, o?: unknown): void }
}

let pyodide: PyodideLike | null = null
let loading: Promise<PyodideLike> | null = null

function post(message: unknown) {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(message)
}

async function ensurePyodide(runtimeUrl: string, requestId: string): Promise<PyodideLike> {
  if (pyodide) return pyodide
  if (!loading) {
    loading = (async () => {
      post({ type: 'progress', requestId, message: 'Waking Pip up…' })
      // Loaded at run time from the self-hosted copy, not bundled: the wasm and
      // stdlib are large and versioned separately from the app bundle.
      const mod = (await import(/* @vite-ignore */ `${runtimeUrl}pyodide.mjs`)) as {
        loadPyodide: (o: { indexURL: string }) => Promise<PyodideLike>
      }
      const py = await mod.loadPyodide({ indexURL: runtimeUrl })
      py.FS.mkdirTree('/rbl')
      py.FS.writeFile('/rbl/observe.py', observeSource, { encoding: 'utf8' })
      py.FS.writeFile('/rbl/session.py', sessionSource, { encoding: 'utf8' })
      py.FS.writeFile('/rbl/contracts.py', contractsSource, { encoding: 'utf8' })
      py.runPython(
        `import sys\nsys.path.insert(0, '/rbl')\nimport observe, session, contracts\n`,
      )
      pyodide = py
      return py
    })()
  }
  return loading
}

function callPython(py: PyodideLike, code: string, args: Record<string, unknown>): unknown {
  for (const [key, value] of Object.entries(args)) py.globals.set(key, value)
  const json = py.runPython(code) as string
  return JSON.parse(json)
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as Record<string, unknown>
  const requestId = String(msg.requestId ?? '')
  try {
    switch (msg.type) {
      case 'init': {
        const started = performance.now()
        const py = await ensurePyodide(String(msg.runtimeUrl), requestId)
        const version = py.runPython('import sys; sys.version.split()[0]') as string
        post({
          type: 'ready',
          requestId,
          pythonVersion: version,
          startupMs: Math.round(performance.now() - started),
        })
        break
      }

      case 'run': {
        const py = await ensurePyodide(String(msg.runtimeUrl), requestId)
        const result = callPython(
          py,
          `
import json, observe
_m = {int(k): v for k, v in json.loads(_rbl_map).items()}
_setup_ns = {}
if _rbl_setup:
    exec(compile(_rbl_setup, '<mission-setup>', 'exec'),
         {'__builtins__': observe._safe_builtins()}, _setup_ns)
_b = observe.Budgets(**json.loads(_rbl_budgets))
json.dumps(observe.run_program(_rbl_source, _m, _setup_ns, _b))
`,
          {
            _rbl_source: msg.source,
            _rbl_map: JSON.stringify(msg.lineToCard ?? {}),
            _rbl_setup: msg.setup ?? '',
            _rbl_budgets: JSON.stringify(msg.budgets ?? {}),
          },
        )
        post({ type: 'runResult', requestId, result })
        break
      }

      case 'manual': {
        const py = await ensurePyodide(String(msg.runtimeUrl), requestId)
        const result = callPython(
          py,
          `
import json, session
json.dumps(session.run_commands_and_check(
    _rbl_setup, json.loads(_rbl_commands), _rbl_check or None))
`,
          {
            _rbl_setup: msg.setup ?? '',
            _rbl_commands: JSON.stringify(msg.commands ?? []),
            _rbl_check: msg.checkSource ?? '',
          },
        )
        post({ type: 'manualResult', requestId, result })
        break
      }

      case 'checkContract': {
        const py = await ensurePyodide(String(msg.runtimeUrl), requestId)
        const result = callPython(
          py,
          `
import json, contracts
json.dumps(contracts.check(_rbl_source, json.loads(_rbl_cases), _rbl_check,
                           json.loads(_rbl_misconceptions)))
`,
          {
            _rbl_source: msg.source,
            _rbl_cases: JSON.stringify(msg.cases ?? []),
            _rbl_check: msg.checkSource ?? '',
            _rbl_misconceptions: JSON.stringify(msg.misconceptions ?? []),
          },
        )
        post({ type: 'contractResult', requestId, result })
        break
      }

      default:
        post({
          type: 'failed',
          requestId,
          error: { kind: 'UnknownRequest', message: `Unknown request ${String(msg.type)}` },
        })
    }
  } catch (err) {
    post({
      type: 'failed',
      requestId,
      error: {
        kind: (err as Error)?.name ?? 'Error',
        message: (err as Error)?.message ?? String(err),
      },
    })
  }
}
