import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { utils } from 'ssh2'
import type { ImportedKey } from '@shared/types'
import { JsonFile } from './json-file'
import { deleteSecret, storeSecret } from './secrets'

interface KeyFile {
  version: 1
  keys: ImportedKey[]
}

const keysDir = () => join(app.getPath('userData'), 'keys')

const index = new JsonFile<KeyFile>(join(app.getPath('userData'), 'keys.json'), () => ({
  version: 1,
  keys: []
}))

/** Where the raw private key bytes live. Kept 0600, same as ~/.ssh. */
export function keyFilePath(id: string): string {
  return join(keysDir(), `${id}.key`)
}

/** Vault key under which this key's passphrase is sealed. */
export function keyVaultId(id: string): string {
  return `key:${id}`
}

export function listKeys(): ImportedKey[] {
  return index.read().keys
}

export function getKey(id: string): ImportedKey | undefined {
  return index.read().keys.find((k) => k.id === id)
}

export type ImportResult =
  | { status: 'ok'; key: ImportedKey }
  | { status: 'needs-passphrase' }
  | { status: 'error'; message: string }

/**
 * Copy a private key into the app's store.
 *
 * The key is parsed first so we can record its real type and fingerprint and
 * reject anything that isn't a usable key — importing a file that turns out to
 * be a public key or a stray text file is a confusing failure at connect time.
 */
export function importKey(input: {
  /** Either a path to read, or the key text itself (pasted). */
  path?: string
  text?: string
  name?: string
  passphrase?: string
  rememberPassphrase?: boolean
}): ImportResult {
  let data: Buffer
  try {
    data = input.text ? Buffer.from(input.text, 'utf8') : readFileSync(input.path!)
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }

  const parsed = utils.parseKey(data, input.passphrase)

  if (parsed instanceof Error) {
    const message = parsed.message.toLowerCase()
    // ssh2 reports a missing or wrong passphrase through the same error path.
    if (message.includes('passphrase') || message.includes('decrypt')) {
      return { status: 'needs-passphrase' }
    }
    return { status: 'error', message: parsed.message }
  }

  const key = Array.isArray(parsed) ? parsed[0] : parsed
  if (!key) return { status: 'error', message: 'No usable key found in that file' }

  if (!key.isPrivateKey()) {
    return { status: 'error', message: 'That is a public key — import the private key instead' }
  }

  const id = randomUUID()
  const publicBlob = key.getPublicSSH()
  const fingerprint = `SHA256:${createHash('sha256')
    .update(publicBlob)
    .digest('base64')
    .replace(/=+$/, '')}`

  const comment = key.comment || input.name || ''
  const imported: ImportedKey = {
    id,
    name: input.name?.trim() || comment || `${key.type} key`,
    type: key.type,
    fingerprint,
    encrypted: Boolean(input.passphrase),
    publicKey: `${key.type} ${publicBlob.toString('base64')}${comment ? ` ${comment}` : ''}`,
    importedAt: Date.now()
  }

  // Store the original bytes rather than a re-serialised copy, so the file stays
  // byte-identical to what the user imported.
  mkdirSync(keysDir(), { recursive: true, mode: 0o700 })
  const target = keyFilePath(id)
  writeFileSync(target, data, { mode: 0o600 })
  chmodSync(target, 0o600)

  if (input.passphrase && input.rememberPassphrase !== false) {
    try {
      storeSecret(keyVaultId(id), input.passphrase)
    } catch {
      // Keychain unavailable: the key still imports, we just prompt each time.
    }
  }

  index.update((current) => ({ ...current, keys: [...current.keys, imported] }))
  return { status: 'ok', key: imported }
}

export function renameKey(id: string, name: string): void {
  index.update((current) => ({
    ...current,
    keys: current.keys.map((k) => (k.id === id ? { ...k, name } : k))
  }))
}

export function deleteKey(id: string): void {
  try {
    rmSync(keyFilePath(id), { force: true })
  } catch {
    /* file already gone */
  }
  deleteSecret(keyVaultId(id))
  index.update((current) => ({ ...current, keys: current.keys.filter((k) => k.id !== id) }))
}
