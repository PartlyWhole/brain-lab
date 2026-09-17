"""Manual-operation session: the student acting as the robot's memory.

Every operation here manipulates *actual Python objects*. Nothing edits the
displayed JSON graph directly, so sharing, mutation and rebinding are true
because Python made them true, not because the renderer agreed to draw them.

Two spaces exist and are never conflated:

* ``bindings`` - real Python names in the session namespace. These are what a
  Python program would see.
* ``work_area`` - a game-managed holding area for objects that have been
  produced but not yet given a name. A draft name living here is not a binding.

Undo replays the command prefix from the mission setup rather than trying to
invert a mutation. Inverting is not generally possible and would quietly break
aliasing; replaying preserves it exactly.
"""

import observe


class OperationError(Exception):
    """A rejected operation. Carries a sentence the student can act on."""

    def __init__(self, message, hint=None):
        Exception.__init__(self, message)
        self.message = message
        self.hint = hint


class Session(object):
    def __init__(self, setup_source="", budgets=None):
        self.budgets = budgets or observe.Budgets()
        self.setup_source = setup_source or ""
        self.registry = observe.ObjectRegistry()
        self.recorder = observe._OutputRecorder(self.budgets.max_output_bytes)
        self.bindings = {}
        self.work_area = []          # list of {"slotId", "label", "object"}
        self._slot_seq = 0
        self._apply_setup()

    # -- setup / replay -----------------------------------------------------
    def _apply_setup(self):
        if not self.setup_source.strip():
            return
        ns = {"__builtins__": observe._safe_builtins()}
        exec(compile(self.setup_source, "<mission-setup>", "exec"), ns)
        for key, value in ns.items():
            if key.startswith("__"):
                continue
            self.bindings[key] = value

    def reset(self):
        self.registry.reset()
        self.recorder = observe._OutputRecorder(self.budgets.max_output_bytes)
        self.bindings = {}
        del self.work_area[:]
        self._slot_seq = 0
        self._apply_setup()

    # -- references ---------------------------------------------------------
    def _new_slot_id(self):
        self._slot_seq += 1
        return "w%d" % self._slot_seq

    def _find_slot(self, slot_id):
        for entry in self.work_area:
            if entry["slotId"] == slot_id:
                return entry
        raise OperationError("That work-area item is no longer there.")

    def resolve(self, ref):
        """Turns a reference description into the live Python object.

        A reference is never a value copy: resolving the same name twice yields
        the same object, which is what makes sharing observable.
        """
        if not isinstance(ref, dict):
            raise OperationError("That input is missing.")
        kind = ref.get("kind")
        if kind == "name":
            name = ref.get("name")
            if name not in self.bindings:
                raise OperationError(
                    "There is no name %s in the brain yet." % _q(name),
                    hint="Bind a name to an object before using it.",
                )
            return self.bindings[name]
        if kind == "work":
            return self._find_slot(ref.get("slotId"))["object"]
        if kind == "slot":
            container = self.resolve(ref.get("target"))
            index = ref.get("index")
            if not isinstance(container, (list, tuple)):
                raise OperationError("Only a list or a tuple has numbered slots.")
            if not isinstance(index, int) or isinstance(index, bool):
                raise OperationError("A slot number must be a whole number.")
            if index < 0 or index >= len(container):
                raise OperationError(
                    "This list has %d slot%s, numbered 0 to %d, so there is no slot %d."
                    % (len(container), "" if len(container) == 1 else "s",
                       len(container) - 1, index)
                    if container else
                    "This list has no slots yet, so there is no slot %d." % index,
                    hint="Append an item first, or pick a slot that exists.",
                )
            return container[index]
        if kind == "literalInt":
            try:
                return int(ref.get("text"))
            except (TypeError, ValueError):
                raise OperationError("That is not a whole number.")
        if kind == "literalStr":
            value = ref.get("value")
            if not isinstance(value, str):
                raise OperationError("That is not text.")
            if len(value) > self.budgets.max_string_chars:
                raise OperationError("That text is too long for the lab.")
            return value
        if kind == "literalBool":
            return bool(ref.get("value"))
        if kind == "literalNone":
            return None
        raise OperationError("That kind of input is not supported yet.")

    def _stage(self, obj, label):
        entry = {"slotId": self._new_slot_id(), "label": label, "object": obj}
        self.work_area.append(entry)
        if len(self.work_area) > 12:
            del self.work_area[0]
        return entry["slotId"]

    # -- operations ---------------------------------------------------------
    def apply(self, command):
        """Applies one semantic command and reports its result and effect."""
        if not isinstance(command, dict):
            raise OperationError("That operation could not be read.")
        op = command.get("op")
        handler = _HANDLERS.get(op)
        if handler is None:
            raise OperationError("The operation %s is not supported yet." % _q(op))
        return handler(self, command)

    # Each handler returns a dict describing what happened, in the language the
    # feedback panel uses. "result" is what the operation produced; "effect" is
    # what it changed. They are reported separately and never merged.
    def _op_make_list(self, cmd):
        items = [self.resolve(r) for r in cmd.get("items", [])]
        slot = self._stage(list(items), "new list")
        return {"resultSlotId": slot, "effect": None,
                "description": "Made a new list with %d slot%s."
                               % (len(items), "" if len(items) == 1 else "s")}

    def _op_make_int(self, cmd):
        value = self.resolve({"kind": "literalInt", "text": cmd.get("text")})
        return {"resultSlotId": self._stage(value, "number"), "effect": None,
                "description": "Made the number %d." % value}

    def _op_make_str(self, cmd):
        value = self.resolve({"kind": "literalStr", "value": cmd.get("value")})
        return {"resultSlotId": self._stage(value, "text"), "effect": None,
                "description": "Made the text %s." % _q(value)}

    def _op_lookup(self, cmd):
        obj = self.resolve(cmd.get("ref"))
        return {"resultSlotId": self._stage(obj, "looked up"), "effect": None,
                "description": "Followed the reference and found the object."}

    def _op_bind(self, cmd):
        name = cmd.get("name")
        if not _is_identifier(name):
            raise OperationError(
                "%s cannot be a name." % _q(name),
                hint="Names start with a letter and contain letters, digits or _.",
            )
        obj = self.resolve(cmd.get("ref"))
        existed = name in self.bindings
        self.bindings[name] = obj
        return {
            "resultSlotId": None,
            "effect": "rebind" if existed else "bind",
            "description": ("Pointed %s at this object." % name) if existed
                           else ("Named this object %s." % name),
        }

    def _op_append(self, cmd):
        target = self.resolve(cmd.get("target"))
        if not isinstance(target, list):
            raise OperationError("Only a list can be appended to.")
        value = self.resolve(cmd.get("value"))
        before = len(target)
        target.append(value)
        # append changes the list and returns None; both are reported.
        return {"resultSlotId": self._stage(None, "append result"),
                "effect": "mutate",
                "description": "Added one slot to the list: %d slot%s now, was %d."
                               % (len(target), "" if len(target) == 1 else "s", before)}

    def _op_set_slot(self, cmd):
        target = self.resolve(cmd.get("target"))
        if not isinstance(target, list):
            raise OperationError("Only a list slot can be replaced this way.")
        index = cmd.get("index")
        if not isinstance(index, int) or isinstance(index, bool):
            raise OperationError("A slot number must be a whole number.")
        if index < 0 or index >= len(target):
            raise OperationError(
                "This list has %d slot%s, so there is no slot %d."
                % (len(target), "" if len(target) == 1 else "s", index))
        value = self.resolve(cmd.get("value"))
        target[index] = value
        return {"resultSlotId": None, "effect": "mutate",
                "description": "Slot %d now refers to a different object. "
                               "The list itself is the same list." % index}

    def _op_read_slot(self, cmd):
        obj = self.resolve({"kind": "slot", "target": cmd.get("target"),
                            "index": cmd.get("index")})
        return {"resultSlotId": self._stage(obj, "slot %s" % cmd.get("index")),
                "effect": None,
                "description": "Read slot %s. The list did not change."
                               % cmd.get("index")}

    def _op_length(self, cmd):
        target = self.resolve(cmd.get("target"))
        if not isinstance(target, (list, tuple, str, dict, set)):
            raise OperationError("That kind of object does not have a length.")
        n = len(target)
        return {"resultSlotId": self._stage(n, "length"), "effect": None,
                "description": "The length is %d." % n}

    def _op_add(self, cmd):
        left = self.resolve(cmd.get("left"))
        right = self.resolve(cmd.get("right"))
        try:
            value = left + right
        except TypeError:
            raise OperationError(
                "A %s and a %s cannot be added."
                % (observe._type_name(left), observe._type_name(right)),
                hint="Adding works between two numbers, or between two texts.",
            )
        return {"resultSlotId": self._stage(value, "sum"), "effect": None,
                "description": "The result is a new object; the inputs did not change."}

    def _op_compare(self, cmd):
        left = self.resolve(cmd.get("left"))
        right = self.resolve(cmd.get("right"))
        operator = cmd.get("operator")
        try:
            value = _COMPARISONS[operator](left, right)
        except KeyError:
            raise OperationError("That comparison is not supported yet.")
        except TypeError:
            raise OperationError(
                "A %s and a %s cannot be compared with %s."
                % (observe._type_name(left), observe._type_name(right), operator))
        return {"resultSlotId": self._stage(bool(value), "answer"), "effect": None,
                "description": "The comparison answered %s." % ("True" if value else "False")}

    def _op_print(self, cmd):
        obj = self.resolve(cmd.get("ref"))
        self.recorder.write(_display(obj) + "\n")
        # print writes to the output panel and produces None.
        return {"resultSlotId": self._stage(None, "print result"), "effect": "output",
                "description": "Wrote to the output panel. The brain did not change."}

    def _op_discard(self, cmd):
        entry = self._find_slot(cmd.get("slotId"))
        self.work_area.remove(entry)
        return {"resultSlotId": None, "effect": None,
                "description": "Cleared the work-area item. No name changed."}

    # -- snapshot -----------------------------------------------------------
    def snapshot(self):
        serializer = observe.Serializer(self.registry, self.budgets)
        binding_pairs = sorted(self.bindings.items())
        work_pairs = [(e["slotId"], e["object"]) for e in self.work_area]
        objects, truncated = serializer.serialize([binding_pairs, work_pairs])
        return {
            "objects": objects,
            "scopes": [{
                "id": "global",
                "kind": "global",
                "label": "Brain",
                "parentId": None,
                "bindings": [{"name": n, "objectId": self.registry.uid(o)}
                             for n, o in binding_pairs],
            }],
            "workArea": [{
                "slotId": e["slotId"],
                "label": e["label"],
                "objectId": self.registry.uid(e["object"]),
            } for e in self.work_area],
            "outputLength": self.recorder.length,
            "output": self.recorder.text(),
            "truncated": truncated,
        }


