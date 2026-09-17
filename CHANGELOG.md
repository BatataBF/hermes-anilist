# Changelog

All notable changes to this project are documented here.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Episode alerts.** Any show with a known next episode can be armed from its own page: the plugin
  creates a cron job that fires the moment that episode airs. The job lives in the **profile's own
  cron store** — through the gateway's `cron.manage` RPC, the same door the app's scheduled surfaces
  use — so it keeps firing with Hermes closed and shows up in `hermes cron list` like any other job.
  The schedule sent is the ISO timestamp AniList reports, which the store turns into a one-shot, and
  the name is namespaced (`[anilist:<media id>:e<episode>] <title> — EP <n>`) so the pane can find
  its own again. Settings ▸ *Alerts* lists them with pause/resume and remove, and the show's page says
  whether its next episode is armed. It works signed out: an air date is public, and a cron job does
  not care who is logged in.
- **Destination.** An alert can be scheduled on any registered connection, not just this device: the
  call is routed with the app's own `host.profileRoutes()` descriptor through `host.requestProfile` —
  the same multi-connection door Bot Mode uses — so the job lands in *that* machine's cron store. This
  is the difference between an alert that only surfaces inside the app and one that reaches a phone: a
  box running its own gateway with a messaging channel configured is where the job has to live. The
  Alerts list asks every destination it can reach, names each row's host, and routes pause/resume and
  remove back to the gateway that owns the job — a host it cannot reach is reported as such, never as
  "no alerts". **Delivery target:** an alert records where its notification comes out
  (`local`/`telegram`/`discord`, the CLI's own vocabulary), offered as a named choice whenever the
  destination is not this device and remembered between alerts — the RPC default of `local` only
  surfaces the run inside whichever app owns that store. **Set once, not per alert:** the destination
  and the channel are preferences (Settings ▸ *Default destination*), so every alert after the first
  opens on the host and channel already chosen — and with no preference yet it opens on the host where
  this plugin already has jobs. A reader whose notifications live on one box should
  not have to say so twice. A run that failed, or was refused by the
  scheduler's pre-dispatch validation, says so on its row.

- **Daily digest.** One message a day with what airs from the reader's list, armed from Settings: same store,
  same destination and same delivery target as an alert, but recurring — on a cron expression, which is the one
  schedule form the app's own editor reads back without choking. The ids of everything that can still air are
  baked in at arm time, and the prompt is self-contained: it asks AniList's public API itself, because the job
  runs on whichever host was picked and **that host may not have this plugin installed**. Verified against a
  real 72-id list — the message arrives as one line per show, no preamble, no notes, no questions.
  *(L4 is complete with this.)*

### Changed

- **The status-bar popover is the feed again.** It keeps the filters it always had (today · the window ·
  my list) and drops the view switcher: the catalog and the settings live in the workspace, where there is
  room to read them. Two named buttons at the bottom — *See everything* and *Search a show* — open it, and
  the menu closes on the way out.
- **Settings is one organized place**: Account, Alerts, Daily digest, Default destination, Preferences —
  each under a labeled group, with the digest beside the alerts it belongs to and never in the popover.
- **Named actions instead of glyphs.** Refresh says *Refresh*; arming an alert or the digest is the primary
  button rather than another ghost one; the chip names the show it is counting down to (its tooltip says
  the whole thing.

- **The answer cache is bounded.** Every key is a question (a query at a page, a window at a cursor)
  and a long-lived gateway mints hundreds of them: the cache now holds at most 256 entries, evicting
  expired ones first and then whatever is closest to expiring.

### Fixed

- **The stitched airing window ignored the rate floor.** `_cached` checks the budget before the
  first request, but a 7-day window is up to `MAX_AIRING_PAGES` cursor pages — a dense season could
  spend the last of the host's shared 30/minute on a continuation page. The loop now stops between
  pages when the floor trips, keeps what the first page returned, and leaves `hasNextPage` true so
  *Ver más* can continue later.
- **The delivery picker crashed the workspace.** Its value read a bare `alertDelivery` that the
  preference refactor had already moved onto `settings` — the render threw
  `ReferenceError: alertDelivery is not defined`, the app's error boundary caught it, and the pane
  said *failed to render*. This class (an identifier left behind by a rename) passes `node --check`
  because the file still parses, so `tools/lint_plugin_js.py` now checks for it and the README says
  to run it after touching the desktop half.

## [0.6.0] - 2026-09-17

### Added

- **Writing back** (`PUT` / `DELETE /list/{media_id}`). The star adds a show to the account and takes
  it off again; the detail pane sets the status (AniList's six, `rewatching` included) and steps the
  progress. Picking *watched* fills the progress in, the way AniList's own editor does — otherwise
  "watched" sitting beside "7/12" reads like the write did not take. Writes are **absolute, never
  deltas**, so two windows stepping the same episode cannot add up to two and a retry after a timeout
  is safe to repeat. The mutation is folded into the cached list, so a write costs one request instead
  of two, and the next read is fresh rather than merely fast. Removal is the one destructive action —
  it deletes the entry along with its score, notes and progress — so it goes through a confirmation
  dialog, and `DeleteMediaListEntry` gets the **entry** id (the only id it accepts) resolved from the
  list rather than guessed from the media id. A write with a revoked token says so instead of quietly
  doing nothing, which is the one place reads and writes deliberately differ.
- **The account's own list** — signing in now shows the reader's real list instead of an empty
  local one. `GET /list` reads `MediaListCollection` for the signed-in viewer (whose id comes from
  the token, never from the caller), translates AniList's status enum into the vocabulary the rest
  of the plugin already speaks, skips custom lists (they repeat shows already filed under a status),
  and hands back entries watching-first with progress, score, cover and episode count. *My list* —
  the feed filter, the row markers and the detail pane — reads it through one seam, so no surface
  has to know which store answered. (Writing back landed in the same release — see above — so that
  list is edited from here rather than shadowed by a local copy.) Signed out, the route is silent (no
  request) and the local watchlist answers as before.
- **The sign-in pane** (Settings ▸ *AniList account*), written as three numbered steps: create the app
  (with the exact pin redirect shown selectable), paste its Client ID, then **Get AniList token** —
  which opens the authorize URL with that id already in it — and paste the token. Once AniList
  confirms it, the pane shows *Connected as <user>* with the avatar and a Disconnect button; a
  rejected token is named as such instead of failing silently, and the token field clears only on
  success so a refused token stays put to be fixed.
- **The account backend for sign-in** (`GET/PUT/DELETE /account`). The client id (public) lives in the
  plugin's own state; the token — a credential — is validated against AniList's `Viewer` **before** it
  is stored, and only then written to the profile's `.env` through the same function `hermes config
  set` uses (`save_env_value`), read back through the profile-safe secret scope (`get_secret`, which
  fails closed in a multiplexed process with no scope bound rather than guessing whose token it is).
  No response ever carries the token, not even a prefix, and the viewer identity is cached against a
  digest of the token so a rotation cannot serve the previous account. Sign-out removes the env entry
  and keeps the client id. A token AniList refuses comes back as `401` (verified live), so the UI can
  say "that token does not work" instead of "AniList is broken".

### Changed

- **No shared AniList application.** The pane briefly shipped a plugin-wide `client_id` so nobody would
  have to register an app (the Seanime arrangement). It is gone on purpose: every account registers
  **its own** app, so no plugin-wide identity exists to leak, rotate, inherit — or to answer for. The
  cost is one minute of setup per account; the benefit is that nothing about a user's access to their
  own account passes through anybody else's application.

### Fixed

- **The Client ID is saved when it is used.** *Get AniList token* is enabled by what is in the field,
  not by what is stored — so pasting the id and going straight for the token worked, and left the id
  unsaved. It came back as an empty field and a disabled button, with the answer sitting on AniList's
  developer page. The click now persists the id on its way out.
- **A malformed query no longer reads as a rejected token.** The 4xx branch mapped `400` and `401`
  together, so a bad GraphQL field came back as *"AniList rejected that token"* — exactly how a query
  bug gets mistaken for a credential problem (it cost one this session: the token was fine, the query
  wasn't). Only a `401` names the token now, and any other 4xx carries AniList's own message instead
  of a bare status code.

## [0.5.0] - 2026-09-17

### Added

- **Tracking from the feed itself.** Every row (feed, season and search) carries a star that adds or
  removes the show, and its badge reads `EP 7/12` when AniList knows the show's length. A third
  filter, **Mi lista**, narrows the feed to what is being tracked — their next 7 days are a handful
  of episodes, not a hundred.
- **A show detail view.** Any title opens it in the workspace tab: cover, format, status, length,
  duration, score, studio, genres, the next episode's countdown, the description as text, the
  episode list with its own **Ver más** (paged on top of the first 25 that ride along with the
  detail), and the tracking controls — status among AniList's five, progress ±, remove. The tab strip
  keeps showing *Upcoming* while drilled in, and *Volver* goes back to the feed.
- **A local watchlist** (`GET/PUT/DELETE /watchlist`), stored in the plugin's own profile-scoped
  state (`ctx.state` → `~/.hermes/plugin-data/<namespace>/state.json`), so it survives restarts, is
  visible to the backend, and is ready for the episode alerts of L4. Statuses are AniList's own
  (`watching`, `completed`, `planned`, `paused`, `dropped`) so sign-in can push them straight through
  instead of translating a private vocabulary. Every field is optional in a PUT — a progress tick
  must not reset the title, and a title refresh must not reset the progress.
- **A show detail** (`GET /anime/{id}`) with the description as plain text (AniList's
  `asHtml: false` still ships `<br>`, stripped here), cover/banner, format, status, length, duration,
  genres, score, studio, the next episode and its own episode list; `GET /anime/{id}/episodes` pages
  that list on its own for "show more".
- Airing rows carry `totalEpisodes`, and the airing query fetches `native` titles too — the title
  language setting finally has something to switch to on the feed.
- `__init__.py` bridges `ctx.state` into the dashboard routes. The web server imports
  `dashboard/plugin_api.py` itself under a synthetic module name and hands it no context, so the
  routes take their state through an explicit `bind_state()` and resolve it lazily: registration and
  route mounting are separate startup steps whose order is not ours to depend on.

- **Day separators in the multi-day view.** The upcoming list groups by *local* calendar day, headed
  by *Hoy* / *Mañana* / *Dom 20* and closed with the kit's `Separator`. Grouping is presentation
  only — the feed, its order and the AniList budget are untouched — and the single-day filter stays
  a flat list, where a header would only repeat the filter itself.

- **A "Ver más" footer** under the multi-day list, shown only when the feed really is truncated (the
  page cap) with a hint naming the window. The panel merges the deeper page onto the rows on screen,
  deduped by episode and re-sorted — a refetch can slide the window forward, so a row can show up in
  both halves. It is hidden in the single-day filter, where the deeper page lands past midnight and
  the click would look broken.

### Changed

- **The whole row opens the detail**, not just the title text: hitting a truncated title exactly was a
  small game nobody should have to play. The star and the external link call `stopPropagation`, so
  tapping them still does only their own thing.
- **The airing feed covers its whole window now, not its first page.** A 7-day window held 65
  episodes and one page of 50 ran out at day 2.5 — which is why the list, and the day sections with
  it, stopped days before the window did. The backend stitches cursor pages (up to
  `MAX_AIRING_PAGES`) into one cached feed, so the sections now reach day 7. `hasNextPage` means
  "there is more than I returned" rather than "AniList had another page", and the page size went
  40 → 50 because the cap is what actually bounds a refresh, not the size of each step.
- `/airing` takes `after=<unix seconds>`: the cursor behind **Ver más**, returning episodes strictly
  after the last row on screen. The cursor keys the cache (not the wall clock), so two clicks a
  second apart cost one request, and a stale cursor never re-fetches the past.

### Fixed

- **The row actions are no longer hover-only.** The track star and the "open on AniList" button appeared
  only while the pointer rested on a row (`opacity-0` plus a `group-hover` reveal), which reads as
  "the buttons are missing" — and since a *tracked* row was the only one whose star ever showed, the
  feature looked like it existed only for today. Both are always visible now, muted until tracked or
  pointed at.
- **A day header past tomorrow read `E 19` instead of `Sáb 19`.** The weekday names were registered
  as an array, but a plugin i18n value is only ever `string | ((...args) => string)` — anything else
  resolves back to the key itself, so `t('dayNames')` handed back the string `"dayNames"` and the
  code indexed *that* (`"dayNames"[6]` → `e`, upper-cased by the header's `uppercase`). The names
  are a function now, with the constraint written next to them.

## [0.4.0] - 2026-09-17

### Added

- **A settings view**, reachable from the shared view switcher (Próximos · Temporadas · Ajustes) in
  both the popover and the workspace tab, and from the palette (`AniList: Settings`). Preferences are
  client-side and per install (`ctx.storage`), so none of them needs a gateway round trip:
  **title language** (English / Romaji / Native), **feed window** (3 / 7 / 14 days, which the airing
  query honors), **filter** (the popover's control and the settings row deliberately write the same
  value — what you pick in passing is what the next open remembers) and **cover art** on or off.
- The popover **names its views**: the switcher spells out Próximos, Temporadas and Ajustes instead
  of hiding them behind a glyph.

### Changed

- `normalize_media_page` and `normalize_airing` now also return `titles: {romaji, english, native}`,
  with `null` flattened to `""` so callers can fall through. `title` keeps its
  english → romaji → native preference, so existing callers are unaffected.

## [0.3.0] - 2026-09-17

### Added

- **A window filter on the upcoming list** — `Hoy` / `7 días`, as a `SegmentedControl` beside the
  section title. The feed is always fetched as a seven-day window and narrowing happens
  client-side, so flipping the filter back and forth never spends AniList budget. `Hoy` ends at the
  user's own midnight (not UTC's), and an episode that has just started still counts as today —
  its row says "airing now".

## [0.2.2] - 2026-09-17

### Fixed

- **The lists scroll.** The kit's `ScrollArea` viewport is `size-full`, so a `max-height` root gave
  it a percentage height that resolves to `auto`: the rows were clipped at 18rem with no way to
  reach the rest of the window. Both lists now carry a definite height (`h-80`), and the workspace's
  takes `flex-1` with `min-height: 0`.

### Changed

- The status-bar popover is 24rem wide instead of the kit's 18rem default: the season track, the
  year stepper and the search field fit on one line. The width is an inline style, because the
  compiled Tailwind ships no `w-96` to lean on.

## [0.2.1] - 2026-09-17

### Fixed

- **The status-bar popover no longer dismisses itself when the pointer reaches for it.** Opening
  the chip's popover and sliding the mouse toward it closed it immediately. Escape and a click
  outside still close it; a focus change the user never asked for no longer does
  (`onFocusOutside` is prevented). Every dismissal now logs which event fired, so `desktop.log`
  names the mechanism instead of leaving it to a guess.

## [0.2.0] - 2026-09-17

### Added

- `GET /search?q=&page=&per_page=` — free-text title search
  (`Page.media(search:, sort: SEARCH_MATCH)`), returning the same normalized media page as
  `/trending` and `/season` and sharing their 300 s TTL cache and rate-limit floor. Queries with
  fewer than two non-space characters are rejected before they spend budget, and the cache key
  folds case and padding, so `One Piece` and `  one piece ` cost one request, not two.
- **Season browser + title search (L1).** `host.openWorkspace` opens an `anilist` workspace tab
  with a season/year selector and a debounced search field over the 24 most popular titles of that
  season. The status-bar popover gains a seasons button that renders the same panel compact, so the
  search box exists once and only once, and a desktop without the workspace door falls back to that
  popover (the palette command points at it rather than failing silently). Season and search pages
  also cache for 300 s client-side, so flipping seasons re-reads the backend's TTL entry instead of
  spending new AniList budget.

### Fixed

- **The header now names the gateway the data actually comes from.** It read the registry's
  `primary` row instead, which is a different question: with an SSH box as primary and a local
  app-managed backend serving the requests, the popover claimed to be reading from the remote
  while every byte came from the local backend. Resolve `host.state.connectionId` instead — the
  app's active source, `local` for an app-managed backend, and the documented `null` treated as
  local — so the label re-renders on a connection or profile swap rather than freezing at
  `register()` time.
- The airing query key now carries the source and profile
  (`['plugin:hermes-anilist', <connectionId>, <profile>, 'airing']`). Two gateways can both
  expose a `default` profile; without the source in the key their rows shared one cache entry
  and overwrote each other.

## [0.1.1] - 2026-09-17

### Changed

- **Desktop surface is now a status-bar popover instead of a docked pane.** Closing the only pane a
  plugin contributes disables that plugin (core pane lifecycle), so a lone pane could not be
  dismissed without switching the feature off. The chip unfolds the upcoming-episode list; Escape or
  a click outside closes it.
- `manifest_version: 2` removed from `plugin.yaml`. `hermes plugins install` pins its own ceiling at
  1 (`hermes_cli/plugins_cmd.py`), so a v2 declaration made the plugin **uninstallable from git**
  while still loadable and catalog-valid. Every v2 field (`config_schema`, `python_dependencies`) is
  parsed with no version gate, so staying on v1 keeps the full feature set.
- Each row gains a hover action that opens the show on AniList (`ctx.os.openExternal`).
