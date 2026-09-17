# The supported Python subset

Robot Brain Lab runs **real Python 3.14** (Pyodide 314.0.7) in a browser
worker. It does not simulate Python. Everything listed as supported below
behaves exactly as CPython does, because CPython is what runs it.

What is *not* listed is not approximated. The lab reports unsupported
behaviour explicitly rather than drawing a plausible-looking picture of it.

## Types

| Type | Shown as | Notes |
|---|---|---|
| `int` | a number tile | Unbounded. Serialized as a decimal string, so precision never depends on JavaScript's number range. |
| `float` | a number tile | `nan`, `inf` and `-inf` are labelled by name. |
| `bool` | a True/False tile | Distinguished from `int`, so `True` and `1` are separate tiles. |
| `str` | a text tile | Displayed up to 2,000 characters, then explicitly marked as shortened. |
| `None` | a None tile | |
| `list` | slots, numbered from 0 | Only real slots are drawn. |
| `tuple` | fixed slots | Its references cannot be replaced; referenced mutable objects still can change. |
| `dict` | key/value entries | Insertion order preserved. |
| `set` | unordered items | |
| function | a function tile | Created by `def`; calling it opens a call workspace. |

Anything else is shown as an *unsupported* tile carrying its type name. The
lab never calls a user-defined `__repr__` or a property to describe an object.

## Statements

Supported: name binding (`x = …`), list slot assignment (`xs[i] = …`),
`list.append(…)`, `print(…)`, `if` / `else`, `for … in …`, `break`,
`continue`, and `def` with `return`.

Not in this release: `while` (the runtime handles it; the visual palette does
not offer it yet), `elif` as a distinct card, comprehensions, `import`,
classes, `try`/`except`, `with`, generators, decorators, `global`/`nonlocal`,
augmented assignment (`+=`), slicing, and unpacking assignment.

## Expressions

Supported: integer, string, boolean and `None` literals; name lookup; list
display; `+ - * // %`; `> < >= <= == !=`; indexing; and calls to `len`, `sum`,
`max`, `min`, `abs`, `range`, `str`, `int`.

Comparison chaining (`0 < x < 10`) is not offered by the palette. `and`, `or`
and `not` are deliberately later lessons: the design introduces explicit
comparisons before truthiness and short-circuit evaluation.

## Builtins available to a student program

`abs bool dict divmod enumerate float int len list max min print range
reversed round set sorted str sum tuple zip`, plus the exception names
`Exception IndexError KeyError TypeError ValueError ZeroDivisionError
NameError AttributeError StopIteration`.

This restricted mapping is what bounds the supported *language*. It is not a
security boundary, and a static site's worker cannot be one — see
"Known limitations" in the README.

## Identity: a deliberate decision

- **Mutable objects (`list`, `dict`, `set`) and `tuple`s are identified by real
  object identity.** Two names on one list converge on one tile. Two equal but
  separately created lists are two tiles with different identity badges. This
  is where sharing matters pedagogically, and the lab tells the truth about it.

- **Immutable scalars (`int`, `float`, `str`, `bool`, `None`) are identified by
  value.** Equal numbers are always drawn as one tile.

The second point is a choice, not an accident. CPython interns small integers
and some strings, so whether `1000` and `1000` are "the same object" is an
implementation detail that changes with the value. The design document asks us
not to build identity puzzles on that. Value identity makes the claim the
curriculum actually needs — *appending a number does not copy it* — true for
every number rather than only the interned ones.

The consequence to be aware of: the lab does not, and should not, be used to
teach `is` on integers or strings.

## Execution observation

Statement boundaries come from `sys.settrace`, filtered to the student's own
program. CPython reports a line event *before* that line runs, so:

- every line event is labelled `before-instruction`, and its snapshot is the
  state the instruction is about to act on;
- the state an instruction *produced* is the snapshot on the following event;
- a terminal `end` event always exists, so the last instruction's effect is
  always visible.

Function calls and returns get their own `call` and `return` events, with the
returned object included in the graph. The module frame's own call and return
are suppressed, because they duplicated the first and last steps and would
have appeared as phantom instructions.

Expression-level animation is not claimed. A single line can contain several
operations; line tracing reports the line, not the sub-steps. Manual mode is
where evaluation is exposed in finer detail, one operation at a time.

## Limits on a single run

| Budget | Default | Why |
|---|---|---|
| Trace events | 2,000 | Keeps playback inspectable and stops a nonterminating method. |
| Visible objects | 500 | Bounds snapshot size. |
| Output | 20,000 bytes | |
| String display | 2,000 characters | |
| Container items | 200 | |

Exceeding a budget stops the run, keeps everything recorded so far, and says
so. It is a lab safeguard, never presented as a rule of Python.

A cooperative budget cannot interrupt every long-running native operation, so
the Stop control terminates the worker outright and starts a fresh one. The
student's method lives in the app, not in the worker, so nothing of theirs is
lost.

## Garbage collection

Objects are held alive for the duration of a run so their identities stay
stable in the trace. Garbage collection, finalizers and object lifetime are
therefore outside the supported learning semantics, and the lab does not
suggest that an unreferenced object is destroyed at a particular moment.
Unreachable objects may be dimmed; they are never animated as being deleted.
