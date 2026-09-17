#!/usr/bin/env node
/**
 * Every className the plugin writes must exist in the app's compiled stylesheet.
 *
 * The desktop half is one uncompiled file: Tailwind resolves those class names
 * inside the app's build, so a class the build never emitted renders as nothing —
 * silently. It is invisible in review, invisible to `node --check`, and invisible
 * in the running UI until someone looks at the right pixel. The built stylesheet
 * is the only place that knows, and it is the same stylesheet the app in front of
 * you is using.
 *
 * Checked: every `className:` string, template literal (its static text AND the
 * quoted strings inside `${…}` branches). Not checked: class names assembled at
 * runtime from variables — there are none today, and a build cannot have emitted
 * what it never saw anyway.
 *
 * Usage: node tools/class_audit.mjs [path/to/index-*.css]
 *        Default: the newest apps/desktop/dist/assets/index-*.css under the
 *        installed runtime ($HERMES_HOME/hermes-agent, ~/.hermes by default).
 * Exit:  0 = every class exists, 1 = at least one is missing (printed with uses)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PLUGIN = new URL('../desktop/plugin.js', import.meta.url)

/** Tailwind escapes every character that is special in a CSS selector. */
const escapeClass = (name) => {
  let escaped = name

  for (const character of "()[]{}.:/%#,>+*~='\"! ") escaped = escaped.replaceAll(character, `\\${character}`)

  return escaped
}

const findStylesheet = () => {
  if (process.argv[2]) return process.argv[2]

  const home = process.env.HERMES_HOME || join(homedir(), '.hermes')
  const assets = join(home, 'hermes-agent', 'apps', 'desktop', 'dist', 'assets')

  let names = []
  try {
    names = readdirSync(assets).filter((name) => /^index-.*\.css$/.test(name))
  } catch {
    return null
  }

  return (
    names
      .map((name) => join(assets, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null
  )
}

const stylesheet = findStylesheet()

if (!stylesheet) {
  console.error(
    'no compiled stylesheet found — pass it explicitly:\n' +
      '  node tools/class_audit.mjs ~/.hermes/hermes-agent/apps/desktop/dist/assets/index-*.css'
  )
  process.exit(1)
}

const css = readFileSync(stylesheet, 'utf8')
const source = readFileSync(PLUGIN, 'utf8')

/** Every class name the file writes, with how many times it appears. */
const collected = new Map()
const add = (snippet) => {
  for (const token of snippet.split(/\s+/)) {
    if (!token || token.includes('${')) continue
    collected.set(token, (collected.get(token) || 0) + 1)
  }
}

const literals = [
  // className: '…' | "…" | `…`
  ...source.matchAll(/className:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g),
  // className={'…'} and friends
  ...source.matchAll(/className=\{\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)\s*\}/g)
]

for (const match of literals) {
  const text = match.slice(1).find((part) => part !== undefined) || ''

  add(text.replace(/\$\{[^}]*\}/g, ' ')) // the static text
  // …and the strings inside each `${…}` branch, which contribute classes too.
  for (const branch of text.matchAll(/\$\{([^}]*)\}/g)) {
    for (const quoted of branch[1].matchAll(/'([^']*)'|"([^"]*)"/g)) {
      add(quoted[1] || quoted[2] || '')
    }
  }
}

const missing = [...collected.entries()]
  .filter(([name]) => !css.includes(`.${escapeClass(name)}`))
  .sort((a, b) => b[1] - a[1])

console.log(`${stylesheet.split('/').pop()}: ${collected.size} class(es) checked`)

if (missing.length) {
  console.error(`\n${missing.length} class(es) the app's build never emitted:`)
  for (const [name, uses] of missing) console.error(`   ${name}  (used ${uses}×)`)
  process.exit(1)
}

console.log('every class the plugin writes exists in the app\'s stylesheet ✅')
