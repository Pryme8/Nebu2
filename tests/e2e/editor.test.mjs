/**
 * Editor smoke suite.
 *
 * Each scenario below maps to a bug that actually shipped, or to a path that
 * would break silently if it regressed.
 *
 *   npm run test:e2e          (needs `npm run dev` running, or set NEBU_E2E_URL)
 *   NEBU_E2E_HEADED=1 npm run test:e2e   to watch it
 */

import { openEditor, check, scenario, summary } from './harness.mjs'

const s = await openEditor()
const {
  page, errors, pause, click, clickTitle, clickStartsWith,
  addComponent, newNamedEntity, selectOptionByMarker, treeNames, text,
  openMenu, menuItem, menuSubItem,
} = s

await scenario('Boot', async () => {
  check('loads with no console errors', errors.length === 0,
        errors.length ? errors.slice(0, 2).join(' | ') : '')
  const body = await text()
  check('renders the default scene', body.includes('Main Scene'))
  check('renders the bottom dock', ['Files', 'Assets', 'Console', 'Animation']
        .every(t => body.includes(t)))
})

await scenario('Entities and components', async () => {
  await newNamedEntity('Crate')
  await addComponent('Mesh')
  check('mesh entity appears in the hierarchy', (await treeNames()).includes('Crate'))

  await selectOptionByMarker('TorusKnot', 'Sphere')
  const body = await text()
  check('primitive type is switchable', body.includes('Sphere'))
})

await scenario('Transform editing', async () => {
  // Exercises the Vec3-accepting setters on TransformComponent.
  const vals = [['2.5', 0], ['1.25', 1], ['-3', 2]]
  for (const [v, i] of vals) await s.fill('input[type="number"]', v, { nth: i })
  await pause(600)
  const read = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="number"]')].slice(0, 3).map(e => e.value))
  check('position writes through', JSON.stringify(read) === JSON.stringify(['2.5', '1.25', '-3']),
        read.join(','))
})

await scenario('Tool shortcuts respect text focus', async () => {
  // Regression: EditorLayer only checked Ctrl/Alt, so typing "w" in any input
  // silently switched the active gizmo tool.
  const r = await page.evaluate(async () => {
    const active = () => document.querySelector('button[title^="Translate"]')
      .className.includes('accent')
    const input = document.querySelector('input[placeholder="Search…"]')
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }))
    await new Promise(res => setTimeout(res, 300))
    const whileTyping = active()

    input.blur()
    document.body.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }))
    await new Promise(res => setTimeout(res, 300))
    return { whileTyping, whenNotTyping: active() }
  })
  check('does not switch tool while typing', r.whileTyping === false)
  check('still switches tool when not typing', r.whenNotTyping === true)
})

await scenario('Animation tracks', async () => {
  // Regression: AnimationGroup.normalize() threw on a track with no keyframes,
  // aborting the sync so the new track never reached the timeline.
  errors.length = 0
  await addComponent('Animation')
  await click('button', 'Add Clip')
  await pause(1200)
  await clickTitle('Edit in Timeline')
  await pause(1500)

  for (const prop of ['Position Y', 'Rotation Y', 'Scale X']) {
    await clickTitle('Add property track')
    await pause(600)
    await clickStartsWith('button', prop)
    await pause(1000)
  }

  const body = await text()
  check('timeline is no longer empty', !body.includes('No tracks'))
  check('all three tracks are listed',
        ['position.y', 'rotation.y', 'scaling.x'].every(l => body.includes(l)))
  check('adding tracks raises no runtime errors', errors.length === 0,
        errors.slice(0, 2).join(' | '))
})

await scenario('Menu bar', async () => {
  await openMenu('Edit')
  const disabled = await page.evaluate(() => {
    const out = {}
    for (const b of document.querySelectorAll('[data-menu-bar] button')) {
      const label = b.querySelector('span.flex-1')?.textContent.trim()
      if (label) out[label] = b.disabled
    }
    return out
  })
  check('Paste greys out with an empty clipboard', disabled.Paste === true)
  check('Project Settings stays enabled', disabled['Project Settings…'] === false)

  const before = (await treeNames()).length
  await openMenu('GameObject')
  await menuSubItem('3D Object', 'Sphere')
  check('3D Object submenu creates a primitive', (await treeNames()).includes('Sphere'))

  await openMenu('GameObject')
  await menuSubItem('Light', 'Directional')
  check('Light submenu creates a light',
        (await treeNames()).some(n => n.includes('Directional')))

  await openMenu('Edit'); await menuItem('Undo')
  await openMenu('Edit'); await menuItem('Undo')
  check('menu Undo unwinds both creations', (await treeNames()).length === before)

  await openMenu('Edit'); await menuItem('Redo')
  check('menu Redo re-applies', (await treeNames()).length > before)
})

await scenario('Menu hover behaviour', async () => {
  // Regression: document.__nebuMenuOpen was set on open but never cleared, so
  // after any menu had been used, hovering the bar re-opened the last menu.
  await page.evaluate(() => document.body.click())
  await pause(400)
  await page.locator('[data-menu-bar] button:text-is("Help")').hover()
  await pause(500)
  const opened = await page.evaluate(() =>
    document.body.innerText.includes('About Nebu2'))
  check('hovering does not open a menu on its own', opened === false)
})

await scenario('Dialogs load on demand', async () => {
  // These are defineAsyncComponent now, so a broken dynamic import would show
  // up as a dialog that simply never appears.
  errors.length = 0

  await openMenu('Edit')
  await menuItem('Project Settings…')
  await pause(1200)
  check('Project Settings dialog opens', (await text()).includes('Active Plugins')
        || (await text()).includes('Compatibility'))
  await click('button', 'Cancel')
  await pause(600)

  await openMenu('Build')
  await menuItem('Export Project…')
  await pause(1400)
  check('Export dialog opens', (await text()).includes("What's Included")
        || (await text()).includes('Export ZIP'))
  await click('button', 'Cancel')
  await pause(600)

  check('async dialogs raise no runtime errors', errors.length === 0,
        errors.slice(0, 2).join(' | '))
})

await scenario('Play mode', async () => {
  errors.length = 0
  // Play stays disabled until the scene has a Camera component.
  await openMenu('GameObject')
  await menuItem('Camera')
  await pause(800)
  check('Play is enabled once a camera exists', await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '▶ Play')
    return !!b && !b.disabled && !b.className.includes('cursor-not-allowed')
  }))
  await click('button', '▶ Play')
  await pause(2500)
  const body = await text()
  check('enters play mode', body.includes('Stop'))
  check('play mode raises no runtime errors', errors.length === 0,
        errors.slice(0, 2).join(' | '))
  await click('button', '⏹ Stop').catch(() => {})
})

const ok = summary()
await s.browser.close()
process.exit(ok ? 0 : 1)
