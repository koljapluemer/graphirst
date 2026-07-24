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
await page.waitForSelector('.react-flow__node', { timeout: 15000 })
await page.waitForTimeout(1000)

async function ss(name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
  console.log('shot:', name)
}

async function dumpLabels(tag) {
  const info = await page.evaluate(() => {
    const edgePaths = document.querySelectorAll('.react-flow__edge-path').length
    const labelButtons = [...document.querySelectorAll('.react-flow__edgelabel-renderer button')]
      .map((b) => b.textContent?.trim())
    return { edgePaths, labelButtons }
  })
  console.log(tag, JSON.stringify(info))
}

await dumpLabels('before-connect')

const boxes = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.react-flow__node')]
  return nodes.map((n) => {
    const rect = n.getBoundingClientRect()
    return { id: n.getAttribute('data-id'), x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  })
})
const a = boxes.find((b) => b.id === 'note-a.json')
const b = boxes.find((b) => b.id === 'note-b.json')

const bHandles = await page.evaluate((bid) => {
  const node = document.querySelector(`.react-flow__node[data-id="${bid}"]`)
  const handles = [...node.querySelectorAll('.react-flow__handle')]
  return handles.map((h) => {
    const r = h.getBoundingClientRect()
    return { cls: h.className, x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
}, b.id)
const sourceHandle = bHandles.find((h) => h.cls.includes('right') && h.cls.includes('source'))
const targetCenter = { x: a.x + a.w / 2, y: a.y + a.h / 2 }

await page.mouse.move(sourceHandle.x, sourceHandle.y)
await page.mouse.down()
await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 20 })
await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(500)

const input = page.locator('input[placeholder*="label" i]').first()
await input.click()
await input.fill('reciprocates')
await page.getByRole('button', { name: 'Connect' }).click()

// Immediately (before the async refetch/refit settle) check the DOM.
await page.waitForTimeout(50)
await dumpLabels('t+50ms (optimistic pin, pre-refetch)')
await ss('09-t50')

await page.waitForTimeout(400)
await dumpLabels('t+450ms')
await ss('10-t450')

await page.waitForTimeout(1000)
await dumpLabels('t+1450ms (refetch should be settled)')
await ss('11-t1450')

await page.waitForTimeout(2000)
await dumpLabels('t+3450ms (fully settled)')
await ss('12-t3450')

await app.close()
