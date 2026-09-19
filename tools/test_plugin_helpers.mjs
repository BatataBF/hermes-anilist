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

const CONSTS = ['STRINGS', 'DEFAULT_SETTINGS', 'ALERT_PREFIX', 'ALERT_RE', 'DIGEST_PREFIX', 'DIGEST_STATUSES', 'DELIVERY_NAMES', 'SYNOPSIS_CLAMP', 'CHIP_COMING_HOURS', 'TITLE_LANGUAGES', 'WINDOW_DAYS', 'ALERT_DELIVERIES', 'DIGEST_HOURS', 'SURFACE_RETRIES_MAX']
const FUNCTIONS = [
  'countdown', 'endOfToday', 'withinFilter', 'dayKey', 'dayLabel', 'groupByDay', 'rowKey', 'mergeAiring',
  'titleOf', 'routeId', 'isAniListJob', 'isAlert', 'isDigest', 'alertFor', 'alertTitle', 'alertStateLabel',
  'alertDestinationLabel', 'alertRouteLabel', 'digestIds', 'digestSchedule', 'digestJobName',
  'preferredRoute', 'runAtLabel', 'airingWhen', 'airedDate', 'synopsisStyle', 'chipIcon', 'comingAiring', 'episodeTag',
  'clockTime', 'monthHeading', 'calendarMonth', 'monthGrid', 'hasEpisodesOutside', 'nextAiring',
  'normalizeSettings', 'settingsSeed', 'surfaceRouteKey', 'surfaceAfterFailure', 'isMissingBackend'
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

// ─── the show page's calendar ───────────────────────────────────────────────

/** A local wall-clock instant, as the calendar helpers see one (unix seconds). */
const wall = (year, month, day, hour = 10, minute = 30) =>
  Math.floor(new Date(year, month, day, hour, minute).getTime() / 1000)

test('clockTime reads the reader\'s own clock, zero-padded', () => {
  assert.equal(helpers.clockTime(wall(2026, 8, 18)), '10:30')
  assert.equal(helpers.clockTime(wall(2026, 8, 18, 21, 5)), '21:05')
})

test('calendarMonth opens on the next episode, and on the last one once a show is over', () => {
  const episodes = [{ airingAt: wall(2026, 6, 3) }, { airingAt: wall(2026, 8, 18) }]

  assert.deepEqual(helpers.calendarMonth(episodes, wall(2026, 8, 17)), { year: 2026, month: 8 })
  // Everything aired: the calendar shows the schedule that exists, not an empty month.
  assert.deepEqual(helpers.calendarMonth(episodes, wall(2026, 9, 1)), { year: 2026, month: 8 })
  assert.deepEqual(helpers.calendarMonth([], wall(2026, 8, 17)), { year: 2026, month: 8 })
})

test('monthGrid is six weeks of local days, each carrying what airs on it', () => {
  const cells = helpers.monthGrid([{ episode: 12, airingAt: wall(2026, 8, 18) }], 2026, 8)

  assert.equal(cells.length, 42)
  // September 2026 opens on a Tuesday, so the grid starts on Sunday 30 August.
  assert.equal(cells[0].day, 30)
  assert.equal(cells[0].inMonth, false)
  assert.equal(cells[2].day, 1)
  assert.equal(cells[2].inMonth, true)

  const marked = cells.filter((cell) => cell.items.length)

  assert.equal(marked.length, 1)
  assert.equal(marked[0].day, 18)
  assert.equal(marked[0].key, helpers.dayKey(wall(2026, 8, 18)))
})

test('nextAiring is the first episode still to come, or nothing', () => {
  const episodes = [
    { episode: 11, airingAt: wall(2026, 8, 11) },
    { episode: 12, airingAt: wall(2026, 8, 18) }
  ]

  assert.equal(helpers.nextAiring(episodes, wall(2026, 8, 17)).episode, 12)
  assert.equal(helpers.nextAiring(episodes, wall(2026, 8, 18, 11)), null)
  assert.equal(helpers.nextAiring([], wall(2026, 8, 17)), null)
  assert.equal(helpers.nextAiring(null, wall(2026, 8, 17)), null)
})

test('the month arrows stop where the schedule does', () => {
  const episodes = [{ airingAt: wall(2026, 8, 11) }, { airingAt: wall(2026, 8, 18) }]

  assert.equal(helpers.hasEpisodesOutside(episodes, 2026, 8, -1), false)
  assert.equal(helpers.hasEpisodesOutside(episodes, 2026, 8, 1), false)
  assert.equal(helpers.hasEpisodesOutside(episodes, 2026, 7, 1), true)
  assert.equal(helpers.hasEpisodesOutside(episodes, 2026, 9, -1), true)
})

test('monthHeading spells the month out and pins the year', () => {
  assert.equal(helpers.monthHeading(2026, 8, t), 'September 2026')
  assert.equal(helpers.monthHeading(2026, 8, makeT('es')), 'septiembre 2026')
})

test('airingWhen names the weekday, the date and the hour', () => {
  assert.equal(helpers.airingWhen(wall(2026, 8, 18), t), 'Fri 18 Sep · 10:30')
  assert.equal(helpers.airingWhen(wall(2026, 8, 18), makeT('es')), 'Vie 18 sep · 10:30')
})

// ─── the synopsis beside the cover ──────────────────────────────────────────

test('a synopsis that fits is clipped and nothing more', () => {
  assert.deepEqual(helpers.synopsisStyle(false, false), {
    maxHeight: helpers.SYNOPSIS_CLAMP,
    overflow: 'hidden'
  })
})

test('a synopsis that runs past the clip fades out to say so', () => {
  const faded = helpers.synopsisStyle(false, true)

  assert.equal(faded.maxHeight, helpers.SYNOPSIS_CLAMP)
  assert.equal(faded.overflow, 'hidden')
  assert.match(faded.maskImage, /^linear-gradient\(to bottom, rgba\(0, 0, 0, 1\) 60%/)
  // The prefixed copy rides along for older Chromium in the app's Electron.
  assert.equal(faded.WebkitMaskImage, faded.maskImage)
})

test('an open synopsis is neither clipped nor faded', () => {
  assert.equal(helpers.synopsisStyle(true, true), undefined)
  assert.equal(helpers.synopsisStyle(true, false), undefined)
})

test('the chip names the episode, with the show\'s length when AniList knows it', () => {
  assert.equal(helpers.episodeTag({ episode: 12, totalEpisodes: 12 }, t), 'EP 12/12')
  assert.equal(helpers.episodeTag({ episode: 12, totalEpisodes: null }, t), 'EP 12')
  assert.equal(helpers.episodeTag({ episode: 12 }, t), 'EP 12')
  assert.equal(helpers.episodeTag({ totalEpisodes: 12 }, t), '', 'no episode, nothing to name')
  assert.equal(helpers.episodeTag(null, t), '')
})

// ─── the status-bar chip ────────────────────────────────────────────────────

test('the chip wears a broadcast mark once its episode is within the hour', () => {
  const now = wall(2026, 8, 18, 10, 0)

  assert.equal(helpers.chipIcon(now + 3600, now), 'broadcast')
  assert.equal(helpers.chipIcon(now + 3601, now), 'clock')
  assert.equal(helpers.chipIcon(now - 60, now), 'broadcast', 'already airing reads the same way')
  assert.equal(helpers.chipIcon(null, now), 'clock', 'nothing scheduled is never "on air"')
  assert.equal(helpers.chipIcon(undefined, now), 'clock')
})

test('the chip counts what is coming: only mine, only inside the horizon, in air order', () => {
  const now = wall(2026, 8, 18, 10, 0)
  const items = [
    { id: 1, airingAt: now + 600 }, // not tracked
    { id: 2, airingAt: now + 3600 }, // mine, next
    { id: 3, airingAt: now + 7200 }, // mine, right after it
    { id: 4, airingAt: now + 30 * 3600 }, // mine, tomorrow
    { id: 5, airingAt: now + 4000 } // not tracked
  ]
  const ids = new Set(['2', '3', '4'])
  const coming = helpers.comingAiring(items, ids, 24, now)

  assert.deepEqual(coming.map((item) => item.id), [2, 3], 'mine, in order, inside the horizon')
  assert.equal(coming[0].id, 2, 'and the chip names the first of them')
  assert.equal(helpers.comingAiring(items, ids, 48, now).length, 3, 'a wider horizon reaches tomorrow')
  assert.equal(helpers.comingAiring(items, new Set()).length, 0, 'nothing tracked, nothing claimed')
  assert.equal(helpers.comingAiring(items, new Set(['9']), 24, now).length, 0)
  assert.equal(helpers.comingAiring(null, ids, 24, now).length, 0)
  // The tooltip promises this number; keeping them one value is what stops drift.
  assert.equal(helpers.CHIP_COMING_HOURS, 24)
})

// ─── settings: the host owns them, a device only reads ──────────────────────

test('the settings contract matches the enums the backend validates', () => {
  // The Python side pins the same sets (tests/test_plugin_api.py); a drift has to
  // fail one of the two suites, never a reader's pane.
  assert.deepEqual(helpers.TITLE_LANGUAGES, ['english', 'romaji', 'native'])
  assert.deepEqual(helpers.WINDOW_DAYS, [3, 7, 14])
  assert.deepEqual(helpers.ALERT_DELIVERIES, ['local', 'telegram', 'discord'])
  assert.deepEqual(helpers.DIGEST_HOURS, [8, 9, 12, 20])
})

test('a host that has stored nothing means the defaults, not a broken shape', () => {
  assert.deepEqual(helpers.normalizeSettings({}), helpers.DEFAULT_SETTINGS)
  assert.deepEqual(helpers.normalizeSettings(null), helpers.DEFAULT_SETTINGS)
  assert.deepEqual(helpers.normalizeSettings('nonsense'), helpers.DEFAULT_SETTINGS)
})

test('a preference outside the contract falls back instead of rendering', () => {
  const stored = helpers.normalizeSettings({
    windowDays: 5,
    titleLanguage: 'spanish',
    covers: 'no',
    digestHour: '9',
    alertDelivery: 'carrier-pigeon',
    defaultFilter: 'year'
  })

  assert.equal(stored.windowDays, helpers.DEFAULT_SETTINGS.windowDays)
  assert.equal(stored.titleLanguage, helpers.DEFAULT_SETTINGS.titleLanguage)
  assert.equal(stored.digestHour, helpers.DEFAULT_SETTINGS.digestHour)
  assert.equal(stored.alertDelivery, helpers.DEFAULT_SETTINGS.alertDelivery)
  assert.equal(stored.defaultFilter, helpers.DEFAULT_SETTINGS.defaultFilter)
  // Only an explicit false turns covers off: a string must not read as "off".
  assert.equal(stored.covers, true)
})

test('the seed only fires against a host with nothing stored', () => {
  const local = { windowDays: 14, titleLanguage: 'romaji' }

  assert.deepEqual(helpers.settingsSeed({}, local), helpers.normalizeSettings(local))
  assert.equal(helpers.settingsSeed(null, local).windowDays, 14)
  // A host holding ANY preference owns them: a second device opening the pane
  // must not overwrite the first reader's choices with its own leftovers.
  assert.equal(helpers.settingsSeed({ covers: false }, local), null)
  assert.equal(helpers.settingsSeed({ windowDays: 3 }, local), null)
  // Nothing local to migrate, or nothing usable.
  assert.equal(helpers.settingsSeed({}, null), null)
  assert.equal(helpers.settingsSeed({}, 'not an object'), null)
})

test('a registration batch is named by its host and profile', () => {
  assert.equal(helpers.surfaceRouteKey('vps-zonda', 'default'), 'vps-zonda:default')
  assert.equal(helpers.surfaceRouteKey(null, null), 'local:default', 'no connection means this machine')
  assert.equal(helpers.surfaceRouteKey('vps-zonda', ''), 'vps-zonda:default')
  assert.notEqual(
    helpers.surfaceRouteKey('vps-zonda', 'default'),
    helpers.surfaceRouteKey('local', 'default'),
    'the same profile on two hosts is two surfaces'
  )
})

test('a failed probe tells a host without the plugin from a host that is merely down', () => {
  const missing = new Error('404 Not Found')
  const unreachable = new Error('fetch failed')

  // The plugin is not installed there: the surface goes away at once.
  assert.equal(helpers.surfaceAfterFailure(missing, 'vps-zonda:default', 'vps-zonda:default'), 'hide')
  // The reader left that host: whatever the answer says, it is not about this one.
  assert.equal(helpers.surfaceAfterFailure(missing, 'vps-zonda:default', 'local:default'), 'hide')
  assert.equal(helpers.surfaceAfterFailure(unreachable, 'vps-zonda:default', 'local:default'), 'hide')
  // Same host, transient: keep what is on screen and give the host one more try.
  assert.equal(helpers.surfaceAfterFailure(unreachable, 'vps-zonda:default', 'vps-zonda:default'), 'retry')
  // The ladder stays bounded — a host that is down is not polled forever.
  assert.ok(helpers.SURFACE_RETRIES_MAX >= 1 && helpers.SURFACE_RETRIES_MAX <= 5)
})

if (failed) {
  console.error(`\n${failed} test(s) failed, ${passed} passed`)
  process.exit(1)
}

console.log(`\n${passed} test(s) passed`)
