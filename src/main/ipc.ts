import { homedir } from 'node:os'
import { join } from 'node:path'
import { rm, writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { ConnectOptions, Macro, SavedSession, ScanTarget, SftpEntry, Tunnel } from '@shared/types'
import { checkTools, launchExternal, startXServer } from './external-tools'
import * as net from './net-tools'
import { checkUnixTools } from './unix-tools'
import * as toolbox from './tools'
import * as macros from './store/macros'
import * as sftpOps from './ssh/sftp-ops'
import { TransferReporter } from './ssh/transfer-progress'
import * as tunnels from './ssh/tunnels'
import { listSerialPorts } from './terminals/serial'
import * as keys from './store/keys'
import * as sessions from './store/sessions'
import * as secrets from './store/secrets'
import * as registry from './terminals/registry'

/**
 * Every handler is wrapped so a thrown error crosses the bridge as a rejected
 * promise with a readable message instead of Electron's generic IPC error.
 */
function handle<A extends unknown[], R>(
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, ...args: A) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true as const, value: await fn(event, ...(args as A)) }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/** Escape a transcript for the throwaway print window. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Bridge the ops layer's callbacks onto a reporter. */
function hooksFor(reporter: TransferReporter) {
  return {
    onTotals: (items: number, bytes: number) => reporter.setTotals(items, bytes),
    onCurrent: (name: string) => reporter.setCurrent(name),
    onBytes: (bytes: number) => reporter.setBytes(bytes),
    onItemDone: (bytes: number) => reporter.itemDone(bytes)
  }
}

