/**
 * Autosave that cannot lose the last thing the student did.
 *
 * A plain debounce has a window in which a reload, a tab close or a navigation
 * throws away the most recent change. For a child who closes the tab as soon as
 * they are finished, that window is exactly when the loss happens. So:
 *
 *  * `delayMs: 0` saves immediately, which is right for infrequent, meaningful
 *    events like performing one manual operation;
 *  * a non-zero delay still coalesces keystroke-frequency edits, but the
 *    pending save is flushed when the page is hidden or unloaded.
 *
 * `pagehide` and `visibilitychange` are used rather than `beforeunload`,
 * because they are the ones that actually fire on mobile and on tab discard.
 */
import { useEffect, useRef } from 'react'

export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<void> | void,
  delayMs = 400,
  enabled = true,
): void {
  const latest = useRef(value)
  const saver = useRef(save)
  const timer = useRef<number | undefined>(undefined)
  const dirty = useRef(false)

  latest.current = value
  saver.current = save

  const flush = useRef(() => {
    if (!dirty.current) return
    dirty.current = false
    window.clearTimeout(timer.current)
    void saver.current(latest.current)
  })

  useEffect(() => {
    if (!enabled) return
    dirty.current = true

    if (delayMs <= 0) {
      flush.current()
      return
    }

    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => flush.current(), delayMs)
    return () => window.clearTimeout(timer.current)
  }, [value, delayMs, enabled])

  useEffect(() => {
    if (!enabled) return
    const onHide = () => flush.current()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush.current()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      // Leaving the mission is also a moment work must not be lost.
      flush.current()
    }
  }, [enabled])
}
