import { describe, it, expect } from 'vitest'
import { parseRoute, hrefFor } from './router'

describe('hash routes', () => {
  it('reads the map at the root, with or without a hash', () => {
    expect(parseRoute('')).toEqual({ name: 'map' })
    expect(parseRoute('#')).toEqual({ name: 'map' })
    expect(parseRoute('#/')).toEqual({ name: 'map' })
  })

  it('reads a mission deep link', () => {
    expect(parseRoute('#/mission/heavy-parcels'))
      .toEqual({ name: 'mission', missionId: 'heavy-parcels' })
  })

  it('round-trips an id that needs encoding', () => {
    const route = { name: 'mission', missionId: 'a/b c' } as const
    expect(parseRoute(hrefFor(route))).toEqual(route)
  })

  it('reads the diagnostics route', () => {
    expect(parseRoute('#/diagnostics')).toEqual({ name: 'diagnostics' })
  })

  it('reports an unknown path rather than guessing', () => {
    expect(parseRoute('#/nowhere')).toEqual({ name: 'notFound', path: '/nowhere' })
    expect(parseRoute('#/mission')).toEqual({ name: 'notFound', path: '/mission' })
  })
})
