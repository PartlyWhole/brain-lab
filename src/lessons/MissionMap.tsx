/**
 * The mission list.
 *
 * Progress is shown as three plain states, not a score. Nothing is locked
 * behind a gate the student cannot see: prerequisites are named so a student
 * can go back to what a mission builds on, but exploration is allowed.
 */
import { useEffect, useState } from 'react'
import type { Mission } from './schema'
import { getStore, type MissionProgress } from '../persistence/store'
import { hrefFor } from '../app/router'
import './map.css'

const STATE_LABEL: Record<MissionProgress['status'], string> = {
  'not-started': 'not started',
  'in-progress': 'started',
  complete: 'done',
}

export function MissionMap({ missions }: { missions: Mission[] }) {
  const [progress, setProgress] = useState<Record<string, MissionProgress>>({})

  useEffect(() => {
    void getStore().allProgress().then((all) => {
      setProgress(Object.fromEntries(all.map((p) => [p.missionId, p])))
    })
  }, [])

  const groups = [
    { title: 'Be Pip’s memory', missions: missions.filter((m) => m.goal.kind === 'manual') },
    { title: 'Teach Pip a method', missions: missions.filter((m) => m.goal.kind === 'invent') },
  ]

  return (
    <div className="map">
      <header className="map__header">
        <h1>Robot Brain Lab</h1>
        <p>
          Pip is a robot who cannot remember anything on its own. First you do the
          remembering. Then you teach Pip how to do it.
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.title}>
          <h2 className="map__group">{group.title}</h2>
          <ul className="map__list">
            {group.missions.map((mission) => {
              const status = progress[mission.id]?.status ?? 'not-started'
              return (
                <li key={mission.id}>
                  <a className={`map__card map__card--${status}`}
                     href={hrefFor({ name: 'mission', missionId: mission.id })}>
                    <span className="map__state" data-status={status}>
                      {STATE_LABEL[status]}
                    </span>
                    <span className="map__title">{mission.title}</span>
                    <span className="map__purpose">{mission.purpose}</span>
                    {mission.sourceIds.length > 0 && (
                      <span className="map__source">
                        from exercise{mission.sourceIds.length > 1 ? 's' : ''}{' '}
                        {mission.sourceIds.join(', ')}
                      </span>
                    )}
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
