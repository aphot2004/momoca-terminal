import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type { SavedSession, ToolCheck, ToolId } from '@shared/types'

const run = promisify(execFile)

/** Resolve a binary on PATH, including the Homebrew prefixes a GUI app misses. */
async function which(binary: string): Promise<string | null> {
  const env = {
    ...process.env,
    PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:/opt/X11/bin`
  }
  try {
    const { stdout } = await run('/usr/bin/which', [binary], { env })
    const path = stdout.trim()
    return path || null
  } catch {
    return null
  }
}

function firstExistingApp(names: string[]): string | null {
  for (const name of names) {
    const path = `/Applications/${name}`
    if (existsSync(path)) return path
    const utility = `/Applications/Utilities/${name}`
    if (existsSync(utility)) return utility
  }
  return null
}

interface ToolDef {
  id: ToolId
  name: string
  purpose: string
  detect: () => Promise<{ available: boolean; detail?: string }>
  install?: ToolCheck['install']
}

const TOOLS: ToolDef[] = [
  {
    id: 'vnc',
    name: 'Screen Sharing',
    purpose: 'VNC sessions',
    detect: async () => ({ available: true, detail: 'Built into macOS' })
  },
  {
    id: 'browser',
    name: 'Default browser',
    purpose: 'Browser sessions',
    detect: async () => ({ available: true, detail: 'Your default browser' })
  },
  {
    id: 'mosh',
    name: 'Mosh',
    purpose: 'Mosh sessions',
    detect: async () => {
      const path = await which('mosh')
      return { available: Boolean(path), detail: path ?? undefined }
    },
    install: {
      summary: 'Mosh must be installed on this Mac *and* on the server.',
      steps: [
        { label: 'Install locally with Homebrew', command: 'brew install mosh' },
        { label: 'On a Debian/Ubuntu server', command: 'sudo apt install mosh' },
        { label: 'On a RHEL/Fedora server', command: 'sudo dnf install mosh' },
        { label: 'Open UDP 60000–61000 to the server in its firewall' }
      ],
      url: 'https://mosh.org/#getting'
    }
  },
  {
    id: 'freerdp',
    name: 'FreeRDP or Windows App',
    purpose: 'RDP sessions',
    detect: async () => {
      const binary = await which('xfreerdp3') ?? await which('xfreerdp')
      if (binary) return { available: true, detail: binary }
      const app = firstExistingApp(['Windows App.app', 'Microsoft Remote Desktop.app'])
      return { available: Boolean(app), detail: app ?? undefined }
    },
    install: {
      summary:
        'RDP needs an external client — there is no usable JavaScript RDP implementation to embed.',
      steps: [
        { label: 'Command-line client (opens its own window)', command: 'brew install freerdp' },
        { label: 'Or install Windows App from the Mac App Store' }
      ],
      url: 'https://apps.apple.com/app/windows-app/id1295203466'
    }
  },
  {
    id: 'xquartz',
    name: 'XQuartz',
    purpose: 'XDMCP sessions and X11 forwarding',
    detect: async () => {
      const app = firstExistingApp(['XQuartz.app'])
      const binary = existsSync('/opt/X11/bin/X') ? '/opt/X11/bin/X' : null
      return { available: Boolean(app || binary), detail: binary ?? app ?? undefined }
    },
    install: {
      summary: 'XQuartz provides the X server macOS no longer ships.',
      steps: [
        { label: 'Install with Homebrew', command: 'brew install --cask xquartz' },
        { label: 'Log out and back in so /opt/X11 is on your PATH' },
        { label: 'It also enables SSH X11 forwarding (ssh -X)' }
      ],
      url: 'https://www.xquartz.org'
    }
  },
  {
    id: 'ftp',
    name: 'ftp client',
    purpose: 'FTP sessions',
    detect: async () => {
      const path = await which('ftp')
      return { available: Boolean(path), detail: path ?? undefined }
    },
    install: {
      summary: 'macOS removed the bundled ftp client in Catalina.',
      steps: [
        { label: 'Install it with Homebrew', command: 'brew install inetutils' },
        { label: 'Prefer SFTP where you can — FTP sends credentials in the clear' }
      ]
    }
  },
  {
    id: 'rsh',
    name: 'rsh client',
    purpose: 'Rsh sessions',
    detect: async () => {
      const path = await which('rsh')
      return { available: Boolean(path), detail: path ?? undefined }
    },
    install: {
      summary:
        'Rsh is unencrypted and removed from modern systems. Only use it on an isolated network.',
      steps: [
        { label: 'Install it with Homebrew', command: 'brew install inetutils' },
        { label: 'Use SSH instead wherever possible' }
      ]
    }
  }
]

export async function checkTools(): Promise<ToolCheck[]> {
  return Promise.all(
    TOOLS.map(async (tool) => {
      const { available, detail } = await tool.detect()
      return {
        id: tool.id,
        name: tool.name,
        purpose: tool.purpose,
        available,
        detail,
        install: tool.install
      }
    })
  )
}

export async function checkTool(id: ToolId): Promise<ToolCheck | null> {
  return (await checkTools()).find((tool) => tool.id === id) ?? null
}

/**
 * X server ▸ Start X server. macOS has no X server of its own, so this starts
 * XQuartz and lets it own the display; a missing XQuartz sends the caller to
 * the requirements guide rather than failing silently.
 */
export async function startXServer(): Promise<{
  launched: boolean
  message: string
  tool?: ToolId
}> {
  const tool = await checkTool('xquartz')
  if (!tool?.available) {
    return { launched: false, message: 'XQuartz is not installed', tool: 'xquartz' }
  }
  spawn('/usr/bin/open', ['-a', 'XQuartz'], { detached: true, stdio: 'ignore' }).unref()
  return { launched: true, message: 'Started XQuartz — X11 clients can use $DISPLAY' }
}

/**
 * Session kinds that hand off to another application rather than opening a tab.
 * Returns a human-readable outcome for the UI to show.
 */
export async function launchExternal(
  session: SavedSession
): Promise<{ launched: boolean; message: string; tool?: ToolId }> {
  const host = session.host ?? ''
  const user = session.username

  switch (session.kind) {
    case 'vnc': {
      const port = session.port && session.port !== 5900 ? `:${session.port}` : ''
      const auth = user ? `${encodeURIComponent(user)}@` : ''
      await shell.openExternal(`vnc://${auth}${host}${port}`)
      return { launched: true, message: `Opened Screen Sharing to ${host}` }
    }

    case 'browser': {
      const scheme = session.port === 443 ? 'https' : 'http'
      const port = session.port && session.port !== 80 && session.port !== 443 ? `:${session.port}` : ''
      await shell.openExternal(`${scheme}://${host}${port}`)
      return { launched: true, message: `Opened ${host} in your browser` }
    }

    case 'rdp': {
      const tool = await checkTool('freerdp')
      if (!tool?.available) {
        return { launched: false, message: 'No RDP client found', tool: 'freerdp' }
      }
      if (tool.detail?.endsWith('.app')) {
        await shell.openExternal(`rdp://full%20address=s:${host}:${session.port ?? 3389}`)
        return { launched: true, message: `Handed ${host} to ${tool.detail.split('/').pop()}` }
      }
      const args = [`/v:${host}:${session.port ?? 3389}`, '/cert:ignore']
      if (user) args.push(`/u:${user}`)
      spawn(tool.detail!, args, { detached: true, stdio: 'ignore' }).unref()
      return { launched: true, message: `Started FreeRDP against ${host}` }
    }

    case 'xdmcp': {
      const tool = await checkTool('xquartz')
      if (!tool?.available) {
        return { launched: false, message: 'XQuartz is not installed', tool: 'xquartz' }
      }
      // XDMCP asks the remote display manager for a login session on :1.
      spawn('/opt/X11/bin/X', ['-query', host, ':1'], { detached: true, stdio: 'ignore' }).unref()
      return { launched: true, message: `Requested an XDMCP session from ${host} on display :1` }
    }

    default:
      return { launched: false, message: `${session.kind} is not an external session type` }
  }
}
