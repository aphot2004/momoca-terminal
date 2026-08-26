import type { MouseEvent, ReactNode } from 'react'
import { useView } from '../view-state'
import {
  IconExit,
  IconFiles,
  IconKey,
  IconLocal,
  IconSession,
  IconSessions,
  IconHelp,
  IconMacro,
  IconNetwork,
  IconUnix,
  IconToolbox,
  IconMultiExec,
  IconView,
  IconTheme,
  IconTunnel,
  IconVault
} from './Icons'

interface Props {
  onNewSession: () => void
  onLocalTerminal: () => void
  onKeys: () => void
  onVault: () => void
  onTunnels: () => void
  onNetwork: () => void
  onMacros: () => void
  onUnix: () => void
  onToolbox: () => void
  onView: (x: number, y: number) => void
  onToggleMultiExec: () => void
  multiExec: boolean
  splitActive: boolean
  onGuide: () => void
  onToggleSidebar: () => void
  onToggleFiles: () => void
  onToggleTheme: () => void
  onExit: () => void
  filesEnabled: boolean
  sidebarOpen: boolean
  filesOpen: boolean
  activeTunnels: number
  recording: boolean
}

function RibbonButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  title
}: {
  icon: ReactNode
  label: string
  onClick: (event: MouseEvent) => void
  active?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      className={`ribbon-btn${active ? ' active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
    >
      <span className="ribbon-icon">{icon}</span>
      <span className="ribbon-label">{label}</span>
    </button>
  )
}

/** MobaXterm's icon strip, trimmed to the actions this app actually implements. */
export function Ribbon(props: Props) {
  // MobaXterm's View menu offers three button sizes; the captions and the icon
  // scale are pure presentation, so CSS does the work from this one class.
  const { buttonSize } = useView()

  return (
    <div className={`ribbon size-${buttonSize}`}>
      <RibbonButton
        icon={<IconSession />}
        label="Session"
        onClick={props.onNewSession}
        title="Create a new saved session"
      />
      <RibbonButton
        icon={<IconLocal />}
        label="Local"
        onClick={props.onLocalTerminal}
        title="Start a local terminal (⌘T)"
      />
      <RibbonButton icon={<IconKey />} label="Keys" onClick={props.onKeys} title="Manage SSH keys" />
      <RibbonButton
        icon={<IconVault />}
        label="Vault"
        onClick={props.onVault}
        title="Master password for saved credentials"
      />
      <RibbonButton
        icon={
          <span className="ribbon-badge-wrap">
            <IconTunnel />
            {props.activeTunnels > 0 && <span className="ribbon-badge">{props.activeTunnels}</span>}
          </span>
        }
        label="Tunneling"
        onClick={props.onTunnels}
        title="Port forwarding and SOCKS proxies"
      />

      <RibbonButton
        icon={<IconNetwork />}
        label="Network"
        onClick={props.onNetwork}
        title="Ping, port scanner and subnet discovery"
      />
      <RibbonButton
        icon={
          <span className="ribbon-badge-wrap">
            <IconMacro />
            {props.recording && <span className="ribbon-badge rec" />}
          </span>
        }
        label="Macros"
        onClick={props.onMacros}
        title="Record and replay terminal input"
      />
      <RibbonButton
        icon={<IconToolbox />}
        label="Tools"
        onClick={props.onToolbox}
        title="Processes, hardware, keygen, ports, diff and more"
      />
      <RibbonButton
        icon={<IconUnix />}
        label="Unix"
        onClick={props.onUnix}
        title="Which Unix commands you have, and how to get the rest"
      />

      <span className="ribbon-sep" />

      <RibbonButton
        icon={
          <span className="ribbon-badge-wrap">
            <IconMultiExec />
            {props.multiExec && <span className="ribbon-badge multi">!</span>}
          </span>
        }
        label="MultiExec"
        onClick={props.onToggleMultiExec}
        active={props.multiExec}
        title="Type into every visible terminal at once"
      />
      <RibbonButton
        icon={<IconView />}
        label="View"
        onClick={(e) => props.onView(e.clientX, e.clientY)}
        active={props.splitActive}
        title="Split layout, panels, compact mode, zoom"
      />

      <span className="ribbon-sep" />

      <RibbonButton
        icon={<IconSessions />}
        label="Sessions"
        onClick={props.onToggleSidebar}
        active={props.sidebarOpen}
        title="Show or hide the sessions panel"
      />
      <RibbonButton
        icon={<IconFiles />}
        label="Files"
        onClick={props.onToggleFiles}
        active={props.filesOpen && props.filesEnabled}
        disabled={!props.filesEnabled}
        title={
          props.filesEnabled
            ? 'Show or hide the SFTP browser'
            : 'SFTP is available on SSH sessions only'
        }
      />

      <span className="ribbon-sep" />

      <RibbonButton
        icon={<IconTheme />}
        label="Theme"
        onClick={props.onToggleTheme}
        title="Switch between light and dark"
      />
      <RibbonButton
        icon={<IconHelp />}
        label="Requirements"
        onClick={props.onGuide}
        title="Which session types work, and what to install for the rest"
      />

      <span className="ribbon-spacer" />

      <RibbonButton icon={<IconExit />} label="Exit" onClick={props.onExit} title="Quit MoMoca" />
    </div>
  )
}
