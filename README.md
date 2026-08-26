# MobaClone

A MobaXterm-style terminal for macOS: tabbed local and SSH sessions with an SFTP
file browser that shares the same SSH connection as the shell beside it.

Electron + TypeScript + React, `xterm.js` for rendering, `ssh2` for the protocol,
`node-pty` for local shells.

## Running it

```bash
npm install && npm run dev
```

`npm run build` produces the bundles in `out/`; `npm start` previews the built app.
`npm run dist` packages a universal (arm64 + x64) DMG.

## What works today

- **MobaXterm-style chrome** — a menu bar (Terminal, Sessions, View, X server,
  Tools, Macros, Settings, Help) over the icon ribbon, left panel that switches
  between the session tree and the SFTP browser, quick-connect box, status bar,
  and a welcome screen with a Light/Dark picker. Both themes apply to the app
  chrome and to live terminals.
- **The menus MobaXterm has** — Terminal (new/duplicate/close tab, set tab
  title, find in terminal, save or print the transcript, write commands on all
  terminals), Sessions with a **User sessions** submenu of everything saved,
  the full **View** menu (terminal splitting, compact and fullscreen, iconify,
  show menu bar / buttons bar / both, three button sizes, terminal zoom, sidebar
  on the left or right, tab numbers and close buttons, theme, screenshot),
  X server, Tools grouped System / Office / Network, Macros with a submenu of
  saved macros, Settings (configuration, keyboard shortcuts, import/export/reset
  configuration) and Help. Every bar that can hide itself has a way back:
  `⌘⇧M` for the menu bar, a chevron in the tab strip for the ribbon, `⌘⇧E` for
  compact mode.
- **Session types** — every tile in MobaXterm's strip is live. SSH, SFTP, Telnet,
  Serial, Shell, FTP, Rsh and Mosh open in a tab; RDP, VNC, Browser and XDMCP
  hand off to the right external app. A type whose client isn't installed is
  **disabled in the picker** with a dot and a reason on hover, so you can't
  choose something that would fail at connect time. **Requirements** in the
  ribbon lists what's installed with copy-paste install commands for what isn't;
  `KIND_REQUIREMENT` in `shared/types.ts` is the single map both the picker and
  the launcher read, so they can't disagree.
- **Tabbed terminals** — local login shells and SSH, WebGL-rendered, 20k lines of
  scrollback. `⌘T` new tab, `⌘W` close, `⌘1`–`⌘9` switch, middle-click to close.
- **Scrolling** — a real, always-visible scrollbar in the terminal and every
  list, wheel/trackpad scrolling, `⇧PageUp`/`⇧PageDown`/`⇧Home`/`⇧End` and
  `⌘↑`/`⌘↓` for scrollback (swallowed rather than leaked to the shell as stray
  escapes), and a "*N* lines below" chip that jumps back to the newest output.
  Two things bite here: macOS overlay scrollbars are zero-width until you
  scroll, and Chromium **ignores every `::-webkit-scrollbar` rule** on an
  element whose `scrollbar-width` is `thin` or `none` — setting that property
  silently cancels the styling. The chip is driven by the viewport's own
  `scroll` event, because xterm's `onScroll` does not fire for user scrollback.
  The ribbon scrolls horizontally when the window is too narrow for it.
- **SSH tunnels** — local (`-L`), remote (`-R`) and dynamic SOCKS5 (`-D`) port
  forwarding, each over its own connection so tunnels outlive terminal tabs.
  Live state and a per-tunnel connection count show in the manager and as a
  badge on the ribbon. The form is written around *which machine is which*:
  "Listen host" and "Destination host" are accurate and useless, so the type
  picker asks what you want to do ("Reach a remote service from this Mac"), the
  fields say **On this Mac, listen on** and **Forward to, as seen from the
  server**, and a diagram plus a sentence names the address you connect to and
  the one the service lives at. The equivalent `ssh -L/-R/-D` command is shown
  and copyable, so the mapping is checkable against something familiar.
- **SFTP browser** — MobaXterm's toolbar (parent, download, upload, refresh, new
  file, new folder, delete), an editable path bar, and a right-click menu with
  open-in-editor, download, rename, delete, copy name/path, upload, new
  file/folder, and permissions.
- **Embedded editor** — open a remote file straight from the browser, edit, and
  `⌘S` writes it back over the same SFTP channel.
- **Permissions** — a chmod grid on the properties dialog, showing the octal and
  `rwx` forms as you toggle bits.
- **Recursive delete** — SFTP's `rmdir` only removes empty directories, so a
  folder is emptied depth-first. The confirmation names the item count first,
  and symlinks are unlinked rather than descended into.
- **Auto-refresh** — the file pane follows changes you make in the terminal
  beside it. Re-listing every tick would re-transfer the directory for nothing,
  so each 1.5s tick `stat`s the open folder — one small round trip — and only
  re-lists when its mtime moves, which is what create/delete/rename do. Measured
  idle: one STAT per tick and **zero** READDIR. Polling pauses while the app is
  in the background or an SFTP operation is running, the listing is diffed
  before re-rendering so your selection and scroll position survive, and a
  footer toggle turns it off for slow links.
