import { _electron as electron } from 'playwright-core'
import path from 'node:path'

const APP_DIR = '/home/brokkoli/GITHUB/graphirst'
const USER_DATA = process.argv[2]
const SHOT_DIR = process.argv[3]

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', `--user-data-dir=${USER_DATA}`, APP_DIR],
  env: { ...process.env },
  timeout: 30000
})

const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(2500)

async function ss(name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
  console.log('shot:', name)
}

await ss('01-loaded')

// Wait for the react-flow nodes to render
await page.waitForSelector('.react-flow__node', { timeout: 15000 }).catch((e) => console.log('node wait failed', e.message))
await page.waitForTimeout(1000)
await ss('02-graph')

// Find node-a and node-b bounding boxes via DOM (id is filename)
const boxes = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.react-flow__node')]
  return nodes.map((n) => {
    const rect = n.getBoundingClientRect()
    return { id: n.getAttribute('data-id'), x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  })
})
console.log('nodes:', JSON.stringify(boxes))

const a = boxes.find((b) => b.id === 'note-a.json')
const b = boxes.find((b) => b.id === 'note-b.json')

if (!a || !b) {
  console.log('ERROR: expected nodes not found')
} else {
  // Drag from B's right-side connection handle to A, to create the reciprocal relation B->A.
  // React Flow handles are small elements with class react-flow__handle inside the node.
  const bHandles = await page.evaluate((bid) => {
    const node = document.querySelector(`.react-flow__node[data-id="${bid}"]`)
    const handles = [...node.querySelectorAll('.react-flow__handle')]
    return handles.map((h) => {
      const r = h.getBoundingClientRect()
      return { cls: h.className, x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
  }, b.id)
  console.log('b handles:', JSON.stringify(bHandles))

  const sourceHandle = bHandles.find((h) => h.cls.includes('source')) ?? bHandles[0]
  const targetCenter = { x: a.x + a.w / 2, y: a.y + a.h / 2 }

  if (sourceHandle) {
    await page.mouse.move(sourceHandle.x, sourceHandle.y)
    await page.mouse.down()
    await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 20 })
    await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    await ss('03-after-drag')

    // Confirm the pending-connection popover (label input + confirm button) if it appeared
    const confirmed = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        b.querySelector('svg') && b.className.includes('bg-')
      )
      return btn ? 'maybe' : 'none'
    })
    console.log('popover probe:', confirmed)
  } else {
    console.log('ERROR: no source handle found on note-b')
  }
}

await ss('04-final')

await app.close()
