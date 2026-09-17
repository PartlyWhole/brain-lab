/**
 * Persistence: round-tripping, reload, and import failures that stay readable.
 *
 * Uses a real IndexedDB implementation (fake-indexeddb) rather than a mock of
 * the Store, so "reload restores the work" is actually exercised through the
 * same code path the browser uses.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { Store, type ImportError, EXPORT_FORMAT, MAX_IMPORT_BYTES } from '../../src/persistence/store'
import type { Program } from '../../src/program/types'

const method: Program = {
  schemaVersion: 1,
  missionId: 'heavy-parcels',
  body: [
    { kind: 'bind', id: 'c1', name: 'result', value: { kind: 'list', id: 'e1', items: [] } },
    {
      kind: 'for', id: 'c2', loopName: 'weight',
      iterable: { kind: 'name', id: 'e2', name: 'weights' },
      body: [{
        kind: 'append', id: 'c3',
        target: { kind: 'name', id: 'e3', name: 'result' },
        value: { kind: 'name', id: 'e4', name: 'weight' },
      }],
    },
  ],
}

beforeEach(() => {
  // A fresh database per test: no leakage between cases.
  globalThis.indexedDB = new IDBFactory()
})

describe('saving and restoring', () => {
  it('restores a saved method through a new Store, as a reload would', async () => {
    await new Store().saveMethod('heavy-parcels', method)
    const afterReload = await new Store().loadMethod('heavy-parcels')
    expect(afterReload).toEqual(method)
  })

  it('returns null for a mission with nothing saved', async () => {
    expect(await new Store().loadMethod('nothing-here')).toBeNull()
  })

  it('keeps progress including the hint level and prediction answers', async () => {
    const store = new Store()
    await store.saveProgress({
      missionId: 'shared-list', status: 'in-progress', hintLevel: 2,
      commands: [{ op: 'makeInt', text: '3' }], predictions: { p1: 'a' },
    })
    const back = await new Store().loadProgress('shared-list')
    expect(back).toMatchObject({
      missionId: 'shared-list', status: 'in-progress', hintLevel: 2,
      predictions: { p1: 'a' },
    })
    expect(back!.commands).toEqual([{ op: 'makeInt', text: '3' }])
  })

  it('ignores a stored record that no longer matches the schema', async () => {
    const store = new Store()
    await store.saveMethod('heavy-parcels', method)
    // Simulate a record left by an incompatible version.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('robot-brain-lab', 1)
      req.onsuccess = () => {
        const tx = req.result.transaction('methods', 'readwrite')
        tx.objectStore('methods').put({ missionId: 'heavy-parcels', program: { nope: true } })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    expect(await new Store().loadMethod('heavy-parcels')).toBeNull()
  })
})

describe('export and import', () => {
  it('round-trips a method and its progress into a clean database', async () => {
    const source = new Store()
    await source.saveMethod('heavy-parcels', method)
    await source.saveProgress({
      missionId: 'heavy-parcels', status: 'complete', hintLevel: 1,
      commands: [], predictions: {},
    })
    const bundle = await source.exportBundle('abc1234')
    expect(bundle.format).toBe(EXPORT_FORMAT)
    expect(bundle.methods).toHaveLength(1)

    globalThis.indexedDB = new IDBFactory()
    const target = new Store()
    expect(await target.loadMethod('heavy-parcels')).toBeNull()

    const counts = await target.importBundle(JSON.stringify(bundle))
    expect(counts).toEqual({ methods: 1, progress: 1 })
    expect(await target.loadMethod('heavy-parcels')).toEqual(method)
    expect((await target.loadProgress('heavy-parcels'))!.status).toBe('complete')
  })

  it('rejects text that is not JSON, with a sentence a child can read', async () => {
    await expect(new Store().importBundle('not json at all'))
      .rejects.toThrowError('That file is not a save file the lab can read.')
  })

  it('rejects a JSON file from somewhere else', async () => {
    await expect(new Store().importBundle(JSON.stringify({ hello: 'world' })))
      .rejects.toThrowError('That file was not made by Robot Brain Lab.')
  })

  it('explains a newer file version instead of failing obscurely', async () => {
    const promise = new Store().importBundle(JSON.stringify({
      format: EXPORT_FORMAT, formatVersion: 99, exportedAt: 'x', methods: [], progress: [],
    }))
    await expect(promise).rejects.toThrowError('newer version of the lab')
    await promise.catch((e: ImportError) => {
      expect(e.detail).toContain('File version 99')
    })
  })

  it('rejects a damaged bundle and changes nothing', async () => {
    const store = new Store()
    await store.saveMethod('heavy-parcels', method)
    const damaged = JSON.stringify({
      format: EXPORT_FORMAT, formatVersion: 1, exportedAt: 'x',
      methods: [{ missionId: 'heavy-parcels', program: { schemaVersion: 1 } }],
      progress: [],
    })
    await expect(store.importBundle(damaged)).rejects.toThrowError('damaged')
    // The previously saved method is untouched.
    expect(await store.loadMethod('heavy-parcels')).toEqual(method)
  })

  it('refuses an oversized file before parsing it', async () => {
    const huge = 'x'.repeat(MAX_IMPORT_BYTES + 1)
    await expect(new Store().importBundle(huge)).rejects.toThrowError('too big')
  })

  it('treats imported content as data, never as code', async () => {
    const hostile = JSON.stringify({
      format: EXPORT_FORMAT, formatVersion: 1, exportedAt: 'x', progress: [],
      methods: [{
        missionId: 'x', updatedAt: 'x',
        program: {
          schemaVersion: 1, missionId: 'x',
          body: [{
            kind: 'bind', id: 'c',
            name: 'x); import os; os.system("boom"); (',
            value: { kind: 'int', id: 'e', text: '1' },
          }],
        },
      }],
    })
    // The bundle parses (the schema does not validate identifiers), but the
    // emitter refuses it, so nothing reaches Python.
    await new Store().importBundle(hostile)
    const loaded = await new Store().loadMethod('x')
    const { emitProgram } = await import('../../src/program/emit')
    expect(() => emitProgram(loaded!)).toThrowError(/is not a usable name/)
  })
})

describe('storage that is not available', () => {
  it('falls back to memory and says so instead of losing work', async () => {
    // @ts-expect-error deliberately removing the API the browser may withhold
    delete globalThis.indexedDB
    const store = new Store()
    await store.saveMethod('heavy-parcels', method)
    expect(await store.loadMethod('heavy-parcels')).toEqual(method)
    expect(store.storageState.durable).toBe(false)
    expect(store.storageState.message).toContain('Export')
  })
})
