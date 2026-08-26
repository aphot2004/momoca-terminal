import type { WebContents } from 'electron'
import type { TransferKind, TransferProgress } from '@shared/types'

/** Don't flood the renderer; ~12 updates/sec is smooth and cheap. */
const EMIT_INTERVAL_MS = 80

/** Speed is averaged over this window so it doesn't jitter per chunk. */
const SPEED_WINDOW_MS = 3000

interface Sample {
  at: number
  bytes: number
}

/**
 * Throttled progress reporter for a single SFTP operation.
 *
 * Speed comes from a sliding window rather than total/elapsed, so pausing on a
 * large file doesn't leave a stale average, and finishing many small files
 * doesn't spike it.
 */
export class TransferReporter {
  private samples: Sample[] = []
  private lastEmit = 0
  private done = 0
  private bytes = 0
  private current = ''

  constructor(
    private readonly sender: WebContents,
    private readonly tabId: string,
    private readonly kind: TransferKind,
    private total = 0,
    private totalBytes = 0
  ) {}

  /** Called once the pre-walk knows the size of the job. */
  setTotals(total: number, totalBytes: number): void {
    this.total = total
    this.totalBytes = totalBytes
    this.emit(true)
  }

  setCurrent(name: string): void {
    this.current = name
  }

  /** Absolute byte count for the whole operation so far. */
  setBytes(bytes: number): void {
    this.bytes = bytes
    this.emit()
  }

  itemDone(bytes?: number): void {
    this.done++
    if (typeof bytes === 'number') this.bytes = bytes
    this.emit(true)
  }

  private speed(): number {
    const now = Date.now()
    this.samples.push({ at: now, bytes: this.bytes })
    while (this.samples.length > 2 && now - this.samples[0].at > SPEED_WINDOW_MS) {
      this.samples.shift()
    }
    const oldest = this.samples[0]
    const seconds = (now - oldest.at) / 1000
    if (seconds <= 0) return 0
    return Math.max(0, (this.bytes - oldest.bytes) / seconds)
  }

  private emit(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < EMIT_INTERVAL_MS) return
    this.lastEmit = now
    this.send({
      done: this.done,
      total: this.total,
      current: this.current,
      bytes: this.bytes,
      totalBytes: this.totalBytes,
      bytesPerSecond: this.speed()
    })
  }

  finish(summary: string): void {
    this.send({
      done: this.done,
      total: this.total,
      current: '',
      bytes: this.bytes,
      totalBytes: this.totalBytes,
      bytesPerSecond: 0,
      finished: true,
      summary
    })
  }

  fail(error: string): void {
    this.send({
      done: this.done,
      total: this.total,
      current: '',
      bytes: this.bytes,
      totalBytes: this.totalBytes,
      bytesPerSecond: 0,
      finished: true,
      error
    })
  }

  private send(partial: Omit<TransferProgress, 'tabId' | 'kind'>): void {
    if (this.sender.isDestroyed()) return
    this.sender.send('sftp:progress', {
      tabId: this.tabId,
      kind: this.kind,
      ...partial
    } satisfies TransferProgress)
  }
}
