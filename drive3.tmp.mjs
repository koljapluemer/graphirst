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
await page.waitForTimeout(1500)

async function ss(name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) })
  console.log('shot:', name)
}

const info = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => ({
    id: n.getAttribute('data-id'),
    transform: n.style.transform
  }))
  const edgeLabels = [...document.querySelectorAll('.react-flow__edge, [class*=edge]')].length
  const labelButtons = [...document.querySelectorAll('button')]
    .map((b) => b.textContent?.trim())
    .filter((t) => t && (t.includes('to') || t.includes('reciproc') || t.includes('relate')))
  const viewport = document.querySelector('.react-flow__viewport')?.style.transform
  return { nodes, edgeLabels, labelButtons, viewport }
})
console.log(JSON.stringify(info, null, 2))

// click fit-view control button to force a refit, then screenshot
await page.click('.react-flow__controls-fitview').catch(() => console.log('no fitview control'))
await page.waitForTimeout(600)
await ss('08-forced-fit')

const info2 = await page.evaluate(() => {
  const labelButtons = [...document.querySelectorAll('button')]
    .map((b) => b.textContent?.trim())
    .filter((t) => t && (t.includes('to') || t.includes('reciproc') || t.includes('relate')))
  return { labelButtons }
})
console.log('after forced fit:', JSON.stringify(info2, null, 2))

await app.close()
