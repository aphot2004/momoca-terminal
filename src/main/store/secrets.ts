import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'node:crypto'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { VaultStatus } from '@shared/types'
import { JsonFile } from './json-file'

/**
 * Two ways to protect stored credentials:
 *
 *  - `keychain` (default): sealed with Electron's safeStorage, whose key lives
 *    in the login Keychain. Nothing to type; protection is your macOS account.
 *  - `master`: sealed with a key derived from a master password you set, the
 *    way MobaXterm does it. Asked for once when the app needs a secret, then
 *    held in memory until the app quits.
 *
 * Deliberately absent: a biometric prompt on every single read. An earlier
 * version did that and it fired on each connection, which is unusable.
 */
type VaultMode = 'keychain' | 'master'

interface Kdf {
  salt: string
  N: number
  r: number
  p: number
}

interface VaultFile {
  version: 2
  mode: VaultMode
  kdf?: Kdf
  /** A known plaintext sealed with the master key, to check the password. */
  verifier?: string
  entries: Record<string, string>
}

const VERIFIER_PLAINTEXT = 'mobaclone-vault-v2'

/** scrypt cost. N=2^15 keeps unlock well under a second while staying expensive to attack. */
const DEFAULT_KDF: Omit<Kdf, 'salt'> = { N: 32768, r: 8, p: 1 }
const SCRYPT_MAXMEM = 96 * 1024 * 1024

const vault = new JsonFile<VaultFile>(join(app.getPath('userData'), 'vault.json'), () => ({
  version: 2,
  mode: 'keychain',
  entries: {}
}))

/** Derived master key, held only in memory for the life of the process. */
let masterKey: Buffer | null = null

/** v1 files had no `mode`; everything in them was safeStorage-sealed. */
function readVault(): VaultFile {
  const file = vault.read() as Partial<VaultFile> & { entries?: Record<string, string> }
  if (file.version === 2 && file.mode) return file as VaultFile

  const migrated: VaultFile = { version: 2, mode: 'keychain', entries: file.entries ?? {} }
  vault.write(migrated)
  return migrated
}

// --- primitives ------------------------------------------------------------

function deriveKey(password: string, kdf: Kdf): Buffer {
  return scryptSync(password, Buffer.from(kdf.salt, 'base64'), 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT_MAXMEM
  })
}

function seal(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

function open(key: Buffer, sealed: string): string {
  const raw = Buffer.from(sealed, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}

/** Read a stored value under whichever scheme the vault is currently using. */
function unseal(sealed: string, mode: VaultMode): string | null {
  if (mode === 'master') {
    if (!masterKey) return null
    try {
      return open(masterKey, sealed)
    } catch {
      return null
    }
  }
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(sealed, 'base64'))
  } catch {
    return null
  }
}

function sealFor(plaintext: string, mode: VaultMode): string {
  if (mode === 'master') {
    if (!masterKey) throw new Error('Vault is locked — unlock it before saving a secret')
    return seal(masterKey, plaintext)
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain unavailable; refusing to persist secret in plaintext')
  }
  return safeStorage.encryptString(plaintext).toString('base64')
}

// --- public API ------------------------------------------------------------

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function vaultStatus(): VaultStatus {
  const file = readVault()
  return {
    mode: file.mode,
    locked: file.mode === 'master' && masterKey === null,
    secretCount: Object.keys(file.entries).length,
    keychainAvailable: safeStorage.isEncryptionAvailable()
  }
}

/** Verify a master password and cache the derived key for this run. */
export function unlockVault(password: string): boolean {
  const file = readVault()
  if (file.mode !== 'master' || !file.kdf || !file.verifier) return false

  const key = deriveKey(password, file.kdf)
  let plaintext: string
  try {
    plaintext = open(key, file.verifier)
  } catch {
    return false
  }

  const expected = Buffer.from(VERIFIER_PLAINTEXT)
  const actual = Buffer.from(plaintext)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false

  masterKey = key
  return true
}

export function lockVault(): void {
  masterKey?.fill(0)
  masterKey = null
}

/**
 * Turn a master password on, change it, or remove it.
 *
 * Existing secrets are re-encrypted under the new scheme, so switching never
 * silently orphans a saved password. The vault must be unlocked first if a
 * master password is already set.
 */
export function setMasterPassword(next: string | null): void {
  const file = readVault()

  if (file.mode === 'master' && !masterKey) {
    throw new Error('Unlock the vault before changing the master password')
  }

  // Recover every secret under the current scheme before re-sealing.
  const plain: Record<string, string> = {}
  for (const [id, sealed] of Object.entries(file.entries)) {
    const value = unseal(sealed, file.mode)
    if (value === null) {
      throw new Error(`Could not read the stored secret "${id}" — aborting rather than losing it`)
    }
    plain[id] = value
  }

  if (next === null) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Cannot fall back to the Keychain on this system')
    }
    const entries = Object.fromEntries(
      Object.entries(plain).map(([id, value]) => [
        id,
        safeStorage.encryptString(value).toString('base64')
      ])
    )
    lockVault()
    vault.write({ version: 2, mode: 'keychain', entries })
    return
  }

  const kdf: Kdf = { ...DEFAULT_KDF, salt: randomBytes(16).toString('base64') }
  const key = deriveKey(next, kdf)
  const entries = Object.fromEntries(
    Object.entries(plain).map(([id, value]) => [id, seal(key, value)])
  )

  masterKey = key
  vault.write({
    version: 2,
    mode: 'master',
    kdf,
    verifier: seal(key, VERIFIER_PLAINTEXT),
    entries
  })
}

export function storeSecret(key: string, secret: string): void {
  const file = readVault()
  const sealed = sealFor(secret, file.mode)
  vault.update((current) => ({ ...current, entries: { ...current.entries, [key]: sealed } }))
}

export function hasSecret(key: string): boolean {
  return key in readVault().entries
}

export function deleteSecret(key: string): void {
  vault.update((current) => {
    const entries = { ...current.entries }
    delete entries[key]
    return { ...current, entries }
  })
}

/**
 * Unseal a stored secret. Returns null when the vault is locked or the entry is
 * absent; callers fall back to prompting interactively, so a locked vault
 * degrades to "type it this once" rather than failing the connection.
 */
export async function revealSecret(key: string): Promise<string | null> {
  const file = readVault()
  const sealed = file.entries[key]
  if (!sealed) return null
  return unseal(sealed, file.mode)
}
