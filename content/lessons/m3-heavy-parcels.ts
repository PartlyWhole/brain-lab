/**
 * Missions: heavy-parcels and heavy-parcels-repair.
 *
 * The contract is: a NEW list of the weights strictly greater than `limit`, in
 * the original order, with `weights` and `limit` left exactly as they were.
 *
 * The case set is built backwards from the bugs, not forwards from the happy
 * path. Each case below names the specific wrong method it is there to catch:
 *
 *   example            - the 5.12 bug (`result = [weight]`): answers [9], not [8, 9]
 *   duplicates         - the same bug again, where losing data is unmissable
 *   equal-to-limit     - `>=` instead of `>`: keeps the weight that ties the limit
 *   none-qualify       - a method that appends unconditionally
 *   all-qualify        - a method that never appends, or answers []
 *   empty              - a method that reads weights[0] before the loop
 *   negatives          - a limit that is not positive, and a method that
 *                        compares against 0 instead of limit
 *   longer-run         - a different length and a different limit, so nothing
 *                        can be hard-coded to the example
 *   hand-it-back       - `answer = weights`: right contents, wrong object
 *
 * Source: stage 5 (5.7, 5.12, 5.17); the repair variant is 5.12 with 5.14.
 */
import { PROGRAM_SCHEMA_VERSION } from '../../src/program/types'

const checkSource = `
def check_case(case, ns, original, identities, error):
    label = case.get("label") or case.get("id") or "this parcel run"
    weights = original.get("weights")
    limit = original.get("limit")

    if error is not None:
        return False, ("On %s the method stopped. Python reported %s: %s"
                       % (label, error["kind"], error["message"]))

    if "answer" not in ns:
        return False, ("On %s the method finished without ever naming an answer. "
                       "The last step should bind answer." % label)
    answer = ns["answer"]

    if ns.get("weights") != weights:
        return False, ("On %s the parcel list ended up as %r. It started as %r and "
                       "Pip needs it left exactly as it arrived."
                       % (label, ns.get("weights"), weights))
    if ns.get("limit") != limit:
        return False, ("On %s limit ended up as %r. It started as %r and nothing "
                       "should change it." % (label, ns.get("limit"), limit))

    if not isinstance(answer, list):
        return False, ("On %s answer is %r. Pip needs a list of the heavy weights, "
                       "even when that list is empty." % (label, answer))
    if id(answer) == identities.get("weights"):
        return False, ("On %s answer is the parcel list itself, not a new list. "
                       "Start an empty list of your own and append to that one."
                       % label)

    expected = []
    for w in weights:
        if w > limit:
            expected.append(w)

    if answer == expected:
        return True, "%s: %r" % (label, answer)

    if sorted(answer) == sorted(expected):
        return False, ("On %s with weights %r and limit %r the method answered %r. "
                       "Those are the right parcels in the wrong order; Pip needs "
                       "%r." % (label, weights, limit, answer, expected))
    if len(answer) == 1 and len(expected) > 1 and answer[0] == expected[-1]:
        return False, ("On %s with weights %r and limit %r the method answered %r, "
                       "keeping only the last heavy parcel. The earlier ones were "
                       "thrown away instead of collected. Pip needs %r."
                       % (label, weights, limit, answer, expected))
    kept = [w for w in answer if w == limit]
    if kept and limit not in expected:
        return False, ("On %s the method kept the weight %r, which is exactly the "
                       "limit. Pip only wants parcels heavier than the limit, so it "
                       "answered %r when it needs %r."
                       % (label, limit, answer, expected))
    return False, ("On %s with weights %r and limit %r the method answered %r. Pip "
                   "needs %r: every weight bigger than the limit, in the order they "
                   "arrived." % (label, weights, limit, answer, expected))
`

