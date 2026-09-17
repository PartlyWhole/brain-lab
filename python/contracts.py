"""Trusted mission contract checking.

Grading runs the student's program *uninstrumented* on each case, in a fresh
namespace, and then hands the result to a trusted per-mission checker written
in Python alongside the curriculum. Keeping the checker in Python means the
answer to "is this correct?" comes from Python itself rather than from a second
opinion implemented in the renderer.

Each case is graded independently with a fresh namespace. A mission that needs
to expose shared-default-state behaviour does so by running two calls inside a
single case, deliberately, rather than by leaking state between cases.
"""

import copy
import sys

import observe


class StepBudgetExceeded(Exception):
    pass


def _counting_tracer(limit, filename):
    """Counts executed lines so a nonterminating method still returns a verdict.

    This is a game safeguard on the *grader*, not a Python semantic rule; the
    message says so, so a student is never told their program is wrong when it
    was only stopped.
    """
    state = {"n": 0}

    def trace(frame, event, arg):
        if frame.f_code.co_filename != filename:
            return None
        if event == "line":
            state["n"] += 1
            if state["n"] > limit:
                raise StepBudgetExceeded(
                    "This method was still running after %d steps, so the check "
                    "stopped it." % limit
                )
        return trace

    return trace


FILENAME = "<student-method>"


def run_case(source, case, step_limit=20000):
    """Runs the student's source once against one case.

    Returns the final namespace, a deep copy of the declared inputs taken
    *before* the run, and any error. The pre-run copy is what makes "the input
    was not modified" a checkable claim.
    """
    ns = {"__name__": "__student__", "__builtins__": observe._safe_builtins()}
    setup = case.get("setup", "")
    if setup:
        exec(compile(setup, "<mission-setup>", "exec"), ns)

    input_names = case.get("inputs", [])
    # Deep copies, and also the identity of each live input, so a checker can
    # ask both "was it changed?" and "was the same object handed back?".
    original = {}
    identities = {}
    for name in input_names:
        if name in ns:
            original[name] = copy.deepcopy(ns[name])
            identities[name] = id(ns[name])

    error = None
    try:
        code = compile(source, FILENAME, "exec")
    except SyntaxError as exc:
        return {"ns": ns, "original": original, "identities": identities,
                "error": {"kind": "SyntaxError", "message": str(exc.msg),
                          "line": exc.lineno}}

    old_trace = sys.gettrace()
    try:
        sys.settrace(_counting_tracer(step_limit, FILENAME))
        exec(code, ns)
    except StepBudgetExceeded as exc:
        error = {"kind": "StepBudgetExceeded", "message": str(exc), "line": None}
    except BaseException as exc:                      # noqa: BLE001
        tb = sys.exc_info()[2]
        line = None
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == FILENAME:
                line = tb.tb_lineno
            tb = tb.tb_next
        error = {"kind": type(exc).__name__, "message": str(exc), "line": line}
    finally:
        sys.settrace(old_trace)

    return {"ns": ns, "original": original, "identities": identities, "error": error}


def diagnose(misconceptions, case, run):
    """Finds the first authored misconception that matches a failing run.

    The condition is evaluated with ``ns``, ``original``, ``identities``,
    ``error`` and ``case`` supplied as GLOBALS, not locals. A comprehension in
    the condition creates its own scope and cannot see an eval frame's locals,
    so passing them as locals would raise NameError on exactly the conditions
    that need them most.
    """
    if not misconceptions:
        return None
    env = {
        "__builtins__": __builtins__,
        "ns": run["ns"],
        "original": run["original"],
        "identities": run["identities"],
        "error": run["error"],
        "case": case,
    }
    for item in misconceptions:
        condition = item.get("when")
        if not condition:
            continue
        try:
            if bool(eval(compile(condition, "<misconception>", "eval"), env)):
                return {"id": item.get("id", ""), "feedback": item.get("feedback", "")}
        except Exception:                             # noqa: BLE001
            # A condition that cannot be evaluated must never break grading or
            # be reported to a student as if it were their mistake.
            continue
    return None


def check(source, cases, check_source, misconceptions=None):
    """Grades every case and returns a plain-data report.

    ``check_source`` is trusted curriculum code defining
    ``check_case(case, ns, original, identities, error) -> (passed, message)``.
    """
    checker_ns = {"__builtins__": __builtins__, "copy": copy}
    exec(compile(check_source, "<mission-contract>", "exec"), checker_ns)
    check_case = checker_ns["check_case"]

    results = []
    for case in cases:
        run = run_case(source, case)
        try:
            passed, message = check_case(
                case, run["ns"], run["original"], run["identities"], run["error"],
            )
        except Exception as exc:                      # noqa: BLE001
            passed, message = False, "The check could not run: %s" % exc
        results.append({
            "caseId": case.get("id", ""),
            "label": case.get("label", case.get("id", "")),
            "passed": bool(passed),
            "message": message,
            "error": run["error"],
            "hidden": bool(case.get("hidden", False)),
            # Named only for a failing case: a misconception is an explanation
            # of a mistake, not a remark about correct work.
            "misconception": None if passed else diagnose(misconceptions, case, run),
        })

    first_failure = next((r for r in results if not r["passed"]), None)
    return {
        "passed": all(r["passed"] for r in results) and len(results) > 0,
        "cases": results,
        "firstFailure": first_failure,
        "misconception": first_failure["misconception"] if first_failure else None,
    }
