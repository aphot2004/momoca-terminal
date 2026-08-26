import { useEffect, useState } from 'react'
import type { HardwareInfo } from '@shared/types'

function bytes(value: number): string {
  if (!value) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let scaled = value
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit++
  }
  return `${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)} ${units[unit]}`
}

export function HardwareTool() {
  const [info, setInfo] = useState<HardwareInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.toolbox
      .hardware()
      .then(setInfo)
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) return <div className="warning">{error}</div>
  if (!info) return <div className="muted-row">Reading hardware…</div>

  return (
    <>
      <dl className="props">
        <dt>Model</dt>
        <dd className="mono">{info.model || '—'}</dd>
        <dt>CPU</dt>
        <dd>
          {info.cpu || '—'} {info.cores ? `· ${info.cores} cores` : ''}
        </dd>
        <dt>Memory</dt>
        <dd>{bytes(info.memoryBytes)}</dd>
        <dt>macOS</dt>
        <dd>
          {info.osVersion} {info.osBuild && `(${info.osBuild})`}
        </dd>
        <dt>Graphics</dt>
        <dd>{info.gpus.length ? info.gpus.join(', ') : '—'}</dd>
      </dl>

      <div className="field" style={{ marginTop: 14 }}>
        <label>Volumes</label>
        <div className="tool-table">
          <div className="tool-thead disk-grid">
            <span>Name</span>
            <span>Format</span>
            <span>Free</span>
            <span>Size</span>
          </div>
          <div className="tool-tbody">
            {info.disks.map((disk) => (
              <div key={disk.name} className="tool-trow disk-grid">
                <span className="ellipsis">{disk.name}</span>
                <span className="dim">{disk.fs || '—'}</span>
                <span className="mono">{bytes(disk.freeBytes)}</span>
                <span className="mono">{bytes(disk.sizeBytes)}</span>
              </div>
            ))}
            {!info.disks.length && <div className="muted-row">No volumes reported.</div>}
          </div>
        </div>
      </div>
    </>
  )
}
