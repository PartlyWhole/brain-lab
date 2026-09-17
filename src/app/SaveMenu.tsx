/**
 * Export and import.
 *
 * Browser storage can be cleared without warning, so export is offered plainly
 * rather than hidden in a settings screen. Import validates before it writes
 * anything, and says what is wrong in a sentence rather than a stack trace.
 */
import { useEffect, useRef, useState } from 'react'
import { getStore, ImportError } from '../persistence/store'

export function SaveMenu() {
  const store = getStore()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string; detail?: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [durable, setDurable] = useState(true)

  useEffect(() => {
    // Touch the store so its availability is known before the student relies on it.
    void store.allProgress().then(() => setDurable(store.storageState.durable))
  }, [store])

  const doExport = async () => {
    const bundle = await store.exportBundle(__APP_BUILD__.commit)
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `robot-brain-lab-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage({ tone: 'good', text: 'Saved a copy to your downloads.' })
  }

  const doImport = async (file: File) => {
    try {
      const counts = await store.importBundle(await file.text())
      setMessage({
        tone: 'good',
        text: `Brought back ${counts.methods} method${counts.methods === 1 ? '' : 's'}.`,
        detail: 'Reload the page to see them.',
      })
    } catch (err) {
      setMessage({
        tone: 'bad',
        text: (err as Error).message,
        detail: err instanceof ImportError ? err.detail : undefined,
      })
    }
  }

  return (
    <div className="savemenu">
      <button type="button" className="shell__link" onClick={() => setOpen((v) => !v)}
        aria-expanded={open}>
        Save file
      </button>

      {open && (
        <div className="savemenu__panel">
          {!durable && (
            <p className="savemenu__warn">{store.storageState.message}</p>
          )}
          <button type="button" onClick={doExport}>Export my work</button>
          <button type="button" onClick={() => fileRef.current?.click()}>Bring work back</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void doImport(file)
              e.target.value = ''
            }}
          />
          {message && (
            <p className={`savemenu__msg savemenu__msg--${message.tone}`}>
              {message.text}
              {message.detail && <span className="savemenu__detail">{message.detail}</span>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
