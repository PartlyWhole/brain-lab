/**
 * Mission: bind-a-name.
 *
 * The first thing a student does by hand. Making an object and naming an
 * object are two separate operations in `python/session.py`, and this mission
 * exists so the student feels that separation before anything else is built on
 * it: the Make tool leaves the number in the work area, and only Bind puts a
 * name on it.
 *
 * Source: stage 1 (1.1, 1.2, 1.13).
 */

const checkSource = `
def check_state(names, work, output, aliases):
    if "charge" not in names:
        return False, ("Nothing is called charge yet. Making an object puts it in "
                       "the work area; Bind is what gives it a name.")
    value = names["charge"]
    if isinstance(value, bool) or not isinstance(value, int):
        return False, ("charge points at %r. Pip needs it to point at the whole "
                       "number 12." % (value,))
    if value != 12:
        return False, "charge points at the number %d. Pip needs 12." % value
    return True, "charge points at the number 12."
`

export const bindANameMission = {
  id: 'bind-a-name',
  contentVersion: 1,
  sourceIds: ['1.1', '1.2', '1.13'],
  stage: 1,
  title: 'Give it a name',
  mode: 'operate',
  purpose: 'A name is a label you put on an object.',
  prompt: 'Make the number 12 and name it charge.',
  prerequisites: [],
  setupSource: '',
  tools: ['makeInt', 'makeList', 'lookup', 'bind', 'print'],
  prediction: {
    id: 'make-then-name',
    question: 'You make the number 12. Is it called charge yet?',
    options: [
      { id: 'yes', label: 'Yes, making it names it' },
      { id: 'no', label: 'No, it has no name until you bind one' },
    ],
    correctOptionId: 'no',
    explanation:
      'Making an object puts it in the work area with no name. Bind is the step that '
      + 'attaches the label charge to it.',
  },
  hints: [
    {
      level: 1,
      text: 'Pip looks for a name called charge and finds nothing. That is the part that fails.',
    },
    {
      level: 2,
      text: 'Make the number, then look at the work area. Is the 12 sitting there with no label on it?',
    },
    {
      level: 3,
      text: 'The first missing step is the naming one. Making 12 put it in the work area; it did not name it.',
    },
    {
      level: 4,
      text: 'Making an object and naming an object are two different jobs. Make builds it, Bind labels it.',
    },
    {
      level: 5,
      text: 'Do this: Make the number 12, then Bind the name charge to that work-area item.',
    },
  ],
  misconceptions: [
    {
      id: 'made-but-not-bound',
      when: '"charge" not in names and any(w["object"] == 12 for w in work)',
      feedback:
        'The number 12 is sitting in the work area with no label. Nothing is called charge yet.',
    },
    {
      id: 'named-the-wrong-object',
      when: '"charge" in names and names["charge"] != 12',
      feedback: 'charge has a label on it, but it is pointing at something other than the number 12.',
    },
  ],
  transferVariant: 'Now make the text "pip" and name it robot, with no help.',
  goal: {
    kind: 'manual',
    checkSource,
    successMessage: 'charge now points at the number 12.',
  },
}
