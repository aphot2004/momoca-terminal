import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BrewPackage } from '@shared/types'

interface Props {
  onRunLocal: (command: string, title: string) => void
}

/**
 * Stands in for MobApt. Upgrades are not run in-process: brew wants a real
 * terminal for its output and any prompts, so this hands the command over.
 */
export function BrewPackages({ onRunLocal }: Props) {
  const [packages, setPackages] = useState<BrewPackage[]>([])
  const [available, setAvailable] = useState(true)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    const result = await window.api.toolbox.brew()
    setAvailable(result.available)
    setPackages(result.packages)
    setBusy(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const outdated = packages.filter((p) => p.outdated)

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? packages.filter((p) => p.name.toLowerCase().includes(needle)) : packages
  }, [packages, filter])

  if (!available && !busy) {
    return (
      <>
        <p className="hint">
          Homebrew was not found. Install it from{' '}
          <a href="https://brew.sh" target="_blank" rel="noreferrer">
            brew.sh
          </a>
          , then re-check.
        </p>
        <button className="btn" onClick={() => void refresh()}>
          Re-check
        </button>
      </>
    )
  }

  return (
    <>
      {outdated.length > 0 && (
        <div className="inset">
          <div className="cmd-row">
            <code>brew upgrade</code>
            <button className="btn" onClick={() => onRunLocal('brew upgrade', 'brew upgrade')}>
              Run
            </button>
          </div>
          <p className="hint" style={{ margin: '6px 0 0' }}>
            {outdated.length} package{outdated.length === 1 ? '' : 's'} outdated:{' '}
            {outdated.slice(0, 8).map((p) => p.name).join(', ')}
            {outdated.length > 8 ? '…' : ''}
          </p>
        </div>
      )}

      <div className="field-row">
        <div className="field" style={{ flex: 1 }}>
          <label>Filter</label>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
        </div>
        <div className="field" style={{ alignSelf: 'end' }}>
          <button className="btn" onClick={() => void refresh()}>
            {busy ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="tool-table">
        <div className="tool-thead brew-grid">
          <span>Package</span>
          <span>Version</span>
          <span />
        </div>
        <div className="tool-tbody">
          {shown.map((pkg) => (
            <div key={pkg.name} className="tool-trow brew-grid">
              <span className="ellipsis">
                {pkg.name}
                {pkg.outdated && <span className="key-badge" style={{ marginLeft: 6 }}>outdated</span>}
              </span>
              <span className="mono dim ellipsis">{pkg.version}</span>
              <button
                className="btn ghost"
                onClick={() => onRunLocal(`brew info ${pkg.name}`, `brew info`)}
              >
                Info
              </button>
            </div>
          ))}
          {!shown.length && !busy && <div className="muted-row">Nothing installed matches.</div>}
        </div>
      </div>
    </>
  )
}
