/**
 * The nested visual method editor.
 *
 * Block structure is nested DOM, not a flowchart: a program is a tree, and
 * showing it as a tree is what lets a student see what is *inside* a loop. One
 * execution marker shows the current instruction during playback.
 *
 * Every gesture has a keyboard equivalent: insertion points are buttons,
 * Alt+Arrow moves a card, Delete removes it. Dragging is never required.
 */
import { useState } from 'react'
import type { Program, Stmt } from '../program/types'
import { hole, newId } from '../program/types'
import type { EditorCard } from '../lessons/schema'
import {
  insertStmt, moveStmt, removeStmt, replaceExpr, updateStmt, locate, findStmt,
  type Problem, type StmtSlot,
} from '../program/edit'
import { ExprChip } from './ExprChip'
import './editor.css'

export interface MethodEditorProps {
  program: Program
  palette: EditorCard[]
  availableNames: string[]
  problems: Problem[]
  /** The card Pip is executing right now, or null when nothing is running. */
  executingCardId?: string | null
  /** Cards already executed in this run, for a faded trail. */
  visitedCardIds?: string[]
  readOnly?: boolean
  onChange: (next: Program) => void
}

const CARD_LABELS: Record<EditorCard, { label: string; hint: string }> = {
  bind: { label: 'Point a name at something', hint: 'name = …' },
  append: { label: 'Add to the end of a list', hint: 'list.append(…)' },
  slotWrite: { label: 'Replace one slot of a list', hint: 'list[i] = …' },
  print: { label: 'Say it out loud', hint: 'print(…)' },
  if: { label: 'Only if…', hint: 'if …:' },
  for: { label: 'For each item…', hint: 'for item in …:' },
  break: { label: 'Stop the loop', hint: 'break' },
  continue: { label: 'Skip to the next turn', hint: 'continue' },
}

function makeCard(kind: EditorCard): Stmt {
  const id = newId('c')
  switch (kind) {
    case 'bind': return { kind: 'bind', id, name: '', value: hole('a value') }
    case 'append': return { kind: 'append', id, target: hole('the list'), value: hole('what to add') }
    case 'slotWrite':
      return { kind: 'slotWrite', id, target: hole('the list'), index: hole('which slot'), value: hole('the new thing') }
    case 'print': return { kind: 'print', id, value: hole('what to say') }
    case 'if': return { kind: 'if', id, condition: hole('a comparison'), then: [], otherwise: [] }
    case 'for': return { kind: 'for', id, loopName: '', iterable: hole('a list'), body: [] }
    case 'break': return { kind: 'break', id }
    case 'continue': return { kind: 'continue', id }
  }
}

export function MethodEditor(props: MethodEditorProps) {
  const { program, readOnly } = props
  return (
    <div className="editor" role="region" aria-label="Pip’s method">
      <StatementList
        {...props}
        body={program.body}
        parentId={null}
        slot="body"
        depth={0}
      />
      {program.body.length === 0 && !readOnly && (
        <p className="editor__empty">
          Pip has no instructions yet. Add the first one.
        </p>
      )}
    </div>
  )
}

function StatementList(
  props: MethodEditorProps & {
    body: Stmt[]
    parentId: string | null
    slot: StmtSlot['slot']
    depth: number
  },
) {
  const { body, depth, readOnly } = props
  // An <ol> may only contain <li>, so the leading insertion point and the
  // spoken summary live outside it. Otherwise a screen reader stops treating
  // the instructions as a list at all.
  return (
    <div className="stmt-list" data-depth={depth}>
      {!readOnly && <InsertPoint {...props} index={0} />}
      <ol className="stmt-list__items">
        {body.map((stmt, index) => (
          <li key={stmt.id}>
            <StatementCard {...props} stmt={stmt} index={index} />
            {!readOnly && <InsertPoint {...props} index={index + 1} />}
          </li>
        ))}
        {body.length === 0 && (
          <li className="stmt-list__empty">nothing in here yet</li>
        )}
      </ol>
      <span className="visually-hidden">
        {`${body.length} instruction${body.length === 1 ? '' : 's'} at level ${depth + 1}`}
      </span>
    </div>
  )
}