- **Transfer progress** — downloads, uploads and deletes report the file in
  flight, bytes moved against the total, throughput and an ETA. Byte counts come
  from `fastGet`/`fastPut`'s step callback, and the rate is averaged over a
  sliding 3s window so it doesn't jitter per chunk.
- **No dialog pile-ups** — every destructive or dialog-opening action runs
  through `useExclusive`, which drops re-entrant clicks using a *ref* (state is
  batched, so a double-click would otherwise slip through) and stays locked for
  a short tail afterwards. Clicks queued behind a modal are delivered the
  instant it closes; without that tail they reopen it immediately.
- **In-app name prompts** — Electron does not implement `window.prompt`; it
  throws "prompt() is not supported". New file, New folder and Rename use
  `usePrompt` instead.
- **Credential vault** — secrets are sealed with the macOS Keychain by default,
  or behind a **master password** you set, MobaXterm-style: asked for once per
  launch, then held in memory. scrypt-derived key, AES-256-GCM per entry, and
  switching modes re-encrypts rather than orphaning anything. There is
  deliberately no IPC that reads a secret back out to the renderer.
- **Folder download** — recursive, with live progress. Symlinks are skipped
  rather than followed, cycles are caught by resolving each directory, and a
  50,000-entry ceiling bounds the walk even if a server misdescribes its own
  tree. A link to `/` cannot turn a folder download into a filesystem copy.
- **Network tools** — ping (streams replies live, with min/avg/max and loss), a
  concurrent TCP port scanner with service names and presets, and subnet
  discovery that ping-sweeps a CIDR then retries quiet hosts on common TCP
  ports, since firewalled machines often ignore ICMP but still answer on 22 or
  443. Results annotate with reverse DNS and the ARP table, every job is
  cancellable, and absurd inputs (`1-99999`, a `/8` sweep) are refused with a
  reason rather than appearing to hang.
- **Macro recorder** — records the raw bytes you type into a terminal, so
  control characters and escape sequences replay faithfully rather than being
  reconstructed from a transcript. Replay into any tab, either as fast as the
  shell accepts or with the original pauses. Terminal *output* is deliberately
  not recorded — it would be meaningless to send back to a shell.
  Hitting Record **closes** the macro panel and leaves a floating bar: the panel
  is modal, and a modal's scrim covers the terminal, so leaving it open makes
  the feature impossible to use.
- **Editing a macro** — a step table with the delay before each step and the
  bytes it sends, reorderable and deletable. Control characters are shown as
  backslash escapes (`\r`, `\t`, `\e`, `\x03`) that round-trip exactly, so
  hand-editing cannot silently corrupt something the recorder captured
  faithfully.
- **Playback speed** — Instant, 4×, 2×, as recorded, or half speed. Stored per
  macro and overridable for a single run. Instant still leaves a token gap
  between steps, because a remote shell's line discipline will otherwise
  coalesce separate commands into one line.
- **Run on many terminals at once** — MobaXterm's MultiExec applied to a saved
  macro. Tick any of the open terminals (or Select all), and the macro is
  replayed into them concurrently, with per-target status. One failing target
  does not abort the others. Verified by three shells writing files named after
  their own PIDs.
- **Tools** — MobaXterm's Tools menu, minus the games and the Windows/X11-only
  entries, translated to macOS. *System*: running processes (with SIGTERM /
  SIGKILL, refusing PID 0/1 and this app), hardware inventory, Homebrew packages
  with an upgrade hand-off, and a root shell. *Office*: a local text editor, a
  unified-diff file comparison, and an ASCII table. *Network*: an SSH key
  generator that imports straight into the key store, listening ports via
  `lsof`, Wake-on-LAN magic packets, and a tcpdump capture builder. Anything
  needing root or long-running output is handed to a real terminal rather than
  pretended at in a panel.
- **MultiExec** — type once, and the keystrokes go to every terminal currently
  on screen, with a banner naming how many. Off by default and never persisted:
  restoring broadcast-to-all on launch would be a nasty surprise.
- **Split views** — multitab, 2 terminals side by side or stacked, or a 4-way
  grid, matching MobaXterm's Split button. Panes are *positioned* over the
  terminal area rather than being separate React subtrees: re-parenting a
  terminal would unmount it and drop the session.
- **View menu** — split layout, sessions panel, diagnostics bar, compact mode,
  full screen, and zoom (`⌘+` / `⌘−` / `⌘0`). Compact mode hides the ribbon —
  which is where the View menu lives — so it leaves a chevron in the tab bar and
  a `⌘⇧E` shortcut as ways back. A mode with no exit is a trap.
