/**
 * Local persistence: saved methods and mission progress.
 *
 * IndexedDB in a namespaced database, with no account and no backend. Browser
 * storage can be cleared, blocked, or unavailable in a private window, so every
 * call degrades to an in-memory store and reports that it did, rather than
 * throwing away the student's work silently. Export is the real backup, which
 * is why it is offered rather than buried.
 */
import { z } from 'zod'
import { ProgramSchema, type Program } from '../program/types'

export const DB_NAME = 'robot-brain-lab'
export const DB_VERSION = 1
export const EXPORT_FORMAT = 'robot-brain-lab/export'
export const EXPORT_FORMAT_VERSION = 1

/** Refuses an import larger than this; a saved method is a few KB. */
export const MAX_IMPORT_BYTES = 2_000_000

const STORE_METHODS = 'methods'
const STORE_PROGRESS = 'progress'

export const SavedMethodSchema = z.object({
  missionId: z.string(),
  program: ProgramSchema,
  updatedAt: z.string(),
})
export type SavedMethod = z.infer<typeof SavedMethodSchema>

export const MissionProgressSchema = z.object({
  missionId: z.string(),
  status: z.enum(['not-started', 'in-progress', 'complete']),
  /** Highest hint level revealed, so the ladder does not reset on reload. */
  hintLevel: z.number().int().min(0).max(5).default(0),
  /** Manual-mission command log; replaying it reconstructs the exact state. */
  commands: z.array(z.unknown()).default([]),
  /** Prediction answers, kept so a committed prediction is not re-asked. */
  predictions: z.record(z.string(), z.string()).default({}),
  updatedAt: z.string(),
})
export type MissionProgress = z.infer<typeof MissionProgressSchema>

export const ExportBundleSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.number().int(),
  exportedAt: z.string(),
  app: z.object({ commit: z.string() }).partial().optional(),
  methods: z.array(SavedMethodSchema).default([]),
  progress: z.array(MissionProgressSchema).default([]),
})
export type ExportBundle = z.infer<typeof ExportBundleSchema>

export class ImportError extends Error {
  readonly detail: string
  constructor(message: string, detail = '') {
    super(message)
    this.detail = detail
  }
}

/* ------------------------------------------------------------------ */

export interface StorageState {
  /** False when IndexedDB is unavailable and work is only in memory. */
  durable: boolean
  message: string | null
}

interface Backend {
  get<T>(store: string, key: string): Promise<T | null>
  put(store: string, value: unknown): Promise<void>
  all<T>(store: string): Promise<T[]>
  remove(store: string, key: string): Promise<void>
  clear(): Promise<void>
}

/** Used when IndexedDB cannot be opened. Work survives the session, not a reload. */
class MemoryBackend implements Backend {
  private data = new Map<string, Map<string, unknown>>()
  private bucket(store: string) {
    if (!this.data.has(store)) this.data.set(store, new Map())
    return this.data.get(store)!
  }
  async get<T>(store: string, key: string) {
    return (this.bucket(store).get(key) as T) ?? null
  }
  async put(store: string, value: unknown) {
    this.bucket(store).set((value as { missionId: string }).missionId, value)
  }
  async all<T>(store: string) {
    return [...this.bucket(store).values()] as T[]
  }
  async remove(store: string, key: string) {
    this.bucket(store).delete(key)
  }
  async clear() {
    this.data.clear()
  }
}

class IndexedDbBackend implements Backend {
  private db: IDBDatabase
  constructor(db: IDBDatabase) {
    this.db = db
  }

  private run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode)
      const req = fn(tx.objectStore(store))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error ?? new Error('Storage request failed.'))
    })
  }

  get<T>(store: string, key: string) {
    return this.run<T | null>(store, 'readonly', (s) => s.get(key)).then((v) => v ?? null)
  }
  put(store: string, value: unknown) {
    return this.run<void>(store, 'readwrite', (s) => s.put(value))
  }
  all<T>(store: string) {
    return this.run<T[]>(store, 'readonly', (s) => s.getAll())
  }
  remove(store: string, key: string) {
    return this.run<void>(store, 'readwrite', (s) => s.delete(key))
  }
  async clear() {
    await this.run<void>(STORE_METHODS, 'readwrite', (s) => s.clear())
    await this.run<void>(STORE_PROGRESS, 'readwrite', (s) => s.clear())
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no local storage available.'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      // Migrations are additive and keyed by version; old exports stay readable
      // because the export schema is validated separately from the DB shape.
      if (!db.objectStoreNames.contains(STORE_METHODS)) {
        db.createObjectStore(STORE_METHODS, { keyPath: 'missionId' })
      }
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        db.createObjectStore(STORE_PROGRESS, { keyPath: 'missionId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Local storage could not be opened.'))
  })
}

