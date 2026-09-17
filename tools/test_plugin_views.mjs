#!/usr/bin/env node
/**
 * The desktop half's view components, rendered without the app.
 *
 * `tools/test_plugin_helpers.mjs` covers the pure helpers; this covers what sits
 * on top of them. The failure mode it exists for is the one nobody sees in
 * review: the app loads `desktop/plugin.js` uncompiled, so a component that
 * throws while rendering shows up as "plugin-workspace:… failed to render" and
 * nothing else. A render here proves the tree actually builds — and it lets the
 * markup be asserted (the calendar's marked day, the table's columns, which row
 * is highlighted) instead of eyeballed.
 *
 * The plugin's kit (`Button`, `Select`, `Tip`, …) comes from the app at runtime,
 * so it is stubbed: the point is the plugin's own composition, not the kit's
 * implementation. Time is fixed, so a "next episode" is the same episode on
 * every run.
 *
 * React is not a dependency of this repo (the plugin has no build step), so the
 * modules are located in this order:
 *   1. $ANILIST_REACT_MODULES
 *   2. <hermes home>/hermes-agent/apps/desktop/node_modules
 *   3. $TMPDIR/anilist-render/node_modules
 * None found → SKIPPED (exit 0) with the command to install them:
 *   mkdir -p /tmp/anilist-render && cd /tmp/anilist-render && npm i react@18 react-dom@18
 *
 * Usage: node tools/test_plugin_views.mjs
 * Exit:  0 = every assertion passed (or React was missing), 1 = a failure
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

const moduleDirs = [
  process.env.ANILIST_REACT_MODULES,
  join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'hermes-agent', 'apps', 'desktop', 'node_modules'),
  join(tmpdir(), 'anilist-render', 'node_modules')
].filter(Boolean)

const modules = moduleDirs.find((dir) => existsSync(join(dir, 'react', 'package.json')))

if (!modules) {
  console.log(
    'SKIPPED: no React found.\n' +
      '  mkdir -p /tmp/anilist-render && cd /tmp/anilist-render && npm i react@18 react-dom@18\n' +
      '  ANILIST_REACT_MODULES=/tmp/anilist-render/node_modules node tools/test_plugin_views.mjs'
  )
  process.exit(0)
}

const React = require(join(modules, 'react'))
const jsxRuntime = require(join(modules, 'react/jsx-runtime'))
const { renderToStaticMarkup } = require(join(modules, 'react-dom/server'))

// ─── the plugin, lifted by name ─────────────────────────────────────────────

const source = readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
const lines = source.split('\n')

const grabFunction = (name) => {
  const start = lines.findIndex((line) => line.startsWith(`function ${name}(`))
  if (start === -1) throw new Error(`desktop/plugin.js has no top-level function ${name}`)
  const end = lines.findIndex((line, index) => index > start && line === '}')
  if (end === -1) throw new Error(`function ${name} is not closed by a column-0 brace`)

  return lines.slice(start, end + 1).join('\n')
}

const grabConst = (name) => {
  const start = lines.findIndex((line) => line.startsWith(`const ${name} = `))
  if (start === -1) throw new Error(`desktop/plugin.js has no top-level const ${name}`)
  if (!lines[start].trimEnd().endsWith('{')) return lines[start]
  const end = lines.findIndex((line, index) => index > start && line === '}')
  if (end === -1) throw new Error(`const ${name} is not closed by a column-0 brace`)

  return lines.slice(start, end + 1).join('\n')
}

const FUNCTIONS = [
  'countdown', 'dayKey', 'dayLabel', 'airedDate', 'clockTime', 'episodeWhen', 'monthHeading',
  'nextAiring', 'calendarMonth', 'monthGrid', 'hasEpisodesOutside', 'airingWhen', 'synopsisStyle',
  'Synopsis', 'DayCell', 'EpisodeCalendar', 'EpisodeTable', 'StatusSelect'
]
const CONSTS = ['STRINGS', 'SYNOPSIS_CLAMP']

/** The kit, stubbed: every component keeps its children so the tree is assertable. */
const STUBS = `
const { jsx, jsxs } = globalThis.__anilist__
const { useState, useEffect, useRef } = globalThis.__anilistReact__

const element = (name) => (props = {}) => {
  const { children, ...rest } = props
  const passthrough = {}

  for (const key of ['className', 'title']) if (rest[key] !== undefined) passthrough[key] = rest[key]
  if (rest.disabled) passthrough['data-disabled'] = 'true'

  return jsx('div', { 'data-kit': name, ...passthrough, children })
}

const Button = element('Button')
const Tip = ({ children }) => children
const Select = ({ children }) => jsx('div', { children })
const SelectTrigger = ({ children }) => jsx('div', { children })
const SelectValue = () => jsx('span', { 'data-kit': 'SelectValue' })
const SelectContent = ({ children }) => jsx('div', { children })
const SelectItem = ({ children }) => jsx('div', { children })
const DisclosureCaret = ({ open }) => jsx('span', { 'data-kit': 'caret', children: open ? 'v' : '>' })
const haptic = () => {}
`

