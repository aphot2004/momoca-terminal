import { useEffect, useState } from 'react'

export function WakeOnLanTool() {
  const [mac, setMac] = useState('')
  const [broadcast, setBroadcast] = useState('255.255.255.255')
  const [port, setPort] = useState(9)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Offer the current subnet's broadcast address, which routers forward more
  // reliably than the global 255.255.255.255.
  useEffect(() => {
    void window.api.net.localNetworks().then((nets) => {
      const first = nets.find((n) => n.cidr.endsWith('/24'))
      if (first) setBroadcast(first.cidr.replace(/\.0\/24$/, '.255'))
    })
  }, [])

  const send = async () => {
    setError(null)
    setStatus(null)
    try {
      await window.api.toolbox.wol(mac, broadcast, port)
      setStatus(`Magic packet sent to ${mac} via ${broadcast}:${port}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {error && <div className="warning">{error}</div>}
      {status && <div className="notice">{status}</div>}

      <p className="hint">
        Wake-on-LAN is fire-and-forget: nothing replies, so a successful send does not prove the
        machine woke. The target needs WoL enabled in its firmware and must be on this subnet
        unless your router forwards directed broadcasts.
      </p>

      <div className="field">
        <label>MAC address</label>
        <input
          value={mac}
          onChange={(e) => setMac(e.target.value)}
          placeholder="a4:83:e7:1b:2c:3d"
          spellCheck={false}
        />
      </div>

      <div className="field-row">
        <div className="field" style={{ flex: 2 }}>
          <label>Broadcast address</label>
          <input value={broadcast} onChange={(e) => setBroadcast(e.target.value)} spellCheck={false} />
        </div>
        <div className="field" style={{ width: 96 }}>
          <label>Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value) || 9)}
          />
        </div>
      </div>

      <button className="btn primary" disabled={!mac.trim()} onClick={() => void send()}>
        Send magic packet
      </button>
    </>
  )
}
