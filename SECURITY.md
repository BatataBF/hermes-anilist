# Security Policy

## What this plugin is, security-wise

hermes-anilist is a Hermes plugin with three parts (see the README): a desktop half that runs in the
app's renderer, a backend half that runs inside the Hermes process serving your session, and two agent
tools. It **listens on nothing**: the routes it contributes are mounted by Hermes' own web server, behind
whatever authentication that server already has. The only host it talks to is `https://graphql.anilist.co`.

## Credentials

- **The token is optional and yours.** `ANILIST_TOKEN` lives in the profile's `.env`
  (`<HERMES_HOME>/.env`), read through `agent.secret_scope` — profile-scoped, fail-closed under
  multiplex. It never reaches the renderer: the pane hands a pasted token *to* the backend and every
  answer back carries the viewer's name and avatar, never the token or a prefix of it.
- **No shared application ships with the plugin.** You register your own AniList app; its public Client
  ID lives in the plugin's profile-scoped state under
  `<HERMES_HOME>/plugin-data/agent-plugin-hermes-anilist-<digest>/`. There is no plugin-wide client id
  to leak or rotate, and no third party's application between you and your account.
- **Revoking access**: *Disconnect* in Settings ▸ AniList account removes the token from the profile.
  Also revoke it in AniList's own settings if you want it dead everywhere.
- **Rotating the app**: create a new app, paste the new Client ID, connect again, and delete the old app
  in AniList. Nothing else in the plugin needs to change.

## What the plugin deliberately does not do

- No telemetry, analytics, or outbound call to anything but AniList.
- No self-update: `hermes plugins update hermes-anilist` is the only path, and a catalog install checks
  out the reviewed pin.
- No privileged capabilities (`tools.override`, `llm.*`), no extra environment variables, no second
  HTTP client (the 30 req/min budget is shared with the pane, on purpose).
- No destructive action without a confirmation: removing a show deletes the entry on AniList, so it is
  confirmed in a dialog first.
- No credential in a cron job. An episode alert stores a prompt and AniList ids on the host you chose;
  the job asks AniList's public API itself, so it needs no token.

## Deployment notes

- **Alerts and the digest run where you point them.** If you schedule them on another host (a VPS, an
  SSH gateway), that host's cron store and its delivery channel are what carry the notification — read
  that host's own configuration as part of your trust decision. The plugin only writes jobs it
  namespaces (`[anilist:*]`) and can list back.
- The desktop half is opt-in (`defaultEnabled: false`) and so is the plugin. Enabling it grants its
  code the same in-process trust as any Hermes plugin; there is no sandbox.

## Reporting a vulnerability

Report privately through this repository's **GitHub Security Advisories** (Security → Report a
vulnerability), or open a minimal issue that describes the impact without implementation details.

Please do **not** paste, screenshot, or attach:

- your `ANILIST_TOKEN` or any part of it;
- the contents of `<HERMES_HOME>/.env`;
- your AniList list, notes, or scores if that is not necessary to describe the problem.

A minimal reproduction against public AniList data is always enough; the API is public and needs no
credential to exercise.
