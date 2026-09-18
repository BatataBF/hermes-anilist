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
release commit. The catalog pin is bumped after a release, in its own PR (below).

### Attribution — every commit credits the agent

This plugin was written by Hermes Agent, and the git history says so: the last block of every commit
message is

```
Co-authored-by: Hermes Agent <noreply@nousresearch.com>
```

It is a trailer, not prose: GitHub parses `Co-authored-by:` and shows the second author on the commit
and among the contributors. It goes after one blank line at the end of the message.

Three ways to get it right:

- **By hand**: `git commit` picks up [`.gitmessage`](.gitmessage), which already ends with the trailer.
  Enable it once per clone: `git config commit.template .gitmessage`.
- **From a message file** (`git commit -F msg.txt`, which is what an agent does): the template is *not*
  applied, so append the trailer to the file yourself.
- **On an existing commit**: don't. Amending or rebasing rewrites the commit id, and the catalog pins
  the `v0.8.0` release commit by SHA — rewriting it would invalidate a pin that was deliberately made
  two weeks before submission. Credit goes forward instead; the release commit stays as it is.

The address is deliberately not linked to a GitHub account: the `Hermes` handle there belongs to an
unrelated project, and `hermes-agent` is an empty account. Swapping the address for
`<id>+<login>@users.noreply.github.com` of a real account is what gives the co-author an avatar.

The other two places the credit lives: `author:` in `plugin.yaml` (so the catalog card shows it) and the
first lines of the README.

## The plugin catalog (maintainer-facing)

The catalog is the only reviewed index behind `hermes plugins install <name>`, and admission is a pull
request to a **different** repository — `NousResearch/hermes-agent`, never this one. So: it is where the
submission's checklist lives, and where the entry file is kept ready to copy. Nothing under this repo's
`plugin-catalog/` directory is read by Hermes at runtime — that directory is documentation plus the PR's
payload.

The policy is hermes-agent's `plugin-catalog/README.md`; the user-facing side is the
[Plugin Catalog](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugin-catalog) page.

| Requirement | Where this repo stands |
|---|---|
| Owner-submitted PR | BatataBF owns the repo |
| Public repository | `github.com/BatataBF/hermes-anilist` |
| Real releases/tags, not just a branch | annotated tags per release — `v0.7.0`, `v0.8.0`, … |
| Exact 40-hex SHA pin, at least two weeks old at review | pinned to the `v0.8.0` commit; the PR opens no earlier than **2026-10-01** |
| Not self-updating | no updater in the plugin: `hermes plugins update` is the only path |
| Declared capabilities match reality | `hermes plugins validate` passes (2 declared tools, 2 registered) |
| Admission validation green | `.github/workflows/ci.yml` runs the same validator on every push |
| Security scan clean | `hermes plugins validate` reports `safe`; no `tools.override`, no LLM access |

**To submit**: open a PR against `NousResearch/hermes-agent` adding `plugin-catalog/hermes-anilist.yaml`
with the contents of [this repo's copy](plugin-catalog/hermes-anilist.yaml), and paste the validator
output in the description.

**To bump the pin** after a release: the same PR shape with a new `sha` (the release commit, quoted so
YAML does not read an all-digit SHA as a number) and the matching `version` label, so the diff a reviewer
reads is exactly the commit range users would adopt.

The developer guide also asks standalone plugins to be promoted in the Nous Research Discord
`#plugins-skills-and-skins` channel — a community plugin is a standalone repo first
(`~/.hermes/plugins/` or a pip entry point) and a catalog entry second.