const cases = [
  {
    id: 'example',
    label: 'the four parcels from the depot',
    setup: 'weights = [2, 8, 5, 9]\nlimit = 5\n',
    inputs: ['weights', 'limit'],
    expected: [8, 9],
    hidden: false,
  },
  {
    id: 'duplicates',
    label: 'three parcels of the same weight',
    setup: 'weights = [6, 6, 2, 6]\nlimit = 5\n',
    inputs: ['weights', 'limit'],
    expected: [6, 6, 6],
    hidden: false,
  },
  {
    id: 'equal-to-limit',
    label: 'two parcels exactly on the limit',
    setup: 'weights = [5, 5, 6]\nlimit = 5\n',
    inputs: ['weights', 'limit'],
    expected: [6],
    hidden: false,
  },
  {
    id: 'empty',
    label: 'no parcels at all',
    setup: 'weights = []\nlimit = 3\n',
    inputs: ['weights', 'limit'],
    expected: [],
    hidden: false,
  },
  {
    id: 'none-qualify',
    label: 'every parcel is light',
    setup: 'weights = [1, 2, 3]\nlimit = 10\n',
    inputs: ['weights', 'limit'],
    expected: [],
    hidden: false,
  },
  {
    id: 'all-qualify',
    label: 'every parcel is heavy',
    setup: 'weights = [7, 8, 9]\nlimit = 1\n',
    inputs: ['weights', 'limit'],
    expected: [7, 8, 9],
    hidden: false,
  },
  {
    id: 'negatives',
    label: 'weights below zero',
    setup: 'weights = [-5, -1, -9, 0]\nlimit = -3\n',
    inputs: ['weights', 'limit'],
    expected: [-1, 0],
    hidden: false,
  },
  {
    id: 'longer-run',
    label: 'six parcels and a different limit',
    setup: 'weights = [10, 3, 10, 1, 12, 7]\nlimit = 7\n',
    inputs: ['weights', 'limit'],
    expected: [10, 10, 12],
    hidden: true,
  },
  {
    id: 'hand-it-back',
    label: 'two heavy parcels and nothing to leave out',
    setup: 'weights = [4, 9]\nlimit = 1\n',
    inputs: ['weights', 'limit'],
    expected: [4, 9],
    hidden: true,
  },
]

const palette = ['bind', 'append', 'if', 'for'] as const
const availableNames = ['weights', 'limit', 'result', 'weight', 'answer']

export const heavyParcelsMission = {
  id: 'heavy-parcels',
  contentVersion: 1,
  sourceIds: ['5.7', '5.12', '5.17'],
  stage: 5,
  title: 'Heavy parcels',
  mode: 'invent',
  purpose: 'Pip must pick out the heavy parcels and leave the delivery alone.',
  prompt: 'Build a new list of every weight bigger than limit, in the same order.',
  prerequisites: ['rebind-vs-mutate'],
  setupSource: 'weights = [2, 8, 5, 9]\nlimit = 5\n',
  tools: [],
  prediction: {
    id: 'equal-to-limit',
    question: 'A parcel weighs exactly 5 and the limit is 5. Does it go in the answer?',
    options: [
      { id: 'yes', label: 'Yes, 5 is not lighter than the limit' },
      { id: 'no', label: 'No, bigger than the limit means strictly bigger' },
    ],
    correctOptionId: 'no',
    explanation:
      'Bigger than 5 means over 5. A parcel that weighs exactly 5 sits on the line, so it stays behind.',
  },
  hints: [
    {
      level: 1,
      text: 'With weights [6, 6, 2, 6] and limit 5 your method answers a shorter list than Pip needs. Every weight over 5 has to be in there.',
    },
    {
      level: 2,
      text: 'Run that input again and step through it. Watch the result list after each parcel.',
    },
    {
      level: 3,
      text: 'The first turn where it goes wrong is the second heavy parcel: look at what result holds before that step and just after it.',
    },
    {
      level: 4,
      text: 'Adding to the list you already have is not the same as pointing result at a brand new list.',
    },
    {
      level: 5,
      text: 'Do this: keep one result list made before the loop, and inside the if use append on it instead of binding result again.',
    },
  ],
  misconceptions: [
    {
      id: 'rebinds-instead-of-appending',
      when: 'error is None and isinstance(ns.get("answer"), list) and len(ns["answer"]) == 1'
        + ' and len([w for w in original["weights"] if w > original["limit"]]) > 1',
      feedback:
        'You pointed result at a new one-item list on each heavy parcel, so only the last one survived. The earlier heavy parcels were thrown away.',
    },
    {
      id: 'keeps-the-equal-weight',
      when: 'error is None and isinstance(ns.get("answer"), list)'
        + ' and original["limit"] in ns["answer"] and original["limit"] in original["weights"]',
      feedback:
        'A parcel weighing exactly the limit ended up in the answer. The test let it through because it asked for not lighter instead of heavier.',
    },
    {
      id: 'hands-back-the-input',
      when: 'error is None and id(ns.get("answer")) == identities.get("weights")',
      feedback:
        'answer is the delivery list itself. Pip asked for a new list, so the original stays the way it arrived.',
    },
    {
      id: 'appends-to-the-input',
      when: 'error is None and ns.get("weights") != original["weights"]',
      feedback: 'You appended into weights. The delivery list changed, and it was meant to be left alone.',
    },
  ],
  transferVariant:
    'Same method, new job: weights [4, 4, 4, 12] with limit 4. It should answer just [12].',
  goal: {
    kind: 'invent',
    checkSource,
    cases,
    palette,
    availableNames,
    answerName: 'answer',
  },
}

