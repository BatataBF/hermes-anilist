#!/usr/bin/env node
/**
 * The desktop half's surface gate, driven without the app.
 *
 * The gate is what makes "install once on the host" true: the app loads this half
 * wherever it runs, and the half registers its chip, palette commands and panes
 * only while its own backend answers on the ACTIVE connection. None of that is
 * visible to a pure-helper test, so this lifts the real gate functions (plus a
 * stubbed `host`, `rest`, `store` and `ctx`) and drives the transitions a reader
 * actually performs: open on a host that has the plugin, switch to one that does
 * not, switch back, and let a slow answer from the previous host arrive late.
 *
 * The batch itself is deliberately lifted too — "the chip and three palette
 * commands" is the contract the gate hands over, so it is asserted rather than
 * assumed. What is stubbed is only the kit and the host bridge the app provides.
 *
 * Usage: node tools/test_plugin_gate.mjs
 * Exit:  0 = every assertion passed, 1 = a failure
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const lines = source.split('\n')

/** `function name(…) { … }` or `async function name(…) { … }` — closed by a column-0 brace. */
const grabFunction = (name) => {
  const start = lines.findIndex(
    (line) => line.startsWith(`function ${name}(`) || line.startsWith(`async function ${name}(`)
  )
  if (start === -1) throw new Error(`desktop/plugin.js has no top-level function ${name}`)
  const end = lines.findIndex((line, index) => index > start && line === '}')
  if (end === -1) throw new Error(`function ${name} is not closed by a column-0 brace`)

  return lines.slice(start, end + 1).join('\n')
}

/** `const NAME = …` — single line, or an object block closed by a column-0 brace. */
const grabConst = (name) => {
  const start = lines.findIndex((line) => line.startsWith(`const ${name} = `))
  if (start === -1) throw new Error(`desktop/plugin.js has no top-level const ${name}`)
  if (!lines[start].trimEnd().endsWith('{')) return lines[start]
  const end = lines.findIndex((line, index) => index > start && line === '}')
  if (end === -1) throw new Error(`const ${name} is not closed by a column-0 brace`)

  return lines.slice(start, end + 1).join('\n')
}

const CONSTS = ['DEFAULT_SETTINGS', 'TITLE_LANGUAGES', 'WINDOW_DAYS', 'ALERT_DELIVERIES', 'DIGEST_HOURS', 'SETTINGS_KEY', 'SURFACE_RETRY_MS', 'SURFACE_RETRIES_MAX']
const FUNCTIONS = [
  'normalizeSettings', 'settingsSeed', 'localSettings', 'loadSettings',
  'isMissingBackend', 'surfaceRouteKey', 'currentSurfaceRoute', 'hideSurface', 'surfaceAfterFailure', 'scheduleSurfaceRetry', 'stopSurfaceRetry',
  'syncSurface', 'refreshConnections', 'contributions'
]

// The stubs stand in for what the app hands a plugin: `rest`, `ctx.storage`, the
// host bridge, the kit. Everything below is REAL lifted code.
const HARNESS = `
let rest = null
let store = null
let t = (key) => key
const SOURCE = 'plugin:hermes-anilist'
const PALETTE_AREA = 'palette'

let surfaceDispose = null
let surfaceRoute = null
let surfaceToken = 0
let surfaceRetry = null
let surfaceRetries = 0
let hostSettings = null

const $registry = { value: {}, set(value) { this.value = value } }
const $settings = { value: null, get() { return this.value }, set(value) { this.value = value } }

const jsx = (type, props) => ({ type, props })
const NextChip = () => null
let workspaceOpens = false
const openAniListWorkspace = () => workspaceOpens
const queryClient = { invalidateQueries: async () => {} }

// Mutable so a test can walk the window between hosts.
let route = { connectionId: 'local', profile: 'default' }
const notices = []
const host = {
  state: {
    connectionId: { get: () => route.connectionId },
    profile: { get: () => route.profile }
  },
  notify: (message) => notices.push(message),
  connections: async () => []
}

// The gate's registration channel: one entry per live batch.
const batches = []
const ctx = {
  registerMany: (batch) => {
    batches.push(batch)
    return () => {
      const at = batches.indexOf(batch)
      if (at >= 0) batches.splice(at, 1)
    }
  }
}

const puts = []
const backends = {}
let holdRest = false
const held = []

const restStub = async (path, opts) => {
  const key = route.connectionId + ':' + route.profile
  const answer = () => {
    if (!(key in backends)) throw new Error('404 Not Found: no backend half on ' + key)
    if (opts && opts.method === 'PUT') {
      puts.push({ key, body: opts.body })
      backends[key] = { ...(backends[key] || {}), ...opts.body }
    }
    return { settings: backends[key] }
  }
  if (holdRest) return new Promise((resolve, reject) => held.push(() => { try { resolve(answer()) } catch (error) { reject(error) } }))
  return answer()
}

export const setRest = (fn) => { rest = fn }
export const setStore = (value) => { store = value }
export const setRoute = (next) => { route = next }
export const setBackend = (key, settings) => { backends[key] = settings }
export const setHold = (on) => { holdRest = on }
export const release = () => { const next = held.shift(); if (next) next() }
export const heldCount = () => held.length
export const getBatches = () => batches
export const getPuts = () => puts
export const getNotices = () => notices
export const getRoute = () => surfaceRoute
export const getHostSettings = () => hostSettings
export const setWorkspaceOpens = (on) => { workspaceOpens = on }
export const ctxStub = ctx
export const settings = $settings
export const registry = $registry
`

