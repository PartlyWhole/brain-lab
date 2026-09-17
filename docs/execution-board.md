# Execution board

Current enough for another agent to resume after context loss. Update the
status column and the evidence line when a workstream moves.

**Delivery target:** roadmap M1–M3 plus read-only Python reveal, as a verified
static artifact deployable to GitHub Pages.

## Status summary

| # | Workstream | Owner | Status | Evidence |
|---|---|---|---|---|
| 0 | Runtime + trace feasibility | Lead | **Done** | 48 semantic tests; browser check of production build at `/robot-brain-lab/` |
| 1 | Shared contracts | Lead | **Done** | `src/program/types.ts`, `src/runtime/types.ts`, `python/*.py` |
| 2 | Brain workspace UI | Brain/UI | Not started | — |
| 3 | Nested method editor + code reveal | Editor | Not started | — |
| 4 | Mission content + contracts | Content | Not started | — |
| 5 | Lesson shell, playback, persistence | Lead | Not started | — |
| 6 | Build, Pages workflow, docs | Lead | Partial | subpath build verified; workflow not written |

## M0 evidence (closed)

Measured on this machine, production build served under `/robot-brain-lab/`:

- Python **3.14.2** via pinned Pyodide **314.0.7**, self-hosted (12.9 MB of
  runtime assets, 17 MB `dist/` total).
- Cold runtime start **1268 ms**; start after a hard stop **1112 ms**.
- Sharing, rebinding, append-without-copy, immutable historical snapshots,
  empty/nonempty loops, branch skips, nested calls, implicit and explicit
  returns, exceptions with preserved prior effects, cyclic graphs, unbounded
  integers: `tests/semantics/trace-fidelity.test.ts` (30 cases).
- Emitter precedence, escaping, indentation and source mapping, cross-checked
  by executing the emitted Python: `tests/semantics/emitter.test.ts` (18 cases).
- Runaway `while True` stopped by the trace budget with state preserved; hard
  stop terminated the worker and a fresh runtime served the next run with no
  page reload.

## Contracts other workstreams must code against

- **Program tree** — `src/program/types.ts`. Statements are cards with stable
  ids; `hole` marks an unfilled operand. Only the editor mutates it.
- **Python emission** — `src/program/emit.ts`. `emitProgram` returns
  `{ source, lineToCard, cardToLine }`. Nothing else may generate Python.
- **Runtime graph** — `src/runtime/types.ts`. `Snapshot`, `TraceEvent`,
  `RunResult`, plus `describeObject`, `reachableFrom`, `referenceCounts`.
- **Worker** — `src/runtime/client.ts`. `getRuntime()` gives the shared
  `PythonRuntime`: `run`, `manual`, `checkContract`, `cancel`.
- **Manual operations** — `python/session.py`. Typed commands against real
  Python objects; undo is replay of a command prefix, never inversion.
- **Grading** — `python/contracts.py`. Per-case fresh namespace, deep copy of
  declared inputs taken before the run.

## Decisions taken, with reasons

1. **Scalar identity is by value; container identity is by object.** CPython
   interning is implementation-defined and the design forbids building identity
   puzzles on it. Value identity makes "append did not copy the number" true for
   every integer rather than only the interned ones. Sharing that matters
   pedagogically — lists, dicts, sets — uses real object identity.
2. **A line event is labelled `before-instruction`, never "done".** CPython
   reports a line before it runs. The state a card produced is the next event's
   snapshot, so a terminal `end` event always exists.
3. **Self-hosted, pinned runtime.** No CDN at play time; reproducible builds.
4. **Cancellation is worker termination plus immediate restart.** A cooperative
   budget cannot interrupt every native operation. The student's method lives in
   the app, so nothing of theirs is lost.
5. **The module frame's call/return events are suppressed.** They duplicated the
   first and last steps and would have shown as phantom instructions.

## Open questions for the user (not blocking)

- GitHub owner/repository, and root vs project site. Deployment config is
  written to take either; nothing is invented.
- Learner age and reading level. Recorded as unresolved; copy is written short
  and plain in the meantime.
