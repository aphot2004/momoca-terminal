import type { SavedSession, Tunnel, TunnelType } from '@shared/types'

interface Props {
  draft: Tunnel | Omit<Tunnel, 'id'>
  session?: SavedSession
}

/**
 * Says in plain words which end is which.
 *
 * "Listen host" and "Destination host" are accurate and completely unhelpful:
 * they never say which machine you connect to, or which one runs the service.
 * This spells out both, draws the hop, and shows the equivalent `ssh` command
 * so the mapping is checkable against something familiar.
 */
export function TunnelExplainer({ draft, session }: Props) {
  const server = session ? `${session.username ?? ''}@${session.host ?? 'server'}`.replace(/^@/, '') : 'the server'
  const serverName = session?.host ?? 'server'
  const listen = `${draft.listenHost || '127.0.0.1'}:${draft.listenPort || '?'}`
  const dest = `${draft.destHost || '?'}:${draft.destPort || '?'}`
  const port = draft.listenPort || '?'

  const sshCommand =
    draft.type === 'local'
      ? `ssh -L ${draft.listenPort}:${draft.destHost}:${draft.destPort} ${server}`
      : draft.type === 'remote'
        ? `ssh -R ${draft.listenPort}:${draft.destHost}:${draft.destPort} ${server}`
        : `ssh -D ${draft.listenPort} ${server}`

  const flow: Record<TunnelType, { from: string; via: string; to: string }> = {
    local: {
      from: `This Mac\n${listen}`,
      via: serverName,
      to: `Service\n${dest}`
    },
    remote: {
      from: `${serverName}\n${listen}`,
      via: 'This Mac',
      to: `Service\n${dest}`
    },
    dynamic: {
      from: `This Mac\nSOCKS ${port}`,
      via: serverName,
      to: 'Anywhere\nthe server can reach'
    }
  }

  const f = flow[draft.type]

  return (
    <div className="tunnel-explain">
      <div className="tunnel-flow">
        <span className="flow-node">{f.from}</span>
        <span className="flow-arrow">→</span>
        <span className="flow-node via">{f.via}</span>
        <span className="flow-arrow">→</span>
        <span className="flow-node">{f.to}</span>
      </div>

      <p className="tunnel-summary">
        {draft.type === 'local' && (
          <>
            Point your app at <code>{listen}</code> <strong>on this Mac</strong>. Traffic goes
            through {serverName}, which then connects to <code>{dest}</code> — an address that only
            has to make sense <strong>from the server</strong>. Use{' '}
            <code>localhost</code> as the destination if the service runs on the server itself.
          </>
        )}
        {draft.type === 'remote' && (
          <>
            Anyone on {serverName} connects to <code>{listen}</code> <strong>there</strong>. Traffic
            comes back down the SSH connection and this Mac forwards it to <code>{dest}</code> — an
            address that only has to make sense <strong>from here</strong>. Use{' '}
            <code>localhost</code> to expose something running on this Mac.
          </>
        )}
        {draft.type === 'dynamic' && (
          <>
            Set your browser or app&rsquo;s SOCKS5 proxy to <code>{listen}</code>{' '}
            <strong>on this Mac</strong>. Every request it makes is then resolved and connected{' '}
            <strong>from {serverName}</strong>, so you reach whatever that machine can reach.
          </>
        )}
      </p>

      <div className="cmd-row">
        <code>{sshCommand}</code>
        <button
          type="button"
          className="btn ghost"
          onClick={() => void navigator.clipboard.writeText(sshCommand)}
          title="The plain ssh command this is equivalent to"
        >
          Copy
        </button>
      </div>
    </div>
  )
}
