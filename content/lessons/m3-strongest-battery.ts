/**
 * Mission: strongest-battery.
 *
 * Contract: `charges` is a nonempty list of integers; `answer` is the largest
 * of them; `charges` is left as it arrived. The empty list is outside the
 * contract, so there is deliberately no empty case here - inventing a "right"
 * answer for it would teach a rule Python does not have.
 *
 * What each case is here to catch:
 *
 *   example         - the happy path
 *   all-negative    - best-so-far started at 0: answers 0, which is not even
 *                     one of the charges
 *   negative-pair   - the same bug with no zero anywhere near the answer
 *   best-first      - best-so-far bound inside the loop: answers the last
 *                     charge instead of the biggest
 *   best-last       - the mirror case, so "answer the first one" also fails
 *   ties            - the biggest charge appearing twice
 *   single          - a one-charge list, where the loop body runs once
 *   zero-and-below  - 0 really is the biggest here, so a method cannot be
 *                     rejected merely for answering 0
 *   longer-run      - a different length with the biggest in the middle
 *
 * Source: stage 5 (5.15, 5.17, 5.19).
 */

const checkSource = `
def check_case(case, ns, original, identities, error):
    label = case.get("label") or case.get("id") or "this run"
    charges = original.get("charges")

    if error is not None:
        if error["kind"] == "NameError":
            return False, ("On %s the method stopped. Python reported a NameError: %s. The "
                           "best-so-far charge has to be named before it is compared."
                           % (label, error["message"]))
        return False, ("On %s the method stopped. Python reported %s: %s"
                       % (label, error["kind"], error["message"]))

    if "answer" not in ns:
        return False, ("On %s the method finished without ever naming an answer. The "
                       "last step should bind answer." % label)
    answer = ns["answer"]

    if ns.get("charges") != charges:
        return False, ("On %s the charge list ended up as %r. It started as %r and "
                       "Pip needs it left alone." % (label, ns.get("charges"), charges))

    if isinstance(answer, bool) or not isinstance(answer, int):
        return False, ("On %s answer is %r. Pip needs one whole number: the biggest "
                       "charge in the list." % (label, answer))

    expected = charges[0]
    for c in charges:
        if c > expected:
            expected = c

    if answer == expected:
        return True, "%s: %d" % (label, answer)

    if answer not in charges:
        return False, ("On %s the method answered %d, which is not one of the charges "
                       "%r at all. The best-so-far charge was started at a made-up "
                       "number instead of at the first charge. Pip needs %d."
                       % (label, answer, charges, expected))
    if answer == charges[-1]:
        return False, ("On %s the method answered %d, which is simply the last charge. "
                       "The best-so-far charge was replaced on every turn instead of "
                       "only when a bigger one turned up. Pip needs %d."
                       % (label, answer, expected))
    if answer == charges[0]:
        return False, ("On %s the method answered %d, the first charge, and never "
                       "moved on from it. Pip needs %d." % (label, answer, expected))
    return False, ("On %s the biggest of the charges %r is %d, but the method answered "
                   "%d." % (label, charges, expected, answer))
`

