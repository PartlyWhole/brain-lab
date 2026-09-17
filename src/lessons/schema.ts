/**
 * Mission definitions.
 *
 * Authored as TypeScript modules under content/lessons/ and validated with
 * these schemas at load time, so a malformed mission fails loudly at the
 * boundary instead of producing a confusing lesson.
 *
 * A mission records where it came from in the source curriculum (`sourceIds`)
 * so a teacher can move between the printed exercises and the game.
 */
import { z } from 'zod'
import { ProgramSchema } from '../program/types'

export const CONTENT_SCHEMA_VERSION = 1

/** Operations the brain's tool palette may offer in a mission. */
export const MANUAL_TOOLS = [
  'makeInt', 'makeStr', 'makeList', 'lookup', 'bind', 'append', 'setSlot',
  'readSlot', 'length', 'add', 'compare', 'print', 'discard',
] as const
export type ManualTool = (typeof MANUAL_TOOLS)[number]

/** Instruction cards the method editor may offer in a mission. */
export const EDITOR_CARDS = [
  'bind', 'append', 'slotWrite', 'print', 'if', 'for', 'break', 'continue',
] as const
export type EditorCard = (typeof EDITOR_CARDS)[number]

export const HintSchema = z.object({
  /** 1 = reveal a failing input … 5 = demonstrate a repair. Never skip ahead. */
  level: z.number().int().min(1).max(5),
  text: z.string(),
})

/**
 * A misconception the mission expects, with the feedback that names the actual
 * event rather than saying "wrong". `when` is trusted Python returning a bool.
 */
export const MisconceptionSchema = z.object({
  id: z.string(),
  when: z.string(),
  feedback: z.string(),
})

export const PredictionSchema = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).min(2),
  correctOptionId: z.string(),
  /** Shown after the student commits, whether they were right or wrong. */
  explanation: z.string(),
})

/** A mission the student completes by operating the brain by hand. */
export const ManualGoalSchema = z.object({
  kind: z.literal('manual'),
  /**
   * Trusted Python defining
   * `check_state(names, work, output, aliases) -> (done, message)`.
   * `aliases(a, b)` reports whether two names reach the same object, so a
   * mission can require sharing rather than mere equality.
   */
  checkSource: z.string(),
  /** Shown in the goal strip; plain language, not a restatement of the check. */
  successMessage: z.string(),
})

/** A mission the student completes by building a method. */
export const InventGoalSchema = z.object({
  kind: z.literal('invent'),
  /** Trusted Python defining `check_case(case, ns, original, identities, error)`. */
  checkSource: z.string(),
  cases: z.array(z.object({
    id: z.string(),
    label: z.string(),
    setup: z.string(),
    /** Names the checker may compare against their pre-run deep copies. */
    inputs: z.array(z.string()).default([]),
    expected: z.unknown().optional(),
    /** Hidden cases still run; on a static site nothing is truly secret. */
    hidden: z.boolean().default(false),
  })).min(1),
  /** Cards the palette offers. Keeping it small is a teaching decision. */
  palette: z.array(z.enum(EDITOR_CARDS)),
  /** Names the method may read; shown in the editor's name picker. */
  availableNames: z.array(z.string()).default([]),
  /** A faulty or partial method to start from, for repair missions. */
  starterProgram: ProgramSchema.optional(),
  /** What a finished method must bind. Before functions, this is `answer`. */
  answerName: z.string().default('answer'),
})

export const MissionSchema = z.object({
  id: z.string(),
  contentVersion: z.literal(CONTENT_SCHEMA_VERSION),
  /** Exercise ids from /Users/alan/Desktop/PythonExercises, e.g. "2.4". */
  sourceIds: z.array(z.string()).default([]),
  stage: z.number().int().min(1).max(9),
  title: z.string(),
  mode: z.enum(['operate', 'investigate', 'invent']),
  /** One short line from Pip. One idea, not a paragraph. */
  purpose: z.string(),
  /** The immediate ask. Also one line. */
  prompt: z.string(),
  prerequisites: z.array(z.string()).default([]),
  /** Python that builds the starting state. Aliases are expressible here. */
  setupSource: z.string().default(''),
  tools: z.array(z.enum(MANUAL_TOOLS)).default([]),
  prediction: PredictionSchema.optional(),
  hints: z.array(HintSchema).default([]),
  misconceptions: z.array(MisconceptionSchema).default([]),
  /** A second case that tests whether the understanding transferred. */
  transferVariant: z.string().optional(),
  goal: z.discriminatedUnion('kind', [ManualGoalSchema, InventGoalSchema]),
})
export type Mission = z.infer<typeof MissionSchema>
export type ManualGoal = z.infer<typeof ManualGoalSchema>
export type InventGoal = z.infer<typeof InventGoalSchema>
export type Hint = z.infer<typeof HintSchema>
export type Prediction = z.infer<typeof PredictionSchema>

export function parseMission(raw: unknown): Mission {
  return MissionSchema.parse(raw)
}