const EXPORTS = [...CONSTS, ...FUNCTIONS, 'restStub', 'PALETTE_AREA']

const moduleFile = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'anilist-gate-'))
  const file = join(dir, 'gate.mjs')
  writeFileSync(
    file,
    [
      HARNESS,
      ...CONSTS.map(grabConst),
      ...FUNCTIONS.map(grabFunction),
      `export { ${EXPORTS.join(', ')} }`
    ].join('\n\n')
  )

  return file
})()

const gate = await import(pathToFileURL(moduleFile).href)

gate.setRest(gate.restStub)

let passed = 0
let failed = 0

const test = async (name, run) => {
  try {
    await run()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  FAIL ${name}\n       ${error.message}`)
  }
}

// ─── the gate ───────────────────────────────────────────────────────────────

await test('a host without the plugin gets no surface at all', async () => {
  gate.setRoute({ connectionId: 'local', profile: 'default' })
  gate.setBackend('vps-zonda:default', {})

  await gate.syncSurface(gate.ctxStub)

  assert.equal(gate.getBatches().length, 0, 'nothing is contributed where the backend does not answer')
  assert.equal(gate.getRoute(), null)
})

await test('a host that answers grows the whole surface in one batch', async () => {
  gate.setRoute({ connectionId: 'vps-zonda', profile: 'default' })

  await gate.syncSurface(gate.ctxStub)

  assert.equal(gate.getBatches().length, 1, 'one batch, registered once')
  assert.equal(gate.getRoute(), 'vps-zonda:default')
})

await test('switching away removes it, and switching back restores it', async () => {
  gate.setRoute({ connectionId: 'local', profile: 'default' })
  await gate.syncSurface(gate.ctxStub)

  assert.equal(gate.getBatches().length, 0, 'the local backend has no plugin: no chip')

  gate.setRoute({ connectionId: 'vps-zonda', profile: 'default' })
  await gate.syncSurface(gate.ctxStub)

  assert.equal(gate.getBatches().length, 1)
  assert.equal(gate.getRoute(), 'vps-zonda:default')
})

await test('a second sync on the same host refreshes without remounting', async () => {
  const before = gate.getBatches()[0]

  await gate.syncSurface(gate.ctxStub)
  await gate.syncSurface(gate.ctxStub)

  assert.equal(gate.getBatches().length, 1, 'still exactly one batch')
  assert.equal(gate.getBatches()[0], before, 'the same batch object: a popover stays open')
})

await test('a late answer from the previous host cannot claim the surface', async () => {
  // Route A answers slowly; B answers at once. The stale A answer must not win.
  gate.setRoute({ connectionId: 'vps-zonda', profile: 'default' })
  gate.setBackend('vps-zonda:default', {})
  gate.setBackend('other-host:default', {})
  gate.setHold(true)
  const stale = gate.syncSurface(gate.ctxStub)

  gate.setRoute({ connectionId: 'other-host', profile: 'default' })
  gate.setHold(false)
  await gate.syncSurface(gate.ctxStub)

  assert.equal(gate.getRoute(), 'other-host:default')
  assert.equal(gate.heldCount(), 1, 'the first probe is still in flight')

  gate.release()
  await stale

  assert.equal(gate.getRoute(), 'other-host:default', 'the stale answer did not re-label the surface')
  assert.equal(gate.getBatches().length, 1)
})

await test('the same profile on two hosts is two surfaces', async () => {
  gate.setRoute({ connectionId: 'vps-zonda', profile: 'default' })
  await gate.syncSurface(gate.ctxStub)
  const remote = gate.getBatches()[0]

  gate.setRoute({ connectionId: 'homelab', profile: 'default' })
  gate.setBackend('homelab:default', {})
  await gate.syncSurface(gate.ctxStub)

  assert.notEqual(gate.getBatches()[0], remote, 'a different host re-registers')
  assert.equal(gate.getBatches().length, 1)
})

// ─── the preferences the host owns ──────────────────────────────────────────

await test('a device seeds a host that has nothing, exactly once', async () => {
  let removed = false

  gate.setRoute({ connectionId: 'fresh', profile: 'default' })
  gate.setBackend('fresh:default', {})
  gate.setStore({
    get: (key, fallback) => (key === gate.SETTINGS_KEY ? { windowDays: 14, titleLanguage: 'romaji' } : fallback),
    remove: () => {
      removed = true
    }
  })

  await gate.syncSurface(gate.ctxStub)

  assert.deepEqual(
    gate.getPuts().at(-1).body,
    { ...gate.DEFAULT_SETTINGS, windowDays: 14, titleLanguage: 'romaji' },
    'the legacy blob is normalized on the way out'
  )
  assert.equal(removed, true, 'the local copy is dropped: the host is the store from here on')
  assert.equal(gate.settings.get().windowDays, 14)
})

await test('a host that already holds a preference is never overwritten by leftovers', async () => {
  gate.setRoute({ connectionId: 'owned', profile: 'default' })
  gate.setBackend('owned:default', { covers: false })
  gate.setStore({ get: (key, fallback) => (key === gate.SETTINGS_KEY ? { windowDays: 14 } : fallback), remove: () => {} })
  const putsBefore = gate.getPuts().length

  await gate.syncSurface(gate.ctxStub)

  assert.equal(gate.getPuts().length, putsBefore, 'no write at all: the host answered')
  assert.equal(gate.settings.get().covers, false, 'the host value is what the pane renders')
  assert.equal(gate.settings.get().windowDays, gate.DEFAULT_SETTINGS.windowDays)
})

await test('an empty host answer still renders the defaults', async () => {
  gate.setRoute({ connectionId: 'blank', profile: 'default' })
  gate.setBackend('blank:default', {})
  gate.setStore({ get: (key, fallback) => fallback, remove: () => {} })

  await gate.syncSurface(gate.ctxStub)

  assert.deepEqual(gate.settings.get(), gate.DEFAULT_SETTINGS)
})

// ─── the batch itself ───────────────────────────────────────────────────────

await test('the batch is the chip and three palette commands', async () => {
  const batch = gate.contributions()

  assert.deepEqual(batch.map((entry) => entry.id), ['chip', 'seasons', 'settings', 'refresh'])
  assert.equal(batch[0].area, 'statusBar.right', 'the chip lives in the status bar')
  assert.equal(batch[0].order, 130)
  assert.equal(typeof batch[0].render, 'function')
  assert.deepEqual(
    batch.slice(1).map((entry) => entry.area),
    [gate.PALETTE_AREA, gate.PALETTE_AREA, gate.PALETTE_AREA]
  )
})

await test('a palette command with no workspace door points at the surface that has one', async () => {
  const [, seasons] = gate.contributions()
  gate.setWorkspaceOpens(false)
  gate.getNotices().length = 0

  seasons.data.run()

  assert.equal(gate.getNotices().length, 1)
  assert.match(gate.getNotices()[0].message, /AniList/)
})

if (failed) {
  console.error(`\n${failed} test(s) failed, ${passed} passed`)
  process.exit(1)
}

console.log(`\n${passed} test(s) passed`)
