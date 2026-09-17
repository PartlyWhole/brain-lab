/**
 * The application shell.
 *
 * The shell and the lesson text render before Python is ready, but anything
 * that actually executes shows its real readiness rather than pretending to be
 * available. Text size is adjustable here because the reading level of the
 * intended learner is still an open question.
 */
import { useEffect, useState } from 'react'
import { useRoute, hrefFor, navigate } from './router'
import { missions } from '../../content/lessons'
import { MissionMap } from '../lessons/MissionMap'
import { MissionPlayer } from '../lessons/MissionPlayer'
import { Diagnostics } from './Diagnostics'
import { SaveMenu } from './SaveMenu'
import './shell.css'

export function App() {
  const route = useRoute()
  const [scale, setScale] = useState(() => {
    const saved = Number(localStorage.getItem('rbl:text-scale'))
    return Number.isFinite(saved) && saved >= 1 ? saved : 1
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(scale))
    localStorage.setItem('rbl:text-scale', String(scale))
  }, [scale])

  const mission = route.name === 'mission'
    ? missions.find((m) => m.id === route.missionId)
    : undefined

  return (
    <>
      <a className="skip" href="#main">Skip to the lab</a>

      <header className="shell__bar">
        <a className="shell__home" href={hrefFor({ name: 'map' })}>
          <span className="shell__logo" aria-hidden="true">◍</span>
          Robot Brain Lab
        </a>

        {mission && <span className="shell__where">{mission.title}</span>}

        <div className="shell__tools">
          <div className="shell__scale" role="group" aria-label="Text size">
            <button type="button" onClick={() => setScale((s) => Math.max(1, +(s - 0.1).toFixed(2)))}
              disabled={scale <= 1} title="Smaller text">A−</button>
            <button type="button" onClick={() => setScale((s) => Math.min(1.6, +(s + 0.1).toFixed(2)))}
              disabled={scale >= 1.6} title="Bigger text">A+</button>
          </div>
          <SaveMenu />
          <a className="shell__link" href={hrefFor({ name: 'diagnostics' })}>Runtime</a>
        </div>
      </header>

      <main id="main">
        {route.name === 'map' && <MissionMap missions={missions} />}
        {route.name === 'diagnostics' && <Diagnostics />}
        {route.name === 'mission' && mission && <MissionPlayer mission={mission} />}
        {route.name === 'mission' && !mission && (
          <NotFound
            title="Pip does not know that mission."
            detail={`Nothing here is called “${route.missionId}”.`}
          />
        )}
        {route.name === 'notFound' && (
          <NotFound title="There is nothing at this address." detail={route.path} />
        )}
      </main>
    </>
  )
}

function NotFound({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="notfound">
      <h1>{title}</h1>
      <p>{detail}</p>
      <button type="button" className="button button--primary"
        onClick={() => navigate({ name: 'map' })}>
        Back to the missions
      </button>
    </div>
  )
}
