import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { SavedSession } from '@shared/types'
import { JsonFile } from './json-file'

interface SessionFile {
  version: 1
  sessions: SavedSession[]
}

const file = new JsonFile<SessionFile>(join(app.getPath('userData'), 'sessions.json'), () => ({
  version: 1,
  sessions: []
}))

export function listSessions(): SavedSession[] {
  return file.read().sessions
}

export function getSession(id: string): SavedSession | undefined {
  return file.read().sessions.find((s) => s.id === id)
}

export function saveSession(input: SavedSession | Omit<SavedSession, 'id'>): SavedSession {
  const id = 'id' in input && input.id ? input.id : randomUUID()
  const session: SavedSession = { ...input, id }
  file.update((current) => {
    const sessions = current.sessions.filter((s) => s.id !== id)
    sessions.push(session)
    sessions.sort((a, b) => (a.folder + a.name).localeCompare(b.folder + b.name))
    return { ...current, sessions }
  })
  return session
}

export function deleteSession(id: string): void {
  file.update((current) => ({
    ...current,
    sessions: current.sessions.filter((s) => s.id !== id)
  }))
}
