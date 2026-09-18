# Changelog

All notable changes to this project are documented here.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A screenshot gallery in the README** (`docs/screenshots/`) with a `manifest.json` recording each
  image's surface, theme and window size — the chip's popover, the Catalog tab, and a show's page. Taken
  from the app on a real account: no mock data, and nothing credential-shaped in frame.
- **`CONTRIBUTING.md`** — the loop (clone → the exact commands → `hermes plugins update`), the safety
  invariants a change has to respect (the renderer never holds a credential, one HTTP client and one
  cache, reads name their store, `null` is never invented, writes are absolute, declared capabilities
  match reality, handlers take `**kw`), where each test lives, and the PR checklist.
- **`SECURITY.md`** — what the plugin is security-wise (it listens on nothing; the only host it talks to
  is AniList), where the token and the client id live, what it deliberately never does (no telemetry, no
  self-update, no privileged capabilities, no credentials in cron jobs), and how to report a problem
  without pasting a token or your list.
- **`ruff.toml`, and ruff in CI** — bug-focused rules (undefined names, unused imports, blind excepts
  that carry no reason, unsafe defaults), with the annotation-modernization rules off on purpose: the
  backend writes `Dict`/`Optional` the way the host codebase does, and `from __future__ import
  annotations` makes those rewrites cosmetic. The test job runs a Python 3.11 **and** 3.12 matrix, so the
  source stays installable on the next Python too.
- **The tools' arguments, in the README** — a value table and a JSON example for `anilist_list` and
  `anilist_show`, including what `limit`/`episodes` clamp to and that a truncated answer says so.
- **A repository layout section**, so the four halves and the dev tooling are findable from the README.
- The full update paths: `hermes plugins update` + restart, `--force` reinstall, a hand-made clone, and
  the difference a catalog install has (its pin, never `git pull`).

### Changed

- **The catalog submission moved out of the README.** It is maintainer-facing process, not a feature a
  reader needs: it lives in [`CONTRIBUTING.md`](CONTRIBUTING.md) now (the checklist, the entry file, the
  two-week pin rule and how a release bumps the pin), and the README keeps a one-line pointer. Nothing in
  `plugin-catalog/` is read by Hermes at runtime, and the README no longer implies otherwise.
- **The show page's screenshot no longer names a host.** The `RUN ON` control is redacted where it showed
  the alert destination; the rest of the capture is untouched. Two other captures were left out of the
  gallery entirely because they showed the account row and the destination list.
- `.gitignore` covers the caches and build outputs of that tooling (`.ruff_cache/`, `.coverage`,
  `htmlcov/`, `dist/`, `node_modules/`, `.env`), so a contributor's tree stays clean.

### Fixed

- **CI's validator job could never pass.** `hermes plugins validate` ran through the upstream reusable
  action `NousResearch/hermes-agent/.github/actions/plugin-validate`, whose install step is
  `pip install git+https://github.com/NousResearch/hermes-agent@<ref>` — and Hermes' `setup.py` refuses to
  build a wheel outside a Nix build (`HERMES_NIX_BUILD=1`), so every run since the workflow landed died in
  `Failed building wheel for hermes-agent`. The job now checks out Hermes, installs it editably with
  `uv sync --no-dev`, and runs `validate` plus `doctor --ci` from that venv, with a comment saying why so
  the action does not come back. The `tests` job was green throughout.
- Lint findings the new rules surfaced: a stale `# noqa` on five handlers whose excepts are deliberately
  blind (they now carry a `BLE001` directive *and* the reason), two un-sorted import blocks, one
  `open()` without a context manager, and a shebang on a file nobody could execute. The explanatory
  comments that rode on those directives were kept as plain comments — the directive was unnecessary,
  the *why* was not.

## [0.8.0] - 2026-09-17

### Added

