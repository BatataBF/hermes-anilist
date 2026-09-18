# Contributing

Thanks for improving hermes-anilist. This repo is small on purpose, and most of what a change has to
respect is written down here or in the README's *How it works* section.

## The loop

```bash
git clone https://github.com/BatataBF/hermes-anilist.git && cd hermes-anilist
uv run --with pytest --with httpx --with fastapi --quiet pytest tests/ -q   # offline: no network
node tools/test_plugin_helpers.mjs
python3 tools/lint_plugin_js.py desktop/plugin.js
hermes plugins validate "$(pwd)"            # the same gate the plugin catalog CI runs
hermes plugins update hermes-anilist        # materialize an edit in the installed copy
```

Desktop-half edits hot-reload: save `desktop/plugin.js` and the app picks it up. Backend and `tools.py`
edits need the backend restarted — tools and routes register at startup, so a running session keeps the
old code until then.

## Safety invariants

Keep these unless a change documents and tests a different security model:

- **The renderer never holds a credential.** A token only ever travels *to* the backend; every answer
  back carries public data and a `connected` flag. Never add a route that returns the token, the client
  id, or a prefix of either.
- **One HTTP client, one cache.** The agent tools and the dashboard routes read through the same
  functions in `dashboard/plugin_api.py` — a second client would spend the 30 req/min budget twice.
- **Every read says which store answered** (`store: anilist | local`), and `null` is never turned into
  `0`: an absent score, year or season stays absent rather than guessed.
- **Writes are absolute, never deltas** (`episode_watched: 12` means "at least 12"), and a destructive
  action is confirmed in the UI before it runs.
- **Declared capabilities match reality.** Adding a tool means adding it to `provides_tools` in
  `plugin.yaml` in the same change; `hermes plugins validate` fails when the two disagree.
- **Tool handlers accept `**kw`.** The dispatcher forwards `task_id` and `session_id` to every call; a
  handler that declares only its arguments dies with a `TypeError` before it reads anything.
- **The desktop half uses the host's kit** (`Button`, `Select`, `ScrollArea`, `ContextMenu*`, `Codicon`,
  …) and only classes the app's compiled stylesheet actually emits — run `tools/class_audit.mjs`.
- **English in the repo, translations through `STRINGS.es`.** Labels, comments, commits, changelog
  entries. `tools/i18n_audit.mjs desktop/plugin.js` keeps the two locales in step.
- **No credential in a cron job.** Alerts carry a prompt and ids; the job asks AniList itself.

## Test placement

Mirror what is under test, not the file layout:

| File | Owns |
|---|---|
| `tests/test_plugin_api.py` | the routes: payload normalization, caching, the store decision |
| `tests/test_agent_reads.py` | the reads the tools and the routes share, against trimmed real payloads |
| `tests/test_agent_tools.py` | registration, the dispatcher contract, the shape a handler returns |
| `tools/test_plugin_helpers.mjs` | the desktop half's pure helpers (no app, no React) |
| `tools/test_plugin_views.mjs` | the show page's views rendered headless (needs React — see its header) |

## Pull request checklist

- [ ] `uv run --with pytest --with httpx --with fastapi --quiet pytest tests/ -q` — passes.
- [ ] `uvx ruff check .` — passes (config in `ruff.toml`; it checks for bugs, not for taste).
- [ ] `node tools/test_plugin_helpers.mjs` and `node tools/i18n_audit.mjs desktop/plugin.js` — pass.
- [ ] `python3 tools/lint_plugin_js.py desktop/plugin.js` — every identifier is declared.
- [ ] `node tools/class_audit.mjs` — every class exists in the installed app's stylesheet.
- [ ] `hermes plugins validate "$(pwd)"` — validates, with no declared-vs-registered warning.
- [ ] Backend behaviour changed → the test came first (it failed, then it passed), one commit per task.
- [ ] User-facing change → `CHANGELOG.md` under `## [Unreleased]`, and the README if a capability moved.

## Commits and releases

One commit per task, imperative subject, the *why* in the body. Releases are deliberate: the `version`
in `plugin.yaml`, a `## [x.y.z] - YYYY-MM-DD` section in the changelog and an annotated tag, all in the
release commit. Bumping the plugin catalog's pin happens after a release, in the PR that carries the new
`sha` and `version` (see the README's *Hermes plugin catalog*).
