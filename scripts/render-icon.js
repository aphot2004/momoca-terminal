// Renders build/icon.svg into the .iconset macOS needs, then leaves iconutil to
// pack it. Chromium does the rasterising because it is the same renderer that
// draws the mark inside the app, and because `qlmanage` bakes its own drop
// shadow into the thumbnail — which would ship as part of the icon.
//
//   ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/render-icon.js
//   iconutil -c icns build/icon.iconset -o build/icon.icns
//
// One window, one page load, and the SVG resized between captures: each size is
// a real vector render rather than a downscale of the 1024, and reloading a
// window per size fails on macOS after the first transparent window.
const { app, BrowserWindow, screen } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync } = require('node:fs')
const { join } = require('node:path')

// Without these, capturePage hands back the art converted into the display's
// colour space with an ICC profile embedded, and the shipped pixels drift off
// the authored values — the face lightens and the caret shifts hue.
app.commandLine.appendSwitch('force-color-profile', 'srgb')
app.commandLine.appendSwitch('disable-color-correct-rendering')

/** The names `iconutil` expects, and the pixel size each one is. */
const SIZES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

const CANVAS = 1024
const root = join(__dirname, '..')
const outDir = join(root, 'build', 'icon.iconset')
const page = join(root, 'build', '.icon-render.html')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')

/**
 * Hinting for the two smallest renders. At 16px the prompt's stroke lands
 * between pixels and greys out, so the small sizes get a heavier, brighter
 * chevron — the same mark, drawn for the pixels it actually has.
 */
const small = svg
  .replace('stroke-width="62"', 'stroke-width="78"')
  .replace('stroke="#8b93a8"', 'stroke="#aeb6c6"')

void app.whenReady().then(async () => {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const pageFor = (art) => `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; }
</style>
${art}`
  writeFileSync(page, pageFor(svg))

  // capturePage returns device pixels, so on a Retina display the SVG is laid
  // out at half size to land on the exact pixel dimensions iconutil expects.
  const scale = screen.getPrimaryDisplay().scaleFactor || 1
  const window = new BrowserWindow({
    width: Math.ceil(CANVAS / scale),
    height: Math.ceil(CANVAS / scale),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { sandbox: true }
  })

  try {
    await window.loadFile(page)

    let art = 'regular'
    // SIZES starts at 16px, so the first swap happens immediately.
    for (const [name, size] of SIZES) {
      // Swap in the hinted art for the sizes that need it, once.
      const want = size <= 32 ? 'small' : 'regular'
      if (want !== art) {
        writeFileSync(page, pageFor(want === 'small' ? small : svg))
        await window.loadFile(page)
        art = want
      }

      // Re-render the vector at the target size, then take that rect.
      const css = size / scale
      await window.webContents.executeJavaScript(
        `(() => { const s = document.querySelector('svg');
          s.style.width = '${css}px'; s.style.height = '${css}px'; return true })()`
      )
      await new Promise((resolve) => setTimeout(resolve, 80))
      const image = await window.webContents.capturePage({ x: 0, y: 0, width: css, height: css })
      writeFileSync(join(outDir, name), image.toPNG())
      process.stdout.write(`${name} (${size}px)\n`)
    }
  } catch (err) {
    process.stderr.write(`render failed: ${err && err.message}\n`)
    process.exitCode = 1
  } finally {
    window.destroy()
    unlinkSync(page)
    app.quit()
  }
})
