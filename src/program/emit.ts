/**
 * Deterministic Python emitter with a line -> card source map.
 *
 * The emitter never concatenates unchecked student text into source. Names are
 * validated as Python identifiers and string literals are escaped, so a student
 * cannot type their way out of the supported subset.
 */
import type { Expr, Program, Stmt } from './types'
import { walkStmts } from './types'

export const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'match', 'case', '_',
])

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isValidName(name: string): boolean {
  return IDENTIFIER.test(name) && !PYTHON_KEYWORDS.has(name) && name.length <= 32
}

/** Python string literal with explicit escaping; never interpolate raw text. */
export function pythonString(value: string): string {
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0')
    else out += ch
  }
  return out + '"'
}

export class EmitError extends Error {
  readonly nodeId: string
  constructor(message: string, nodeId: string) {
    super(message)
    this.nodeId = nodeId
  }
}

/* Precedence levels, loosest first. Mirrors Python's grammar for the subset. */
/**
 * A negative literal is given a deliberately loose level so that it is
 * parenthesised wherever it appears as an operand: `5 * (-3)` rather than the
 * equally valid `5 * -3`. This is a readability choice for a code reveal a
 * beginner reads, not a correctness requirement; the Python-agreement cases in
 * tests/semantics/emitter.test.ts pin the values either way.
 */
const P_NEGATIVE_LITERAL = 2
const P_COMPARE = 3
const P_ADD = 4
const P_MUL = 5
const P_TRAILER = 7
const P_ATOM = 8

function precedenceOf(e: Expr): number {
  switch (e.kind) {
    case 'compare':
      return P_COMPARE
    case 'arith':
      return e.op === '+' || e.op === '-' ? P_ADD : P_MUL
    case 'index':
    case 'call':
      return P_TRAILER
    case 'int':
      return e.text.startsWith('-') ? P_NEGATIVE_LITERAL : P_ATOM
    default:
      return P_ATOM
  }
}

function wrap(text: string, own: number, needed: number): string {
  return own < needed ? `(${text})` : text
}

export function emitExpr(e: Expr, needed = 0): string {
  const own = precedenceOf(e)
  switch (e.kind) {
    case 'hole':
      throw new EmitError('This instruction still has an empty space to fill in.', e.id)
    case 'int':
      return wrap(e.text, own, needed)
    case 'str':
      return pythonString(e.value)
    case 'bool':
      return e.value ? 'True' : 'False'
    case 'none':
      return 'None'
    case 'name':
      if (!isValidName(e.name)) {
        throw new EmitError(`"${e.name}" is not a usable name.`, e.id)
      }
      return e.name
    case 'list':
      return `[${e.items.map((x) => emitExpr(x, 0)).join(', ')}]`
    case 'arith': {
      // Left-associative: the right operand needs one extra level.
      const text = `${emitExpr(e.left, own)} ${e.op} ${emitExpr(e.right, own + 1)}`
      return wrap(text, own, needed)
    }
    case 'compare': {
      const text = `${emitExpr(e.left, own + 1)} ${e.op} ${emitExpr(e.right, own + 1)}`
      return wrap(text, own, needed)
    }
    case 'index':
      return `${emitExpr(e.target, P_TRAILER)}[${emitExpr(e.index, 0)}]`
    case 'call':
      return `${e.fn}(${e.args.map((x) => emitExpr(x, 0)).join(', ')})`
  }
}

export interface EmitResult {
  /** The Python source, one statement per line. */
  source: string
  /** 1-based line number -> the card id that produced it. */
  lineToCard: Record<number, string>
  /** card id -> 1-based line number. */
  cardToLine: Record<string, number>
}

/**
 * Renders a program. Block statements occupy their header line only; their
 * bodies occupy the following lines, which is exactly how Python's line events
 * report them, so the source map stays honest for playback highlighting.
 */
export function emitProgram(program: Program): EmitResult {
  const out: string[] = []
  const lineToCard: Record<number, string> = {}
  const cardToLine: Record<string, number> = {}

  const push = (indent: number, text: string, cardId: string) => {
    out.push('    '.repeat(indent) + text)
    const line = out.length
    lineToCard[line] = cardId
    if (!(cardId in cardToLine)) cardToLine[cardId] = line
  }

  const emitBody = (body: Stmt[], indent: number) => {
    if (body.length === 0) {
      // `pass` belongs to the enclosing block header, not to a card of its own.
      out.push('    '.repeat(indent) + 'pass')
      return
    }
    for (const s of body) emitStmt(s, indent)
  }

  const emitStmt = (s: Stmt, indent: number) => {
    switch (s.kind) {
      case 'bind':
        if (!isValidName(s.name)) {
          throw new EmitError(`"${s.name}" is not a usable name.`, s.id)
        }
        push(indent, `${s.name} = ${emitExpr(s.value, 0)}`, s.id)
        break
      case 'slotWrite':
        push(
          indent,
          `${emitExpr(s.target, P_TRAILER)}[${emitExpr(s.index, 0)}] = ${emitExpr(s.value, 0)}`,
          s.id,
        )
        break
      case 'append':
        push(indent, `${emitExpr(s.target, P_TRAILER)}.append(${emitExpr(s.value, 0)})`, s.id)
        break
      case 'print':
        push(indent, `print(${emitExpr(s.value, 0)})`, s.id)
        break
      case 'break':
        push(indent, 'break', s.id)
        break
      case 'continue':
        push(indent, 'continue', s.id)
        break
      case 'if':
        push(indent, `if ${emitExpr(s.condition, 0)}:`, s.id)
        emitBody(s.then, indent + 1)
        if (s.otherwise.length > 0) {
          // `else:` is part of the same card; it does not receive line events.
          out.push('    '.repeat(indent) + 'else:')
          emitBody(s.otherwise, indent + 1)
        }
        break
      case 'for':
        if (!isValidName(s.loopName)) {
          throw new EmitError(`"${s.loopName}" is not a usable name.`, s.id)
        }
        push(indent, `for ${s.loopName} in ${emitExpr(s.iterable, 0)}:`, s.id)
        emitBody(s.body, indent + 1)
        break
    }
  }

  for (const s of program.body) emitStmt(s, 0)
  if (out.length === 0) out.push('pass')

  return { source: out.join('\n') + '\n', lineToCard, cardToLine }
}

/** Card ids in source order; used by the editor and the code reveal. */
export function cardOrder(program: Program): string[] {
  const ids: string[] = []
  walkStmts(program.body, (s) => ids.push(s.id))
  return ids
}