function InsertPoint(
  props: MethodEditorProps & { parentId: string | null; slot: StmtSlot['slot']; index: number },
) {
  const { palette, parentId, slot, index, program, onChange } = props
  const [open, setOpen] = useState(false)

  return (
    <div className="insert">
      <button
        type="button"
        className="insert__button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span aria-hidden="true">+</span>
        <span className="visually-hidden">Add an instruction here</span>
      </button>
      {open && (
        <ul className="insert__menu">
          {palette.map((kind) => (
            <li key={kind}>
              <button
                type="button"
                onClick={() => {
                  onChange(insertStmt(program, { parentId, slot, index }, makeCard(kind)))
                  setOpen(false)
                }}
              >
                <span className="picker__label">{CARD_LABELS[kind].label}</span>
                <span className="picker__hint">{CARD_LABELS[kind].hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatementCard(props: MethodEditorProps & { stmt: Stmt; depth: number; index: number }) {
  const {
    stmt, program, onChange, problems, availableNames, readOnly,
    executingCardId, visitedCardIds,
  } = props

  const problem = problems.find((p) => p.nodeId === stmt.id)
  const executing = executingCardId === stmt.id
  const visited = visitedCardIds?.includes(stmt.id) && !executing

  const replace = (exprId: string, next: import('../program/types').Expr) =>
    onChange(replaceExpr(program, exprId, next))

  const chip = (e: import('../program/types').Expr, role: string) => (
    <ExprChip
      expr={e} role={role} availableNames={availableNames} problems={problems}
      readOnly={readOnly} onReplace={replace}
    />
  )

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (readOnly) return
    const at = locate(program, stmt.id)
    if (!at) return

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onChange(removeStmt(program, stmt.id))
      return
    }
    if (!event.altKey) return

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onChange(moveStmt(program, stmt.id, { ...at, index: Math.max(0, at.index - 1) }))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      onChange(moveStmt(program, stmt.id, { ...at, index: at.index + 1 }))
    } else if (event.key === 'ArrowLeft' && at.parentId) {
      // Out of the enclosing block, landing just after it.
      event.preventDefault()
      const outer = locate(program, at.parentId)
      if (outer) {
        onChange(moveStmt(program, stmt.id, { ...outer, index: outer.index + 1 }))
      }
    } else if (event.key === 'ArrowRight') {
      // Into the block immediately above, if there is one.
      event.preventDefault()
      const siblings = at.parentId
        ? childrenOf(findStmt(program, at.parentId)!, at.slot)
        : program.body
      const above = siblings[at.index - 1]
      if (above && (above.kind === 'for' || above.kind === 'if')) {
        onChange(moveStmt(program, stmt.id, {
          parentId: above.id,
          slot: above.kind === 'for' ? 'body' : 'then',
          index: above.kind === 'for' ? above.body.length : above.then.length,
        }))
      }
    }
  }

  return (
    <div
      className={[
        'card', `card--${stmt.kind}`,
        executing ? 'card--executing' : '',
        visited ? 'card--visited' : '',
        problem?.severity === 'error' ? 'card--error' : '',
        problem?.severity === 'draft' ? 'card--draft' : '',
      ].filter(Boolean).join(' ')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      // A labelled group, so a screen reader announces what the card does
      // rather than reading a bare row of controls.
      role="group"
      aria-current={executing ? 'step' : undefined}
      aria-label={cardLabel(stmt)}
      data-card-id={stmt.id}
    >
      <div className="card__row">
        {/* The execution marker is a distinct treatment from reference arrows:
            a solid bar plus a text label, never just a colour. */}
        <span className="card__marker" aria-hidden="true">{executing ? '▶' : ''}</span>

        <div className="card__body">{renderCardBody(stmt, chip, props)}</div>

        {!readOnly && (
          <div className="card__tools">
            <button type="button" title="Move up"
              onClick={() => {
                const at = locate(program, stmt.id)
                if (at) onChange(moveStmt(program, stmt.id, { ...at, index: Math.max(0, at.index - 1) }))
              }}>
              <span aria-hidden="true">↑</span>
              <span className="visually-hidden">Move up</span>
            </button>
            <button type="button" title="Move down"
              onClick={() => {
                const at = locate(program, stmt.id)
                if (at) onChange(moveStmt(program, stmt.id, { ...at, index: at.index + 1 }))
              }}>
              <span aria-hidden="true">↓</span>
              <span className="visually-hidden">Move down</span>
            </button>
            <button type="button" title="Remove"
              onClick={() => onChange(removeStmt(program, stmt.id))}>
              <span aria-hidden="true">×</span>
              <span className="visually-hidden">Remove this instruction</span>
            </button>
          </div>
        )}
      </div>

      {problem && (
        <p className={`card__problem card__problem--${problem.severity}`}>{problem.message}</p>
      )}

      {stmt.kind === 'for' && (
        <div className="card__block">
          <StatementList {...props} body={stmt.body} parentId={stmt.id} slot="body"
            depth={props.depth + 1} />
        </div>
      )}
      {stmt.kind === 'if' && (
        <>
          <div className="card__block">
            <StatementList {...props} body={stmt.then} parentId={stmt.id} slot="then"
              depth={props.depth + 1} />
          </div>
          {(stmt.otherwise.length > 0 || !readOnly) && (
            <>
              <p className="card__else">otherwise</p>
              <div className="card__block">
                <StatementList {...props} body={stmt.otherwise} parentId={stmt.id}
                  slot="otherwise" depth={props.depth + 1} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function childrenOf(parent: Stmt, slot: StmtSlot['slot']): Stmt[] {
  if (parent.kind === 'for') return parent.body
  if (parent.kind === 'if') return slot === 'otherwise' ? parent.otherwise : parent.then
  return []
}

function renderCardBody(
  stmt: Stmt,
  chip: (e: import('../program/types').Expr, role: string) => React.ReactNode,
  props: MethodEditorProps,
) {
  const { program, onChange, readOnly } = props
  const nameInput = (value: string, onSet: (v: string) => void, label: string) => (
    <input
      className="card__name"
      value={value}
      placeholder="name…"
      aria-label={label}
      disabled={readOnly}
      size={Math.max(4, value.length + 1)}
      onChange={(e) => onSet(e.target.value)}
    />
  )

  switch (stmt.kind) {
    case 'bind':
      return (
        <>
          {nameInput(stmt.name, (v) => onChange(updateStmt(program, stmt.id, { name: v })),
            'The name to point')}
          <span className="card__word">points at</span>
          {chip(stmt.value, 'a value')}
        </>
      )
    case 'append':
      return (
        <>
          <span className="card__word">add</span>
          {chip(stmt.value, 'what to add')}
          <span className="card__word">to the end of</span>
          {chip(stmt.target, 'the list')}
        </>
      )
    case 'slotWrite':
      return (
        <>
          <span className="card__word">in</span>
          {chip(stmt.target, 'the list')}
          <span className="card__word">, put</span>
          {chip(stmt.value, 'the new thing')}
          <span className="card__word">in slot</span>
          {chip(stmt.index, 'which slot')}
        </>
      )
    case 'print':
      return (
        <>
          <span className="card__word">say</span>
          {chip(stmt.value, 'what to say')}
        </>
      )
    case 'if':
      return (
        <>
          <span className="card__word">only if</span>
          {chip(stmt.condition, 'a comparison')}
        </>
      )
    case 'for':
      return (
        <>
          <span className="card__word">for each item in</span>
          {chip(stmt.iterable, 'a list')}
          <span className="card__word">, call it</span>
          {nameInput(stmt.loopName, (v) => onChange(updateStmt(program, stmt.id, { loopName: v })),
            'The name for each item')}
        </>
      )
    case 'break':
      return <span className="card__word">stop the loop</span>
    case 'continue':
      return <span className="card__word">skip to the next turn</span>
  }
}

function cardLabel(stmt: Stmt): string {
  switch (stmt.kind) {
    case 'bind': return `Point ${stmt.name || 'a name'} at something`
    case 'append': return 'Add to the end of a list'
    case 'slotWrite': return 'Replace one slot of a list'
    case 'print': return 'Say something out loud'
    case 'if': return 'Only if'
    case 'for': return `For each item, called ${stmt.loopName || 'something'}`
    case 'break': return 'Stop the loop'
    case 'continue': return 'Skip to the next turn'
  }
}
