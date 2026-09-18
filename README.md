# hermes-anilist

AniList tracker for **Hermes Desktop** — airing countdowns, a season browser, episode alerts and
agent tools over your own list, without leaving Hermes.

**Built with `@Hermes`.** Every line of this plugin — the desktop half, the backend, the agent tools,
the tests and this README — was developed with
[Hermes Agent](https://hermes-agent.nousresearch.com/) doing the implementation, driven by the repo's
owner and running mostly on **`deepseek-v4.1-flash`**. The taste, the screenshots and the bug reports
are human; the code is not.

> **Status: 0.8.0.** The pane, the AniList backend (read *and* write), the pin-flow sign-in, the cron
> alerts, the daily digest and the two agent tools all work today. Next: the catalog PR (which opens
> once the pinned commit is two weeks old — see [Hermes plugin catalog](#hermes-plugin-catalog)) and the
> agent's writing tools.

---

## What it is

A Hermes plugin with three halves in one installable folder:

| Part | Where | What it does |
|---|---|---|
| Desktop half | `desktop/plugin.js` | The status-bar chip, the popover it unfolds, the workspace tab (**Upcoming · Catalog · Settings**) and the show page |
| Backend half | `dashboard/plugin_api.py` | The only thing that talks to AniList — HTTP client, cache and rate-limit budget live here |
| Agent half | `tools.py`, `__init__.py`, `skills/usage/SKILL.md` | The two tools the model calls, the native entry point that registers them, and the skill that teaches when to use them |

The renderer never holds a credential: it only ever sees public data and a `connected` flag.

## Capabilities

| Capability | Where | What it does |
|---|---|---|
| **Status-bar chip** | Status bar | Names the next episode of *your* list with a countdown (`EP 12/12 in 1h 7m`), a clock icon that turns into a broadcast mark within the hour, a `+N` for the rest of your next 24 hours, and a bell once a reminder is armed for that episode |
| **Airing feed** | Chip → popover | Your window (3 / 7 / 14 days) sectioned by local day — **Today / Tomorrow / Fri 19** — with a cursor-backed **Show more**, plus search and the two doors out: the full workspace and Settings |
| **Season browser** | Workspace ▸ **Catalog** | Any season and year, or a debounced title search |
| **My list** | Workspace ▸ Upcoming / Catalog | Star any show from any row; the **My list** filter narrows the feed to what you track. Account-backed when signed in, local otherwise |
| **Tracking** | Show page | AniList's own statuses (`watching`, `rewatching`, `planned`, `completed`, `paused`, `dropped`), progress ±, and removal behind a confirmation because it deletes the entry on AniList. The score is shown — yours from AniList, never invented — but not editable yet |
| **Show page** | Workspace | Identity, the next episode with its countdown and the alert action, tracking controls, a **month calendar** of its air dates, an episode table with `EP · Day · Date · Time`, and the synopsis beside the cover |
| **Episode alerts** | Show page / Settings | A cron job per episode that fires when it airs — it survives closing Hermes, shows up in `hermes cron list`, and is paused, resumed or cancelled from Settings ▸ *Alerts* |
| **Daily digest** | Settings | One message a day at the hour you pick with what airs from your list; it carries the ids and asks AniList's public API itself, so a host without this plugin can still run it |
| **Agent tools** | Any session | `anilist_list` and `anilist_show` — the model reads the list you actually track and answers about one show (see [Agent tools](#agent-tools)) |
| **Settings** | Workspace ▸ Settings | Title language (English / Romaji / Original), feed window, the filter it opens on, covers, default destination and channel, alerts, and the AniList account |
| **Two languages** | Everywhere | English and Spanish, following the app's language |

## Requirements

- Hermes `>= 0.21` (the Desktop Plugin SDK).
- **No credential for anything read-only.** AniList's public GraphQL API (`https://graphql.anilist.co`)
  needs no key; the budget is 30 requests/minute shared per host, which the backend spends once.
- **For signing in and writing to your list**: your own AniList application (one minute to create) —
  see [Set up your AniList account](#set-up-your-anilist-account). The plugin deliberately ships no
  shared application.

## Install

```bash
# From the repository (works today)
hermes plugins install BatataBF/hermes-anilist
hermes plugins enable hermes-anilist
```

Once the catalog entry lands, the same install by name:

```bash
hermes plugins install hermes-anilist    # resolves to the reviewed, pinned commit
hermes plugins enable hermes-anilist
```

Then, in Hermes Desktop:

1. **⌘K → Reload desktop plugins** — the desktop half is loaded by the app and is opt-in.
2. **Capabilities → Plugins** — check that **hermes-anilist** is there and enabled.
3. The chip appears in the status bar. Click it.

Updating, after a new release:

```bash
hermes plugins update hermes-anilist
```

> **Never install by symlinking a clone into the plugins directory.** The installer resolves the
> destination and refuses a plugin whose name resolves outside it
> (`hermes_cli/plugins_cmd.py::_sanitize_plugin_name`), so a symlinked install loads fine but is
> **uninstallable** from the Desktop dialog and from `hermes plugins install`. Install by
> `owner/repo` and let Hermes manage its own checkout.

### Where it runs

The plugin halves load in the **backend** that serves your session. On Desktop that is usually the
app-managed local backend; if you point Hermes at another host (an SSH gateway, a VPS), the plugin
must be installed there too for the chip and the tools to exist in those sessions. Alerts and the
digest are different: they are cron jobs, so they run on the host you pick, whether or not that host
has the plugin.

## Set up your AniList account

Everything read-only works signed out, against the local list. Connecting an account is what makes
the list *yours*: statuses, progress and scores read from AniList, and edits written back.

Nothing here needs an account: the feed, seasons and search read AniList publicly. Connecting is for
importing and syncing your own list. Each account registers its own app — the plugin ships no shared
credentials.

In the plugin: **Workspace ▸ Settings ▸ AniList account**.

1. **Create an app with this redirect.** Open
   [AniList's developer settings](https://anilist.co/settings/developer) and create a client with the
   redirect URL exactly:

   ```
   https://anilist.co/api/v2/oauth/pin
   ```

   It must match exactly — AniList compares it literally.

2. **Paste its Client ID** into the plugin and press **Save**. The Client ID is public; it is stored
   in the plugin's own profile-scoped state, never in the code.

3. **Get a token and paste it.** Press **Get AniList token** — your browser opens AniList's authorize
   page for your own app — approve it, and copy the token AniList shows. Paste it into the field and
   press **Connect**. The answer comes back as `Connected as <your name>`.

After that the header shows your account's name, **My list** is your real AniList list, and the
tracking controls write to it. **Disconnect** removes the token from the profile; your list on
AniList is untouched.

Everything else — the feed, seasons, search, the local list, alerts, the digest, the agent tools —
keeps working signed out.

## Agent tools

With the plugin enabled the model gets two tools, and they only read:

| Tool | Answers |
|---|---|
| `anilist_list` | "What am I watching this season?", "What of mine airs this week?", "What am I behind on?" — filters `all · airing · behind · not_started`, and an entry in one AniList status. Each row: status, progress, total episodes, your score, season and year, and the next episode with its air time |
| `anilist_show` | "Is this good?", "Do I have the sequels?", "What should I watch next?" — AniList's score (0–100, `null` when there is none), its all-time rankings *with their context*, spoiler-free tags, the score distribution, related works in story order each flagged with whether it is already in your list, the community's recommendations with vote counts, and your own entry |

Rules the tools follow, and the reason they are trustworthy:

- **Every answer names the list it read** — your AniList account's, or this device's when you are
  signed out. `store: anilist` vs `store: local`.
- **`null` is not zero.** A show AniList has no score for reports `null`, and a score you never set
  is not invented.
- **A title resolves itself and says which show it got**, plus what else matched — so a wrong pick is
  visible instead of silent.
- **Neither tool writes.** Watching an episode for you is a deliberate follow-up, not a side effect of
  a question.

The plugin also ships a skill (`hermes-anilist:usage`, in `skills/usage/SKILL.md`) that teaches the map
from question to tool and those honesty rules. Load it with `skill_view('hermes-anilist:usage')`; it is
not in `~/.hermes/skills/`, so nothing finds it unless a tool description names it.

## How it works

```
Desktop pane (renderer)          Backend (gateway/serve process)        AniList
    ctx.rest('/airing')  ───────►  /api/plugins/hermes-anilist/airing  ───►  graphql.anilist.co
                         ◄───────  cache + rate-limit budget            ◄───  public data
```

- All network access happens in the backend half, so the 30 req/min budget is spent once per host and
  not once per window.
- The agent tools live in `tools.py` and read through the same functions the routes do
  (`read_entries`, `read_show`, `read_airing`, `read_search` in `dashboard/plugin_api.py`) — one pooled
  HTTP client, one cache, one answer to "which store is answering". `hermes plugins validate` compares
  the tools declared in `plugin.yaml` against the ones `register(ctx)` actually registers.
- The pane declares the source it is reading from (`connection · profile`), because a Hermes desktop
  can be connected to several gateways and profiles at once.
- Polling is the primary refresh path (`ctx.socket` is a no-op against OAuth remotes).

## Security & credentials

- **No stored secret ever reaches the renderer.** The AniList token lives in the `.env` of the host
  running the backend for that profile, read through `agent.secret_scope` (profile-safe, fails closed
  under multiplex). The renderer only ever *hands one over*: the token you paste goes straight to the
  backend, and every answer back carries the viewer's name and avatar — never the token, not even a
  prefix.
- The plugin ships **no shared AniList application**. Each account registers its own app, and that
  public id lives in your own plugin state — there is no plugin-wide `client_id` to leak, rotate or
  inherit, and no third party's application between you and your account.
- Runtime state (the local watchlist) lives in the plugin's own profile-scoped state under
  `<HERMES_HOME>/plugin-data/`, reached through `ctx.state` — never through `config.yaml`, and never
  from the renderer. Its directory name is derived from the plugin id
  (`agent-plugin-hermes-anilist-<digest>`); treat it as an implementation detail.
- The plugin declares **no** privileged capabilities (`tools.override`, `llm.*`).

## Development

```bash
uv run --with pytest --with httpx --with fastapi --quiet pytest tests/ -q   # offline, no network
node tools/test_plugin_helpers.mjs           # the desktop half's pure helpers, no app needed
node tools/test_plugin_views.mjs             # renders the show page's views (needs React — see its header)
node tools/i18n_audit.mjs desktop/plugin.js  # locale parity: used/undefined, defined/unused, skew
node tools/class_audit.mjs                   # every className exists in the app's compiled stylesheet
python3 tools/lint_plugin_js.py desktop/plugin.js   # identifiers used but never declared
hermes plugins doctor "$(pwd)" --ci          # real discovery + register(ctx) contracts
hermes plugins validate "$(pwd)"             # the same gate the plugin catalog CI runs
```

Test placement mirrors what is under test: `tests/test_plugin_api.py` (the routes),
`tests/test_agent_reads.py` (the payloads the tools and routes share), `tests/test_agent_tools.py`
(registration and the dispatcher contract). Backend changes are written test-first: the failing test
first, then the implementation.

The desktop half is loaded **uncompiled**: a stale identifier left behind by a rename parses fine
(`node --check` passes) and only throws `ReferenceError` when that component renders, which the app
shows as *"plugin-workspace:… failed to render"*. `tools/lint_plugin_js.py` is the cheap net for that
class — run it after touching `desktop/plugin.js`. A class name the app's build never emitted is the
same trap one layer down: it parses, it lints, and it renders nothing at all, which is what
`tools/class_audit.mjs` checks against the installed app's compiled stylesheet.

Layout matters: the working copy is a normal clone, and the installed copy under
`<hermes home>/plugins/` is a **git checkout managed by Hermes** — never a symlink. The loop is
clone → push → `hermes plugins update hermes-anilist`.

Desktop-half edits hot-reload: save `desktop/plugin.js` and the app picks it up. Backend-half and
`tools.py` edits need the backend restarted, because tools and routes register at startup.

## Hermes plugin catalog

**What this section is for:** the catalog is the only reviewed index behind
`hermes plugins install <name>`, and admission is a pull request to a *different* repository
(`NousResearch/hermes-agent`) — never to this one. So this section is the submission's checklist with
where this repo stands, and it is where the entry file lives, ready to copy. Nothing under this repo's
`plugin-catalog/` directory is read by Hermes at runtime.

The catalog itself is documented at
[Plugin Catalog](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugin-catalog), and
the checklist is that repo's `plugin-catalog/README.md`:

| Requirement | Where this repo stands |
|---|---|
| Owner-submitted PR | BatataBF owns the repo |
| Public repository | `github.com/BatataBF/hermes-anilist` |
| Real releases/tags, not just a branch | annotated tags per release — `v0.7.0`, `v0.8.0`, … |
| Exact 40-hex SHA pin, at least two weeks old at review | pinned to the `v0.8.0` commit; submit the PR no earlier than **2026-10-01** |
| Not self-updating | no updater in the plugin: `hermes plugins update` is the only path |
| Declared capabilities match reality | `hermes plugins validate` passes (2 declared tools, 2 registered) |
| Admission validation green | `.github/workflows/ci.yml` runs the same validator on every push |
| Security scan clean | `hermes plugins validate` reports `safe`; no `tools.override`, no LLM access |

The entry itself is kept in this repo, ready to copy, at
[`plugin-catalog/hermes-anilist.yaml`](plugin-catalog/hermes-anilist.yaml). To submit, open a PR against
`NousResearch/hermes-agent` adding that same path with the file's contents, and paste the validator
output in the description.

The developer guide also asks standalone plugins to be promoted in the Nous Research Discord
`#plugins-skills-and-skins` channel — a community plugin is a standalone repo first
(`~/.hermes/plugins/` or a pip entry point) and a catalog entry second.

Bumping the pin after a release is the same PR with a new `sha` (and the matching `version` label), so
the diff a reviewer reads is exactly the commit range users would adopt.

## Roadmap

- [x] **L0 · skeleton** — repository, unified package layout, live read-only pane over AniList.
- [x] **L1 · feed and browsing** — airing countdowns, day sections, season browser, search, window
  filter, settings. (`0.4.0`)
- [x] **L2 · watchlist and detail** — a local watchlist with AniList's status vocabulary, per-show
  detail, tracking from any row, the **My list** filter. (`0.5.0`)
- [x] **L3 · sign-in** — AniList OAuth **pin** flow, the token in the backend `.env`, the account's own
  list read *and* written. (`0.6.0`)
- [x] **L4 · alerts** — a cron job per show plus the daily digest, both with a destination and a
  delivery channel remembered between them. (`0.7.0`)
- [x] **L5 · pane, tools, docs and CI** — the show page rebuilt around the next episode, the calendar
  and the episode table; the chip that follows your own list; `anilist_list` + `anilist_show` and
  their skill; the README as a front door; CI on every push; the catalog entry, pinned and ready.
  (`0.8.0`)
- [ ] **L6 · catalog and writing tools** — the catalog entry merged (the PR opens once the pin is two
  weeks old, and each later release is a pin-bump PR); editing the score (which needs the account's own
  scale, `User.mediaListOptions.scoreFormat`); and `anilist_mark`, `anilist_remove`, `anilist_airing`,
  `anilist_stats` and `anilist_recommend` for the agent.

What `1.0.0` means here: updating never breaks your settings or your list — stable backend routes,
stable tool and manifest names, and a pin in the catalog that moves only through a reviewed PR. There is
no server-side config schema to freeze: every preference is client-side, in the desktop half's own
storage, precisely so a future version can add one without migrating anyone.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) — Keep a Changelog, one entry per released version.

## License

MIT — see [LICENSE](LICENSE).