- **Unix command set** — MobaXterm bundles a Unix toolset because Windows has
  none; macOS already ships one, so there is nothing to bundle. The real gaps
  here are different, and this reports them: which of ~37 common tools you have,
  where the **BSD** variant differs from what Linux docs assume (`sed -i`,
  `grep -P`, macOS's 2006-era rsync), and one `brew install` line for everything
  missing.
- **Diagnostics bar** — **reports the server you're connected to**, not this Mac:
  CPU, memory, disk, network, load and uptime are polled from the SSH host over
  an exec channel every 3s. The scope chip on the left flips to local metrics
  when you want them, and falls back to local automatically with no SSH tab
  focused. Reads `/proc` on Linux and `vm_stat`/`sysctl` on a BSD or macOS host.
- **SSH key import** — bring keys in from a file or by pasting them. Each key is
  parsed on import (so a public key or a stray text file is rejected up front,
  not at connect time), copied into the app's own store at `0600` inside a `0700`
  directory, and listed with its real type and SHA256 fingerprint. Encrypted keys
  prompt for the passphrase, which can be sealed in the Keychain. Each key's
  public half is one click away for pasting into `authorized_keys`.
- **SSH auth** — agent (`SSH_AUTH_SOCK`), imported keys, a key file referenced in
  place, or password, plus keyboard-interactive for 2FA.
- **Host key verification** — real `~/.ssh/known_hosts` parsing, including hashed
  entries. Unknown hosts prompt with a SHA256 fingerprint; a *changed* key is
  flagged as a possible MITM and is never written back to `known_hosts`.
- **SFTP browser** — opens a second channel on the existing connection, so no
  second login. Browse, upload, download, mkdir, delete, rename.
- **Directory following** — with "track directory" on, an OSC 7 hook is installed
  in the remote shell so the file pane follows your `cd`, with a "Follow terminal
  folder" toggle in the browser itself. The shell would normally echo that whole
  setup line back as a wall of source on your first screen, so the hook prints a
  one-shot random marker and the client swallows everything up to it — see
  `pushData` in [`ssh-terminal.ts`](src/main/ssh/ssh-terminal.ts).
- **Session manager** — saved sessions grouped into folders in the sidebar.

> An earlier build asked for Touch ID on *every* secret read, which fired on each
> connection and was unusable. The vault above replaces it: authenticate once, or
> not at all if you stay on Keychain mode.

## Not built yet

Deliberately out of scope for the first pass, roughly in order of cost:

| Feature | Approach when you want it |
|---|---|
| Split panes | Layout tree around the existing `TerminalPane` |
| MultiExec (type to all tabs) | Fan a single `term:write` out across selected tabs |
| Drag & drop upload | HTML5 drop target on the file pane, then the existing upload IPC |
| Syntax highlighting in the editor | Swap the textarea for CodeMirror 6; the IPC already fits |
| Folder *upload* | Mirror `downloadDirectory` with `fastPut`, reusing the same guards |
| Per-process list (remote `top`) | Another section in the stats probe, rendered as a table |
| Embedded VNC / RDP | `noVNC` + a WS bridge; RDP would need `guacd`. Today both hand off to a native client |

## Layout

```
src/
  main/           Electron main process
    ssh/          ssh2 client, known_hosts, SFTP ops, tunnels, SOCKS5
    terminals/    Backend registry: local pty, SSH, telnet, serial
    store/        Session JSON store, imported key store, Keychain-sealed vault
    system-stats.ts  Host metrics for the diagnostics bar
    ipc.ts        Every renderer-callable channel, error-wrapped
  preload/        contextBridge API surface (the renderer has no Node access)
  renderer/src/   React UI
  shared/         Types crossing all three
```

The design rule worth preserving: `TerminalBackend` is the seam. A local pty, an
SSH channel, a telnet socket and a serial port all expose the same
`write`/`resize`/`sftp`/`dispose` surface, so the IPC layer never branches on
session type — `createBackend` in `terminals/registry.ts` is the only switch, and
every protocol above is one more implementation of that interface.

## Testing

There is no unit-test suite; the features were verified by driving the running
app over the Chrome DevTools protocol against a throwaway `ssh2` server. A local
SSH server with a known key exercises auth, host-key prompts, shell, SFTP, and
`direct-tcpip` forwarding end to end without touching a real host.

One lesson is worth writing down. An early macro test passed while the feature
was **completely unusable**: it called `.focus()` on xterm's hidden textarea,
which bypassed the modal scrim that a real user cannot bypass. A synthetic test
that reaches past the UI proves nothing about whether the UI works.

The harness now clicks at real coordinates and, before every click, asserts the
target is the topmost element at its own centre via `document.elementFromPoint`.
Anything sitting under an overlay fails loudly instead of silently passing.

## macOS notes

- **`node-pty`'s `spawn-helper`** loses its executable bit during npm extraction,
  and every pty spawn then fails with a bare `posix_spawnp failed.`
  `scripts/fix-pty-permissions.js` restores it from `postinstall`.
- **Electron's own installer** can extract its app bundle incompletely (missing
  `Contents/Frameworks`), which shows up as `Error: Electron uninstall`. Fix:

  ```bash
  rm -rf node_modules/electron/dist && unzip -q ~/Library/Caches/electron/*/electron-*-darwin-arm64.zip -d node_modules/electron/dist && printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
  ```

- Packaging uses the hardened runtime; `build/entitlements.mac.plist` grants the
  JIT and unsigned-memory entitlements Electron and `node-pty` need. Signing and
  notarization still require your own Developer ID.
