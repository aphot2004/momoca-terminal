import type { TransferProgress } from '@shared/types'

function bytes(value: number, digits = 1): string {
  if (value < 1024) return `${Math.round(value)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let scaled = value / 1024
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit++
  }
  return `${scaled.toFixed(scaled < 10 ? digits : 0)} ${units[unit]}`
}

function eta(remaining: number, rate: number): string | null {
  if (rate <= 0 || remaining <= 0) return null
  const seconds = Math.round(remaining / rate)
  if (seconds < 60) return `${seconds}s left`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s left`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`
}

const VERB: Record<TransferProgress['kind'], string> = {
  download: 'Downloading',
  upload: 'Uploading',
  delete: 'Deleting'
}

/** Footer strip showing the file in flight, throughput and overall progress. */
export function TransferBar({ progress }: { progress: TransferProgress }) {
  if (progress.error) {
    return (
      <div className="transfer">
        <div className="transfer-line error">{progress.error}</div>
      </div>
    )
  }

  if (progress.finished) {
    return (
      <div className="transfer">
        <div className="transfer-line done" title={progress.summary}>
          {progress.summary}
        </div>
      </div>
    )
  }

  // Deletes move no bytes, so they're measured in items.
  const movesBytes = progress.kind !== 'delete'
  const ratio = movesBytes
    ? progress.totalBytes > 0
      ? progress.bytes / progress.totalBytes
      : 0
    : progress.total > 0
      ? progress.done / progress.total
      : 0

  const remaining = eta(progress.totalBytes - progress.bytes, progress.bytesPerSecond)

  return (
    <div className="transfer">
      <div className="transfer-line" title={progress.current}>
        <span className="transfer-verb">{VERB[progress.kind]}</span>
        <span className="transfer-name">{progress.current || '…'}</span>
      </div>

      <span className="meter">
        <span className="meter-fill ok" style={{ width: `${Math.min(1, ratio) * 100}%` }} />
      </span>

      <div className="transfer-stats">
        <span>
          {progress.done}/{progress.total || '?'}
        </span>
        {movesBytes && progress.totalBytes > 0 && (
          <span>
            {bytes(progress.bytes)} / {bytes(progress.totalBytes)}
          </span>
        )}
        {movesBytes && progress.bytesPerSecond > 0 && (
          <span className="transfer-rate">{bytes(progress.bytesPerSecond)}/s</span>
        )}
        {remaining && <span>{remaining}</span>}
      </div>
    </div>
  )
}
