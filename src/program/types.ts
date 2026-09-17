/**
 * The program model: a versioned tree with stable node ids.
 *
 * This is the single source of truth for a student's method. The visual editor
 * mutates it, the emitter renders it as Python, and the code reveal shows that
 * Python. There is no second description of the method anywhere, which is what
 * keeps "the code reveal and the visual method describe the same behaviour"
 * true by construction rather than by agreement.
 */
import { z } from 'zod'

export const PROGRAM_SCHEMA_VERSION = 1

/** Binary arithmetic supported by the palette. */
export const ARITH_OPS = ['+', '-', '*', '//', '%'] as const
export type ArithOp = (typeof ARITH_OPS)[number]

/** Comparisons supported by the palette. */
export const COMPARE_OPS = ['>', '<', '>=', '<=', '==', '!='] as const
export type CompareOp = (typeof COMPARE_OPS)[number]

/** Built-in calls the supported subset allows. */
export const CALLABLE_BUILTINS = ['len', 'sum', 'max', 'min', 'abs', 'range', 'str', 'int'] as const
export type CallableBuiltin = (typeof CALLABLE_BUILTINS)[number]

const nodeId = z.string().min(1)

/* ------------------------------------------------------------------ */
/* Expressions                                                         */
/* ------------------------------------------------------------------ */

export type Expr =
  | { kind: 'hole'; id: string; label?: string }
  | { kind: 'int'; id: string; text: string }
  | { kind: 'str'; id: string; value: string }
  | { kind: 'bool'; id: string; value: boolean }
  | { kind: 'none'; id: string }
  | { kind: 'name'; id: string; name: string }
  | { kind: 'list'; id: string; items: Expr[] }
  | { kind: 'arith'; id: string; op: ArithOp; left: Expr; right: Expr }
  | { kind: 'compare'; id: string; op: CompareOp; left: Expr; right: Expr }
  | { kind: 'index'; id: string; target: Expr; index: Expr }
  | { kind: 'call'; id: string; fn: CallableBuiltin; args: Expr[] }

export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('hole'), id: nodeId, label: z.string().optional() }),
    // Integers travel as decimal strings: Python ints are unbounded.
    z.object({ kind: z.literal('int'), id: nodeId, text: z.string().regex(/^-?\d+$/) }),
    z.object({ kind: z.literal('str'), id: nodeId, value: z.string().max(500) }),
    z.object({ kind: z.literal('bool'), id: nodeId, value: z.boolean() }),
    z.object({ kind: z.literal('none'), id: nodeId }),
    z.object({ kind: z.literal('name'), id: nodeId, name: z.string() }),
    z.object({ kind: z.literal('list'), id: nodeId, items: z.array(ExprSchema).max(50) }),
    z.object({
      kind: z.literal('arith'), id: nodeId, op: z.enum(ARITH_OPS),
      left: ExprSchema, right: ExprSchema,
    }),
    z.object({
      kind: z.literal('compare'), id: nodeId, op: z.enum(COMPARE_OPS),
      left: ExprSchema, right: ExprSchema,
    }),
    z.object({ kind: z.literal('index'), id: nodeId, target: ExprSchema, index: ExprSchema }),
    z.object({
      kind: z.literal('call'), id: nodeId, fn: z.enum(CALLABLE_BUILTINS),
      args: z.array(ExprSchema).max(3),
    }),
  ]) as z.ZodType<Expr>,
)

/* ------------------------------------------------------------------ */
/* Statements (instruction cards)                                      */
/* ------------------------------------------------------------------ */

export type Stmt =
  | { kind: 'bind'; id: string; name: string; value: Expr }
  | { kind: 'slotWrite'; id: string; target: Expr; index: Expr; value: Expr }
  | { kind: 'append'; id: string; target: Expr; value: Expr }
  | { kind: 'print'; id: string; value: Expr }
  | { kind: 'if'; id: string; condition: Expr; then: Stmt[]; otherwise: Stmt[] }
  | { kind: 'for'; id: string; loopName: string; iterable: Expr; body: Stmt[] }
  | { kind: 'break'; id: string }
  | { kind: 'continue'; id: string }

export const StmtSchema: z.ZodType<Stmt> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('bind'), id: nodeId, name: z.string(), value: ExprSchema }),
    z.object({
      kind: z.literal('slotWrite'), id: nodeId,
      target: ExprSchema, index: ExprSchema, value: ExprSchema,
    }),
    z.object({ kind: z.literal('append'), id: nodeId, target: ExprSchema, value: ExprSchema }),
    z.object({ kind: z.literal('print'), id: nodeId, value: ExprSchema }),
    z.object({
      kind: z.literal('if'), id: nodeId, condition: ExprSchema,
      then: z.array(StmtSchema).max(60), otherwise: z.array(StmtSchema).max(60),
    }),
    z.object({
      kind: z.literal('for'), id: nodeId, loopName: z.string(),
      iterable: ExprSchema, body: z.array(StmtSchema).max(60),
    }),
    z.object({ kind: z.literal('break'), id: nodeId }),
    z.object({ kind: z.literal('continue'), id: nodeId }),
  ]) as z.ZodType<Stmt>,
)

export const ProgramSchema = z.object({
  schemaVersion: z.literal(PROGRAM_SCHEMA_VERSION),
  missionId: z.string(),
  body: z.array(StmtSchema).max(120),
})
export type Program = z.infer<typeof ProgramSchema>

/* ------------------------------------------------------------------ */
/* Node helpers                                                        */
/* ------------------------------------------------------------------ */

let counter = 0
/** Stable-enough unique ids for editor nodes within a browser session. */
export function newId(prefix = 'n'): string {
  counter += 1
  return `${prefix}${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function hole(label?: string): Expr {
  return { kind: 'hole', id: newId('h'), label }
}

export function emptyProgram(missionId: string): Program {
  return { schemaVersion: PROGRAM_SCHEMA_VERSION, missionId, body: [] }
}

export function isBlock(s: Stmt): s is Extract<Stmt, { kind: 'if' | 'for' }> {
  return s.kind === 'if' || s.kind === 'for'
}

/** Every statement in the tree, in source order, with its depth. */
export function walkStmts(
  body: Stmt[],
  visit: (s: Stmt, depth: number, parent: Stmt | null) => void,
  depth = 0,
  parent: Stmt | null = null,
): void {
  for (const s of body) {
    visit(s, depth, parent)
    if (s.kind === 'if') {
      walkStmts(s.then, visit, depth + 1, s)
      walkStmts(s.otherwise, visit, depth + 1, s)
    } else if (s.kind === 'for') {
      walkStmts(s.body, visit, depth + 1, s)
    }
  }
}

/** Every expression inside a statement, including nested ones. */
export function walkExprs(e: Expr, visit: (e: Expr) => void): void {
  visit(e)
  switch (e.kind) {
    case 'list':
      e.items.forEach((x) => walkExprs(x, visit))
      break
    case 'arith':
    case 'compare':
      walkExprs(e.left, visit)
      walkExprs(e.right, visit)
      break
    case 'index':
      walkExprs(e.target, visit)
      walkExprs(e.index, visit)
      break
    case 'call':
      e.args.forEach((x) => walkExprs(x, visit))
      break
    default:
      break
  }
}
