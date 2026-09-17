"""Object-graph serialization and execution observation for Robot Brain Lab.

Contract guarantees relied upon by the rest of the app:

* A serialized snapshot contains only plain immutable data (str / int / bool /
  None and containers built here). It never holds a reference to a live Python
  object, so a historical snapshot cannot change when a live list is mutated
  later. This is the "historical snapshots are immutable" requirement.
* Object identity is run-local. The registry keeps a strong reference to every
  object it has named, so CPython cannot recycle an ``id()`` and hand two
  different objects the same run-local id during one run.
* Identity policy (documented deliberately, see docs/supported-subset.md):
    - Mutable objects (list, dict, set) and tuples / functions are identified by
      true object identity. This is where sharing is pedagogically real.
    - Immutable scalars (int, float, str, bool, None) are identified by value.
      CPython's small-int and string interning is implementation-defined; the
      design brief asks us not to build identity puzzles on it. Value identity
      makes "append does not copy the number" true and deterministic for every
      value, not just interned ones.
"""

import sys
import math

SUPPORTED_SCALARS = (bool, int, float, str, type(None))


class ExecutionBudgetExceeded(Exception):
    """Raised inside the traced program when a run exceeds its event budget."""


class GraphTooLarge(Exception):
    """Raised when a single snapshot exceeds the visible-object budget."""


class Budgets(object):
    def __init__(
        self,
        max_events=2000,
        max_objects=500,
        max_output_bytes=20000,
        max_string_chars=2000,
        max_container_items=200,
    ):
        self.max_events = max_events
        self.max_objects = max_objects
        self.max_output_bytes = max_output_bytes
        self.max_string_chars = max_string_chars
        self.max_container_items = max_container_items


class ObjectRegistry(object):
    """Assigns stable run-local ids and prevents id() reuse within the run."""

    def __init__(self):
        self._by_identity = {}   # id(obj) -> uid          (mutable objects)
        self._by_value = {}      # (typename, key) -> uid  (immutable scalars)
        self._keep = []          # strong refs; stops id() recycling
        self._next = 1

    def _mint(self):
        uid = "o%d" % self._next
        self._next += 1
        return uid

    @staticmethod
    def _value_key(obj):
        """Canonical key for a scalar, distinguishing types that compare equal."""
        if obj is None:
            return ("none", None)
        if obj is True or obj is False:
            return ("bool", obj)
        if isinstance(obj, int):
            return ("int", obj)
        if isinstance(obj, float):
            if math.isnan(obj):
                return ("float", "nan")
            return ("float", repr(obj))
        if isinstance(obj, str):
            return ("str", obj)
        return None

    def uid(self, obj):
        key = self._value_key(obj)
        if key is not None:
            got = self._by_value.get(key)
            if got is None:
                got = self._mint()
                self._by_value[key] = got
                self._keep.append(obj)
            return got

        ident = id(obj)
        got = self._by_identity.get(ident)
        if got is None:
            got = self._mint()
            self._by_identity[ident] = got
            self._keep.append(obj)
        return got

    def reset(self):
        self._by_identity.clear()
        self._by_value.clear()
        del self._keep[:]
        self._next = 1


def _type_name(obj):
    if obj is None:
        return "none"
    if obj is True or obj is False:
        return "bool"
    if isinstance(obj, int):
        return "int"
    if isinstance(obj, float):
        return "float"
    if isinstance(obj, str):
        return "str"
    if isinstance(obj, list):
        return "list"
    if isinstance(obj, tuple):
        return "tuple"
    if isinstance(obj, dict):
        return "dict"
    if isinstance(obj, set):
        return "set"
    if callable(obj):
        return "function"
    return "unsupported"


