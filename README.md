# hermes-anilist

AniList tracker pane for **Hermes Desktop** — airing countdowns, season browser and episode alerts,
without leaving the app.

> **Status: early development.** The desktop pane and the read-only AniList backend work today.
> AniList sign-in (OAuth pin flow) and cron episode alerts land in the next phases; see
> [Roadmap](#roadmap).

## What it is

A Hermes plugin with three parts in one installable folder:

| Part | Where | What it does |
|---|---|---|
| Desktop half | `desktop/plugin.js` | A status-bar chip that unfolds a popover, a workspace tab (Upcoming · Seasons · Settings) and command-palette entries |
| Backend half | `dashboard/plugin_api.py` | The only thing that talks to AniList — caching and the rate-limit budget live here |
| Agent half | `plugin.yaml` + `__init__.py` | Manifest, settings schema, and the bridge that hands the routes their state |

The renderer never holds a credential: it only ever sees public data and a `configured` flag.

## What you can do today

- **Upcoming episodes** in the chip, with a countdown per row. The list is sectioned by *local*
  calendar day (**Hoy / Mañana / Dom 20**) and the window is a setting (3 / 7 / 14 days). The backend
  stitches AniList's pages so a 7-day window really covers 7 days, and a cursor-backed **Ver más**
  reaches deeper when a window is dense.
- **Seasons and search**: browse any season/year, or search a title (debounced, one request per word).
- **A local watchlist**: star any show from the feed, the season browser or the search results. The
  **Mi lista** filter then narrows the feed to what you track — your next 7 days are a handful of
  episodes, not a hundred. Statuses are AniList's own five (`watching`, `completed`, `planned`,
  `paused`, `dropped`) so sign-in can push them straight through later.
- **A per-show detail**: cover, format, status, length, duration, score, studio, genres, the next
  episode's countdown, the full description, the episode list, and the tracking controls (status,
  progress ±, remove).
- **Settings** (client-side, per install): title language (English / Romaji / Original), feed window,
  the filter it opens on, and whether rows show cover art.
- English and Spanish, following the app's language.


## Install

```bash
hermes plugins install BatataBF/hermes-anilist   # git clone into <hermes home>/plugins/
hermes plugins enable hermes-anilist
hermes gateway restart
```

> **Never install by symlinking a clone into the plugins directory.** The installer resolves the
> destination and refuses a plugin whose name resolves outside it
> (`hermes_cli/plugins_cmd.py::_sanitize_plugin_name`), so a symlinked install works for the loader
> but makes the plugin **uninstallable** from the Desktop dialog and from `hermes plugins install`.

Then, in Hermes Desktop: **⌘K → Reload desktop plugins**, and enable the plugin under
**Capabilities → Plugins** (the desktop half is opt-in by design).

### One-click install (once cataloged)

```html
<a href="hermes://plugin/install?repo=BatataBF/hermes-anilist&enable=1">Install in Hermes</a>
```

## Requirements

- Hermes `>= 0.21` (Desktop Plugin SDK `@hermes/plugin-sdk`).
- No AniList credential needed for anything read-only: the public GraphQL API at
  `https://graphql.anilist.co` needs no API key (30 requests/minute shared per host).

## How it works

```
Desktop pane (renderer)          Backend (gateway/serve process)        AniList
    ctx.rest('/airing')  ───────►  /api/plugins/hermes-anilist/airing  ───►  graphql.anilist.co
                         ◄───────  cache + rate-limit budget            ◄───  public data
```

- All network access happens in the backend half, so the 30 req/min budget is spent once per host
  and not once per window.
- The pane declares the source it is reading from (`connection · profile`), because a Hermes desktop
  can be connected to several gateways and profiles at once.
- Polling is the primary refresh path (`ctx.socket` is a no-op against OAuth remotes).

## Security & credentials

- **No stored secret ever reaches the renderer.** The AniList token lives in the `.env` of the host
  running the backend for that profile, read through `agent.secret_scope` (profile-safe, fails closed
  under multiplex). The renderer only ever *hands one over*: the token the user pastes into the
  sign-in field goes straight to the backend, and every answer back carries the viewer's name and
  avatar — never the token, not even a prefix.
- The plugin ships **no shared AniList application**. Each account registers its own app (one minute,
  in AniList's developer settings) and that public id lives in the user's own plugin state — there is
  no plugin-wide `client_id` to leak, rotate or inherit, and no third party's application standing
  between a user and their account. The token is the only credential, and it never leaves the machine.
- Runtime state (the local watchlist) lives in the plugin's own profile-scoped state under
  `<HERMES_HOME>/plugin-data/`, reached through `ctx.state` — never through `config.yaml`, and never
  from the renderer. The directory is derived from the plugin id
  (`agent-plugin-hermes-anilist-<digest>`), so treat it as an implementation detail.
- The plugin declares **no** privileged capabilities (`tools.override`, `llm.*`).

## Roadmap

- [x] **L0 · skeleton** — repository, unified package layout, live read-only pane over AniList.
- [x] **L1 · feed and browsing** — airing countdowns, day sections, season browser, search, window
  filter, settings. (shipped in `0.4.0`)
- [x] **L2 · watchlist and detail** — a local watchlist with AniList's status vocabulary, per-show
  detail with the episode list, tracking from any row, the **Mi lista** filter. (shipped in `0.5.0`)
- [ ] **L3 · sign-in** — AniList OAuth **pin** flow, the token in the backend `.env`, the account's
  list imported and synced. *(The account routes and their tests landed; the Settings UI and the list
  import are next.)*
- [ ] **L4 · alerts** — an action that creates a cronjob per show (exact one-shot at airing time, or
  a daily digest), with the jobs listed and cancellable from the pane.
- [ ] **L5 · hardening** — i18n review, docs, catalog submission (`category: desktop`,
  `tier: community`), a release candidate before `1.0.0`.

What `1.0.0` means here: updating never breaks your settings or your list — a frozen
`config_schema`, stable backend routes, and both halves published to the catalog.

## Development

```bash
python3 -m pytest tests/ -q                 # offline unit tests (no network)
hermes plugins doctor "$(pwd)" --ci         # real discovery + register(ctx) contracts
hermes plugins validate "$(pwd)"            # the same gate the plugin catalog CI runs
```

Install layout matters: the working copy lives in a normal clone (e.g. `~/projects/hermes-anilist`),
and the installed copy under `<hermes home>/plugins/` is a **git checkout managed by Hermes** — never
a symlink (see Install above). The loop is clone → push → `hermes plugins update hermes-anilist`.

Desktop-half edits hot-reload: save `desktop/plugin.js` and the app picks it up. Backend-half edits
need the gateway/serve process restarted, because the routes mount at startup.

## License

MIT — see [LICENSE](LICENSE).