const moduleSource = [
  ...CONSTS.map(grabConst),
  STUBS,
  ...FUNCTIONS.map(grabFunction),
  `export { ${[...CONSTS, ...FUNCTIONS].join(', ')} }`
].join('\n\n')

const dir = mkdtempSync(join(tmpdir(), 'anilist-views-'))
const file = join(dir, 'views.mjs')

writeFileSync(file, moduleSource)
globalThis.__anilist__ = jsxRuntime
globalThis.__anilistReact__ = React

const views = await import(pathToFileURL(file).href)

/** The plugin's own i18n semantics, resolved against its English bundle. */
const t = (key, ...args) => {
  const value = views.STRINGS.en[key]

  if (typeof value === 'function') return value(...args)

  return typeof value === 'string' ? value : key
}

// ─── the fixtures ───────────────────────────────────────────────────────────

// Fixed clock: Thursday 17 September 2026, 18:07 local. The show airs Fridays.
const NOW = { year: 2026, month: 8, day: 17, hour: 18, minute: 7 }
const wall = (year, month, day, hour = 10, minute = 30) =>
  Math.floor(new Date(year, month, day, hour, minute).getTime() / 1000)

const EPISODES = [
  { episode: 10, airingAt: wall(2026, 8, 4) },
  { episode: 11, airingAt: wall(2026, 8, 11) },
  { episode: 12, airingAt: wall(2026, 8, 18) }
]

const render = (component, props) => renderToStaticMarkup(jsxRuntime.jsx(component, { t, ...props }))

let passed = 0
let failed = 0