export const strongestBatteryMission = {
  id: 'strongest-battery',
  contentVersion: 1,
  sourceIds: ['5.15', '5.17', '5.19'],
  stage: 5,
  title: 'Strongest battery',
  mode: 'invent',
  purpose: 'Pip wants the strongest battery in the crate, whatever the numbers look like.',
  prompt: 'Find the biggest number in charges and name it answer.',
  prerequisites: ['charge-total'],
  setupSource: 'charges = [3, 9, 4]\n',
  tools: [],
  prediction: {
    id: 'start-the-best',
    question: 'The charges are all below zero. What should best-so-far start at?',
    options: [
      { id: 'zero', label: '0' },
      { id: 'first', label: 'The first charge in the list' },
    ],
    correctOptionId: 'first',
    explanation:
      'Starting at 0 means 0 wins whenever every charge is negative, and 0 is not in the crate. The first charge is always a real charge.',
  },
  hints: [
    {
      level: 1,
      text: 'With charges [-7, -2, -9] your method answers 0. There is no battery of 0 in the crate; the strongest is -2.',
    },
    {
      level: 2,
      text: 'Run that input again and step through it, reading best-so-far before the loop and after each turn.',
    },
    {
      level: 3,
      text: 'The problem is already there before the first turn: best-so-far starts at a number that is not one of the charges.',
    },
    {
      level: 4,
      text: 'Best-so-far has to start as one of the real charges, otherwise the made-up starting number can win.',
    },
    {
      level: 5,
      text: 'Do this: before the loop, bind best to charges[0] instead of 0. The rest of the method can stay as it is.',
    },
  ],
  misconceptions: [
    {
      id: 'best-started-at-zero',
      when: 'error is None and isinstance(ns.get("answer"), int)'
        + ' and ns["answer"] not in original["charges"]',
      feedback:
        'The answer is not one of the charges in the crate. Best-so-far began at a made-up number and nothing in the list ever beat it.',
    },
    {
      id: 'best-bound-inside-the-loop',
      when: 'error is None and len(original["charges"]) > 0'
        + ' and ns.get("answer") == original["charges"][-1]'
        + ' and max(original["charges"]) != original["charges"][-1]',
      feedback:
        'The answer is the last charge. Best-so-far was replaced on every turn, not only when a bigger charge turned up.',
    },
    {
      id: 'never-moved-past-the-first',
      when: 'error is None and len(original["charges"]) > 0'
        + ' and ns.get("answer") == original["charges"][0]'
        + ' and max(original["charges"]) != original["charges"][0]',
      feedback: 'The answer is the first charge. The comparison inside the loop never replaced it.',
    },
  ],
  transferVariant: 'Now find the weakest battery instead, on the same crate.',
  goal: {
    kind: 'invent',
    checkSource,
    cases: [
      {
        id: 'example',
        label: 'three batteries',
        setup: 'charges = [3, 9, 4]\n',
        inputs: ['charges'],
        expected: 9,
        hidden: false,
      },
      {
        id: 'all-negative',
        label: 'every battery below zero',
        setup: 'charges = [-7, -2, -9]\n',
        inputs: ['charges'],
        expected: -2,
        hidden: false,
      },
      {
        id: 'best-first',
        label: 'the strongest battery first',
        setup: 'charges = [9, 1, 2]\n',
        inputs: ['charges'],
        expected: 9,
        hidden: false,
      },
      {
        id: 'best-last',
        label: 'the strongest battery last',
        setup: 'charges = [1, 2, 9]\n',
        inputs: ['charges'],
        expected: 9,
        hidden: false,
      },
      {
        id: 'ties',
        label: 'two equally strong batteries',
        setup: 'charges = [5, 5, 2]\n',
        inputs: ['charges'],
        expected: 5,
        hidden: false,
      },
      {
        id: 'single',
        label: 'one battery on its own',
        setup: 'charges = [4]\n',
        inputs: ['charges'],
        expected: 4,
        hidden: false,
      },
      {
        id: 'negative-pair',
        label: 'two batteries, both below zero',
        setup: 'charges = [-3, -3]\n',
        inputs: ['charges'],
        expected: -3,
        hidden: false,
      },
      {
        id: 'zero-and-below',
        label: 'a flat battery is the best there is',
        setup: 'charges = [0, -1]\n',
        inputs: ['charges'],
        expected: 0,
        hidden: true,
      },
      {
        id: 'longer-run',
        label: 'six batteries, strongest in the middle',
        setup: 'charges = [2, 11, 7, 11, -4, 0]\n',
        inputs: ['charges'],
        expected: 11,
        hidden: true,
      },
    ],
    palette: ['bind', 'if', 'for'] as const,
    availableNames: ['charges', 'best', 'charge', 'answer'],
    answerName: 'answer',
  },
}
