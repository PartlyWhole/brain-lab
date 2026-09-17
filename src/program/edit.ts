/**
 * Typed edits on the program tree.
 *
 * Every editor gesture is one of these actions. They are pure: each returns a
 * new tree, which is what makes undo/redo a matter of keeping previous trees
 * rather than trying to invert a mutation.
 *
 * Structure is validated by construction here; whether a tree can *run* is a
 * separate question answered by `validate`.
 */
import type { Expr, Program, Stmt } from './types'
import { isBlock, walkExprs, walkStmts } from './types'
import { isValidName } from './emit'

/** Where a statement sits: its parent block, which slot of it, and the index. */
export interface StmtSlot {
  parentId: string | null
  slot: 'body' | 'then' | 'otherwise'
  index: number
}

function childList(parent: Stmt, slot: StmtSlot['slot']): Stmt[] | null {
  if (parent.kind === 'for' && slot === 'body') return parent.body
  if (parent.kind === 'if' && slot === 'then') return parent.then
  if (parent.kind === 'if' && slot === 'otherwise') return parent.otherwise
  return null
}

function withChildren(parent: Stmt, slot: StmtSlot['slot'], next: Stmt[]): Stmt {
  if (parent.kind === 'for' && slot === 'body') return { ...parent, body: next }
  if (parent.kind === 'if' && slot === 'then') return { ...parent, then: next }
  if (parent.kind === 'if' && slot === 'otherwise') return { ...parent, otherwise: next }
  return parent
}

/** Maps a statement id to where it lives. */
export function locate(program: Program, id: string): StmtSlot | null {
  let found: StmtSlot | null = null
  const scan = (body: Stmt[], parentId: string | null, slot: StmtSlot['slot']) => {
    body.forEach((s, index) => {
      if (s.id === id) found = { parentId, slot, index }
      if (s.kind === 'for') scan(s.body, s.id, 'body')
      if (s.kind === 'if') {
        scan(s.then, s.id, 'then')
        scan(s.otherwise, s.id, 'otherwise')
      }
    })
  }
  scan(program.body, null, 'body')
  return found
}

export function findStmt(program: Program, id: string): Stmt | null {
  let found: Stmt | null = null
  walkStmts(program.body, (s) => {
    if (s.id === id) found = s
  })
  return found
}

/** True when `ancestorId` contains `id`; used to refuse self-nesting moves. */
export function contains(program: Program, ancestorId: string, id: string): boolean {
  const ancestor = findStmt(program, ancestorId)
  if (!ancestor || !isBlock(ancestor)) return false
  let hit = false
  const inner = ancestor.kind === 'for' ? [ancestor.body] : [ancestor.then, ancestor.otherwise]
  inner.forEach((list) => walkStmts(list, (s) => { if (s.id === id) hit = true }))
  return hit
}

function mapSlot(
  program: Program,
  target: { parentId: string | null; slot: StmtSlot['slot'] },
  fn: (list: Stmt[]) => Stmt[],
): Program {
  if (target.parentId === null) {
    return { ...program, body: fn(program.body) }
  }
  const rewrite = (body: Stmt[]): Stmt[] =>
    body.map((s) => {
      if (s.id === target.parentId) {
        const list = childList(s, target.slot)
        if (!list) return s
        return withChildren(s, target.slot, fn(list))
      }
      if (s.kind === 'for') return { ...s, body: rewrite(s.body) }
      if (s.kind === 'if') return { ...s, then: rewrite(s.then), otherwise: rewrite(s.otherwise) }
      return s
    })
  return { ...program, body: rewrite(program.body) }
}

export function insertStmt(program: Program, at: StmtSlot, stmt: Stmt): Program {
  return mapSlot(program, at, (list) => {
    const index = Math.max(0, Math.min(at.index, list.length))
    return [...list.slice(0, index), stmt, ...list.slice(index)]
  })
}

export function removeStmt(program: Program, id: string): Program {
  const at = locate(program, id)
  if (!at) return program
  return mapSlot(program, at, (list) => list.filter((s) => s.id !== id))
}

/**
 * Moves a statement. Refuses to drop a block inside itself, which would
 * silently delete the subtree.
 */
export function moveStmt(program: Program, id: string, to: StmtSlot): Program {
  if (id === to.parentId) return program
  if (to.parentId && contains(program, id, to.parentId)) return program

  const from = locate(program, id)
  const stmt = findStmt(program, id)
  if (!from || !stmt) return program

  const removed = removeStmt(program, id)
  // Removing an earlier sibling in the same slot shifts the target index down.
  const sameSlot = from.parentId === to.parentId && from.slot === to.slot
  const index = sameSlot && from.index < to.index ? to.index - 1 : to.index
  return insertStmt(removed, { ...to, index }, stmt)
}