const test = (name, body) => {
  try {
    body()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  FAIL ${name}\n       ${error.message.split('\n')[0]}`)
  }
}

// The components read the wall clock; pin it so "next" is stable.
const realNow = Date.now
const PINNED = new Date(NOW.year, NOW.month, NOW.day, NOW.hour, NOW.minute).getTime()

Date.now = () => PINNED

console.log(`rendering the show page's views (clock pinned to ${new Date(PINNED).toString().slice(0, 24)})`)

test('the calendar renders six weeks, marks the airing days and fills the next one', () => {
  const html = render(views.EpisodeCalendar, { episodes: EPISODES })

  assert.match(html, /September 2026/, 'the month heading')
  for (const weekday of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    assert.match(html, new RegExp(`>${weekday}<`), `the ${weekday} column head`)
  }
  // Every day is a cell; the ones that carry an episode are the clickable ones.
  assert.equal((html.match(/justify-center rounded-sm py-1/g) || []).length, 42, 'six weeks of days')
  assert.equal((html.match(/<button/g) || []).length, 3, 'the three airing days are the buttons')
  assert.match(html, /EP 12/, 'the next episode names itself on its day')
  assert.match(html, /bg-\(--chrome-action-hover\)/, 'and it carries the filled day skin')
  assert.match(html, /1 to air/, 'only the next episode is still to come')
})

test('the calendar lists what airs on the day it picked (the next one)', () => {
  const html = render(views.EpisodeCalendar, { episodes: EPISODES })

  assert.match(html, /EP 12/, 'the picked day names its episode')
  assert.match(html, /10:30/, 'with the local hour')
})

test('the arrows stop where the schedule does', () => {
  const html = render(views.EpisodeCalendar, { episodes: EPISODES })
  const arrows = [...html.matchAll(/data-kit="Button"([^>]*)>/g)].map((match) => match[1])

  assert.equal(arrows.length, 3, 'previous, today, next')
  assert.match(arrows[0], /data-disabled/, 'nothing airs before the first month')
  assert.match(arrows[2], /data-disabled/, 'nothing airs after the last one')
})

test('a finished show still shows its last month, with the last episode picked', () => {
  const html = render(views.EpisodeCalendar, { episodes: [EPISODES[0], EPISODES[1]] })

  assert.match(html, /September 2026/, 'the month that holds the schedule')
  assert.match(html, /EP 11/, 'the last episode is the one on show')
  assert.equal(html.includes('to air'), false, 'and nothing claims to still be coming')
})

test('the table is the columns the old list hid, one row per episode', () => {
  const html = render(views.EpisodeTable, {
    episodes: EPISODES,
    hasMore: true,
    loading: false,
    next: EPISODES[2],
    onLoadMore: () => {}
  })

  for (const head of ['EP', 'Day', 'Date', 'Time']) assert.match(html, new RegExp(`>${head}<`), `the ${head} column`)
  const rows = [...html.matchAll(/grid gap-2 py-0\.5([^"]*)"/g)].map((match) => match[1])

  assert.equal(rows.length, 3, 'one row per episode')
  assert.match(rows[0], /opacity-60/, 'EP 10 already aired, so it recedes')
  assert.match(rows[1], /opacity-60/, 'EP 11 too')
  assert.match(rows[2], /font-semibold/, 'EP 12 is the next one')
  assert.match(html, /Fri/, 'the weekday column is filled')
  assert.match(html, /18 Sep/, 'the date column is filled')
  assert.match(html, /10:30/, 'the time column is filled')
  assert.match(html, /Show more/, 'and the paging button is still there')
})

test('the table stops offering more when there is none', () => {
  const html = render(views.EpisodeTable, {
    episodes: EPISODES,
    hasMore: false,
    loading: false,
    next: null,
    onLoadMore: () => {}
  })

  assert.equal(html.includes('Show more'), false)
})

test('the synopsis sits clipped beside the cover, under its own label', () => {
  const html = render(views.Synopsis, {
    text: 'Luck, an S-rank mage in the hero’s party, makes a last stand against the Demon King.'
  })

  assert.match(html, /Synopsis/, 'the label names the prose')
  assert.match(html, /max-height:6\.5rem/, 'clipped to the height of the art beside it')
  assert.match(html, /overflow:hidden/)
  assert.match(html, /S-rank/, 'the text itself is rendered, not folded away')
  // The toggle is measured in the app (scrollHeight vs clientHeight); headless
  // there is no layout to measure, so it must not appear on a guess.
  assert.equal(html.includes('Read more'), false, 'no toggle without a measurement to prove it overflows')
})

test('a show with no description says so instead of leaving the gap empty', () => {
  const html = render(views.Synopsis, { text: '' })

  assert.match(html, /AniList has no description/)
  assert.equal(html.includes('Synopsis'), false, 'and claims no section')
})

test('the status select offers AniList\'s vocabulary and shows the current value', () => {
  const html = render(views.StatusSelect, {
    onChange: () => {},
    options: ['watching', 'rewatching', 'paused', 'planned', 'completed', 'dropped'],
    value: 'planned'
  })

  assert.match(html, /Status/, 'the label names the control')
  assert.match(html, /Planned/, 'the chosen status is spelled out')
  assert.match(html, /Dropped/, 'the whole vocabulary is in the list')
  assert.equal(html.includes('data-kit="SelectValue"'), true)
})

Date.now = realNow

if (failed) {
  console.error(`\n${failed} test(s) failed, ${passed} passed`)
  process.exit(1)
}

console.log(`\n${passed} test(s) passed`)
