import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents } from 'electron'
import type { SshPrompter } from './ssh/ssh-terminal'

type Pending = (value: unknown) => void

const pending = new Map<string, Pending>()

ipcMain.on('prompt:respond', (_event, { requestId, value }: { requestId: string; value: unknown }) => {
  const resolve = pending.get(requestId)
  if (!resolve) return
  pending.delete(requestId)
  resolve(value)
})

/** Ask the renderer to show a modal and wait for the answer. */
function ask<T>(target: WebContents, channel: string, payload: object): Promise<T> {
  const requestId = randomUUID()
  return new Promise<T>((resolve) => {
    pending.set(requestId, resolve as Pending)
    target.send(channel, { requestId, ...payload })

    // If the window goes away mid-prompt, don't leak the pending promise.
    target.once('destroyed', () => {
      if (pending.delete(requestId)) resolve(null as T)
    })
  })
}

export function createPrompter(target: WebContents, tabId: string): SshPrompter {
  return {
    askSecret: (kind, title, prompts) =>
      ask<string[] | null>(target, 'prompt:secret', { tabId, kind, title, prompts }),
    confirmHostKey: (info) => ask<boolean>(target, 'prompt:hostkey', { tabId, ...info })
  }
}