class Serializer(object):
    """Walks a reachable object graph and produces a plain-data snapshot."""

    def __init__(self, registry, budgets):
        self.registry = registry
        self.budgets = budgets

    def serialize(self, roots):
        """roots: list of (scope_dict) already holding live objects.

        Returns (objects_dict, truncated_flag).
        """
        objects = {}
        truncated = [False]
        pending = []

        def ref(obj):
            uid = self.registry.uid(obj)
            if uid not in objects:
                objects[uid] = None          # reserve the slot: stops cycles
                pending.append((uid, obj))
            return uid

        seeds = []
        for scope in roots:
            for _name, obj in scope:
                seeds.append(ref(obj))

        while pending:
            if len(objects) > self.budgets.max_objects:
                truncated[0] = True
                break
            uid, obj = pending.pop(0)
            objects[uid] = self._describe(uid, obj, ref, truncated)

        # Any slot still reserved but undescribed (budget cut) becomes a stub.
        for uid in list(objects.keys()):
            if objects[uid] is None:
                objects[uid] = {"id": uid, "type": "elided"}

        return objects, truncated[0]

    def _describe(self, uid, obj, ref, truncated):
        kind = _type_name(obj)
        base = {"id": uid, "type": kind}

        if kind == "none":
            return base
        if kind == "bool":
            base["value"] = bool(obj)
            return base
        if kind == "int":
            # Decimal string: Python ints are unbounded, JS numbers are not.
            base["text"] = str(obj)
            return base
        if kind == "float":
            if math.isnan(obj):
                base["text"] = "nan"
            elif math.isinf(obj):
                base["text"] = "inf" if obj > 0 else "-inf"
            else:
                base["text"] = repr(obj)
            return base
        if kind == "str":
            limit = self.budgets.max_string_chars
            base["length"] = len(obj)
            if len(obj) > limit:
                base["text"] = obj[:limit]
                base["truncated"] = True
                truncated[0] = True
            else:
                base["text"] = obj
                base["truncated"] = False
            return base
        if kind in ("list", "tuple"):
            limit = self.budgets.max_container_items
            items = list(obj)
            if len(items) > limit:
                base["slots"] = [ref(x) for x in items[:limit]]
                base["truncated"] = True
                base["length"] = len(items)
                truncated[0] = True
            else:
                base["slots"] = [ref(x) for x in items]
                base["truncated"] = False
                base["length"] = len(items)
            return base
        if kind == "dict":
            entries = []
            for i, (k, v) in enumerate(obj.items()):
                if i >= self.budgets.max_container_items:
                    base["truncated"] = True
                    truncated[0] = True
                    break
                entries.append({"key": ref(k), "value": ref(v)})
            base["entries"] = entries
            base.setdefault("truncated", False)
            base["length"] = len(obj)
            return base
        if kind == "set":
            items = []
            for i, x in enumerate(obj):
                if i >= self.budgets.max_container_items:
                    base["truncated"] = True
                    truncated[0] = True
                    break
                items.append(ref(x))
            base["items"] = items
            base.setdefault("truncated", False)
            base["length"] = len(obj)
            return base
        if kind == "function":
            base["name"] = getattr(obj, "__name__", "function")
            return base

        # Unsupported: never call user repr or properties.
        base["label"] = type(obj).__name__
        return base


class _OutputRecorder(object):
    """Collects program output without letting it grow without bound."""

    def __init__(self, limit):
        self.limit = limit
        self.chunks = []
        self.length = 0
        self.truncated = False

    def write(self, text):
        if not isinstance(text, str):
            text = str(text)
        if self.length >= self.limit:
            self.truncated = True
            return len(text)
        room = self.limit - self.length
        if len(text) > room:
            self.chunks.append(text[:room])
            self.length += room
            self.truncated = True
        else:
            self.chunks.append(text)
            self.length += len(text)
        return len(text)

    def flush(self):
        pass

    def text(self):
        return "".join(self.chunks)