- **A list row knows which season a show belongs to.** The account list's own `season` and
  `seasonYear` ride along, so "what am I watching this season" is answered exactly instead of by
  approximation (a show that airs this week is *probably* this season's). The device's own list never
  stored them, so those rows leave the fields out rather than guessing.
- **The catalog entry, ready to submit.** `plugin-catalog/hermes-anilist.yaml` holds the
  `NousResearch/hermes-agent` entry verbatim — reviewed, SHA-pinned, `tier: community`,
  `category: desktop` — with the release commit as the only thing that ever moves, so a pin bump is the
  same file with a new `sha` and a new `version`.
- **CI on every push and pull request**: `hermes plugins validate` through the same reusable action the
  catalog's admission runs, the offline backend suite, and the desktop half's helper and locale checks.
- **The schedule as a calendar.** A show's page carries a month grid of its air dates now: the days
  that air are marked, the next one is filled and names its episode, the arrows stop where the
  schedule does, and the day you pick lists what lands on it. All of it in your own timezone —
  AniList publishes a moment, not a day.
- **An episode table with the columns the old list hid** — weekday, date and air time each in its
  own column, past episodes receding, the next one named.
- `tools/class_audit.mjs`: every `className` in `desktop/plugin.js` checked against the installed
  app's compiled stylesheet. A class the build never emitted renders as nothing, silently.
- **Agent tools: `anilist_list` and `anilist_show`.** The model can read the list you actually track
  — with `filter: airing | behind | not_started`, each row carrying status, progress, the next
  episode and its air time — and ask about one anime: AniList's score (0-100, `null` when there is
  none), its all-time rankings *with their context*, spoiler-free tags, the score distribution,
  related works in story order (each flagged with whether it is already in your list) and the
  community's recommendations with their vote counts. A title resolves itself and the answer says
  which show it resolved to. Both tools name the list they read: your AniList account's, or this
  device's when you are signed out.
- **A bundled skill** (`skills/usage/SKILL.md`, registered as `hermes-anilist:usage`) that teaches the
  model the map from question to tool and the honesty rules — no scores from memory, `null` is not
  zero, a tag list is not a plot summary, and nothing in these two tools writes.
- The show detail now carries what an agent asks and the pane never did: relations, recommendations,
  rankings, tags, favourites and the score spread, in the same `/anime/{id}` response the pane reads.
- **The chip says which episode it counts down to** — `EP 12/12` when AniList has published the
  show's length, `EP 12` when it has not — and a small bell appears once a reminder is armed for
  that very episode, which is the one question about alerts the chip can answer without opening
  anything.
- **Right-click on the chip opens a menu**: the show's page, the show on AniList, *Refresh now*, and
  Settings. Left-click still opens the panel; the show-specific items are absent when there is no
  episode to talk about.

### Changed

- **The README is the plugin's front door now**: what it can do by surface, the three install routes,
  the AniList account walkthrough step by step (with the redirect URL AniList compares literally), the
  agent tools and the rules that make them trustworthy, and the catalog checklist with where this repo
  stands on each line.
- **The status-bar chip follows *your* list, not the whole schedule.** The episode it shows is the
  earliest one among the shows you track — your AniList list when you are signed in, this device's own
  list when you are not, one rule either way, and the minute-by-minute refresh it already had rolls it
  over as each episode goes out. A `+N` says how many more of yours land in the next 24 hours, the
  hover text says the same in words, and when nothing of yours airs in the window it says *nothing of
  yours airs soon* instead of quietly showing someone else's show — the tooltip spells out the window;
  when nothing is tracked at all it says that, naming both ways to fill the list.
- **The show page leads with what it is for.** The next episode, its day and hour, and the alert
  action share a card at the top now, instead of being scattered between the metadata and a wall of
  text.
- **The tracking status is a select**, not a six-button track — AniList's own vocabulary, and the
  same reason the alert destinations became one.
- **The synopsis lives beside the cover**, clipped to the art's height and faded out where it runs
  past — a mask, so the same rule reads right in a light and a dark theme — with a *Read more* when it
  genuinely overflows. Never a fade or a button that implies text which is not there. The gap next to
  the art was room the page already had, and the schedule no longer sits below a wall of prose.
