/**
 * Mission: swap-keep-the-value.
 *
 * Exercise 1.8 as a manual puzzle. The palette deliberately has no Make tool,
 * so the two flag objects in the setup are the only objects in the world: the
 * student cannot fabricate a replacement for the flag they dropped, and the
 * naive `left = right; right = left` order really does lose one. Holding the
 * red flag in the work area first is the whole lesson.
 *
 * Source: stage 1 (1.4, 1.8, 1.13), stage 2 (2.13).
 */

const checkSource = `
def check_state(names, work, output, aliases):
    left = names.get("left")
    right = names.get("right")
    if not isinstance(left, list) or not isinstance(right, list):
        return False, "left and right should each point at one of the two flags."
    if left == ["red flag"] and right == ["blue flag"]:
        return False, "Nothing has swapped yet: left still reaches the red flag."
    if aliases("left", "right"):
        return False, ("left and right now reach the same flag, so one flag has no "
                       "name left. Hold one of them in the work area before you move "
                       "either name.")
    if left != ["blue flag"]:
        return False, "left reaches %r. It should reach the blue flag." % (left,)
    if right != ["red flag"]:
        return False, "right reaches %r. It should reach the red flag." % (right,)
    return True, "The two flags swapped names. Nothing was copied and nothing was lost."
`

export const swapKeepTheValueMission = {
  id: 'swap-keep-the-value',
  contentVersion: 1,
  sourceIds: ['1.4', '1.8', '1.13', '2.13'],
  stage: 2,
  title: 'Swap the flags',
  mode: 'operate',
  purpose: 'To swap two names you need somewhere to put the first one.',
  prompt: 'Make left reach the blue flag and right reach the red flag.',
  prerequisites: ['rebind-vs-mutate'],
  setupSource: 'left = ["red flag"]\nright = ["blue flag"]\n',
  tools: ['lookup', 'bind', 'readSlot', 'print', 'discard'],
  prediction: {
    id: 'naive-swap',
    question: 'You bind left to right, then bind right to left. Where do the names end up?',
    options: [
      { id: 'swapped', label: 'They are swapped' },
      { id: 'both-blue', label: 'Both reach the blue flag' },
      { id: 'both-red', label: 'Both reach the red flag' },
    ],
    correctOptionId: 'both-blue',
    explanation:
      'The first step already moved left onto the blue flag. The second step then reads that new left, so right lands on blue too and the red flag loses its name.',
  },
  hints: [
    {
      level: 1,
      text: 'Right now left and right both reach the blue flag, and nothing reaches the red one.',
    },
    {
      level: 2,
      text: 'Step back to the start and go forward one operation at a time, watching where each name points.',
    },
    {
      level: 3,
      text: 'The first step that went wrong is the one that moved left before anything was holding the red flag.',
    },
    {
      level: 4,
      text: 'Binding does not remember where a name used to point. Once left moves, the old flag is gone unless something else reaches it.',
    },
    {
      level: 5,
      text: 'Do this: Look up left so the red flag sits in the work area, Bind left to right, then Bind right to that work-area item.',
    },
  ],
  misconceptions: [
    {
      id: 'both-names-on-one-flag',
      when: 'aliases("left", "right")',
      feedback:
        'left and right both reach the same flag now. The other flag has no name pointing at it any more.',
    },
    {
      id: 'swapped-the-wrong-way',
      when: 'names.get("left") == ["red flag"] and names.get("right") == ["blue flag"]',
      feedback: 'Nothing moved. left still reaches the red flag and right still reaches the blue one.',
    },
  ],
  transferVariant: 'Now rotate three names - a, b and c - one place along, still without making anything new.',
  goal: {
    kind: 'manual',
    checkSource,
    successMessage: 'Both flags kept, both names moved.',
  },
}
