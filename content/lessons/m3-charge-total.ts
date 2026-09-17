/**
 * Mission: charge-total.
 *
 * Contract: `answer` is the sum of the integers in `charges`; the empty list
 * gives 0; `charges` is left as it arrived.
 *
 * What each case is here to catch:
 *
 *   example         - the happy path, and any method that answers a list
 *   empty           - a method that starts from charges[0] (IndexError) or
 *                     that never binds answer at all
 *   reset-each-turn - `total = 0` written inside the loop: answers 1, not 6
 *   single          - a method that needs at least two items
 *   duplicates      - a method that skips repeats, e.g. one built on a set
 *   negatives       - a method that adds abs(charge) or ignores minus signs
 *   crosses-zero    - a method that stops at the first 0 or treats it as an end
 *   longer-run      - a different length, so nothing can be hard-coded
 *   counts-instead  - [2, 2, 2] vs its length 3: a method that counts the
 *                     charges rather than adding them up
 *
 * Source: stage 5 (5.6, 5.15, 5.16, 5.17).
 */

const checkSource = `
def check_case(case, ns, original, identities, error):
    label = case.get("label") or case.get("id") or "this run"
    charges = original.get("charges")

    if error is not None:
        if error["kind"] == "IndexError" and charges == []:
            return False, ("On %s the method stopped. Python reported an IndexError: it reached "
                           "into a list that has no slots. With no charges at all the "
                           "total should just be 0." % label)
        if error["kind"] == "NameError":
            return False, ("On %s the method stopped. Python reported a NameError: %s. A running "
                           "total has to be named before the loop starts."
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
        return False, ("On %s answer is %r. Pip needs one whole number, the total of "
                       "the charges." % (label, answer))

    expected = 0
    for c in charges:
        expected = expected + c

    if answer == expected:
        return True, "%s: %d" % (label, answer)

    if charges and answer == charges[-1]:
        return False, ("On %s the method answered %d, which is just the last charge. "
                       "The running total was started again on every turn instead of "
                       "once before the loop. Pip needs %d."
                       % (label, answer, expected))
    if answer == len(charges) and expected != len(charges):
        return False, ("On %s the method answered %d, which is how many charges there "
                       "are, not how much they come to. Pip needs %d."
                       % (label, answer, expected))
    return False, ("On %s the charges %r come to %d, but the method answered %d."
                   % (label, charges, expected, answer))
`

export const chargeTotalMission = {
  id: 'charge-total',
  contentVersion: 1,
  sourceIds: ['5.6', '5.15', '5.16', '5.17'],
  stage: 5,
  title: 'Charge total',
  mode: 'invent',
  purpose: 'Pip needs one number: how much charge there is altogether.',
  prompt: 'Add up every number in charges and name the total answer.',
  prerequisites: ['heavy-parcels'],
  setupSource: 'charges = [3, 5, 2]\n',
  tools: [],
  prediction: {
    id: 'where-does-total-start',
    question: 'Where should the running total be set to 0?',
    options: [
      { id: 'before', label: 'Once, before the loop' },
      { id: 'inside', label: 'At the top of the loop body' },
      { id: 'after', label: 'After the loop' },
    ],
    correctOptionId: 'before',
    explanation:
      'Setting it inside the loop wipes it out on every turn, so only the last charge is left. It has to be set once, before the first turn.',
  },
  hints: [
    {
      level: 1,
      text: 'With charges [5, 1] your method answers 1. Pip needs 6, because both charges have to be counted.',
    },
    {
      level: 2,
      text: 'Run that input again and step through it, reading the running total after each turn.',
    },
    {
      level: 3,
      text: 'Look at the first step of the second turn: the total drops back to 0 there, before the 1 is added.',
    },
    {
      level: 4,
      text: 'A running total is set up once, before the loop. Inside the loop it is only ever added to.',
    },
    {
      level: 5,
      text: 'Do this: move the card that binds total to 0 out of the loop so it sits above the for card.',
    },
  ],
  misconceptions: [
    {
      id: 'total-reset-inside-the-loop',
      when: 'error is None and len(original["charges"]) > 0'
        + ' and ns.get("answer") == original["charges"][-1]'
        + ' and sum(original["charges"]) != original["charges"][-1]',
      feedback:
        'The total went back to 0 at the start of every turn, so the answer is just the last charge.',
    },
    {
      id: 'no-total-before-the-loop',
      when: 'error is not None and error["kind"] == "NameError"',
      feedback: 'The method added to a total that did not exist yet. Nothing had named it before the loop.',
    },
    {
      id: 'empty-list-breaks-it',
      when: 'original["charges"] == [] and error is not None',
      feedback: 'With no charges at all the method stopped instead of answering 0.',
    },
    {
      id: 'counted-instead-of-added',
      when: 'error is None and ns.get("answer") == len(original["charges"])'
        + ' and sum(original["charges"]) != len(original["charges"])',
      feedback: 'The answer is how many charges there are, not how much they add up to.',
    },
  ],
  transferVariant: 'Try it on charges [100, -40, -60]. It should answer 0, not stop early.',
  goal: {
    kind: 'invent',
    checkSource,
    cases: [
      {
        id: 'example',
        label: 'three charges',
        setup: 'charges = [3, 5, 2]\n',
        inputs: ['charges'],
        expected: 10,
        hidden: false,
      },
      {
        id: 'empty',
        label: 'no charges at all',
        setup: 'charges = []\n',
        inputs: ['charges'],
        expected: 0,
        hidden: false,
      },
      {
        id: 'reset-each-turn',
        label: 'two charges, five then one',
        setup: 'charges = [5, 1]\n',
        inputs: ['charges'],
        expected: 6,
        hidden: false,
      },
      {
        id: 'single',
        label: 'one charge on its own',
        setup: 'charges = [7]\n',
        inputs: ['charges'],
        expected: 7,
        hidden: false,
      },
      {
        id: 'duplicates',
        label: 'the same charge three times',
        setup: 'charges = [4, 4, 4]\n',
        inputs: ['charges'],
        expected: 12,
        hidden: false,
      },
      {
        id: 'negatives',
        label: 'every charge below zero',
        setup: 'charges = [-3, -5, -2]\n',
        inputs: ['charges'],
        expected: -10,
        hidden: false,
      },
      {
        id: 'crosses-zero',
        label: 'a zero in the middle',
        setup: 'charges = [0, -4, 4, 9]\n',
        inputs: ['charges'],
        expected: 9,
        hidden: false,
      },
      {
        id: 'counts-instead',
        label: 'three charges of two',
        setup: 'charges = [2, 2, 2]\n',
        inputs: ['charges'],
        expected: 6,
        hidden: true,
      },
      {
        id: 'longer-run',
        label: 'seven charges in a row',
        setup: 'charges = [1, 2, 3, 4, 5, 6, 7]\n',
        inputs: ['charges'],
        expected: 28,
        hidden: true,
      },
    ],
    palette: ['bind', 'for'] as const,
    availableNames: ['charges', 'total', 'charge', 'answer'],
    answerName: 'answer',
  },
}
