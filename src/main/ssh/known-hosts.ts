import { createHmac } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const KNOWN_HOSTS = join(homedir(), '.ssh', 'known_hosts')

export type HostKeyVerdict =
  | { status: 'trusted' }
  | { status: 'unknown' }
  | { status: 'mismatch'; storedKeyType: string }

/** OpenSSH writes non-default ports as `[host]:port`. */
function hostPatterns(host: string, port: number): string[] {
  return port === 22 ? [host] : [`[${host}]:${port}`]
}

function matchesPattern(pattern: string, candidates: string[]): boolean {
  if (pattern.startsWith('|1|')) {
    // Hashed entry: |1|<base64 salt>|<base64 HMAC-SHA1 of the hostname>
    const [, , salt, hash] = pattern.split('|')
    if (!salt || !hash) return false
    return candidates.some(
      (candidate) =>
        createHmac('sha1', Buffer.from(salt, 'base64')).update(candidate).digest('base64') === hash
    )
  }
  return candidates.includes(pattern)
}

/**
 * Check a presented host key against ~/.ssh/known_hosts.
 *
 * A `mismatch` means the host is known but is offering a different key of the
 * same type — the signature of a MITM, and never something to auto-accept.
 */
export function verifyHostKey(
  host: string,
  port: number,
  keyType: string,
  key: Buffer
): HostKeyVerdict {
  let contents: string
  try {
    contents = readFileSync(KNOWN_HOSTS, 'utf8')
  } catch {
    return { status: 'unknown' }
  }

  const candidates = hostPatterns(host, port)
  const presented = key.toString('base64')

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    // Skip optional markers such as @cert-authority / @revoked.
    const fields = line.split(/\s+/)
    const parts = fields[0].startsWith('@') ? fields.slice(1) : fields
    const [hostField, storedType, storedKey] = parts
    if (!hostField || !storedType || !storedKey) continue

    const matched = hostField.split(',').some((pattern) => matchesPattern(pattern, candidates))
    if (!matched) continue

    // Only a same-type key that differs is a real mismatch; servers legitimately
    // offer several key types, so a different type is just first contact.
    if (storedType === keyType) {
      if (storedKey === presented) return { status: 'trusted' }
      return { status: 'mismatch', storedKeyType: storedType }
    }
  }

  return { status: 'unknown' }
}

export function trustHostKey(host: string, port: number, keyType: string, key: Buffer): void {
  mkdirSync(dirname(KNOWN_HOSTS), { recursive: true, mode: 0o700 })
  const entry = `${hostPatterns(host, port)[0]} ${keyType} ${key.toString('base64')}\n`
  appendFileSync(KNOWN_HOSTS, entry, { mode: 0o600 })
}
