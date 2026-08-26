/**
 * node-pty ships `spawn-helper` in its prebuilds without the executable bit
 * surviving npm's tarball extraction, and every pty spawn on macOS/Linux fails
 * with a bare "posix_spawnp failed." until it's restored.
 *
 * Runs from postinstall so a fresh clone works without the manual chmod.
 */
const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const prebuilds = join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (!existsSync(prebuilds)) process.exit(0)

for (const platform of readdirSync(prebuilds)) {
  const helper = join(prebuilds, platform, 'spawn-helper')
  if (!existsSync(helper)) continue
  try {
    chmodSync(helper, 0o755)
  } catch (err) {
    console.warn(`could not chmod ${helper}: ${err.message}`)
  }
}
