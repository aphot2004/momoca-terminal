import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { Macro } from '@shared/types'
import { JsonFile } from './json-file'

interface MacroFile {
  version: 1
  macros: Macro[]
}

const file = new JsonFile<MacroFile>(join(app.getPath('userData'), 'macros.json'), () => ({
  version: 1,
  macros: []
}))

export function listMacros(): Macro[] {
  return file.read().macros
}

export function saveMacro(input: Macro | Omit<Macro, 'id'>): Macro {
  const id = 'id' in input && input.id ? input.id : randomUUID()
  const macro: Macro = { ...input, id }
  file.update((current) => ({
    ...current,
    macros: [...current.macros.filter((m) => m.id !== id), macro].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }))
  return macro
}

export function deleteMacro(id: string): void {
  file.update((current) => ({ ...current, macros: current.macros.filter((m) => m.id !== id) }))
}
