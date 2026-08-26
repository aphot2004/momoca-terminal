import { useMemo, useState } from 'react'

/** Control-character names for 0x00–0x1F and 0x7F. */
const CONTROL_NAMES = [
  'NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL',
  'BS', 'HT', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI',
  'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB',
  'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US'
]

interface Row {
  dec: number
  hex: string
  oct: string
  char: string
  note: string
}

export function AsciiTable() {
  const [filter, setFilter] = useState('')

  const rows = useMemo<Row[]>(
    () =>
      Array.from({ length: 128 }, (_, dec) => {
        const control = dec < 32 ? CONTROL_NAMES[dec] : dec === 127 ? 'DEL' : ''
        return {
          dec,
          hex: dec.toString(16).toUpperCase().padStart(2, '0'),
          oct: dec.toString(8).padStart(3, '0'),
          char: control ? control : dec === 32 ? 'space' : String.fromCharCode(dec),
          // Ctrl-key equivalent, which is what you actually type.
          note: dec < 32 ? `^${String.fromCharCode(dec + 64)}` : dec === 127 ? '^?' : ''
        }
      }),
    []
  )

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (r) =>
        String(r.dec) === needle ||
        r.hex.toLowerCase() === needle.replace(/^0x/, '') ||
        r.char.toLowerCase().includes(needle) ||
        r.note.toLowerCase() === needle
    )
  }, [rows, filter])

  return (
    <>
      <div className="field">
        <label>Filter by character, decimal, hex or ^key</label>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="ESC, 27, 1b, ^C…"
          spellCheck={false}
        />
      </div>

      <div className="tool-table">
        <div className="tool-thead ascii-grid">
          <span>Dec</span>
          <span>Hex</span>
          <span>Oct</span>
          <span>Char</span>
          <span>Ctrl</span>
        </div>
        <div className="tool-tbody">
          {shown.map((row) => (
            <div
              key={row.dec}
              className="tool-trow ascii-grid clickable"
              onClick={() => void navigator.clipboard.writeText(String.fromCharCode(row.dec))}
              title="Click to copy this character"
            >
              <span className="mono">{row.dec}</span>
              <span className="mono">0x{row.hex}</span>
              <span className="mono dim">{row.oct}</span>
              <span className="mono">{row.char}</span>
              <span className="mono dim">{row.note}</span>
            </div>
          ))}
          {!shown.length && <div className="muted-row">No match.</div>}
        </div>
      </div>
    </>
  )
}
