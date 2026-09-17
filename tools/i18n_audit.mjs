#!/usr/bin/env node
/**
 * Locale parity for a desktop plugin half.
 *
 * A plugin's i18n values are `string | ((...args) => string)`, and a key that is used but never
 * defined resolves to its own name — the pane renders `alertFailed` instead of a sentence. A key
 * defined but never used is dead weight that hides a rename. Neither shows up in `node --check`.
 *
 * Assumes the shape this plugin family uses: one top-level `const STRINGS = { … }` whose locale
 * entries are two-space (`  en: {`) and whose keys are four-space (`    key: …`). The scan is
 * bounded to that literal on purpose: slicing the LAST locale to end-of-file would sweep up
 * every four-space `key:` in the code below it (`queryKey:`, `className:`…) and report them as
 * locale skew.
 *
 * Usage:  node tools/i18n_audit.mjs [desktop/plugin.js]
 * Exit:   0 = in sync, 1 = missing or skewed keys, 2 = no STRINGS/locale blocks found
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2] || 'desktop/plugin.js'
const source = readFileSync(file, 'utf8')

const used = new Set([...source.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)].map((match) => match[1]))

const lines = source.split('\n')
const stringsStart = lines.findIndex((line) => line === 'const STRINGS = {')
if (stringsStart === -1) {
  console.error(`${file}: no top-level "const STRINGS = {" found`)
  process.exit(2)
}
const stringsEnd = lines.findIndex((line, index) => index > stringsStart && line === '}')
const strings = lines.slice(stringsStart, stringsEnd + 1).join('\n')

const blocks = [...strings.matchAll(/^ {2}([a-zA-Z-]+): \{$/gm)]
if (blocks.length === 0) {
  console.error(`${file}: no locale blocks found (expected top-level "  en: {" entries)`)
  process.exit(2)
}

const locales = blocks.map((block, index) => {
  const end = index + 1 < blocks.length ? blocks[index + 1].index : strings.length
  const body = strings.slice(block.index, end)

  return {
    name: block[1],
    keys: new Set([...body.matchAll(/^ {4}([A-Za-z0-9_]+):/gm)].map((match) => match[1]))
  }
})

let failed = false
for (const locale of locales) {
  const missing = [...used].filter((key) => !locale.keys.has(key))
  const unused = [...locale.keys].filter((key) => !used.has(key))
  const skewed = [
    ...new Set(
      locales.flatMap((other) => (other === locale ? [] : [...other.keys].filter((key) => !locale.keys.has(key))))
    )
  ]

  console.log(`${locale.name}: ${locale.keys.size} defined | ${used.size} used`)
  console.log(`  used but undefined: ${missing.join(', ') || '—'}`)
  console.log(`  defined but unused: ${unused.join(', ') || '—'}`)
  console.log(`  present in another locale only: ${skewed.join(', ') || '—'}`)

  // A key reached only from a conditional path can read as unused: read before deleting.
  if (missing.length || skewed.length) failed = true
}

process.exit(failed ? 1 : 0)
