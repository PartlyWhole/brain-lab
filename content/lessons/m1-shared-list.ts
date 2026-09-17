/**
 * Mission: shared-list.
 *
 * Two names, one list. The check asks `aliases("bag", "supplies")`, not
 * `bag == supplies`, because a student who rebuilds an identical list would
 * pass an equality check while holding exactly the wrong model. Appending the
 * lamp through `bag` and seeing it through `supplies` is the evidence.
 *
 * Source: stage 4 (4.1), stage 1 (1.3, 1.13), stage 2 (2.2).
 */

const checkSource = `
def check_state(names, work, output, aliases):
    supplies = names.get("supplies")
    if not isinstance(supplies, list):
        return False, "supplies should still point at Pip's supply list."
    if "bag" not in names:
        return False, ("There is no name bag yet. Point a second name at the list "
                       "supplies already reaches.")
    bag = names["bag"]
    if not isinstance(bag, list):
        return False, "bag points at %r. It needs to point at a list." % (bag,)
    if not aliases("bag", "supplies"):
        return False, ("bag and supplies point at two different lists, so anything "
                       "you put in one will never show up in the other.")
    if supplies == ["rope", "tape"]:
        return False, ("bag and supplies do share one list, but nothing has been "
                       "added to it yet. Pip still needs the lamp.")
    if supplies != ["rope", "tape", "lamp"]:
        return False, ("The shared list holds %r. Pip needs rope, tape and lamp in "
                       "it, in that order." % (supplies,))
    return True, ("One list, two names. The lamp went in through bag and supplies "
                  "can see it.")
`

export const sharedListMission = {
  id: 'shared-list',
  contentVersion: 1,
  sourceIds: ['1.3', '1.13', '2.2', '4.1'],
  stage: 4,
  title: 'One list, two names',
  mode: 'operate',
  purpose: 'Two names can point at one list.',
  prompt: 'Name the supply list bag as well, then put a lamp in it.',
  prerequisites: ['bind-a-name'],
  setupSource: 'supplies = ["rope", "tape"]\n',
  tools: ['lookup', 'bind', 'append', 'makeStr', 'makeList', 'length', 'print'],
  prediction: {
    id: 'append-through-the-other-name',
    question:
      'bag and supplies point at the same list. You append a lamp through bag. What does supplies hold?',
    options: [
      { id: 'two', label: 'rope and tape' },
      { id: 'three', label: 'rope, tape and lamp' },
      { id: 'one', label: 'just lamp' },
    ],
    correctOptionId: 'three',
    explanation:
      'There is only one list. Appending changed that list, and both names reach it, so both names see the lamp.',
  },
  hints: [
    {
      level: 1,
      text: 'After you add the lamp, supplies still shows only rope and tape. That is the part that fails.',
    },
    {
      level: 2,
      text: 'Step back through what you did and count the list boxes drawn in the brain. Is there one, or two?',
    },
    {
      level: 3,
      text: 'The first wrong step is the one that built a second list. After that, bag and supplies were never the same list.',
    },
    {
      level: 4,
      text: 'Building a list that looks the same is not the same as pointing a second name at the one list.',
    },
    {
      level: 5,
      text: 'Do this: Look up supplies, Bind the name bag to that very item, then append the lamp through bag.',
    },
  ],
  misconceptions: [
    {
      id: 'copied-instead-of-shared',
      when: '"bag" in names and isinstance(names["bag"], list) and not aliases("bag", "supplies")',
      feedback:
        'You built bag a list of its own. supplies still points at the original list, so the lamp never reached it.',
    },
    {
      id: 'shared-but-nothing-added',
      when: 'aliases("bag", "supplies") and len(names["supplies"]) == 2',
      feedback: 'bag and supplies do reach one list, but nothing has been added to it yet.',
    },
    {
      id: 'lamp-left-in-the-work-area',
      when: 'any(w["object"] == "lamp" for w in work) and "lamp" not in names.get("supplies", [])',
      feedback: 'The lamp is sitting in the work area. It has not gone into the list yet.',
    },
  ],
  transferVariant:
    'Start from a list of three tools, give it a second name, and add two things through the new name.',
  goal: {
    kind: 'manual',
    checkSource,
    successMessage: 'One list. Two names. Both see the lamp.',
  },
}
