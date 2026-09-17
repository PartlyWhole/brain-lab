/**
 * Read-only Python generated from the visual method.
 *
 * The code is emitted from the same tree the editor edits, so the two cannot
 * drift apart: there is no second description of the method to keep in sync.
 * Highlighting is bidirectional — the executing card highlights its line, and
 * hovering or focusing a line points back at its card.
 *
 * When the method is not yet complete the panel says exactly what is missing
 * rather than showing approximate or invented code.
 */
import { useMemo } from 'react'
import type { Program } from '../program/types'
import { emitProgram, EmitError } from '../program/emit'
import './codeReveal.css'

export interface CodeRevealProps {
  program: Program
  /** The card Pip is executing, or null. */
  executingCardId?: string | null
  /** Names the mission supplies, shown as a short preamble comment. */
  inputNames?: string[]
  onHoverCard?: (cardId: string | null) => void
  onSelectCard?: (cardId: string) => void
}

export function CodeReveal(props: CodeRevealProps) {
  const { program, executingCardId, inputNames = [], onHoverCard, onSelectCard } = props

  const emitted = useMemo(() => {
    try {
      return { ok: true as const, ...emitProgram(program) }
    } catch (err) {
      return {
        ok: false as const,
        message: err instanceof EmitError
          ? err.message
          : 'This method cannot be written as Python yet.',
      }
    }
  }, [program])

  if (!emitted.ok) {
    return (
      <div className="code" data-state="incomplete">
        <p className="code__notice">
          <strong>Not ready to show yet.</strong> {emitted.message}
        </p>
      </div>
    )
  }

  const lines = emitted.source.replace(/\n$/, '').split('\n')

  return (
    <div className="code">
      {inputNames.length > 0 && (
        <p className="code__preamble">
          <span aria-hidden="true"># </span>
          Pip already knows: {inputNames.join(', ')}
        </p>
      )}
      <ol
        className="code__lines"
        onMouseLeave={() => onHoverCard?.(null)}
        aria-label="The same method written in Python"
      >
        {lines.map((text, i) => {
          const lineNo = i + 1
          const cardId = emitted.lineToCard[lineNo] ?? null
          const current = cardId !== null && cardId === executingCardId
          return (
            <li
              key={lineNo}
              className={`code__line${current ? ' code__line--current' : ''}`}
              aria-current={current ? 'step' : undefined}
              onMouseEnter={() => onHoverCard?.(cardId)}
            >
              <span className="code__no" aria-hidden="true">{lineNo}</span>
              {cardId ? (
                <button
                  type="button"
                  className="code__text"
                  onFocus={() => onHoverCard?.(cardId)}
                  onClick={() => onSelectCard?.(cardId)}
                >
                  <code>{text || ' '}</code>
                </button>
              ) : (
                // Lines with no card of their own: `else:` and `pass`.
                <span className="code__text code__text--static"><code>{text}</code></span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
