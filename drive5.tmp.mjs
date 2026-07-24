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
await page.click('.react-flow__controls-fitview')
await page.waitForTimeout(700)
await page.screenshot({ path: path.join(SHOT_DIR, '13-cold-load-fitted.png') })
await app.close()
