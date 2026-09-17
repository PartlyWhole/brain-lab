/**
 * Hash routing.
 *
 * GitHub Pages serves static files with no rewrite rules, so a path route like
 * /lesson/heavy-parcels would 404 on refresh. A hash route always requests the
 * existing index.html, which is why deep links and reloads work on Pages
 * without any server configuration.
 */
import { useEffect, useState } from 'react'

export type Route =
  | { name: 'map' }
  | { name: 'mission'; missionId: string }
  | { name: 'diagnostics' }
  | { name: 'notFound'; path: string }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'map' }
  if (parts[0] === 'diagnostics') return { name: 'diagnostics' }
  if (parts[0] === 'mission' && parts[1]) {
    return { name: 'mission', missionId: decodeURIComponent(parts[1]) }
  }
  return { name: 'notFound', path }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'map': return '#/'
    case 'mission': return `#/mission/${encodeURIComponent(route.missionId)}`
    case 'diagnostics': return '#/diagnostics'
    case 'notFound': return '#/'
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route).slice(1)
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
