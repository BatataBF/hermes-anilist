#!/usr/bin/env node
/**
 * The desktop half's pure helpers, exercised without the app.
 *
 * desktop/plugin.js is one uncompiled ESM file whose top half is pure functions —
 * and those are where the interesting decisions live: which filter keeps what,
 * which job counts as an alert, which destination a new job opens on.
 * `node --check` proves syntax; this proves behaviour.
 *
 * The file cannot be imported (React and the app's host exist only inside
 * Electron), so each part is lifted BY NAME out of the source into a temp module.
 * That keeps the single-file contract the app loads while giving the helpers a
 * real test surface — the same recipe the plugin-development skill uses.
 *
 * Usage: node tools/test_plugin_helpers.mjs
 * Exit:  0 = every assertion passed, 1 = a failure (name printed with the diff)
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const lines = source.split('\n')

/** `function name(…) { … }` — top level, closed by a column-0 brace. */
const grabFunction = (name) => {
  const start = lines.findIndex((line) => line.startsWith(`function ${name}(`))
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

const CONSTS = ['STRINGS', 'DEFAULT_SETTINGS', 'ALERT_PREFIX', 'ALERT_RE', 'DIGEST_PREFIX', 'DIGEST_STATUSES', 'DELIVERY_NAMES']
const FUNCTIONS = [
  'countdown', 'endOfToday', 'withinFilter', 'dayKey', 'dayLabel', 'groupByDay', 'rowKey', 'mergeAiring',
  'titleOf', 'routeId', 'isAlert', 'isDigest', 'alertFor', 'alertTitle', 'alertStateLabel',
  'alertDestinationLabel', 'alertRouteLabel', 'digestIds', 'digestSchedule', 'digestJobName',
  'preferredRoute', 'runAtLabel'
]

const helpers = await import(
  pathToFileURL(
    (() => {
      const dir = mkdtempSync(join(tmpdir(), 'anilist-helpers-'))
      const file = join(dir, 'helpers.mjs')
      writeFileSync(
        file,
        [...CONSTS.map(grabConst), ...FUNCTIONS.map(grabFunction), `export { ${[...CONSTS, ...FUNCTIONS].join(', ')} }`].join('\n\n')
      )

      return file
    })()
  ).href
)

/** The plugin's own i18n semantics: strings and functions resolve, anything else falls back to the key. */
const makeT = (locale = 'en') => (key, ...args) => {
  const value = helpers.STRINGS[locale][key]
  if (typeof value === 'function') return value(...args)
  if (typeof value === 'string') return value

  return key
}

const t = makeT()
let passed = 0
let failed = 0

const test = (name, run) => {
  try {
    run()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  FAIL ${name}\n       ${error.message}`)
  }
}

/** Noon of the reader's own day: a stable anchor whatever hour the suite runs at. */
const noonToday = () => {
  const at = new Date()
  at.setHours(12, 0, 0, 0)

  return Math.floor(at.getTime() / 1000)
}

// A feed timestamp is whole seconds and the countdown truncates to the minute, so
// the sample has to round UP: flooring a "2d 3h" target can land one minute short.
const cursor = (offsetMs) => Math.ceil((Date.now() + offsetMs) / 1000)
const row = (id, episode, airingAt) => ({ id, episode, airingAt, title: `Show ${id}` })

// ─── pure helpers ───────────────────────────────────────────────────────────

test('countdown buckets days, hours, minutes, and calls the past "airing now"', () => {
  assert.equal(helpers.countdown(cursor(2 * 86400000 + 3 * 3600000), t), 'in 2d 3h')
  assert.equal(helpers.countdown(cursor(5 * 3600000 + 30 * 60000), t), 'in 5h 30m')
  assert.equal(helpers.countdown(cursor(40 * 60000), t), 'in 40m')
  assert.equal(helpers.countdown(cursor(-60000), t), 'airing now')
})

test('groupByDay splits the ordered feed at local day boundaries without reordering', () => {
  const noon = noonToday()
  const groups = helpers.groupByDay([row(1, 1, noon), row(2, 2, noon + 60), row(3, 3, noon + 86400)])

  assert.deepEqual(groups.map((group) => group.items.length), [2, 1])
  assert.equal(helpers.dayLabel(groups[0].items[0].airingAt, t), 'Today')
  assert.equal(helpers.dayLabel(groups[1].items[0].airingAt, t), 'Tomorrow')
})

test('withinFilter: "today" cuts at the end of the local day, "list" narrows to tracked ids', () => {
  const noon = noonToday()
  const items = [row(1, 1, noon), row(2, 2, noon + 86400)]

  assert.equal(helpers.withinFilter(items, 'week', new Set()).length, 2)
  assert.deepEqual(helpers.withinFilter(items, 'today', new Set()).map((item) => item.id), [1])
  assert.deepEqual(helpers.withinFilter(items, 'list', new Set(['2'])).map((item) => item.id), [2])
})

test('mergeAiring dedupes by show+episode, the head wins, and the result is time-ordered', () => {
  const merged = helpers.mergeAiring([row(1, 1, 100), row(1, 2, 300)], [row(1, 1, 100), row(2, 1, 200)])

  assert.deepEqual(merged.map((item) => `${item.id}:${item.episode}`), ['1:1', '2:1', '1:2'])
})

test('titleOf falls through the chosen language to whichever title AniList has', () => {
  const show = { titles: { english: '', romaji: 'Sousou no Frieren', native: '葬送のフリーレン' }, title: 'ignored' }

  assert.equal(helpers.titleOf(show, 'english'), 'Sousou no Frieren')
  assert.equal(helpers.titleOf(show, 'native'), '葬送のフリーレン')
  assert.equal(helpers.titleOf({}, 'english'), 'Untitled')
})

test('preferredRoute: remembered, then the host that already has jobs, then the first', () => {
  const local = { connectionId: null, profile: 'default', mode: 'local' }
  const zonda = { connectionId: 'vps-zonda', profile: 'default', mode: 'remote' }
  const routes = [local, zonda]

  assert.equal(helpers.routeId(helpers.preferredRoute(routes, 'vps-zonda:default', null)), 'vps-zonda:default')
  assert.equal(helpers.routeId(helpers.preferredRoute(routes, null, 'local:default')), 'local:default')
  assert.equal(helpers.routeId(helpers.preferredRoute(routes, 'gone:default', 'also:gone')), 'local:default')
  assert.equal(helpers.preferredRoute([], 'x', 'y'), null)
})

test('digestIds keeps only what can still air and drops junk ids', () => {
  const entries = [
    { id: 1, status: 'watching' },
    { id: 2, status: 'completed' },
    { id: 3, status: 'dropped' },
    { id: 4, status: 'planned' },
    { id: 'x', status: 'watching' },
    { id: 5 }
  ]

  assert.deepEqual(helpers.digestIds(entries), [1, 4, 5])
})

test('digestSchedule is a cron expression — the one form the app reads back as written', () => {
  assert.equal(helpers.digestSchedule(9), '0 9 * * *')
  assert.equal(helpers.digestJobName(t, 9), '[anilist:digest] Daily digest — 09:00')
})

test('runAtLabel says "Today HH:MM" for a job that fires today', () => {
  const soon = new Date(Date.now() + 30 * 60000)
  const label = helpers.runAtLabel(soon.toISOString(), t)
  const time = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`

  // Near midnight the +30min sample can roll into tomorrow, where the label is a
  // date instead — the clock half is what must hold either way.
  if (soon.toDateString() === new Date().toDateString()) {
    assert.equal(label.startsWith('Today '), true)
  }
  assert.equal(label.endsWith(time), true)
})

// ─── what the alerts pane owns ──────────────────────────────────────────────

test('an episode alert is an alert; the daily digest is not', () => {
  const alert = { name: '[anilist:801:e12] Frieren — EP 12' }
  const digest = { name: '[anilist:digest] Daily digest — 09:00' }

  assert.equal(helpers.isAlert(alert), true)
  assert.equal(helpers.isDigest(alert), false)
  assert.equal(helpers.isDigest(digest), true)
  assert.equal(helpers.isAlert(digest), false)
})

test('alertFor finds the armed episode and answers null for the digest', () => {
  const route = { connectionId: 'vps-zonda', profile: 'default', mode: 'remote' }
  const alert = { name: '[anilist:801:e12] Frieren — EP 12' }
  const digest = { name: '[anilist:digest] Daily digest — 09:00' }

  assert.equal(helpers.alertFor({ items: [{ job: alert, route }] }, 801, 12).job.name, alert.name)
  assert.equal(helpers.alertFor({ items: [{ job: digest, route }] }, 801, 12), null)
  assert.equal(helpers.alertFor({ items: [{ job: alert, route }] }, 801, 11), null)
})

test('alertTitle drops the [anilist:…] tag a human does not need', () => {
  assert.equal(helpers.alertTitle({ name: '[anilist:801:e12] Frieren — EP 12' }), 'Frieren — EP 12')
  assert.equal(helpers.alertTitle({ name: '[anilist:digest] Daily digest — 09:00' }), 'Daily digest — 09:00')
})

test('alertStateLabel names a failed run and a blocked one, and stays quiet otherwise', () => {
  assert.equal(helpers.alertStateLabel({ last_status: 'error' }, t), 'last run failed')
  assert.equal(helpers.alertStateLabel({ last_status: 'blocked_config' }, t), 'blocked by host config')
  assert.equal(helpers.alertStateLabel({ last_status: 'ok' }, t), '')
})

test('a destination reads as its label, and a non-default profile is named', () => {
  assert.equal(helpers.alertDestinationLabel({ mode: 'local', profile: 'default' }, t), 'This device')
  assert.equal(helpers.alertDestinationLabel({ mode: 'remote', label: 'VPS Zonda', targetProfile: 'trabajo' }, t), 'VPS Zonda · trabajo')
  assert.equal(helpers.alertRouteLabel({ mode: 'remote', label: 'VPS Zonda', targetProfile: 'default' }, { deliver: 'telegram:1' }, t), 'VPS Zonda · Telegram')
})

if (failed) {
  console.error(`\n${failed} test(s) failed, ${passed} passed`)
  process.exit(1)
}

console.log(`\n${passed} test(s) passed`)