/**
 * The 5.12 repair variant, as its own mission.
 *
 * The starter method is the faulty one from the source exercise: inside the
 * `if`, it binds `result` to a fresh one-item list instead of appending. It is
 * a program tree rather than text so the student repairs the same cards the
 * editor builds, and so `emitProgram` is the only thing that ever writes the
 * Python.
 */
const starterProgram = {
  schemaVersion: PROGRAM_SCHEMA_VERSION,
  missionId: 'heavy-parcels-repair',
  body: [
    {
      kind: 'bind',
      id: 'hpr-init',
      name: 'result',
      value: { kind: 'list', id: 'hpr-empty', items: [] },
    },
    {
      kind: 'for',
      id: 'hpr-loop',
      loopName: 'weight',
      iterable: { kind: 'name', id: 'hpr-weights', name: 'weights' },
      body: [
        {
          kind: 'if',
          id: 'hpr-test',
          condition: {
            kind: 'compare',
            id: 'hpr-cmp',
            op: '>',
            left: { kind: 'name', id: 'hpr-w', name: 'weight' },
            right: { kind: 'name', id: 'hpr-limit', name: 'limit' },
          },
          then: [
            {
              // The bug, exactly as 5.12 writes it: result = [weight]
              kind: 'bind',
              id: 'hpr-bug',
              name: 'result',
              value: {
                kind: 'list',
                id: 'hpr-onelist',
                items: [{ kind: 'name', id: 'hpr-w2', name: 'weight' }],
              },
            },
          ],
          otherwise: [],
        },
      ],
    },
    {
      kind: 'bind',
      id: 'hpr-answer',
      name: 'answer',
      value: { kind: 'name', id: 'hpr-result', name: 'result' },
    },
  ],
}

export const heavyParcelsRepairMission = {
  id: 'heavy-parcels-repair',
  contentVersion: 1,
  sourceIds: ['5.12', '5.14'],
  stage: 5,
  title: 'The parcel method that loses parcels',
  mode: 'investigate',
  purpose: 'This method already runs. It just keeps the wrong parcels.',
  prompt: 'Find an input it gets wrong, then make the smallest repair.',
  prerequisites: ['heavy-parcels'],
  setupSource: 'weights = [2, 8, 5, 9]\nlimit = 5\n',
  tools: [],
  prediction: {
    id: 'how-many-survive',
    question: 'The if does result = [weight]. After weights [6, 6, 2, 6] and limit 5, how long is result?',
    options: [
      { id: 'three', label: 'Three items' },
      { id: 'one', label: 'One item' },
      { id: 'zero', label: 'Empty' },
    ],
    correctOptionId: 'one',
    explanation:
      'Each heavy parcel points result at a brand new one-item list, throwing the previous list away. Only the last one is left.',
  },
  hints: [
    {
      level: 1,
      text: 'Try weights [6, 6, 2, 6] with limit 5. The method answers one parcel when three are heavy.',
    },
    {
      level: 2,
      text: 'Step through that run and read the result list after each pass of the loop.',
    },
    {
      level: 3,
      text: 'On the second heavy parcel, result goes from one item back to one item. The first parcel disappeared at that step.',
    },
    {
      level: 4,
      text: 'The card inside the if replaces result. Pip needs a card that adds to the result that is already there.',
    },
    {
      level: 5,
      text: 'Do this: swap the bind card inside the if for an append card that appends weight onto result. Change nothing else.',
    },
  ],
  misconceptions: [
    {
      id: 'still-rebinding',
      when: 'error is None and isinstance(ns.get("answer"), list) and len(ns["answer"]) == 1'
        + ' and len([w for w in original["weights"] if w > original["limit"]]) > 1',
      feedback:
        'The if still points result at a new one-item list. Each heavy parcel wipes out the one before it.',
    },
    {
      id: 'appended-outside-the-if',
      when: 'error is None and isinstance(ns.get("answer"), list)'
        + ' and len(ns["answer"]) == len(original["weights"]) and len(original["weights"]) > 0'
        + ' and len([w for w in original["weights"] if w > original["limit"]]) < len(original["weights"])',
      feedback:
        'Every parcel is in the answer, light ones included. The append card ended up outside the if instead of inside it.',
    },
  ],
  transferVariant:
    'The same bug shows up in a method that collects even numbers. Fix that one too.',
  goal: {
    kind: 'invent',
    checkSource,
    cases,
    palette,
    availableNames,
    starterProgram,
    answerName: 'answer',
  },
}
