# Test harnesses

Ad-hoc scripts, not a framework. Each drives the running app over the Chrome
DevTools Protocol and prints a PASS/FAIL list, exiting non-zero on any failure.

## Running them

```bash
# 1. the throwaway SSH server (generates its own keys on first run)
node test/sshd.mjs

# 2. the app, with the debugging port open
npm run build
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --remote-debugging-port=9222

# 3. a suite, in a third shell
node test/suites/humantest.mjs
```

Node is at `/opt/homebrew/bin/node`; prefix with `PATH="/opt/homebrew/bin:$PATH"`
if your shell can't find it.

## The suites

| Suite | Covers |
|---|---|
| `humantest.mjs` | UI reachability audit + the full macro record/replay flow by hand |
| `scrolltest.mjs` | Terminal scrollbar, wheel, keyboard scrollback, jump-to-bottom, panel scrolling |
| `viewtest.mjs` | Split layouts, MultiExec, View menu, zoom, compact mode |
| `macroedit.mjs` | Macro editing, playback speed, running on several terminals at once |
| `toolstest.mjs` | Network tools, macro store, Unix command catalogue |

## Two rules they follow

**Click at real coordinates, and check reachability first.** `probe()` in
`humantest.mjs` asserts the intended element is the topmost one at its own
centre before clicking. An earlier macro test passed while the feature was
unusable, because it called `.focus()` on xterm's hidden textarea and reached
past a modal scrim that a person cannot reach past.

**Assert on side effects, not the screen.** The WebGL renderer paints terminal
text to a canvas, so it never reaches the DOM. To prove a command ran, have the
shell write a file (`echo … > file`, or `echo … > file-$$.txt` when you need to
prove *which* shell ran it) and check that from Node. To prove a resize
reached the backend, ask the shell `tput cols`.

## The test server

`sshd.mjs` accepts one public key, serves a real `/bin/sh`, implements enough
SFTP for the file browser (including `lstat` in readdir, so symlinks report as
symlinks — the guards depend on that), and honours `direct-tcpip` so tunnels and
SOCKS can be verified.

Its `exec` handler answers the diagnostics probe as though it were **Linux**,
so the `/proc` parsing path is exercised even though the server runs on macOS.

## Artifacts

`test/.artifacts/` holds generated keys, the served directory and screenshots.
Gitignored, safe to delete — it regenerates.