- **The status-bar chip reads like a status item**: it wears an icon — a clock, or a broadcast mark
  once its episode is within the hour — the countdown is the brightest thing in it, and the label is
  the same small-caps `ANILIST` the app's own items use.
- **The popover's second door goes to Settings.** *Search a show* sent the reader out of the feed and
  then hunting for a search box; the button opens Settings now, where every preference lives. Search
  stays in the workspace's Catalog tab and in the command palette.

### Fixed

- **The agent tools take the context Hermes' dispatcher forwards.** The first real question asked of
  `anilist_list` came back as `TypeError: _handle_list() got an unexpected keyword argument 'task_id'`:
  `model_tools.py` passes `task_id` and `session_id` to *every* tool call, and a handler that declares
  only its arguments dies before it can read anything. Both handlers accept them now, and a test
  registers the plugin the way the loader does and calls every registered handler with that context, so
  the bug class cannot return in a third tool.

## [0.7.0] - 2026-09-17

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
  the whole thing).

- **The answer cache is bounded.** Every key is a question (a query at a page, a window at a cursor)
  and a long-lived gateway mints hundreds of them: the cache now holds at most 256 entries, evicting
  expired ones first and then whatever is closest to expiring.
- **One pooled HTTP client, and every request identifies the plugin.** The airing feed stitches up to
  `MAX_AIRING_PAGES` pages per refresh and each request used to open its own `httpx.AsyncClient`; the
  process keeps a single pooled client now (rebuilt when closed, five fewer handshakes on a dense
  window) and sends `User-Agent: hermes-anilist/…` — AniList answered 403 to an anonymous agent
  string when the digest ran, and it asks clients to identify themselves.