class Tracer(object):
    """Records statement-boundary events for one run of a student program.

    Phase labels are deliberately precise. CPython reports a ``line`` event
    *before* that line runs, so a line event is recorded as
    ``before-instruction``: the snapshot attached to it is the state the
    instruction is about to act on, never the state it produced. The state an
    instruction produced is the snapshot on the *following* event, which is why
    a terminal ``end`` event is always appended.
    """

    def __init__(self, filename, line_to_card, globals_ns, registry, budgets,
                 recorder, ignore_names):
        self.filename = filename
        self.line_to_card = line_to_card or {}
        self.globals_ns = globals_ns
        self.registry = registry
        self.budgets = budgets
        self.recorder = recorder
        self.ignore_names = set(ignore_names or ())
        self.serializer = Serializer(registry, budgets)
        self.events = []
        self.frames = []
        self.frame_seq = 0
        self.stopped_for_budget = False

    # -- name visibility ----------------------------------------------------
    def _visible(self, name):
        if name in self.ignore_names:
            return False
        if name.startswith("__") and name.endswith("__"):
            return False
        if name.startswith("_rbl_"):
            return False
        return True

    def _scope_records(self, frame):
        scopes = [{
            "id": "global",
            "kind": "global",
            "label": "Names",
            "parentId": None,
            "pairs": [(k, v) for k, v in self.globals_ns.items() if self._visible(k)],
        }]
        for rec in self.frames:
            f = rec["frame"]
            if f.f_code.co_name == "<module>":
                continue
            scopes.append({
                "id": rec["id"],
                "kind": "call",
                "label": rec["label"],
                "parentId": "global",
                "pairs": [(k, v) for k, v in f.f_locals.items() if self._visible(k)],
            })
        return scopes

    def _snapshot(self, frame, extra_roots=None):
        """extra_roots are objects that must be in the graph even though no
        student name reaches them, such as a value being returned."""
        scopes = self._scope_records(frame)
        seeds = [s["pairs"] for s in scopes]
        if extra_roots:
            seeds.append(list(extra_roots))
        objects, truncated = self.serializer.serialize(seeds)
        out_scopes = []
        for s in scopes:
            out_scopes.append({
                "id": s["id"],
                "kind": s["kind"],
                "label": s["label"],
                "parentId": s["parentId"],
                "bindings": sorted(
                    [{"name": n, "objectId": self.registry.uid(o)} for n, o in s["pairs"]],
                    key=lambda b: b["name"],
                ),
            })
        return {
            "objects": objects,
            "scopes": out_scopes,
            "outputLength": self.recorder.length,
            "truncated": truncated,
        }

    def _record(self, phase, frame, extra=None, extra_roots=None):
        if len(self.events) >= self.budgets.max_events:
            self.stopped_for_budget = True
            raise ExecutionBudgetExceeded(
                "This method ran for more steps than the lab can show (%d)."
                % self.budgets.max_events
            )
        line = frame.f_lineno
        event = {
            "seq": len(self.events),
            "phase": phase,
            "line": line,
            "cardId": self.line_to_card.get(line),
            "frameId": self.frames[-1]["id"] if self.frames else "global",
            "functionName": frame.f_code.co_name,
            "snapshot": self._snapshot(frame, extra_roots),
        }
        if extra:
            event.update(extra)
        self.events.append(event)

    # -- sys.settrace entry point ------------------------------------------
    def dispatch(self, frame, event, arg):
        if frame.f_code.co_filename != self.filename:
            return None

        if event == "call":
            self.frame_seq += 1
            self.frames.append({
                "frame": frame,
                "id": "f%d" % self.frame_seq,
                "label": frame.f_code.co_name,
            })
            # The module frame's call/return events duplicate the first
            # before-instruction event and the terminal end event, so they are
            # not reported as separate steps.
            if frame.f_code.co_name != "<module>":
                self._record("call", frame)
            return self.dispatch

        if event == "line":
            self._record("before-instruction", frame)
            return self.dispatch

        if event == "return":
            # ``arg`` is the returned object; None covers falling off the end.
            if frame.f_code.co_name != "<module>":
                self._record(
                    "return", frame,
                    {"returnedObjectId": self.registry.uid(arg)},
                    extra_roots=[("<returned>", arg)],
                )
            if self.frames and self.frames[-1]["frame"] is frame:
                self.frames.pop()
            return self.dispatch

        if event == "exception":
            exc_type, exc_value = arg[0], arg[1]
            self._record("error", frame, {
                "error": {
                    "kind": getattr(exc_type, "__name__", "Error"),
                    "message": str(exc_value),
                },
            })
            return self.dispatch

        return self.dispatch

    def finish(self, frame_line, error=None):
        if not frame_line and self.events:
            frame_line = self.events[-1]["line"]
        """Append the terminal snapshot: the state the last instruction produced."""
        scopes = self._scope_records(None)
        objects, truncated = self.serializer.serialize([s["pairs"] for s in scopes])
        out_scopes = []
        for s in scopes:
            out_scopes.append({
                "id": s["id"],
                "kind": s["kind"],
                "label": s["label"],
                "parentId": s["parentId"],
                "bindings": sorted(
                    [{"name": n, "objectId": self.registry.uid(o)} for n, o in s["pairs"]],
                    key=lambda b: b["name"],
                ),
            })
        event = {
            "seq": len(self.events),
            "phase": "end",
            "line": frame_line,
            # Nothing is executing at the end, so no card is highlighted.
            "cardId": None,
            "frameId": "global",
            "functionName": "<module>",
            "snapshot": {
                "objects": objects,
                "scopes": out_scopes,
                "outputLength": self.recorder.length,
                "truncated": truncated,
            },
        }
        if error:
            event["error"] = error
        self.events.append(event)


