/**
 * The hint ladder.
 *
 * Hints are revealed one rung at a time and never skip ahead: a failing input
 * first, then an invitation to look, then the first incorrect event, then the
 * name of the distinction, and only last a demonstrated repair. The next rung
 * is always an explicit choice, so a student is not handed the answer for
 * pausing.
 */
import type { Hint } from './schema'

export interface HintLadderProps {
  hints: Hint[]
  /** Highest rung already revealed. 0 means none. */
  level: number
  onReveal: (level: number) => void
}

export function HintLadder({ hints, level, onReveal }: HintLadderProps) {
  if (hints.length === 0) return null
  const ordered = [...hints].sort((a, b) => a.level - b.level)
  const shown = ordered.filter((h) => h.level <= level)
  const next = ordered.find((h) => h.level > level)

  return (
    <div className="hints">
      {shown.length > 0 && (
        <ol className="hints__list">
          {shown.map((h) => (
            <li key={h.level}>{h.text}</li>
          ))}
        </ol>
      )}
      {next && (
        <button type="button" className="link" onClick={() => onReveal(next.level)}>
          {level === 0 ? 'I want a clue' : 'I need more help'}
        </button>
      )}
      {!next && shown.length > 0 && (
        <p className="hints__end">That is all the help Pip has for this one.</p>
      )}
    </div>
  )
}