- **Opening the workspace refreshes the tab instead of replacing it.** Every *See everything* /
  *Search a show* / ⌘K entry used to close the tab the plugin had opened and open a fresh one,
  losing the scroll position and the show it was drilled into. Re-calling `host.openWorkspace` with
  the same id fronts the existing tab in place (the SDK's own contract), so the close/reopen dance
  and its stale-disposer guard are gone.
- **Destinations are a select, and the digest says where it runs.** *Run on* (inside Daily digest) and
  *Default destination* were the same four-option segmented track shown twice on one screen; both are
  one-line selects now — the registry can expose any number of connections and profiles, and a
  segmented track stops reading past three. The default row carries a line saying what it decides, and
  *In the app* is capitalized like its neighbours.
- **The popover is as tall as its rows.** The compact list carried a fixed 20rem height — what the
  kit's `ScrollArea` needs — so two episodes left most of the menu empty. It is a capped scroller now:
  it grows with the list and scrolls past 20rem, no measurement and no magic row height. Its two
  footer doors (*See everything* / *Search a show*) also share one style, instead of a bordered button
  sitting beside a plain label.
- **Handler copy speaks the active locale.** The chip's fallback notice, the refresh toast and the
  three palette labels were hardcoded English (`STRINGS.en.…`): they go through `ctx.i18n.t` now, so an
  install whose language is Spanish gets its own copy instead of the English fallback, and the palette
  labels follow the app's configured language.
  `tools/i18n_audit.mjs` keeps both locales honest — 118 keys, none missing, none skewed — with its
  scan bounded to the `STRINGS` literal (the naive version picked up `queryKey:`/`className:` from the
  code below the last locale and read them as skew).
- **The desktop half is under test.** `tools/test_plugin_helpers.mjs` lifts the pure helpers out of
  `desktop/plugin.js` by name — the app loads that file whole, uncompiled — and asserts the decisions
  that used to be eyeballed: countdown buckets, day grouping, the feed filters, the merge dedupe, the
  destination fallback, and the digest's id list and schedule.

### Fixed

- **Settings clips nothing: the whole pane scrolls.** The workspace rendered it unwrapped while the
  other three panels sit inside a `ScrollArea` (`flex-1` + `minHeight: 0` against the bounded column),
  so a short window left *Filter at startup*, *Cover art* and the closing note cut off with no way to
  reach them.
- **Rows answer to the keyboard.** The airing and browse rows were click-only `div`s — opening a show
  is reachable now with Tab, Enter and Space (the row's own buttons keep their own focus).
- **The daily digest was listed as an episode alert.** `isAlert` matched the shared `[anilist` prefix
  and the digest is named `[anilist:digest] …`, so Settings showed it twice: a row under *Alerts* with
  Pause/Remove control, plus its own section. The alert predicate now excludes it, and the list the
  destination fallback reads still sees every job this plugin owns — digest included.
- **The stitched airing window ignored the rate floor.** `_cached` checks the budget before the
  first request, but a 7-day window is up to `MAX_AIRING_PAGES` cursor pages — a dense season could
  spend the last of the host's shared 30/minute on a continuation page. The loop now stops between
  pages when the floor trips, keeps what the first page returned, and leaves `hasNextPage` true so the
  *Show more* footer can continue later.
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
  filter, **My list**, narrows the feed to what is being tracked — their next 7 days are a handful
  of episodes, not a hundred.
- **A show detail view.** Any title opens it in the workspace tab: cover, format, status, length,
  duration, score, studio, genres, the next episode's countdown, the description as text, the
  episode list with its own **Show more** (paged on top of the first 25 that ride along with the
  detail), and the tracking controls — status among AniList's five, progress ±, remove. The tab strip
  keeps showing *Upcoming* while drilled in, and *Back* goes back to the feed.
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
  by *Today* / *Tomorrow* / *Fri 19* and closed with the kit's `Separator`. Grouping is presentation
  only — the feed, its order and the AniList budget are untouched — and the single-day filter stays
  a flat list, where a header would only repeat the filter itself.

- **A "Show more" footer** under the multi-day list, shown only when the feed really is truncated (the
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
- `/airing` takes `after=<unix seconds>`: the cursor behind **Show more**, returning episodes strictly
  after the last row on screen. The cursor keys the cache (not the wall clock), so two clicks a
  second apart cost one request, and a stale cursor never re-fetches the past.

### Fixed

- **The row actions are no longer hover-only.** The track star and the "open on AniList" button appeared
  only while the pointer rested on a row (`opacity-0` plus a `group-hover` reveal), which reads as
  "the buttons are missing" — and since a *tracked* row was the only one whose star ever showed, the
  feature looked like it existed only for today. Both are always visible now, muted until tracked or
  pointed at.
- **A day header past tomorrow rendered `E 19` instead of a weekday name.** The names were registered
  as an array, but a plugin i18n value is only ever `string | ((...args) => string)` — anything else
  resolves back to the key itself, so `t('dayNames')` handed back the string `"dayNames"` and the
  code indexed *that* (`"dayNames"[6]` → `e`, upper-cased by the header's `uppercase`). The names
  are a function now, with the constraint written next to them.

## [0.4.0] - 2026-09-17

### Added

- **A settings view**, reachable from the shared view switcher (Upcoming · Catalog · Settings) in
  both the popover and the workspace tab, and from the palette (`AniList: Settings`). Preferences are
  client-side and per install (`ctx.storage`), so none of them needs a gateway round trip:
  **title language** (English / Romaji / Native), **feed window** (3 / 7 / 14 days, which the airing
  query honors), **filter** (the popover's control and the settings row deliberately write the same
  value — what you pick in passing is what the next open remembers) and **cover art** on or off.
- The popover **names its views**: the switcher spells out Upcoming, Catalog and Settings instead
  of hiding them behind a glyph.

### Changed

- `normalize_media_page` and `normalize_airing` now also return `titles: {romaji, english, native}`,
  with `null` flattened to `""` so callers can fall through. `title` keeps its
  english → romaji → native preference, so existing callers are unaffected.

## [0.3.0] - 2026-09-17

### Added

- **A window filter on the upcoming list** — `Today` / `7 days`, as a `SegmentedControl` beside the
  section title. The feed is always fetched as a seven-day window and narrowing happens
  client-side, so flipping the filter back and forth never spends AniList budget. `Today` ends at the
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