export function registerIpc(): void {
  // --- sessions -----------------------------------------------------------
  handle('sessions:list', () => sessions.listSessions())
  handle('sessions:save', (_e, session: SavedSession) => sessions.saveSession(session))
  handle('sessions:delete', (_e, id: string) => sessions.deleteSession(id))

  // --- secrets ------------------------------------------------------------
  handle('secrets:available', () => secrets.isEncryptionAvailable())
  handle('vault:status', () => secrets.vaultStatus())
  handle('vault:unlock', (_e, password: string) => secrets.unlockVault(password))
  handle('vault:lock', () => secrets.lockVault())
  handle('vault:setMaster', (_e, next: string | null) => secrets.setMasterPassword(next))
  handle('secrets:has', (_e, key: string) => secrets.hasSecret(key))
  handle('secrets:store', (_e, key: string, value: string) => secrets.storeSecret(key, value))
  handle('secrets:delete', (_e, key: string) => secrets.deleteSecret(key))

  // --- ssh keys -----------------------------------------------------------
  handle('keys:list', () => keys.listKeys())
  handle('keys:import', (_e, input: Parameters<typeof keys.importKey>[0]) => keys.importKey(input))
  handle('keys:rename', (_e, id: string, name: string) => keys.renameKey(id, name))
  handle('keys:delete', (_e, id: string) => keys.deleteKey(id))

  handle('keys:pickFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import private key',
      defaultPath: join(homedir(), '.ssh'),
      buttonLabel: 'Import',
      properties: ['openFile', 'showHiddenFiles']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // --- terminals ----------------------------------------------------------
  handle('term:create', (event, options: ConnectOptions) => registry.create(options, event.sender))
  handle('term:write', (_e, tabId: string, data: string) => registry.write(tabId, data))
  handle('term:resize', (_e, tabId: string, cols: number, rows: number) =>
    registry.resize(tabId, cols, rows)
  )
  handle('term:close', (_e, tabId: string) => registry.close(tabId))

  // --- sftp ---------------------------------------------------------------
  handle('sftp:list', async (_e, tabId: string, path: string) =>
    sftpOps.list(await registry.requireSftp(tabId), path)
  )
  handle('sftp:read', async (_e, tabId: string, path: string) =>
    sftpOps.readTextFile(await registry.requireSftp(tabId), path)
  )
  handle('sftp:write', async (_e, tabId: string, path: string, contents: string) =>
    sftpOps.writeTextFile(await registry.requireSftp(tabId), path, contents)
  )
  handle('sftp:mkdir', async (_e, tabId: string, path: string) =>
    sftpOps.mkdir(await registry.requireSftp(tabId), path)
  )
  handle('sftp:touch', async (_e, tabId: string, path: string) =>
    sftpOps.touch(await registry.requireSftp(tabId), path)
  )
  handle('sftp:chmod', async (_e, tabId: string, path: string, mode: number) =>
    sftpOps.chmod(await registry.requireSftp(tabId), path, mode)
  )
  handle('sftp:stat', async (_e, tabId: string, path: string) => {
    const stats = await sftpOps.stat(await registry.requireSftp(tabId), path)
    return {
      size: stats.size,
      mode: stats.mode,
      uid: stats.uid,
      gid: stats.gid,
      atime: stats.atime * 1000,
      mtime: stats.mtime * 1000
    }
  })
  handle('sftp:rename', async (_e, tabId: string, from: string, to: string) =>
    sftpOps.rename(await registry.requireSftp(tabId), from, to)
  )
  handle('sftp:remove', async (event, tabId: string, entry: SftpEntry) => {
    const sftp = await registry.requireSftp(tabId)
    const reporter = new TransferReporter(event.sender, tabId, 'delete')
    try {
      const result = await sftpOps.remove(sftp, entry, hooksFor(reporter))
      reporter.finish(`Deleted ${result.removed} item${result.removed === 1 ? '' : 's'}`)
      return result
    } catch (err) {
      reporter.fail(err instanceof Error ? err.message : String(err))
      throw err
    }
  })
  handle('sftp:count', async (_e, tabId: string, entry: SftpEntry) =>
    sftpOps.countEntries(await registry.requireSftp(tabId), entry)
  )

  handle('sftp:download', async (event, tabId: string, entry: SftpEntry) => {
    const sftp = await registry.requireSftp(tabId)
    const result = await dialog.showSaveDialog({ defaultPath: entry.name })
    if (result.canceled || !result.filePath) return null

    const reporter = new TransferReporter(event.sender, tabId, 'download', 1, entry.size)
    reporter.setCurrent(entry.name)
    try {
      await sftpOps.download(sftp, entry.path, result.filePath, (bytes) =>
        reporter.setBytes(bytes)
      )
      reporter.itemDone(entry.size)
      reporter.finish(`Saved ${entry.name}`)
      return result.filePath
    } catch (err) {
      reporter.fail(err instanceof Error ? err.message : String(err))
      throw err
    }
  })

  handle('sftp:downloadFolder', async (event, tabId: string, entry: SftpEntry) => {
    const sftp = await registry.requireSftp(tabId)
    const result = await dialog.showOpenDialog({
      title: `Download "${entry.name}" into…`,
      buttonLabel: 'Download here',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null

    const reporter = new TransferReporter(event.sender, tabId, 'download')
    try {
      const outcome = await sftpOps.downloadDirectory(
        sftp,
        entry.path,
        result.filePaths[0],
        hooksFor(reporter)
      )
      reporter.finish(
        `Saved ${outcome.files} file${outcome.files === 1 ? '' : 's'} to ${result.filePaths[0]}` +
          (outcome.skippedCount ? ` · skipped ${outcome.skippedCount}` : '')
      )
      return { destination: result.filePaths[0], ...outcome }
    } catch (err) {
      reporter.fail(err instanceof Error ? err.message : String(err))
      throw err
    }
  })

  handle('sftp:uploadFolder', async (event, tabId: string, remoteDir: string) => {
    const sftp = await registry.requireSftp(tabId)
    const result = await dialog.showOpenDialog({
      title: 'Upload folder',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null

    const reporter = new TransferReporter(event.sender, tabId, 'upload')
    try {
      const outcome = await sftpOps.uploadDirectory(
        sftp,
        result.filePaths[0],
        remoteDir,
        hooksFor(reporter)
      )
      reporter.finish(
        `Uploaded ${outcome.files} file${outcome.files === 1 ? '' : 's'}` +
          (outcome.skippedCount ? `, skipped ${outcome.skippedCount}` : '')
      )
      return outcome
    } catch (err) {
      reporter.fail(err instanceof Error ? err.message : String(err))
      throw err
    }
  })

  handle('sftp:upload', async (event, tabId: string, remoteDir: string) => {
    const sftp = await registry.requireSftp(tabId)
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return []

    const reporter = new TransferReporter(event.sender, tabId, 'upload')
    try {
      const outcome = await sftpOps.uploadFiles(sftp, result.filePaths, remoteDir, hooksFor(reporter))
      reporter.finish(`Uploaded ${outcome.files} file${outcome.files === 1 ? '' : 's'}`)
      return outcome.names
    } catch (err) {
      reporter.fail(err instanceof Error ? err.message : String(err))
      throw err
    }
  })

  // --- tunnels ------------------------------------------------------------
  handle('tunnels:list', () => tunnels.listTunnels())
  handle('tunnels:save', (_e, tunnel: Tunnel) => tunnels.saveTunnel(tunnel))
  handle('tunnels:delete', (_e, id: string) => tunnels.deleteTunnel(id))
  handle('tunnels:status', () => tunnels.statuses())
  handle('tunnels:start', (event, id: string) => tunnels.startTunnel(id, event.sender))
  handle('tunnels:stop', (_e, id: string) => tunnels.stopTunnel(id))

  // --- external tools -----------------------------------------------------
  handle('tools:check', () => checkTools())
  handle('tools:launch', (_e, session: SavedSession) => launchExternal(session))

  // --- network tools ------------------------------------------------------
  handle('net:scan', (event, target: ScanTarget) => net.scanPorts(target, event.sender))
  handle('net:ping', (event, host: string, count: number) => net.pingHost(host, count, event.sender))
  handle('net:discover', (event, cidr: string) => net.discover(cidr, event.sender))
  handle('net:cancel', (_e, jobId: string) => net.cancelJob(jobId))
  handle('net:localNetworks', () => net.localNetworks())
  handle('net:commonPorts', () => net.COMMON_PORTS)

  // --- macros ---------------------------------------------------------------
  handle('macros:list', () => macros.listMacros())
  handle('macros:save', (_e, macro: Macro) => macros.saveMacro(macro))
  handle('macros:delete', (_e, id: string) => macros.deleteMacro(id))

  // --- toolbox --------------------------------------------------------------
  handle('tool:processes', () => toolbox.listProcesses())
  handle('tool:kill', (_e, pid: number, signal: string) => toolbox.killProcess(pid, signal))
  handle('tool:hardware', () => toolbox.hardwareInfo())
  handle('tool:ports', () => toolbox.listeningPorts())
  handle('tool:wol', (_e, mac: string, broadcast: string, port: number) =>
    toolbox.wakeOnLan(mac, broadcast, port)
  )
  handle('tool:genKey', (_e, input: Parameters<typeof toolbox.generateKey>[0]) =>
    toolbox.generateKey(input)
  )
  handle('tool:readFile', (_e, path: string) => toolbox.readLocalText(path))
  handle('tool:writeFile', (_e, path: string, contents: string) =>
    toolbox.writeLocalText(path, contents)
  )
  handle('tool:diff', (_e, left: string, right: string) => toolbox.diffFiles(left, right))
  handle('tool:brew', () => toolbox.brewPackages())

  handle('tool:pickFile', async (_e, title: string) => {
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openFile', 'showHiddenFiles']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle('tool:saveFile', async (_e, defaultPath: string) => {
    const result = await dialog.showSaveDialog({ defaultPath })
    return result.canceled ? null : result.filePath
  })

  // --- unix tools -----------------------------------------------------------
  handle('unix:check', () => checkUnixTools())

  // --- window ---------------------------------------------------------------
  handle('window:fullscreen', (event, on: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.setFullScreen(on)
    return win?.isFullScreen() ?? false
  })

  handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  /** View ▸ Take a screenshot. Returns where it was written, or null if cancelled. */
  handle('window:screenshot', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const image = await win.webContents.capturePage()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const result = await dialog.showSaveDialog(win, {
      title: 'Save screenshot',
      defaultPath: join(homedir(), 'Desktop', `MoMoca ${stamp}.png`)
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, image.toPNG())
    return result.filePath
  })

  /**
   * Terminal ▸ Print terminal text. Rendering the transcript in a throwaway
   * window is what gives macOS a normal print dialog — the terminal itself is a
   * WebGL canvas and would print as an image of the visible rows only.
   */
  handle('window:printText', async (_e, title: string, text: string) => {
    const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:11px ui-monospace,Menlo,monospace;white-space:pre-wrap;margin:24px}</style>
<body>${escapeHtml(text)}</body>`
    // Chromium refuses a top-level navigation to a data: URL, so the transcript
    // goes through a temp file instead.
    const page = join(app.getPath('temp'), `mobaclone-print-${Date.now()}.html`)
    await writeFile(page, html, 'utf8')

    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await printer.loadFile(page)
      return await new Promise<boolean>((resolve) => {
        printer.webContents.print({ silent: false }, (success) => resolve(success))
      })
    } finally {
      if (!printer.isDestroyed()) printer.destroy()
      await rm(page, { force: true })
    }
  })

  // --- X server -------------------------------------------------------------
  handle('tools:startXServer', () => startXServer())

  // --- misc ---------------------------------------------------------------
  handle('serial:list', () => listSerialPorts())
  handle('dialog:pickPrivateKey', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select private key',
      defaultPath: `${process.env.HOME}/.ssh`,
      properties: ['openFile', 'showHiddenFiles']
    })
    return result.canceled ? null : result.filePaths[0]
  })
}