def _display(obj):
    """Exactly what Python's print would write, for supported types only."""
    return repr(obj) if not isinstance(obj, str) else obj


_COMPARISONS = {
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
}

_KEYWORDS = set([
    "False", "None", "True", "and", "as", "assert", "async", "await", "break",
    "class", "continue", "def", "del", "elif", "else", "except", "finally",
    "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
    "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
])


def _is_identifier(name):
    return (isinstance(name, str) and name.isidentifier()
            and name not in _KEYWORDS and len(name) <= 32)


def _q(value):
    return '"%s"' % value


_HANDLERS = {
    "makeList": Session._op_make_list,
    "makeInt": Session._op_make_int,
    "makeStr": Session._op_make_str,
    "lookup": Session._op_lookup,
    "bind": Session._op_bind,
    "append": Session._op_append,
    "setSlot": Session._op_set_slot,
    "readSlot": Session._op_read_slot,
    "length": Session._op_length,
    "add": Session._op_add,
    "compare": Session._op_compare,
    "print": Session._op_print,
    "discard": Session._op_discard,
}


def run_commands(setup_source, commands, budgets=None):
    """Replays a command list from the mission setup and reports the result.

    This is the whole undo/redo mechanism: the client keeps the command list,
    and any prefix of it can be replayed to reconstruct that exact state,
    aliasing included.
    """
    session = Session(setup_source, budgets)
    applied = []
    error = None
    for i, command in enumerate(commands):
        try:
            outcome = session.apply(command)
            applied.append({"index": i, "ok": True, "outcome": outcome})
        except OperationError as exc:
            error = {"index": i, "kind": "OperationError",
                     "message": exc.message, "hint": exc.hint}
            break
        except Exception as exc:                      # noqa: BLE001
            error = {"index": i, "kind": type(exc).__name__,
                     "message": str(exc), "hint": None}
            break
    return {"snapshot": session.snapshot(), "applied": applied, "error": error}