export class Store {
  private backend: Backend | null = null
  private opening: Promise<Backend> | null = null
  private state: StorageState = { durable: true, message: null }

  get storageState(): StorageState {
    return this.state
  }

  private async backendOf(): Promise<Backend> {
    if (this.backend) return this.backend
    if (!this.opening) {
      this.opening = openDatabase()
        .then((db) => {
          this.backend = new IndexedDbBackend(db)
          this.state = { durable: true, message: null }
          return this.backend
        })
        .catch(() => {
          this.backend = new MemoryBackend()
          this.state = {
            durable: false,
            message:
              'This browser is not letting the lab save work. Everything still ' +
              'works, but it will be gone when you close the tab — use Export to keep it.',
          }
          return this.backend
        })
    }
    return this.opening
  }

  async saveMethod(missionId: string, program: Program): Promise<void> {
    const backend = await this.backendOf()
    const record: SavedMethod = {
      missionId,
      program,
      updatedAt: new Date().toISOString(),
    }
    await backend.put(STORE_METHODS, record)
  }

  async loadMethod(missionId: string): Promise<Program | null> {
    const backend = await this.backendOf()
    const raw = await backend.get<unknown>(STORE_METHODS, missionId)
    if (!raw) return null
    const parsed = SavedMethodSchema.safeParse(raw)
    // A record written by an incompatible version is ignored rather than
    // crashing the lesson; the student still has their export.
    return parsed.success ? parsed.data.program : null
  }

  async saveProgress(progress: Omit<MissionProgress, 'updatedAt'>): Promise<void> {
    const backend = await this.backendOf()
    await backend.put(STORE_PROGRESS, { ...progress, updatedAt: new Date().toISOString() })
  }

  async loadProgress(missionId: string): Promise<MissionProgress | null> {
    const backend = await this.backendOf()
    const raw = await backend.get<unknown>(STORE_PROGRESS, missionId)
    if (!raw) return null
    const parsed = MissionProgressSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }

  async allProgress(): Promise<MissionProgress[]> {
    const backend = await this.backendOf()
    const raw = await backend.all<unknown>(STORE_PROGRESS)
    return raw
      .map((r) => MissionProgressSchema.safeParse(r))
      .filter((r) => r.success)
      .map((r) => r.data)
  }

  async exportBundle(commit: string): Promise<ExportBundle> {
    const backend = await this.backendOf()
    const methods = (await backend.all<unknown>(STORE_METHODS))
      .map((r) => SavedMethodSchema.safeParse(r))
      .filter((r) => r.success)
      .map((r) => r.data)
    return {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      app: { commit },
      methods,
      progress: await this.allProgress(),
    }
  }

  /**
   * Validates and applies an exported bundle.
   *
   * The text is parsed as data. Nothing in it is executed, and a program only
   * enters the store after passing the same schema the editor produces.
   */
  async importBundle(text: string): Promise<{ methods: number; progress: number }> {
    if (text.length > MAX_IMPORT_BYTES) {
      throw new ImportError(
        'That file is too big to be a Robot Brain Lab save file.',
        `${Math.round(text.length / 1024)} KB, limit ${Math.round(MAX_IMPORT_BYTES / 1024)} KB.`,
      )
    }

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new ImportError('That file is not a save file the lab can read.')
    }

    const asRecord = raw as { format?: unknown; formatVersion?: unknown }
    if (asRecord?.format !== EXPORT_FORMAT) {
      throw new ImportError(
        'That file was not made by Robot Brain Lab.',
        `Expected "${EXPORT_FORMAT}".`,
      )
    }
    if (typeof asRecord.formatVersion === 'number' && asRecord.formatVersion > EXPORT_FORMAT_VERSION) {
      throw new ImportError(
        'That save file came from a newer version of the lab.',
        `File version ${asRecord.formatVersion}, this lab reads up to ${EXPORT_FORMAT_VERSION}.`,
      )
    }

    const parsed = ExportBundleSchema.safeParse(raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      throw new ImportError(
        'That save file is damaged, so nothing was changed.',
        first ? `${first.path.join('.')}: ${first.message}` : '',
      )
    }

    const backend = await this.backendOf()
    for (const method of parsed.data.methods) await backend.put(STORE_METHODS, method)
    for (const progress of parsed.data.progress) await backend.put(STORE_PROGRESS, progress)
    return { methods: parsed.data.methods.length, progress: parsed.data.progress.length }
  }

  async clearAll(): Promise<void> {
    const backend = await this.backendOf()
    await backend.clear()
  }
}

let singleton: Store | null = null
export function getStore(): Store {
  if (!singleton) singleton = new Store()
  return singleton
}
