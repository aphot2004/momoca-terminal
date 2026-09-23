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

const SCANNING_VERB: Record<TransferProgress['kind'], string> = {
  download: 'Preparing download',
  upload: 'Preparing upload',
  delete: 'Counting'
}

interface Props {
  progress: TransferProgress
  /** Stops the operation this bar is reporting. Omitted once it's finished. */
  onCancel?: () => void
}

/** Footer strip showing the file in flight, throughput and overall progress. */
export function TransferBar({ progress, onCancel }: Props) {
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
        <div className={`transfer-line ${progress.cancelled ? 'stopped' : 'done'}`} title={progress.summary}>
          {progress.summary}
        </div>
      </div>
    )
  }

  // Real round trips over the connection with nothing to show yet — a big
  // selection used to look exactly like a stuck button for however long this
  // took. A named phase and a running count says it's actually working.
  if (progress.phase === 'scanning') {
    return (
      <div className="transfer">
        <div className="transfer-line scanning">
          <span className="transfer-verb">{SCANNING_VERB[progress.kind]}</span>
          <span className="scan-dot" />
          <span className="transfer-name">{(progress.found ?? 0).toLocaleString()} found…</span>
          {onCancel && (
            <button className="btn ghost danger transfer-stop" onClick={onCancel}>
              Stop
            </button>
          )}
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
        {onCancel && (
          <button className="btn ghost danger transfer-stop" onClick={onCancel}>
            Stop
          </button>
        )}
      </div>

      <span className="meter">
        <span className="meter-fill ok smooth" style={{ transform: `scaleX(${Math.min(1, ratio)})` }} />
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

      {/*
        The bar above is the whole batch; several files move at once (see
        `mapPool`), so it alone can never show any single file's own progress
        — only the aggregate. This follows whichever file most recently sent a
        chunk. It has nothing to say for a delete, which moves no bytes.
      */}
      {movesBytes && progress.currentFile && progress.currentFileTotalBytes! > 0 && (
        <div className="transfer-sub">
          <span className="transfer-name sub" title={progress.currentFile}>
            {progress.currentFile}
          </span>
          <span className="meter sub">
            <span
              className="meter-fill ok"
              style={{
                transform: `scaleX(${Math.min(1, progress.currentFileBytes! / progress.currentFileTotalBytes!)})`
              }}
            />
          </span>
          <span className="transfer-sub-stat">
            {Math.round((progress.currentFileBytes! / progress.currentFileTotalBytes!) * 100)}%
          </span>
        </div>
      )}
    </div>
  )
}
