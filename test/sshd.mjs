/**
 * A throwaway SSH server for testing, on 127.0.0.1:2222.
 *
 * This is what makes the SSH side testable without touching a real host: it
 * accepts exactly one public key, serves a real shell, implements enough SFTP
 * to exercise the file browser, and honours direct-tcpip so port forwarding and
 * SOCKS can be verified end to end.
 *
 *   node test/sshd.mjs
 *
 * Generates its own host key and client key under test/.artifacts on first run.
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { connect as netConnect } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(here, '..') + '/')
const { Server, utils } = require('ssh2')
const pty = require('node-pty')

const ARTIFACTS = resolve(here, '.artifacts')
const SERVE_DIR = resolve(ARTIFACTS, 'served')
mkdirSync(SERVE_DIR, { recursive: true })

// --- keys ------------------------------------------------------------------

const hostKeyPath = resolve(ARTIFACTS, 'hostkey')
const clientKeyPath = resolve(ARTIFACTS, 'testkey')

for (const [path, comment] of [
  [hostKeyPath, 'test-host-key'],
  [clientKeyPath, 'test-client-key']
]) {
  if (!existsSync(path)) {
    execFileSync('/usr/bin/ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', comment, '-f', path, '-q'])
    console.log(`generated ${path}`)
  }
}

// A couple of files to browse.
if (!existsSync(resolve(SERVE_DIR, 'README.txt'))) {
  writeFileSync(resolve(SERVE_DIR, 'README.txt'), 'hello from the served dir\n')
  mkdirSync(resolve(SERVE_DIR, 'subdir'), { recursive: true })
  writeFileSync(resolve(SERVE_DIR, 'subdir', 'nested.conf'), 'nested\n')
}

const hostKey = readFileSync(hostKeyPath)
const allowed = utils.parseKey(readFileSync(`${clientKeyPath}.pub`, 'utf8'))
if (allowed instanceof Error) throw allowed

const STATUS = { OK: 0, EOF: 1, NO_SUCH_FILE: 2, FAILURE: 4 }

let execTick = 0

// --- server ----------------------------------------------------------------

const server = new Server({ hostKeys: [hostKey] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method !== 'publickey') return ctx.reject(['publickey'])
    if (ctx.key.algo !== allowed.type || !ctx.key.data.equals(allowed.getPublicSSH())) {
      return ctx.reject()
    }
    // The first round carries no signature: the client is probing whether the
    // key is usable at all.
    if (!ctx.signature) return ctx.accept()
    return allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) ? ctx.accept() : ctx.reject()
  })

  client.on('ready', () => {
    // direct-tcpip is what `forwardOut` opens — i.e. ssh -L and ssh -D.
    client.on('tcpip', (accept, reject, info) => {
      const upstream = netConnect(info.destPort, info.destIP, () => {
        const channel = accept()
        console.log(`tcpip -> ${info.destIP}:${info.destPort}`)
        channel.pipe(upstream).pipe(channel)
        channel.on('close', () => upstream.destroy())
      })
      upstream.on('error', () => reject())
    })

    client.on('session', (acceptSession) => {
      const session = acceptSession()
      let ptyInfo = { cols: 80, rows: 24 }

      session.on('pty', (accept, _reject, info) => {
        ptyInfo = info
        accept?.()
      })

      /*
       * The diagnostics bar probes the server with one shell command. This
       * answers as though it were Linux so the /proc parsing path is covered
       * even though the test server runs on macOS; counters advance each call
       * so the CPU and network deltas are non-zero.
       */
      session.on('exec', (accept, reject, info) => {
        if (!info.command.includes('#OS')) return reject()
        const stream = accept()
        execTick += 1
        const jiffies = 1_000_000 + execTick * 400
        const idle = 700_000 + execTick * 250
        stream.write(
          [
            '#OS', 'Linux',
            '#CPUS', '8',
            '#STAT', `cpu  ${jiffies} 1200 ${Math.round(jiffies / 4)} ${idle} 3100 0 900 0 0 0`,
            '#MEM',
            'MemTotal:       16311512 kB',
            'MemFree:         1204488 kB',
            'MemAvailable:    9822104 kB',
            'Buffers:          312044 kB',
            'Cached:          5920112 kB',
            '#VMSTAT', '#HWMEM',
            '#DF', '/dev/sda2      488551344 201234567 262450000  44% /',
            '#LOAD', '0.84 1.12 1.05 2/812 44219',
            '#UP', '864000',
            '#NET',
            `  eth0: ${50_000_000 + execTick * 131_072} 412000 0 0 0 0 0 0 ${20_000_000 + execTick * 65_536} 288000 0 0 0 0 0 0`,
            '#END',
            ''
          ].join('\n')
        )
        stream.exit(0)
        stream.end()
      })

      session.on('shell', (accept) => {
        const stream = accept()
        const term = pty.spawn('/bin/sh', [], {
          name: 'xterm-256color',
          cols: ptyInfo.cols,
          rows: ptyInfo.rows,
          cwd: SERVE_DIR,
          env: { ...process.env, PS1: 'testsrv$ ', TERM: 'xterm-256color' }
        })
        term.onData((d) => stream.write(d))
        term.onExit(() => stream.end())
        stream.on('data', (d) => term.write(d.toString('utf8')))
        stream.on('close', () => {
          try {
            term.kill()
          } catch {
            /* already gone */
          }
        })
      })

      session.on('sftp', (accept) => {
        const sftp = accept()
        const handles = new Map()
        let nextHandle = 0

        /*
         * A real server resolves relative paths against the user's home. The
         * app always calls REALPATH first so it never relied on this, but
         * without it a bare `readdir('.')` would list the server process's cwd
         * — which is the repo, not the directory under test.
         */
        const at = (p) => (p === '.' || p === '' ? SERVE_DIR : resolve(SERVE_DIR, p))

        /*
         * readdir must lstat, not stat. Using stat makes a symlink look like
         * whatever it points at, and a link to / then reads as an ordinary
         * directory — which is exactly the case the recursive download and
         * delete guards exist to survive.
         */
        const attrsFor = (p, useLstat = false) => {
          const s = useLstat ? lstatSync(p) : statSync(p)
          return {
            mode: s.mode,
            uid: s.uid,
            gid: s.gid,
            size: s.size,
            atime: s.atime.getTime() / 1000,
            mtime: s.mtime.getTime() / 1000
          }
        }

        sftp.on('REALPATH', (reqid, given) => {
          const target = at(given)
          sftp.name(reqid, [{ filename: target, longname: target, attrs: {} }])
        })

        sftp.on('OPENDIR', (reqid, path) => {
          const dir = at(path)
          try {
            statSync(dir)
          } catch {
            return sftp.status(reqid, STATUS.NO_SUCH_FILE)
          }
          const id = Buffer.from(String(nextHandle++))
          handles.set(id.toString(), { path: dir, sent: false })
          sftp.handle(reqid, id)
        })

        sftp.on('READDIR', (reqid, handle) => {
          const state = handles.get(handle.toString())
          if (!state) return sftp.status(reqid, STATUS.FAILURE)
          if (state.sent) return sftp.status(reqid, STATUS.EOF)
          state.sent = true
          sftp.name(
            reqid,
            readdirSync(state.path).map((filename) => ({
              filename,
              longname: filename,
              attrs: attrsFor(resolve(state.path, filename), true)
            }))
          )
        })

        const statHandler = (reqid, path) => {
          try {
            sftp.attrs(reqid, attrsFor(at(path)))
          } catch {
            sftp.status(reqid, STATUS.NO_SUCH_FILE)
          }
        }
        sftp.on('STAT', statHandler)
        sftp.on('LSTAT', statHandler)

        sftp.on('OPEN', (reqid, filename, flags) => {
          try {
            const read = (flags & 0x01) !== 0
            const write = (flags & 0x02) !== 0
            const trunc = (flags & 0x10) !== 0
            const excl = (flags & 0x20) !== 0
            const mode = excl ? 'wx' : write && trunc ? 'w' : write && read ? 'r+' : write ? 'w' : 'r'
            const fd = openSync(at(filename), mode)
            const id = Buffer.from(String(nextHandle++))
            handles.set(id.toString(), { file: true, fd, path: at(filename) })
            sftp.handle(reqid, id)
          } catch (err) {
            sftp.status(reqid, err.code === 'ENOENT' ? STATUS.NO_SUCH_FILE : STATUS.FAILURE)
          }
        })

        sftp.on('READ', (reqid, handle, offset, length) => {
          const state = handles.get(handle.toString())
          if (!state?.file) return sftp.status(reqid, STATUS.FAILURE)
          try {
            const buf = Buffer.alloc(length)
            const bytes = readSync(state.fd, buf, 0, length, offset)
            if (bytes === 0) return sftp.status(reqid, STATUS.EOF)
            sftp.data(reqid, buf.subarray(0, bytes))
          } catch {
            sftp.status(reqid, STATUS.FAILURE)
          }
        })

        sftp.on('WRITE', (reqid, handle, offset, data) => {
          const state = handles.get(handle.toString())
          if (!state?.file) return sftp.status(reqid, STATUS.FAILURE)
          try {
            writeSync(state.fd, data, 0, data.length, offset)
            sftp.status(reqid, STATUS.OK)
          } catch {
            sftp.status(reqid, STATUS.FAILURE)
          }
        })

        sftp.on('FSTAT', (reqid, handle) => {
          const state = handles.get(handle.toString())
          if (!state) return sftp.status(reqid, STATUS.FAILURE)
          statHandler(reqid, state.path)
        })

        const simple = (fn) => (reqid, ...args) => {
          try {
            fn(...args)
            sftp.status(reqid, STATUS.OK)
          } catch {
            sftp.status(reqid, STATUS.FAILURE)
          }
        }
        sftp.on('SETSTAT', simple((path, attrs) => {
          if (typeof attrs.mode === 'number') chmodSync(at(path), attrs.mode & 0o777)
        }))
        sftp.on('REMOVE', simple((path) => unlinkSync(at(path))))
        sftp.on('MKDIR', simple((path) => mkdirSync(at(path))))
        sftp.on('RMDIR', simple((path) => rmdirSync(at(path))))
        sftp.on('RENAME', simple((from, to) => renameSync(at(from), at(to))))

        sftp.on('CLOSE', (reqid, handle) => {
          const state = handles.get(handle.toString())
          if (state?.file) {
            try {
              closeSync(state.fd)
            } catch {
              /* already closed */
            }
          }
          handles.delete(handle.toString())
          sftp.status(reqid, STATUS.OK)
        })
      })
    })
  })

  client.on('error', (err) => console.log('client error:', err.message))
})

server.listen(2222, '127.0.0.1', () => {
  console.log('test sshd on 127.0.0.1:2222')
  console.log(`  user: anything   key: ${clientKeyPath}`)
  console.log(`  serving: ${SERVE_DIR}`)
})
