/**
 * What the program printed.
 *
 * Output is kept apart from the object graph because printing changes nothing
 * in the brain — `session.py` says so in as many words — and putting the two
 * in one box would suggest otherwise.
 */
export interface OutputPanelProps {
  text: string
  /** Playback is replaying history, so nothing new is arriving to announce. */
  live: boolean
}

export function OutputPanel({ text, live }: OutputPanelProps) {
  return (
    <section className="brain-output" aria-label="Printed output">
      <h3 className="brain-output-title">Output</h3>
      {text
        ? (
          <pre
            className="brain-output-text"
            role="log"
            aria-live={live ? 'polite' : 'off'}
          >
            {text}
          </pre>
        )
        : <p className="brain-output-empty">Nothing printed yet.</p>}
    </section>
  )
}
