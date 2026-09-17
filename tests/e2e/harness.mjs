/**
 * Minimal end-to-end harness for the Nebu2 editor.
 *
 * Drives the real app in a real browser, because the bugs worth catching here
 * only exist once Babylon, Vue reactivity and the DOM are all live — an
 * AnimationGroup that throws on empty keys, a menu that re-opens on hover, a
 * keyboard shortcut that fires inside a text field.
 *
 * Uses playwright-core against a Chrome/Edge already installed on the machine,
 * so `npm install` stays free of a browser download.
 *
 * Elements are driven by dispatching events straight at the node rather than by
 * synthesising real pointer input. The editor is dense with overlapping
 * absolutely-positioned panels, dropdowns and toasts, and pointer-actionability
 * checks spend their time fighting that instead of testing behaviour. Where the
 * interaction itself is the thing under test — hover-opened submenus — real
 * mouse input is used instead.
 */

import { chromium } from 'playwright-core'
import { existsSync } from 'fs'

const CHROME_CANDIDATES = [
  process.env.NEBU_E2E_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

export function findBrowser() {
  const hit = CHROME_CANDIDATES.find(p => existsSync(p))
  if (!hit) {
    throw new Error(
      'No Chrome/Edge found. Set NEBU_E2E_BROWSER to a Chromium executable path.',
    )
  }
  return hit
}

export const BASE_URL = process.env.NEBU_E2E_URL ?? 'http://localhost:5173'

// ── Result tracking ─────────────────────────────────────────────────────────

const results = []

export function check(name, passed, detail = '') {
  results.push({ name, passed })
  const mark = passed ? 'PASS' : 'FAIL'
  process.stdout.write(`  ${mark}  ${name}${detail ? '  — ' + detail : ''}\n`)
}

export async function scenario(name, fn) {
  process.stdout.write(`\n${name}\n`)
  try {
    await fn()
  } catch (err) {
    check(`${name} (threw)`, false, String(err.message ?? err).split('\n')[0].slice(0, 160))
  }
}

export function summary() {
  const failed = results.filter(r => !r.passed)
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} checks passed\n`,
  )
  if (failed.length) {
    process.stdout.write('Failed:\n' + failed.map(f => `  - ${f.name}`).join('\n') + '\n')
  }
  return failed.length === 0
}

// ── Session ─────────────────────────────────────────────────────────────────

export async function openEditor() {
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: process.env.NEBU_E2E_HEADED !== '1',
    args: [
      // Software GL so the suite runs on machines and CI boxes with no GPU.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(10_000)

  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  // Babylon needs a moment to create the engine and first frame.
  await page.waitForTimeout(5000)

  return { browser, page, errors, ...drivers(page) }
}

// ── DOM drivers ─────────────────────────────────────────────────────────────

function drivers(page) {
  const pause = ms => page.waitForTimeout(ms)

  const visible = `el => el.offsetParent !== null || el.getClientRects().length > 0`

  async function click(sel, text = null, nth = 0) {
    const ok = await page.evaluate(({ sel, text, nth }) => {
      const all  = [...document.querySelectorAll(sel)]
        .filter(el => el.offsetParent !== null || el.getClientRects().length > 0)
      const hits = text === null ? all : all.filter(el => el.textContent.trim() === text)
      const el   = hits[nth === -1 ? hits.length - 1 : nth]
      if (!el) return false
      el.click()
      return true
    }, { sel, text, nth })
    if (!ok) throw new Error(`click: no match for ${sel}${text ? ` "${text}"` : ''}`)
    await pause(150)
  }

  /** Catalogue rows read like "Position Y   Float" — match the leading label. */
  async function clickStartsWith(sel, text) {
    const ok = await page.evaluate(({ sel, text }) => {
      const el = [...document.querySelectorAll(sel)]
        .filter(e => e.offsetParent !== null || e.getClientRects().length > 0)
        .find(e => e.textContent.trim().startsWith(text))
      if (!el) return false
      el.click()
      return true
    }, { sel, text })
    if (!ok) throw new Error(`clickStartsWith: no match for "${text}"`)
    await pause(150)
  }

  async function clickTitle(title) {
    const ok = await page.evaluate(t => {
      const el = document.querySelector(`[title="${t}"]`)
      if (!el) return false
      el.click()
      return true
    }, title)
    if (!ok) throw new Error(`clickTitle: no element titled "${title}"`)
    await pause(150)
  }

  async function dblClick(sel, text = null, nth = 0) {
    const ok = await page.evaluate(({ sel, text, nth }) => {
      const all  = [...document.querySelectorAll(sel)]
        .filter(el => el.offsetParent !== null || el.getClientRects().length > 0)
      const hits = text === null ? all : all.filter(el => el.textContent.trim() === text)
      const el   = hits[nth === -1 ? hits.length - 1 : nth]
      if (!el) return false
      el.dispatchEvent(new MouseEvent('click',    { bubbles: true }))
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      return true
    }, { sel, text, nth })
    if (!ok) throw new Error(`dblClick: no match for ${sel}${text ? ` "${text}"` : ''}`)
    await pause(300)
  }

  /** Write through the native setter so Vue's v-model observes the change. */
  async function fill(sel, value, { enter = false, nth = 0 } = {}) {
    const ok = await page.evaluate(({ sel, value, enter, nth }) => {
      const el = [...document.querySelectorAll(sel)][nth]
      if (!el) return false
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, String(value))
      el.dispatchEvent(new Event('input',  { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      if (enter) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return true
    }, { sel, value, enter, nth })
    if (!ok) throw new Error(`fill: no element at ${sel}[${nth}]`)
    await pause(200)
  }

  async function selectOptionByMarker(markerOption, label) {
    const ok = await page.evaluate(({ markerOption, label }) => {
      const sel = [...document.querySelectorAll('select')]
        .find(s => [...s.options].some(o => o.textContent.trim() === markerOption))
      if (!sel) return false
      const opt = [...sel.options].find(o => o.textContent.trim() === label)
      if (!opt) return false
      sel.value = opt.value
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, { markerOption, label })
    if (!ok) throw new Error(`selectOption: "${label}" not found`)
    await pause(900)
  }

  const text = () => page.evaluate(() => document.body.innerText)

  /** Names shown in the hierarchy tree (plus panel titles, which share a class). */
  const treeNames = () => page.evaluate(() =>
    [...document.querySelectorAll('span.flex-1.truncate')].map(e => e.textContent.trim()))

  // ── Editor-specific actions ───────────────────────────────────────────────

  async function selectSceneRoot() {
    await click('span.flex-1.font-medium.truncate', 'Main Scene')
    await pause(400)
  }

  async function addEntity(label) {
    await clickTitle('Add Entity')
    await pause(250)
    await click('button', label)
    await pause(900)
  }

  async function addComponent(label) {
    await click('button', 'Add Component')
    await pause(250)
    await click('button', label)
    await pause(1300)
  }

  /** Create a root-level entity and rename it via the hierarchy inline editor. */
  async function newNamedEntity(name) {
    await selectSceneRoot()
    await addEntity('Empty Entity')
    await dblClick('span.flex-1.truncate', 'Empty Entity', -1)
    // h-5 distinguishes the inline rename box from the h-6 hierarchy search box.
    await fill('input.flex-1.h-5', name, { enter: true })
    await pause(600)
    await click('span.flex-1.truncate', name)
    await pause(700)
  }

  /** Close any open menu without clicking the viewport (which clears selection). */
  async function closeMenus() {
    await page.evaluate(() => document.body.click())
    await pause(250)
  }

  async function openMenu(name) {
    await closeMenus()
    await page.locator(`[data-menu-bar] button:text-is("${name}")`).click()
    await pause(350)
  }

  async function menuItem(label) {
    await page.locator(`[data-menu-bar] span.flex-1:text-is("${label}")`).first().click()
    await pause(900)
  }

  /** Submenus open on CSS hover, so this one needs real pointer input. */
  async function menuSubItem(parent, child) {
    await page.locator(`[data-menu-bar] span.flex-1:text-is("${parent}")`).first().hover()
    await pause(400)
    await page.locator(`[data-menu-bar] span.flex-1:text-is("${child}")`).first().click()
    await pause(900)
  }

  return {
    pause, click, clickStartsWith, clickTitle, dblClick, fill,
    selectOptionByMarker, text, treeNames,
    selectSceneRoot, addEntity, addComponent, newNamedEntity,
    closeMenus, openMenu, menuItem, menuSubItem,
    visible,
  }
}
