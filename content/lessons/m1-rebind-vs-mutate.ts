/**
 * Mission: rebind-vs-mutate.
 *
 * Two halves, deliberately, because each half on its own is passable with the
 * wrong model:
 *
 * - `crate` must grow to [1, 2, 3] *while still sharing a list with* `hold`.
 *   Only a mutation can produce that state; rebinding `crate` to a new
 *   [1, 2, 3] leaves `hold` behind and fails the alias test.
 * - `spare` must move to a different list while `backup` still holds the
 *   untouched [9]. Only a rebind can produce that state; appending would show
 *   through `backup`.
 *
 * Source: stage 2 (2.2, 2.3, 2.4, 2.13).
 */

const checkSource = `
def check_state(names, work, output, aliases):
    crate = names.get("crate")
    hold = names.get("hold")
    if not isinstance(crate, list) or not isinstance(hold, list):
        return False, "crate and hold should both still point at lists."
    if not aliases("crate", "hold"):
        return False, ("crate and hold no longer reach the same list. You pointed "
                       "crate at a new list instead of changing the one they shared.")
    if crate == [1, 2]:
        return False, "The shared crate list still holds 1 and 2. Nothing has been added yet."
    if crate != [1, 2, 3]:
        return False, ("The shared crate list holds %r. Pip wants 1, 2, 3 in the one "
                       "list that crate and hold both reach." % (crate,))

    spare = names.get("spare")
    backup = names.get("backup")
    if not isinstance(spare, list) or not isinstance(backup, list):
        return False, "spare and backup should both still point at lists."
    if backup != [9]:
        return False, ("backup now holds %r. It should still hold just 9: you changed "
                       "the list they shared instead of moving spare on its own."
                       % (backup,))
    if aliases("spare", "backup"):
        return False, ("spare and backup still reach the same list. Point spare at a "
                       "brand new list so backup keeps the old one.")
    if len(spare) < 2:
        return False, ("spare points at %r. Give spare a new list with at least two "
                       "slots so the move is easy to see." % (spare,))
    return True, ("crate grew because you changed the list itself. backup still holds "
                  "9 because you only moved the spare label.")
`

export const rebindVsMutateMission = {
  id: 'rebind-vs-mutate',
  contentVersion: 1,
  sourceIds: ['2.2', '2.3', '2.4', '2.13'],
  stage: 2,
  title: 'Change it, or replace it',
  mode: 'investigate',
  purpose: 'Changing a list and moving a label look alike, but they are not.',
  prompt: 'Add 3 to the crate that crate and hold share, then move spare alone onto a new list.',
  prerequisites: ['shared-list'],
  setupSource: 'crate = [1, 2]\nhold = crate\nspare = [9]\nbackup = spare\n',
  tools: ['append', 'makeInt', 'makeList', 'lookup', 'readSlot', 'bind', 'length', 'print'],
  prediction: {
    id: 'which-one-shows-through',
    question: 'crate and hold share one list. Which action does hold get to see?',
    options: [
      { id: 'append', label: 'Appending 3 to the list' },
      { id: 'bind', label: 'Pointing crate at a new list [1, 2, 3]' },
      { id: 'both', label: 'Both of them' },
    ],
    correctOptionId: 'append',
    explanation:
      'Appending changes the one list both names reach. Pointing crate somewhere new moves only the crate label; hold stays on the old list.',
  },
  hints: [
    {
      level: 1,
      text: 'hold does not reach the same list as crate any more, so the 3 you added shows through only one name.',
    },
    {
      level: 2,
      text: 'Replay your steps one at a time and watch the arrows leaving crate and hold.',
    },
    {
      level: 3,
      text: 'The first step that went wrong is the one that pointed crate at a freshly built list.',
    },
    {
      level: 4,
      text: 'Appending changes the list every name can see. Binding moves one label and leaves the other names where they were.',
    },
    {
      level: 5,
      text: 'Do this: append 3 to crate. Then build a new list and Bind spare to it - do not append to the list backup is on.',
    },
  ],
  misconceptions: [
    {
      id: 'rebound-the-crate',
      when: 'isinstance(names.get("crate"), list) and not aliases("crate", "hold")',
      feedback:
        'You pointed crate at a new list. hold stayed on the original list, so it cannot see the 3.',
    },
    {
      id: 'mutated-the-spare',
      when: 'aliases("spare", "backup") and names.get("backup") != [9]',
      feedback:
        'You changed the list spare and backup share, so backup can see the change too. backup was meant to keep the old list.',
    },
    {
      id: 'spare-never-moved',
      when: 'aliases("spare", "backup") and names.get("backup") == [9]',
      feedback: 'spare and backup still reach the same list. spare has not been moved anywhere yet.',
    },
  ],
  transferVariant:
    'Start with parts and stock sharing one list. End with stock unchanged and parts two items longer.',
  goal: {
    kind: 'manual',
    checkSource,
    successMessage: 'One list grew. One label moved. Two different events.',
  },
}
