# Execution board

Current enough for another agent to resume after context loss. Update the
status column and the evidence line when a workstream moves.

**Delivery target:** roadmap M1–M3 plus read-only Python reveal, as a verified
static artifact deployable to GitHub Pages.

## Status summary

| # | Workstream | Owner | Status | Evidence |
|---|---|---|---|---|
| 0 | Runtime + trace feasibility | Lead | **Done** | 48 semantic tests; production build checked at `/robot-brain-lab/` |
| 1 | Shared contracts | Lead | **Done** | `src/program/types.ts`, `src/runtime/types.ts`, `python/*.py` |
| 2 | Brain workspace UI | Brain/UI | **Done** | 79 layout tests; accessibility suite; live journeys |
| 3 | Nested method editor + code reveal | Lead | **Done** | 22 edit tests; construction and code-reveal journeys |
| 4 | Mission content + contracts | Content | **Done** | 46 tests, including that each case set catches its intended bug |
| 5 | Lesson shell, playback, persistence | Lead | **Done** | 11 playback + 10 tool + 12 persistence tests; journeys |
| 6 | Build, Pages workflow, docs | Lead | **Done** | subpath build verified in-browser; both workflows written |

**Totals: 237 unit and semantic tests, 27 browser journeys. All passing.**

## Published

**<https://partlywhole.github.io/brain-lab/>** — repository
`PartlyWhole/brain-lab`, project site, deployed by
`.github/workflows/deploy.yml` from `main`.

Verified on the live site, not just in CI: Python 3.14.2 boots from the
published URL in 1576 ms, the wasm is served as `application/wasm`, a mission
deep link loads and its setup state arrives from real Python.

## What remains before this is in front of a learner

1. **Learner age and reading level are still unresolved.** Copy is short and
   plain and text size is adjustable, but the reading level has not been set by
   anyone who knows the learner.
2. **No learner pilot has happened.** Every claim recorded here is a product
   check. M4 is where learning evidence starts.

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

## Defects found by driving the real product, and fixed

Each was reproduced through the student's own interaction before the fix and
re-driven afterwards; a unit test alone was not treated as proof.

1. A returned object reachable only as a return value was absent from the
   snapshot graph, so `return` showed a dangling reference.
2. Reference counts lumped names, container slots and work-area holds into one
   number, so "two names, one list" read as "3 references" — burying the point
   of the mission. They now name their sources.
3. Autosave could lose the student's most recent action inside its debounce
   window. Manual operations now save immediately, and editor edits flush on
   page hide.
4. Card tools and insertion points appeared only on hover, so they did not
   exist at all on a touch tablet; at `opacity: 0` they also swallowed clicks
   meant for neighbouring controls.
5. The sticky header covered any control scrolled or focused to the top of the
   viewport.
6. `--ink-faint`, `--name-tag` and `--draft` failed WCAG AA contrast (2.96,
   4.18 and 3.0 against their own backgrounds).
7. `<ol>` contained non-`<li>` children, which stops a screen reader treating
   the instructions as a list.
8. The brain's layout is computed in absolute pixels while fonts scaled with
   the text-size control, so enlarging text broke the layout. The canvas now
   zooms as one piece.
9. A scope label kept its default `<p>` margin while absolutely positioned and
   sat on top of the first name tag.
10. An empty method counted as runnable, so "Test it on everything" would run
    nothing and report a wall of failures instead of the one true reason. An
    unwritten method, and one that never binds the answer name, are now drafts.
11. The same "no instructions yet" sentence appeared in both the editor and the
    feedback strip — the duplicated-idea clutter the design warns against.
12. A comparison read "only if is weight > limit", and changing `>` to `>=`
    meant rebuilding the whole comparison. The operator now sits between its
    operands, in words ("weight is bigger than limit"), and is itself the
    control that changes it.

## Open questions for the user (not blocking)

- Learner age and reading level. Recorded as unresolved; copy is written short
  and plain in the meantime.