STUDENT_FILENAME = "<student-method>"


def run_program(source, line_to_card=None, setup=None, budgets=None):
    """Compile and run one student program, returning a plain-data result.

    ``setup`` is an optional dict of pre-bound names (the mission's starting
    state). Those names are visible to the program and to the snapshots.

    The return value contains only JSON-serializable data.
    """
    budgets = budgets or Budgets()
    registry = ObjectRegistry()
    recorder = _OutputRecorder(budgets.max_output_bytes)

    globals_ns = {"__name__": "__student__", "__builtins__": _safe_builtins()}
    if setup:
        globals_ns.update(setup)

    ignore = set(["__name__", "__builtins__"])

    result = {
        "events": [],
        "output": "",
        "outputTruncated": False,
        "error": None,
        "stoppedForBudget": False,
    }

    try:
        code = compile(source, STUDENT_FILENAME, "exec")
    except SyntaxError as exc:
        result["error"] = {
            "kind": "SyntaxError",
            "message": str(exc.msg),
            "line": exc.lineno,
            "cardId": (line_to_card or {}).get(exc.lineno),
            "phase": "compile",
        }
        return result

    tracer = Tracer(STUDENT_FILENAME, line_to_card, globals_ns, registry,
                    budgets, recorder, ignore)

    real_stdout = sys.stdout
    sys.stdout = recorder
    last_line = 0
    error = None
    try:
        sys.settrace(tracer.dispatch)
        try:
            exec(code, globals_ns)
        finally:
            sys.settrace(None)
    except ExecutionBudgetExceeded as exc:
        result["stoppedForBudget"] = True
        error = {"kind": "ExecutionBudgetExceeded", "message": str(exc),
                 "line": None, "cardId": None, "phase": "run"}
    except BaseException as exc:            # noqa: BLE001 - surfaced to student
        tb = sys.exc_info()[2]
        line = None
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == STUDENT_FILENAME:
                line = tb.tb_lineno
            tb = tb.tb_next
        last_line = line or 0
        error = {
            "kind": type(exc).__name__,
            "message": str(exc),
            "line": line,
            "cardId": (line_to_card or {}).get(line),
            "phase": "run",
        }
    finally:
        sys.stdout = real_stdout

    tracer.finish(last_line, error)

    result["events"] = tracer.events
    result["output"] = recorder.text()
    result["outputTruncated"] = recorder.truncated
    result["error"] = error
    result["globals"] = _export_names(globals_ns, ignore, registry, budgets)
    return result


def _export_names(globals_ns, ignore, registry, budgets):
    """Final top-level bindings, as a snapshot, for contract checking."""
    pairs = [(k, v) for k, v in globals_ns.items()
             if k not in ignore and not (k.startswith("__") and k.endswith("__"))]
    objects, truncated = Serializer(registry, budgets).serialize([pairs])
    return {
        "objects": objects,
        "bindings": sorted([{"name": n, "objectId": registry.uid(o)} for n, o in pairs],
                           key=lambda b: b["name"]),
        "truncated": truncated,
    }


_ALLOWED_BUILTINS = (
    "abs", "bool", "dict", "divmod", "enumerate", "float", "int", "len", "list",
    "max", "min", "print", "range", "reversed", "round", "set", "sorted", "str",
    "sum", "tuple", "zip", "True", "False", "None",
)


def _safe_builtins():
    """A restricted builtins mapping.

    This bounds the *supported language*, keeping the emitter, the visual
    palette and the runtime describing the same subset. It is not a security
    boundary: a static site's worker cannot be one, and the roadmap says so.
    """
    import builtins
    ns = {}
    for name in _ALLOWED_BUILTINS:
        if hasattr(builtins, name):
            ns[name] = getattr(builtins, name)
    # Exceptions the supported subset can raise and lessons can talk about.
    for name in ("Exception", "IndexError", "KeyError", "TypeError",
                 "ValueError", "ZeroDivisionError", "NameError",
                 "AttributeError", "StopIteration"):
        ns[name] = getattr(builtins, name)
    return ns
