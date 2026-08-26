import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Tiny persistence helper: read-through cache over a JSON file, written
 * atomically so a crash mid-write can't truncate the user's session list.
 */
export class JsonFile<T> {
  private cache: T | null = null

  constructor(
    private readonly path: string,
    private readonly fallback: () => T
  ) {}

  read(): T {
    if (this.cache) return this.cache
    try {
      this.cache = JSON.parse(readFileSync(this.path, 'utf8')) as T
    } catch {
      this.cache = this.fallback()
    }
    return this.cache
  }

  write(value: T): void {
    this.cache = value
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = join(dirname(this.path), `.${randomBytes(6).toString('hex')}.tmp`)
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  update(fn: (current: T) => T): T {
    const next = fn(this.read())
    this.write(next)
    return next
  }
}