/** Replaces one expression node anywhere in the tree, by id. */
export function replaceExpr(program: Program, exprId: string, next: Expr): Program {
  const inExpr = (e: Expr): Expr => {
    if (e.id === exprId) return next
    switch (e.kind) {
      case 'list':
        return { ...e, items: e.items.map(inExpr) }
      case 'arith':
      case 'compare':
        return { ...e, left: inExpr(e.left), right: inExpr(e.right) }
      case 'index':
        return { ...e, target: inExpr(e.target), index: inExpr(e.index) }
      case 'call':
        return { ...e, args: e.args.map(inExpr) }
      default:
        return e
    }
  }
  const inStmt = (s: Stmt): Stmt => {
    switch (s.kind) {
      case 'bind':
        return { ...s, value: inExpr(s.value) }
      case 'slotWrite':
        return { ...s, target: inExpr(s.target), index: inExpr(s.index), value: inExpr(s.value) }
      case 'append':
        return { ...s, target: inExpr(s.target), value: inExpr(s.value) }
      case 'print':
        return { ...s, value: inExpr(s.value) }
      case 'if':
        return {
          ...s, condition: inExpr(s.condition),
          then: s.then.map(inStmt), otherwise: s.otherwise.map(inStmt),
        }
      case 'for':
        return { ...s, iterable: inExpr(s.iterable), body: s.body.map(inStmt) }
      default:
        return s
    }
  }
  return { ...program, body: program.body.map(inStmt) }
}

/** Applies a shallow patch to one statement, by id. */
export function updateStmt<T extends Stmt>(
  program: Program,
  id: string,
  patch: Partial<T>,
): Program {
  const inStmt = (s: Stmt): Stmt => {
    let next = s
    if (s.id === id) next = { ...s, ...patch } as Stmt
    if (next.kind === 'for') return { ...next, body: next.body.map(inStmt) }
    if (next.kind === 'if') {
      return { ...next, then: next.then.map(inStmt), otherwise: next.otherwise.map(inStmt) }
    }
    return next
  }
  return { ...program, body: program.body.map(inStmt) }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface Problem {
  nodeId: string
  message: string
  /** 'draft' problems are expected while building; 'error' problems are wrong. */
  severity: 'draft' | 'error'
}

/**
 * Reports what stops a method from running.
 *
 * An unfilled operand is a *draft*, not a mistake: the editor says "still to
 * fill in" rather than marking the student wrong for not having finished yet.
 */
export function validate(program: Program, knownNames: string[] = []): Problem[] {
  const problems: Problem[] = []
  // Names a method may read: the mission's inputs plus anything it binds, plus
  // loop names, since a loop name is bound by the loop itself.
  const bound = new Set(knownNames)
  walkStmts(program.body, (s) => {
    if (s.kind === 'bind') bound.add(s.name)
    if (s.kind === 'for') bound.add(s.loopName)
  })

  const checkExpr = (e: Expr) => {
    walkExprs(e, (node) => {
      if (node.kind === 'hole') {
        problems.push({
          nodeId: node.id,
          message: node.label ? `Still to fill in: ${node.label}.` : 'Still to fill in.',
          severity: 'draft',
        })
      }
      if (node.kind === 'name') {
        if (!isValidName(node.name)) {
          problems.push({
            nodeId: node.id,
            message: node.name
              ? `"${node.name}" cannot be a name.`
              : 'Pick a name.',
            severity: node.name ? 'error' : 'draft',
          })
        } else if (!bound.has(node.name)) {
          problems.push({
            nodeId: node.id,
            message: `Nothing is called "${node.name}" yet.`,
            severity: 'error',
          })
        }
      }
      if (node.kind === 'list' && node.items.length > 20) {
        problems.push({
          nodeId: node.id, severity: 'error',
          message: 'That list is longer than the lab shows.',
        })
      }
    })
  }

  let loopDepth = 0
  const visit = (body: Stmt[]) => {
    for (const s of body) {
      switch (s.kind) {
        case 'bind':
          if (!isValidName(s.name)) {
            problems.push({
              nodeId: s.id, severity: s.name ? 'error' : 'draft',
              message: s.name ? `"${s.name}" cannot be a name.` : 'Choose a name.',
            })
          }
          checkExpr(s.value)
          break
        case 'append':
          checkExpr(s.target); checkExpr(s.value)
          break
        case 'slotWrite':
          checkExpr(s.target); checkExpr(s.index); checkExpr(s.value)
          break
        case 'print':
          checkExpr(s.value)
          break
        case 'if':
          checkExpr(s.condition)
          if (s.then.length === 0 && s.otherwise.length === 0) {
            problems.push({
              nodeId: s.id, severity: 'draft',
              message: 'This if has no instructions inside it yet.',
            })
          }
          visit(s.then); visit(s.otherwise)
          break
        case 'for':
          if (!isValidName(s.loopName)) {
            problems.push({
              nodeId: s.id, severity: s.loopName ? 'error' : 'draft',
              message: s.loopName
                ? `"${s.loopName}" cannot be a name.`
                : 'Choose a name for each item.',
            })
          }
          checkExpr(s.iterable)
          if (s.body.length === 0) {
            problems.push({
              nodeId: s.id, severity: 'draft',
              message: 'This for has no instructions inside it yet.',
            })
          }
          loopDepth += 1
          visit(s.body)
          loopDepth -= 1
          break
        case 'break':
        case 'continue':
          if (loopDepth === 0) {
            problems.push({
              nodeId: s.id, severity: 'error',
              message: s.kind === 'break'
                ? 'Stop-loop only works inside a loop.'
                : 'Next-turn only works inside a loop.',
            })
          }
          break
      }
    }
  }
  visit(program.body)
  return problems
}

export function canRun(problems: Problem[]): boolean {
  return problems.length === 0
}