def check_state(session, check_source):
    """Runs a mission's trusted state check against the live session.

    The checker receives real objects, so it can ask about identity ("do these
    two names reach the same list?") and not only about equality. That
    distinction is the whole point of several missions.
    """
    def aliases(a, b):
        return (a in session.bindings and b in session.bindings
                and session.bindings[a] is session.bindings[b])

    def names():
        return dict(session.bindings)

    ns = {
        "__builtins__": __builtins__,
        "aliases": aliases,
        "same_object": lambda a, b: a is b,
    }
    exec(compile(check_source, "<mission-check>", "exec"), ns)
    work = [{"slotId": e["slotId"], "label": e["label"], "object": e["object"]}
            for e in session.work_area]
    try:
        done, message = ns["check_state"](names(), work, session.recorder.text(), aliases)
    except Exception as exc:                          # noqa: BLE001
        return {"done": False, "message": "The check could not run: %s" % exc}
    return {"done": bool(done), "message": message}


def run_commands_and_check(setup_source, commands, check_source=None, budgets=None):
    """Replay a command prefix and, if the mission has one, grade the state."""
    session = Session(setup_source, budgets)
    applied = []
    error = None
    for i, command in enumerate(commands):
        try:
            outcome = session.apply(command)
            applied.append({"index": i, "ok": True, "outcome": outcome})
        except OperationError as exc:
            error = {"index": i, "kind": "OperationError",
                     "message": exc.message, "hint": exc.hint}
            break
        except Exception as exc:                      # noqa: BLE001
            error = {"index": i, "kind": type(exc).__name__,
                     "message": str(exc), "hint": None}
            break

    check = None
    if check_source and error is None:
        check = check_state(session, check_source)

    return {"snapshot": session.snapshot(), "applied": applied,
            "error": error, "check": check}
