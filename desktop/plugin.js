/**
 * hermes-anilist — desktop half of the unified package.
 *
 * Loaded uncompiled by the Electron renderer; only three module specifiers
 * resolve: @hermes/plugin-sdk, react and react/jsx-runtime. That means:
 *
 *   - no JSX syntax — UI is built with jsx() / jsxs() calls;
 *   - no colors of our own — theme variables (var(--ui-*)) and the app's UI kit;
 *   - no fetch() — data arrives through ctx.rest (our backend namespace) or
 *     host.request (gateway JSON-RPC).
 *
 * Surface choice: a status-bar chip that unfolds a popover, NOT a docked pane.
 * Closing the only pane a plugin contributes disables that plugin (core pane
 * lifecycle), which makes a lone pane a trap — it cannot be dismissed without
 * switching the whole feature off. A popover has no such coupling: it opens on
 * a click and closes on Escape or click-outside, like any built-in control.
 *
 * Source of truth for the contract:
 * website/docs/developer-guide/desktop-plugin-sdk.md in the hermes-agent tree.
 */

import {
  Badge,
  Button,
  Codicon,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  PALETTE_AREA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
  Separator,
  Skeleton,
  Tip,
  atom,
  cn,
  haptic,
  host,
  queryClient,
  usePluginI18n,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-anilist'
const SOURCE = `plugin:${ID}`

/** Bound in register(ctx). */
let rest = null
let osDoor = null
let store = null
/** Resolved in register() from ctx.i18n.t: handlers and palette entries have no hook to translate with. */
let t = (key) => key

/** Registry connections (id → human label), loaded once at register(). */
const $registry = atom({})

const STRINGS = {
  en: {
    title: 'AniList',
    origin: (connection, profile) => (connection ? `${connection} · ${profile}` : profile),
    upcoming: 'Upcoming episodes',
    airingNow: 'airing now',
    inDays: (d, h) => `in ${d}d ${h}h`,
    inHours: (h, m) => `in ${h}h ${m}m`,
    inMinutes: (m) => `in ${m}m`,
    episode: (n) => `EP ${n}`,
    retry: 'Retry',
    refresh: 'Refresh',
    refreshed: 'AniList refreshed',
    openOnAniList: 'Open on AniList',
    empty: 'Nothing airing in this window.',
    backendMissing: 'AniList backend unavailable',
    backendHint: (profile) =>
      `Install and enable hermes-anilist on the host serving "${profile}": ` +
      'hermes plugins install hermes-anilist',
    unreachable: 'AniList is unreachable',
    localDevice: 'This device',
    chipLabel: 'AniList — upcoming episodes',
    chipScope: 'from your list',
    chipMore: (count) => `+${count}`,
    chipMoreHint: (count, hours) => `and ${count} more in the next ${hours}h`,
    chipAlertArmed: 'alert armed',
    menuOpenShow: 'Open the show page',
    menuRefresh: 'Refresh now',
    chipNothingAiring: 'nothing of yours airs soon',
    chipNothingTracked: 'no shows tracked',
    chipNothingAiringHint: (days) => `Nothing in your list airs in the next ${days} days.`,
    chipNothingTrackedHint:
      'Track a show — or sign in to AniList to use your AniList list — and its next episode shows up here.',
    seasons: 'Catalog',
    seasonName: (season) =>
      ({ WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' })[season] || season,
    searchPlaceholder: 'Search a title…',
    noResults: 'No titles match that search.',
    chipFallback: 'Open the anilist chip in the status bar and use its tabs.',
    paletteSeasons: 'AniList: Seasons & search',
    paletteSettings: 'AniList: Settings',
    paletteRefresh: 'AniList: Refresh',
    filterToday: 'Today',
    emptyToday: 'Nothing left today — the next episode is another day.',
    filterList: 'My list',
    emptyList: 'Nothing from your list airs in this window.',
    track: 'Track',
    untrack: 'Untrack',
    back: 'Back',
    addToList: 'Add to my list',
    removeFromList: 'Remove from my list',
    watchStatus: 'Status',
    watchStatusName: (status) =>
      ({ watching: 'Watching', rewatching: 'Rewatching', planned: 'Planned', completed: 'Completed', paused: 'Paused', dropped: 'Dropped' })[
        status
      ] || status,
    progressLabel: 'Progress',
    episodesTitle: 'Episodes',
    scheduleTitle: 'Schedule',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    columnEpisode: 'EP',
    columnDay: 'Day',
    columnDate: 'Date',
    columnTime: 'Time',
    leftToAir: (count) => `${count} to air`,
    synopsis: 'Synopsis',
    readMore: 'Read more',
    readLess: 'Show less',
    noEpisodes: 'AniList has no air dates for this one.',
    noDescription: 'AniList has no description for this one yet.',
    nextEpisode: 'Next episode',
    episodeCount: (count) => `${count} ep`,
    episodeProgress: (episode, total) => `EP ${episode}/${total}`,
    scoreOutOf: (score) => `★ ${score}%`,
    monthName: (index) =>
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][index] || '',
    monthFull: (index) =>
      [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December'
      ][index] || '',
    tabUpcoming: 'Upcoming',
    openUpcoming: 'See everything',
    openSettings: 'Settings',
    sectionAccount: 'Account',
    sectionPreferences: 'Preferences',
    settings: 'Settings',
    settingTitleLanguage: 'Title language',
    titleEnglish: 'English',
    titleRomaji: 'Romaji',
    titleNative: 'Native',
    settingWindow: 'Feed window',
    daysShort: (days) => `${days} days`,
    settingDefaultFilter: 'Filter at startup',
    settingCovers: 'Cover art',
    settingOn: 'On',
    settingOff: 'Off',
    settingsAuthNote:
      'Nothing here needs an account: the feed, seasons and search read AniList publicly. Connecting an account is for importing and syncing your own list.',
    account: 'AniList account',
    accountConnected: 'Connected',
    accountHint:
      'Optional, and it keeps your lists in sync. Each AniList account uses its own app — the plugin ships no shared credentials.',
    accountStepApp: '1 · Create an app with this redirect',
    accountOpenDeveloper: 'Open AniList developer settings',
    accountStepClientId: '2 · Paste its Client ID',
    accountClientId: 'Client ID',
    accountSave: 'Save',
    accountStepToken: '3 · Get a token and paste it',
    accountGetToken: 'Get AniList token',
    accountEntryTip: 'Your AniList entry',
    confirmRemoveTitle: (title) => `Remove “${title}” from your list?`,
    confirmRemoveBody: 'This deletes the entry on AniList — its score, notes and progress go with it.',
    confirmRemoveAction: 'Remove',
    alerts: 'Alerts',
    alertAdd: (episode) => `Alert me when EP ${episode} airs`,
    alertActive: (episode, when) => `EP ${episode} alert${when ? ` · ${when}` : ''}`,
    alertRemove: 'Remove',
    alertPause: 'Pause',
    alertResume: 'Resume',
    alertPaused: 'paused',
    alertEmpty: 'No alerts yet. Open a show and ask to be told when its next episode airs.',
    alertFailed: 'The alert could not be saved.',
    alertsUnavailable: 'Alerts need the Hermes gateway.',
    alertDestination: 'Run on',
    destinationLocal: 'This device',
    alertDeliveryLabel: 'Notify via',
    deliverLocal: 'In the app',
    settingAlertRoute: 'Default destination',
    settingAlertRouteHint: 'New alerts run here unless a show says otherwise.',
    alertsHostUnreachable: (host) => `Could not reach ${host}.`,
    alertRunFailed: 'last run failed',
    alertBlocked: 'blocked by host config',
    digestTitle: 'Daily digest',
    digestHint: (count) => `One message a day with what airs from your list (${count} shows).`,
    digestHour: 'At',
    digestAt: (hour) => `${String(hour).padStart(2, '0')}:00`,
    digestArm: 'Arm the digest',
    digestJobName: 'Daily digest',
    // What the job runs, wherever it runs: the ids are baked in because that host
    // may not have this plugin — the public API is all it needs.
    digestPrompt: (ids) =>
      `Anime digest for today. Ask the public AniList API (POST https://graphql.anilist.co; if it answers 403, retry with a browser User-Agent) ` +
      `about these ids: ${ids}.\n\nYour reply IS the message that gets sent: start straight with the content — no preamble, no notes, ` +
      `no questions, no mention of tools or verification, and nothing after the last link.\n\n` +
      `Format: one line per show airing TODAY, "Title — ep N — HH:MM — https://anilist.co/anime/<id>". ` +
      `If nothing airs today, list tomorrow's in the same format and start the message with "Nothing today; tomorrow:".`,
    // What the cron job runs: a prompt the agent acts on at airing time.
    alertPrompt: (title, episode, url) =>
      `Tell me right away: ${title} — episode ${episode} has just aired. Details: ${url}`,
    accountToken: 'Paste the token AniList shows',
    accountConnect: 'Connect',
    accountConnectedAs: (name) => `Connected as ${name}`,
    accountOpenProfile: 'Open my AniList profile',
    accountDisconnect: 'Disconnect',
    accountTokenRejected: 'AniList rejected that token — copy it again from AniList.',
    accountClientIdInvalid: 'That client ID does not look right (letters and digits only).',
    accountStaleToken: 'The stored token no longer works. Paste a fresh one.',
    moreHint: (days) => `More episodes in the next ${days} days`,
    loadMore: 'Show more',
    loadingMore: 'Loading…',
    dayToday: 'Today',
    dayTomorrow: 'Tomorrow',
    // A function, not an array: plugin i18n values are string | ((...args) => string).
    dayName: (index) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index] || ''
  },
  es: {
    title: 'AniList',
    origin: (connection, profile) => (connection ? `${connection} · ${profile}` : profile),
    upcoming: 'Próximos episodios',
    airingNow: 'saliendo ahora',
    inDays: (d, h) => `en ${d}d ${h}h`,
    inHours: (h, m) => `en ${h}h ${m}m`,
    inMinutes: (m) => `en ${m}m`,
    episode: (n) => `EP ${n}`,
    retry: 'Reintentar',
    refresh: 'Actualizar',
    refreshed: 'AniList actualizado',
    openOnAniList: 'Abrir en AniList',
    empty: 'No hay estrenos en esta ventana.',
    backendMissing: 'Backend de AniList no disponible',
    backendHint: (profile) =>
      `Instalá y habilitá hermes-anilist en el host que sirve "${profile}": ` +
      'hermes plugins install hermes-anilist',
    unreachable: 'AniList no responde',
    localDevice: 'Este equipo',
    chipLabel: 'AniList — próximos episodios',
    chipScope: 'de tu lista',
    chipMore: (count) => `+${count}`,
    chipMoreHint: (count, hours) => `y ${count} más en las próximas ${hours} h`,
    chipAlertArmed: 'alerta armada',
    menuOpenShow: 'Abrir la ficha',
    menuRefresh: 'Actualizar ahora',
    chipNothingAiring: 'nada tuyo emite pronto',
    chipNothingTracked: 'sin series seguidas',
    chipNothingAiringHint: (days) => `Nada de tu lista emite en los próximos ${days} días.`,
    chipNothingTrackedHint:
      'Seguí una serie — o iniciá sesión en AniList para usar tu lista de AniList — y su próximo episodio aparece acá.',
    seasons: 'Catálogo',
    seasonName: (season) =>
      ({ WINTER: 'Invierno', SPRING: 'Primavera', SUMMER: 'Verano', FALL: 'Otoño' })[season] || season,
    searchPlaceholder: 'Buscá un título…',
    noResults: 'Ningún título coincide con esa búsqueda.',
    chipFallback: 'Abrí el chip anilist de la barra de estado y usá sus solapas.',
    paletteSeasons: 'AniList: Temporadas y búsqueda',
    paletteSettings: 'AniList: Ajustes',
    paletteRefresh: 'AniList: Actualizar',
    filterToday: 'Hoy',
    emptyToday: 'Hoy no queda nada — el próximo episodio es otro día.',
    filterList: 'Mi lista',
    emptyList: 'Ninguna de tus series emite en esta ventana.',
    track: 'Seguir',
    untrack: 'Dejar de seguir',
    back: 'Volver',
    addToList: 'Agregar a mi lista',
    removeFromList: 'Quitar de mi lista',
    watchStatus: 'Estado',
    watchStatusName: (status) =>
      ({ watching: 'Viendo', rewatching: 'Reviendo', planned: 'Planeado', completed: 'Visto', paused: 'En pausa', dropped: 'Abandonado' })[
        status
      ] || status,
    progressLabel: 'Progreso',
    episodesTitle: 'Episodios',
    scheduleTitle: 'Calendario',
    previousMonth: 'Mes anterior',
    nextMonth: 'Mes siguiente',
    columnEpisode: 'EP',
    columnDay: 'Día',
    columnDate: 'Fecha',
    columnTime: 'Hora',
    leftToAir: (count) => `${count} por emitir`,
    synopsis: 'Sinopsis',
    readMore: 'Leer más',
    readLess: 'Mostrar menos',
    noEpisodes: 'AniList no tiene fechas de emisión para este título.',
    noDescription: 'AniList todavía no tiene descripción para este título.',
    nextEpisode: 'Próximo episodio',
    episodeCount: (count) => `${count} ep`,
    episodeProgress: (episode, total) => `EP ${episode}/${total}`,
    scoreOutOf: (score) => `★ ${score}%`,
    monthName: (index) =>
      ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][index] || '',
    monthFull: (index) =>
      [
        'enero',
        'febrero',
        'marzo',
        'abril',
        'mayo',
        'junio',
        'julio',
        'agosto',
        'septiembre',
        'octubre',
        'noviembre',
        'diciembre'
      ][index] || '',
    tabUpcoming: 'Próximos',
    openUpcoming: 'Ver todo',
    openSettings: 'Ajustes',
    sectionAccount: 'Cuenta',
    sectionPreferences: 'Preferencias',
    settings: 'Ajustes',
    settingTitleLanguage: 'Idioma de títulos',
    titleEnglish: 'Inglés',
    titleRomaji: 'Romaji',
    titleNative: 'Original',
    settingWindow: 'Ventana del feed',
    daysShort: (days) => `${days} días`,
    settingDefaultFilter: 'Filtro al abrir',
    settingCovers: 'Carátulas',
    settingOn: 'Sí',
    settingOff: 'No',
    settingsAuthNote:
      'Nada de esto necesita cuenta: el feed, las temporadas y la búsqueda leen AniList de forma pública. Conectar una cuenta es para importar y sincronizar tu propia lista.',
    account: 'Cuenta de AniList',
    accountConnected: 'Conectada',
    accountHint:
      'Opcional, y mantiene tus listas sincronizadas. Cada cuenta de AniList usa su propia app — el plugin no trae credenciales compartidas.',
    accountStepApp: '1 · Creá una app con este redirect',
    accountOpenDeveloper: 'Abrir los ajustes de developer de AniList',
    accountStepClientId: '2 · Pegá su Client ID',
    accountClientId: 'Client ID',
    accountSave: 'Guardar',
    accountStepToken: '3 · Obtené un token y pegalo',
    accountGetToken: 'Obtener token de AniList',
    accountEntryTip: 'Tu entrada en AniList',
    confirmRemoveTitle: (title) => `¿Quitar “${title}” de tu lista?`,
    confirmRemoveBody: 'Esto borra la entrada en AniList: se van con ella su puntaje, sus notas y su progreso.',
    confirmRemoveAction: 'Quitar',
    alerts: 'Alertas',
    alertAdd: (episode) => `Avisarme cuando salga el EP ${episode}`,
    alertActive: (episode, when) => `Alerta EP ${episode}${when ? ` · ${when}` : ''}`,
    alertRemove: 'Quitar',
    alertPause: 'Pausar',
    alertResume: 'Reanudar',
    alertPaused: 'en pausa',
    alertEmpty: 'Todavía no hay alertas. Abrí una serie y pedí que te avise cuando salga el próximo episodio.',
    alertFailed: 'No se pudo guardar la alerta.',
    alertsUnavailable: 'Las alertas necesitan el gateway de Hermes.',
    alertDestination: 'Dónde',
    destinationLocal: 'Este equipo',
    alertDeliveryLabel: 'Avisarme por',
    deliverLocal: 'En la app',
    settingAlertRoute: 'Destino por defecto',
    settingAlertRouteHint: 'Las alertas nuevas corren acá salvo que una serie diga otra cosa.',
    alertsHostUnreachable: (host) => `No pude consultar ${host}.`,
    alertRunFailed: 'la última corrida falló',
    alertBlocked: 'bloqueado por la config del host',
    digestTitle: 'Resumen diario',
    digestHint: (count) => `Un mensaje al día con lo que sale de tu lista (${count} series).`,
    digestHour: 'A las',
    digestAt: (hour) => `${String(hour).padStart(2, '0')}:00`,
    digestArm: 'Armar el resumen',
    digestJobName: 'Resumen diario',
    // Lo que corre el job, donde sea que corra: los ids van incrustados porque ese
    // host puede no tener el plugin — la API pública es todo lo que necesita.
    digestPrompt: (ids) =>
      `Resumen diario de anime. Consultá la API pública de AniList (POST https://graphql.anilist.co; si responde 403, reintentá con User-Agent de navegador) ` +
      `para estos ids: ${ids}.\n\nTu respuesta ES el mensaje que se envía: empezá directo con el contenido — sin introducción, sin notas, ` +
      `sin preguntas, sin mencionar herramientas ni verificaciones, y nada después del último link.\n\n` +
      `Formato: una línea por serie que sale HOY, "Título — ep N — HH:MM — https://anilist.co/anime/<id>". ` +
      `Si hoy no sale nada, listá los de mañana con el mismo formato y empezá el mensaje con "Hoy no sale nada; mañana:".`,
    // Lo que corre el cronjob: un prompt que el agente ejecuta al airear.
    alertPrompt: (title, episode, url) =>
      `Avisame al toque: ${title} — el episodio ${episode} acaba de salir al aire. Ficha: ${url}`,
    accountToken: 'Pegá el token que muestra AniList',
    accountConnect: 'Conectar',
    accountConnectedAs: (name) => `Conectada como ${name}`,
    accountOpenProfile: 'Abrir mi perfil de AniList',
    accountDisconnect: 'Desconectar',
    accountTokenRejected: 'AniList rechazó ese token — copialo de nuevo.',
    accountClientIdInvalid: 'Ese Client ID no parece válido (sólo letras y números).',
    accountStaleToken: 'El token guardado ya no sirve. Pegá uno nuevo.',
    moreHint: (days) => `Hay más episodios en los próximos ${days} días`,
    loadMore: 'Ver más',
    loadingMore: 'Cargando…',
    dayToday: 'Hoy',
    dayTomorrow: 'Mañana',
    // Una función, no un array: los valores del i18n de plugins son string | ((...args) => string).
    dayName: (index) => ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][index] || ''
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function countdown(airingAt, t) {
  const ms = airingAt * 1000 - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return t('airingNow')
  const minutes = Math.floor(ms / 60000)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  if (d > 0) return t('inDays', d, h)
  if (h > 0) return t('inHours', h, minutes % 60)
  return t('inMinutes', minutes)
}

/** "EP 12/12" when the show's length is known, "EP 12" when AniList has not said. */
function episodeTag(item, t) {
  if (!item || !item.episode) return ''

  const total = Number(item.totalEpisodes)

  return total > 0 ? t('episodeProgress', item.episode, total) : t('episode', item.episode)
}

/** The clock face the chip wears: on air within the hour, or something still to wait for. */
function chipIcon(airingAt, now = Date.now() / 1000) {
  return airingAt && airingAt - now <= 3600 ? 'broadcast' : 'clock'
}

/** How far ahead "coming up" reaches: the chip is a glance at tonight, not a week. */
const CHIP_COMING_HOURS = 24

/**
 * Your episodes airing inside the chip's horizon, in air order.
 *
 * Only yours: the whole schedule is the popover's business, and a chip that
 * silently changes whose show it means is a chip nobody can trust. Signed in that
 * list is the AniList account's; signed out it is this device's own list, which
 * tracks the same way — one rule either way, so a login does not change what the
 * chip means.
 */
function comingAiring(items, ids, hours = CHIP_COMING_HOURS, now = Date.now() / 1000) {
  const until = now + hours * 3600

  return (items || []).filter(
    (item) => ids && ids.has(String(item.id)) && (item.airingAt || 0) <= until
  )
}

/** 404 from ctx.rest means the Python half is not mounted on this agent. */
function isMissingBackend(error) {
  const message = String((error && error.message) || error || '')
  return message.includes('404') || message.includes('Not Found')
}

async function refreshConnections() {
  try {
    if (typeof host.connections !== 'function') return
    const connections = (await host.connections()) || []
    $registry.set(Object.fromEntries(connections.filter((c) => c && c.id).map((c) => [c.id, c.label || c.id])))
  } catch {
    /* older app build without the registry: the label falls back to the id */
  }
}

/**
 * The gateway this surface is ACTUALLY reading from — not the registry's
 * `primary` row, which is a different question and, when it is an SSH box, a
 * lie about where the data comes from. `host.state.connectionId` is the app's
 * active source ('local' for an app-managed backend); the SDK documents a null
 * as the local/legacy path, so null maps to local here too. Reading it through
 * useValue re-labels the header on a connection or profile swap.
 */
function useSource() {
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile) || 'default'
  const registry = useValue($registry)
  const id = connectionId || 'local'

  return { id, label: registry[id] || null, profile }
}

// ─── settings (client-side, per install) ────────────────────────────────────

const SETTINGS_KEY = 'settings'
const TITLE_LANGUAGES = ['english', 'romaji', 'native']
const WINDOW_DAYS = [3, 7, 14]
// What a notification can come out of, in the CLI's own `--deliver` vocabulary.
// `local` is the run showing up in the app that owns the store; the rest are the
// channels a gateway box may have configured.
const ALERT_DELIVERIES = ['local', 'telegram', 'discord']
const DELIVERY_NAMES = { telegram: 'Telegram', discord: 'Discord' }
// The daily digest is a cron job of its own, in the same store: a cron expression
// (unlike an ISO one-shot) is stable, so re-reading it never has to guess.
const DIGEST_PREFIX = '[anilist:digest]'
const DIGEST_HOURS = [8, 9, 12, 20]
// A completed or dropped show cannot air; everything else can.
const DIGEST_STATUSES = ['watching', 'rewatching', 'paused', 'planned']
const DEFAULT_SETTINGS = {
  covers: true,
  defaultFilter: 'week',
  titleLanguage: 'english',
  windowDays: 7,
  alertDelivery: 'telegram',
  alertRoute: '',
  digestHour: 9
}

/** Whatever a previous version (or a hand-edited localStorage) left: keep the shape. */
function normalizeSettings(raw) {
  const stored = raw && typeof raw === 'object' ? raw : {}

  return {
    covers: stored.covers !== false,
    defaultFilter: ['today', 'week', 'list'].includes(stored.defaultFilter)
      ? stored.defaultFilter
      : DEFAULT_SETTINGS.defaultFilter,
    titleLanguage: TITLE_LANGUAGES.includes(stored.titleLanguage)
      ? stored.titleLanguage
      : DEFAULT_SETTINGS.titleLanguage,
    windowDays: WINDOW_DAYS.includes(Number(stored.windowDays))
      ? Number(stored.windowDays)
      : DEFAULT_SETTINGS.windowDays,
    alertDelivery: ALERT_DELIVERIES.includes(stored.alertDelivery)
      ? stored.alertDelivery
      : DEFAULT_SETTINGS.alertDelivery,
    // The destination is remembered as `connectionId:profile`, the same key the
    // query cache uses, so a route that disappeared falls back instead of matching
    // some other connection's profile of the same name.
    alertRoute: typeof stored.alertRoute === 'string' ? stored.alertRoute : DEFAULT_SETTINGS.alertRoute,
    digestHour: DIGEST_HOURS.includes(Number(stored.digestHour))
      ? Number(stored.digestHour)
      : DEFAULT_SETTINGS.digestHour
  }
}

/** Plugin storage is synchronous, JSON, and scoped per install. Read again after register(). */
const $settings = atom(normalizeSettings(null))

function saveSettings(patch) {
  const next = normalizeSettings({ ...$settings.get(), ...patch })
  $settings.set(next)

  try {
    store?.set?.(SETTINGS_KEY, next)
  } catch {
    /* best-effort: the session keeps the value either way */
  }
}

/** Which of AniList's three titles to show, falling through to what exists. */
function titleOf(item, language) {
  const titles = (item && item.titles) || {}

  return (
    titles[language] || titles.english || titles.romaji || titles.native || (item && item.title) || 'Untitled'
  )
}

function useAiring() {
  const source = useSource()
  const { windowDays } = useValue($settings)

  return useQuery({
    // The window is a setting, so it belongs in the key: two windows are two feeds.
    queryKey: [SOURCE, source.id, source.profile, 'airing', windowDays],
    queryFn: () => rest(`/airing?days=${windowDays}`),
    refetchInterval: 60000,
    retry: 1
  })
}

/** Midnight at the END of the user's own day — "today" must mean their today. */
function endOfToday(now = new Date()) {
  const end = new Date(now)
  end.setHours(24, 0, 0, 0)

  return Math.floor(end.getTime() / 1000)
}

/**
 * The feed is always fetched as a window; narrowing it is client-side so
 * flipping the filter back and forth never spends AniList budget. "My list" is
 * the same narrowing against the ids the reader tracks, and an episode that just
 * started still belongs to today — the row's own countdown says "airing now".
 */
function withinFilter(items, filter, ids, end = endOfToday()) {
  if (filter === 'list') return items.filter((item) => ids.has(String(item.id)))
  if (filter !== 'today') return items

  return items.filter((item) => (item.airingAt || 0) <= end)
}

/** Local calendar day of an instant, as a stable grouping key. */
function dayKey(airingAt) {
  const at = new Date((airingAt || 0) * 1000)

  return `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`
}

/** Today / Tomorrow / "Fri 19" — what a day group is headed with. */
function dayLabel(airingAt, t, now = Date.now()) {
  const at = new Date((airingAt || 0) * 1000)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (dayKey(airingAt) === dayKey(now / 1000)) return t('dayToday')
  if (dayKey(airingAt) === dayKey(tomorrow.getTime() / 1000)) return t('dayTomorrow')

  const name = t('dayName', at.getDay())

  return `${name} ${at.getDate()}`.trim()
}

/**
 * Split an already time-ordered feed into local calendar days. Presentation
 * only: the feed itself is untouched, so sectioning costs nothing on the
 * AniList budget.
 */
function groupByDay(items) {
  const groups = []

  for (const item of items) {
    const key = dayKey(item.airingAt)
    const last = groups[groups.length - 1]

    if (last && last.key === key) {
      last.items.push(item)
    } else {
      groups.push({ items: [item], key })
    }
  }

  return groups
}

/** Identity of a feed row: a show can air twice in a window, an episode can't. */
function rowKey(item) {
  return `${item.id}:${item.episode}`
}

/**
 * What a row's star does, in one place.
 *
 * Adding is one tap and reversible. Taking a show off the list deletes the entry
 * on AniList — score, notes and progress go with it — so that tap asks first.
 * Signed out, the star is the local list as before.
 */
function rowToggle(item, tracked) {
  if (!tracked.account) return () => tracked.toggle(item)
  if (!tracked.has(item.id)) return () => tracked.account.add(item)

  return () => askRemoval(item, item.title)
}

/** One feed row, keyed the way the flat and the grouped list both need it. */
function airingRow(item, t, tracked) {
  return jsx(
    AiringRow,
    {
      item,
      entry: tracked.entry(item.id),
      onToggle: rowToggle(item, tracked),
      t,
      watched: tracked.has(item.id)
    },
    rowKey(item)
  )
}

/** One browse row (season or search hit), watched and keyed the same way. */
function mediaRow(item, t, tracked) {
  return jsx(
    MediaRow,
    {
      item,
      entry: tracked.entry(item.id),
      onToggle: rowToggle(item, tracked),
      t,
      watched: tracked.has(item.id)
    },
    `media:${item.id}`
  )
}

/**
 * Fold a deeper page onto the rows already on screen. The head wins a
 * collision (a refetch slides the window forward, so a row can land in both)
 * and the result is re-sorted, because the halves are only each individually
 * ordered.
 */
function mergeAiring(head, tail) {
  const seen = new Set(head.map(rowKey))
  const merged = [...head, ...tail.filter((item) => !seen.has(rowKey(item)))]

  return merged.sort((a, b) => (a.airingAt || 0) - (b.airingAt || 0))
}

// ─── watchlist (L2, local until sign-in lands) ──────────────────────────────

/** AniList's own five, the same set the backend stores. */
const WATCH_STATUSES = ['watching', 'planned', 'completed', 'paused', 'dropped']

function useWatchlist() {
  const source = useSource()

  return useQuery({
    queryKey: [SOURCE, source.id, source.profile, 'watchlist'],
    queryFn: () => rest('/watchlist'),
    staleTime: 30000,
    refetchInterval: false,
    retry: 1
  })
}

/**
 * The account's own list. Asked for only once an account is connected: signed
 * out it stays idle rather than spending a request that could only come back
 * empty. The list is read-only here — the import is the first half of sign-in,
 * and writing back is its own step.
 */
function useAccountList(connected) {
  const source = useSource()

  return useQuery({
    queryKey: [SOURCE, source.id, source.profile, 'accountList'],
    queryFn: () => rest('/list'),
    enabled: !!connected,
    staleTime: 60000,
    refetchInterval: false,
    retry: 1
  })
}

/**
 * What this plugin means by "my list": the account's when one is connected, the
 * local watchlist otherwise.
 *
 * One seam on purpose. Every row asks a single question — "is this tracked?" —
 * and never which store answered it; the two stores even speak the same status
 * vocabulary (the backend translates AniList's enum), so nothing downstream has
 * to branch. While an account is connected the local list is left alone rather
 * than mirrored into it: two stores both claiming to be the truth is exactly how
 * a list diverges in silence.
 */
function useTracked() {
  const source = useSource()
  const account = useAccount()
  const connected = !!(account.data && account.data.connected)
  const accountList = useAccountList(connected)
  const watchlist = useWatchlist()
  const local = watchRow(source, watchlist)
  const entries = connected
    ? (accountList.data && accountList.data.entries) || []
    : (watchlist.data && watchlist.data.items) || []
  const byId = new Map(entries.map((entry) => [String(entry.id), entry]))

  return {
    connected,
    entries,
    ids: new Set(byId.keys()),
    entry: (id) => byId.get(String(id)) || null,
    has: (id) => byId.has(String(id)),
    isLoading: connected ? accountList.isLoading : watchlist.isLoading,
    // Null while signed out: the entry lives on AniList, and writing to a local
    // copy instead would be a lie dressed as a button.
    account: connected
      ? {
          add: (item) => writeAccount(source, () => rest(`/list/${item.id}`, { method: 'PUT', body: { status: 'watching' } })),
          remove: (id) => writeAccount(source, () => rest(`/list/${id}`, { method: 'DELETE' })),
          setStatus: (id, status, totalEpisodes) =>
            writeAccount(source, () =>
              rest(`/list/${id}`, {
                method: 'PUT',
                // Picking "watched" fills the progress in, the way AniList's own
                // editor does: otherwise "watched" lands beside "7/12" and looks
                // like it did not take.
                body: status === 'completed' && totalEpisodes ? { progress: totalEpisodes, status } : { status }
              })
            ),
          setProgress: (id, progress) =>
            writeAccount(source, () => rest(`/list/${id}`, { method: 'PUT', body: { progress } }))
        }
      : null,
    // Signed out, the local list is still the one being edited — one tap, no dialog.
    toggle: connected ? null : (item) => local.toggle(item),
    drop: connected ? null : (id) => local.drop(id)
  }
}

/** The account's six, in the order the list itself sorts by. */
const ACCOUNT_STATUSES = ['watching', 'rewatching', 'paused', 'planned', 'completed', 'dropped']

/**
 * The show waiting on "yes, take it off my list". One atom rather than per-row
 * state: only one dialog exists (the chip mounts it), and any surface can ask.
 */
const $pendingRemoval = atom(null)

/** Ask before the one destructive write this plugin can make. */
function askRemoval(item, title) {
  haptic('tap')
  $pendingRemoval.set({ id: item.id, title })
}

/** One write path, so every surface re-reads the list once instead of per row. */
function writeAccount(source, work) {
  return work().then((result) => {
    void queryClient.invalidateQueries({
      queryKey: [SOURCE, source.id, source.profile, 'accountList']
    })

    return result
  })
}

/** Ids in the list as strings: AniList ids are numbers on both sides of the wire. */
function watchIdSet(watchlist) {
  return new Set(((watchlist && watchlist.items) || []).map((entry) => String(entry.id)))
}

/** What a first add carries: only what the row actually knows about the show. */
function entryFromItem(item) {
  return {
    id: item.id,
    status: 'watching',
    title: item.title || null,
    cover: item.cover || null,
    totalEpisodes: item.totalEpisodes || item.episodes || null
  }
}

/** One write path, so every surface re-reads the list once instead of per row. */
function writeWatchlist(source, work) {
  return work().then((result) => {
    void queryClient.invalidateQueries({
      queryKey: [SOURCE, source.id, source.profile, 'watchlist']
    })

    return result
  })
}

/**
 * The row-side view of the list: what a row needs to draw its star and to flip
 * it, without every row subscribing to the query itself.
 */
function watchRow(source, watchlist) {
  const ids = watchIdSet(watchlist)

  return {
    has: (id) => ids.has(String(id)),
    // A tracked show is updated, not re-added: PUT keeps its addedAt and any
    // progress the detail view has since recorded.
    add: (item) => writeWatchlist(source, () => rest(`/watchlist/${item.id}`, { method: 'PUT', body: entryFromItem(item) })),
    drop: (id) => writeWatchlist(source, () => rest(`/watchlist/${id}`, { method: 'DELETE' })),
    toggle: (item) =>
      ids.has(String(item.id))
        ? writeWatchlist(source, () => rest(`/watchlist/${item.id}`, { method: 'DELETE' }))
        : writeWatchlist(source, () => rest(`/watchlist/${item.id}`, { method: 'PUT', body: entryFromItem(item) }))
  }
}

/** "EP 7/12" when the show's length is known, plain "EP 7" when it is not. */
function episodeLabel(item, t) {
  return item.totalEpisodes ? t('episodeProgress', item.episode, item.totalEpisodes) : t('episode', item.episode)
}

/** "Viendo 7/24" — where the reader is, per the account's own list. */
function trackedLabel(entry, totalEpisodes, t) {
  const status = t('watchStatusName', entry.status)
  const progress = entry.progress || 0

  if (!progress) return status

  return totalEpisodes ? `${status} ${progress}/${totalEpisodes}` : `${status} ${progress}`
}

/** "− Progreso 7/24 +" — one control, whichever list the entry lives in. */
function ProgressStepper({ entry, onStep, show, t }) {
  const progress = entry.progress || 0
  const label = show.episodes
    ? `${t('progressLabel')} ${progress}/${show.episodes}`
    : `${t('progressLabel')} ${progress}`

  return jsxs('div', {
    className: 'flex items-center gap-1',
    children: [
      jsx(Button, {
        'aria-label': `${t('progressLabel')} −`,
        type: 'button',
        variant: 'ghost',
        size: 'sm',
        onClick: () => onStep(progress - 1),
        children: '−'
      }),
      jsx('span', {
        className: 'text-[0.6875rem] text-(--ui-text-secondary)',
        children: label
      }),
      jsx(Button, {
        'aria-label': `${t('progressLabel')} +`,
        type: 'button',
        variant: 'ghost',
        size: 'sm',
        onClick: () => onStep(progress + 1),
        children: '+'
      })
    ]
  })
}

/** "12 sep" — the day an episode aired, in the reader's own calendar. */
function airedDate(airingAt, t) {
  const date = new Date((airingAt || 0) * 1000)

  return `${date.getDate()} ${t('monthName', date.getMonth())}`
}

/** "10:30" — the hour a show goes up, on the reader's own clock. */
function clockTime(airingAt) {
  const at = new Date((airingAt || 0) * 1000)

  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** "September 2026" — the heading over one month of the calendar. */
function monthHeading(year, month, t) {
  return `${t('monthFull', month)} ${year}`
}

/** The first episode still to air, or nothing when the schedule is spent. */
function nextAiring(episodes, now = Date.now() / 1000) {
  const coming = (episodes || []).filter((episode) => episode && (episode.airingAt || 0) > now)

  return coming.sort((a, b) => a.airingAt - b.airingAt)[0] || null
}

/**
 * The month the calendar opens on: the next episode's, so the reader lands where
 * the show still is. A finished show opens on its last month instead of an empty
 * present — the schedule that exists is the one worth showing.
 */
function calendarMonth(episodes, now = Date.now() / 1000) {
  const next = nextAiring(episodes, now)
  const aired = (episodes || []).filter((episode) => episode && episode.airingAt)
  const fallback = aired.sort((a, b) => b.airingAt - a.airingAt)[0]
  const at = new Date(((next && next.airingAt) || (fallback && fallback.airingAt) || now) * 1000)

  return { year: at.getFullYear(), month: at.getMonth() }
}

/**
 * Six weeks of local days for one month, each cell carrying the episodes that air
 * on it. Always 42 cells so the grid never jumps height as the reader moves; a
 * cell's `key` is the same day key the feed groups by, so both surfaces agree on
 * what "a day" is.
 */
function monthGrid(episodes, year, month) {
  const byDay = new Map()

  for (const episode of episodes || []) {
    if (!episode || !episode.airingAt) continue
    const key = dayKey(episode.airingAt)

    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(episode)
  }

  const first = new Date(year, month, 1)
  const cells = []

  for (let index = 0; index < 42; index += 1) {
    const at = new Date(year, month, 1 - first.getDay() + index)
    const key = dayKey(at.getTime() / 1000)

    cells.push({ day: at.getDate(), inMonth: at.getMonth() === month, items: byDay.get(key) || [], key })
  }

  return cells
}

/** Whether anything airs before (-1) or after (+1) the given month — the arrows' stops. */
function hasEpisodesOutside(episodes, year, month, direction) {
  const edge = new Date(year, month + (direction > 0 ? 1 : 0), 1).getTime() / 1000

  return (episodes || []).some((episode) => {
    const at = (episode && episode.airingAt) || 0

    return direction > 0 ? at >= edge : at < edge
  })
}

// ─── seasons & search (L1) ──────────────────────────────────────────────────

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
/** The backend rejects shorter terms; asking below its floor only burns a round trip. */
const SEARCH_MIN_CHARS = 2
const BROWSE_PER_PAGE = 24
const WORKSPACE_ID = 'seasons'
/** The backend holds season and search pages for 300s — re-asking sooner re-reads that entry. */
const BROWSE_STALE_MS = 300000

/** A season browser that opens on last winter is a bug: start where the calendar is. */
function currentSeason(now = new Date()) {
  const month = now.getMonth() + 1

  return {
    season: month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL',
    year: now.getFullYear()
  }
}

/** One request per typed word, not one per keystroke. */
function useDebounced(value, delayMs = 350) {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)

    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}

function useSeason(season, year) {
  const source = useSource()

  return useQuery({
    queryKey: [SOURCE, source.id, source.profile, 'season', season, year],
    queryFn: () => rest(`/season?season=${season}&year=${year}&per_page=${BROWSE_PER_PAGE}`),
    staleTime: BROWSE_STALE_MS,
    refetchInterval: false,
    retry: 1
  })
}

function useSearch(term) {
  const source = useSource()

  return useQuery({
    queryKey: [SOURCE, source.id, source.profile, 'search', term.toLowerCase()],
    queryFn: () => rest(`/search?q=${encodeURIComponent(term)}&per_page=${BROWSE_PER_PAGE}`),
    enabled: term.length >= SEARCH_MIN_CHARS,
    staleTime: BROWSE_STALE_MS,
    refetchInterval: false,
    retry: 1
  })
}

function MediaRow({ entry, item, onToggle, t, watched }) {
  const { covers, titleLanguage } = useValue($settings)
  const title = titleOf(item, titleLanguage)

  return jsxs('div', {
    className:
      'group flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-(--chrome-action-hover)',
    // Reachable without a pointer: same door, same gesture (Enter / Space).
    role: 'button',
    tabIndex: 0,
    onClick: () => {
      haptic('selection')
      openDetail(item.id)
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        haptic('selection')
        openDetail(item.id)
      }
    },
    children: [
      covers
        ? item.cover
          ? jsx('img', { alt: '', className: 'h-12 w-8 shrink-0 rounded object-cover', src: item.cover })
          : jsx('div', { className: 'h-12 w-8 shrink-0 rounded bg-(--chrome-action-hover)' })
        : null,
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsx('div', {
            className: 'truncate text-xs text-(--ui-text-secondary)',
            title,
            children: title
          }),
          jsxs('div', {
            className: 'flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-quaternary)',
            children: [
              item.score ? jsx(Badge, { variant: 'muted', children: String(item.score) }) : null,
              jsx('span', {
                className: 'truncate',
                children: [item.format, item.seasonYear].filter(Boolean).join(' · ')
              }),
              item.nextEpisode
                ? jsx('span', {
                    className: 'shrink-0',
                    children: `${t('episode', item.nextEpisode)} · ${countdown(item.airingAt, t)}`
                  })
                : null
            ]
          })
        ]
      }),
      jsx(WatchStar, {
        entry,
        onToggle: (event) => {
          event.stopPropagation()
          if (onToggle) onToggle()
        },
        t,
        watched
      }),
      jsx(Tip, {
        label: t('openOnAniList'),
        children: jsx(Button, {
          type: 'button',
          variant: 'ghost',
          size: 'sm',
          className: 'text-(--ui-text-quaternary)',
          onClick: (event) => {
            event.stopPropagation()
            haptic('tap')
            if (osDoor) void osDoor.openExternal(`https://anilist.co/anime/${item.id}`)
          },
          children: '↗'
        })
      })
    ]
  })
}

/**
 * Season browser + title search. One body, two homes: the workspace tab when the
 * desktop has that door, and the chip popover (compact) when it does not — so a
 * search box never exists twice.
 */
function BrowsePanel({ compact = false }) {
  const t = usePluginI18n(ID)
  const tracked = useTracked()
  const [selection, setSelection] = useState(currentSeason)
  const [term, setTerm] = useState('')
  const query = useDebounced(term).trim()
  const searching = query.length >= SEARCH_MIN_CHARS
  const seasonQuery = useSeason(selection.season, selection.year)
  const searchQuery = useSearch(query)
  const active = searching ? searchQuery : seasonQuery
  const items = (active.data && active.data.items) || []
  const shiftYear = (delta) => {
    haptic('tap')
    setSelection((current) => ({ ...current, year: current.year + delta }))
  }

  const controls = jsxs('div', {
    className: 'flex flex-wrap items-center justify-between gap-2',
    children: [
      jsx(SegmentedControl, {
        onChange: (season) => {
          haptic('selection')
          setSelection((current) => ({ ...current, season }))
        },
        options: SEASONS.map((season) => ({ id: season, label: t('seasonName', season) })),
        value: selection.season
      }),
      jsxs('div', {
        className: 'flex items-center gap-0.5',
        children: [
          jsx(Button, {
            'aria-label': String(selection.year - 1),
            type: 'button',
            variant: 'ghost',
            size: 'sm',
            onClick: () => shiftYear(-1),
            children: '◀'
          }),
          jsx('span', {
            className: 'text-xs text-(--ui-text-secondary)',
            children: String(selection.year)
          }),
          jsx(Button, {
            'aria-label': String(selection.year + 1),
            type: 'button',
            variant: 'ghost',
            size: 'sm',
            onClick: () => shiftYear(1),
            children: '▶'
          })
        ]
      })
    ]
  })

  const body = active.isLoading
    ? jsxs('div', {
        className: 'flex flex-col gap-2',
        children: [
          jsx(Skeleton, { className: 'h-12 w-full' }),
          jsx(Skeleton, { className: 'h-12 w-full' }),
          jsx(Skeleton, { className: 'h-12 w-full' })
        ]
      })
    : active.isError
      ? isMissingBackend(active.error)
        ? jsx(ErrorState, {
            title: t('backendMissing'),
            description: t('backendHint', host.state.profile.get() || 'default')
          })
        : jsx(ErrorState, {
            title: t('unreachable'),
            description: String((active.error && active.error.message) || active.error),
            children: jsx(Button, {
              type: 'button',
              size: 'sm',
              onClick: () => void active.refetch(),
              children: t('retry')
            })
          })
      : items.length === 0
        ? jsx(EmptyState, { title: searching ? t('noResults') : t('empty') })
        : jsx(ScrollArea, {
            // A definite height, never max-height: the kit's viewport is
            // `size-full`, and a percentage height against a max-height parent
            // resolves to auto — the list clipped instead of scrolling.
            className: compact ? 'h-80' : 'flex-1',
            style: compact ? undefined : { minHeight: 0 },
            children: jsxs('div', {
              className: 'flex flex-col',
              children: items.map((item) => mediaRow(item, t, tracked))
            })
          })

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx(SearchField, {
        containerClassName: 'w-full',
        onChange: setTerm,
        placeholder: t('searchPlaceholder'),
        loading: searching && active.isFetching,
        value: term
      }),
      controls,
      body
    ]
  })
}

/** Which view the tab opens on, so a palette entry can land on any of them. */
const $workspaceView = atom('browse')
/** The show the detail view is drilled into (null = nothing drilled in). */
const $detailId = atom(null)

/**
 * Drill into a show. The detail lives in the workspace tab — a popover is not a
 * place to read a synopsis — so this is honest about failing when the desktop
 * has no main-area door.
 */
function openDetail(mediaId) {
  if (!mediaId || !openAniListWorkspace('detail')) return false

  $detailId.set(mediaId)

  return true
}

function AniListWorkspace() {
  const t = usePluginI18n(ID)
  const view = useValue($workspaceView)

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col gap-2 p-3',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-center justify-between gap-2',
        children: [jsx(OriginLine, {}), jsx(ViewTabs, { t, value: view, onChange: $workspaceView.set })]
      }),
      view === 'upcoming'
        ? jsx(UpcomingPanel, { compact: false })
        : view === 'browse'
          ? jsx(BrowsePanel, {})
          : view === 'detail'
            ? jsx(DetailPanel, { compact: false })
            : jsx(ScrollArea, {
                // Settings is a long form and the workspace is a `flex h-full
                // min-h-0 flex-col`: without this container the last rows clip with
                // no way to reach them. Same pattern the other three panels use.
                className: 'flex-1',
                style: { minHeight: 0 },
                children: jsx(SettingsPanel, {})
              })
    ]
  })
}

/** Open the workspace, or say why not — the palette entries' own fallback. */
function openWorkspaceOrSay(view) {
  if (openAniListWorkspace(view)) return

  host.notify({ kind: 'info', message: 'AniList: ' + t('chipFallback') })
}

/**
 * Open the workspace tab — or bring the one already open to the front.
 *
 * Re-calling `host.openWorkspace` with the same id refreshes `render` in place and
 * fronts the existing tab (the SDK's own contract), so there is no close/reopen
 * dance: a tab the user already has open keeps its scroll position and the show it
 * was drilled into. False when this desktop predates the main-area door.
 */
function openAniListWorkspace(view = 'browse') {
  if (typeof host.openWorkspace !== 'function') return false

  $workspaceView.set(view)
  host.openWorkspace(WORKSPACE_ID, {
    minWidth: '24rem',
    render: () => jsx(AniListWorkspace, {}),
    title: 'AniList'
  })

  return true
}

// ─── settings, views and the upcoming panel ─────────────────────────────────

/**
 * One filter, one home: the popover's control and the settings row write the
 * same value, so what you pick in passing is what the next open remembers.
 */
function useAiringFilter() {
  const settings = useValue($settings)

  return [settings.defaultFilter, (next) => saveSettings({ defaultFilter: next })]
}

function SettingsRow({ children, label }) {
  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx('div', {
        className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
        children: label
      }),
      children
    ]
  })
}

// ─── alerts (L4: one cron job per episode you want to hear about) ────────────

/**
 * An alert IS a cron job, created through the gateway's own `cron.manage` RPC —
 * the same door the app's own scheduled surfaces use.
 *
 * It lives in the profile's cron store rather than this plugin's state, which is
 * the point: it keeps firing with Hermes closed, it shows up in `hermes cron
 * list` like any other job, and the user can cancel it from either place. What
 * makes it findable again is the name, namespaced the way the app tags its own:
 * `[anilist:<media id>:e<episode>] <title> — EP <n>`.
 */
const ALERT_PREFIX = '[anilist'
const ALERT_RE = /^\[anilist:(\d+):e(\d+)\]/i

/** The profile whose cron store the alerts belong to, when the gateway took one. */
function alertScope() {
  const profile = host.state.profile.get()

  return profile ? { profile } : {}
}

/** Everything this plugin owns on a host — alerts and the digest share the namespace. */
function isAniListJob(job) {
  return String((job && job.name) || '').toLowerCase().startsWith(ALERT_PREFIX)
}

/** An episode alert. The digest has its own row and its own controls — never an alert row. */
function isAlert(job) {
  return isAniListJob(job) && !isDigest(job)
}

function alertsKey(source) {
  return [SOURCE, source.id, source.profile, 'alerts']
}

/** A destination's identity, for keys and for the picker's value. */
function routeId(route) {
  return `${(route && route.connectionId) || 'local'}:${(route && route.profile) || 'default'}`
}

/**
 * Where an alert can be scheduled: this device, plus every registered connection
 * that serves a profile.
 *
 * The destination is the whole point of the choice. A job runs where its cron
 * store and its delivery channel live — a box running its own gateway (with
 * Telegram configured) is the one whose alert reaches a phone, while "this
 * device" only surfaces the run inside the app. `host.profileRoutes` is the app's
 * own inventory of (connection, profile) pairs, so nothing here is guessed.
 */
function useDestinations() {
  return useQuery({
    queryKey: [SOURCE, 'destinations'],
    queryFn: async () => {
      const rows = typeof host.connections === 'function' ? await host.connections() : []
      const labels = new Map((rows || []).map((row) => [String((row && row.id) || ''), (row && row.label) || '']))
      const routes = typeof host.profileRoutes === 'function' ? await host.profileRoutes() : []

      return (routes || []).map((route) => ({
        ...route,
        // A local route is the reader's own machine; a remote one is named after
        // the connection that serves it.
        label: route.mode === 'local' ? '' : `${labels.get(String(route.connectionId)) || route.connectionId}`
      }))
    },
    staleTime: 600000,
    refetchInterval: false,
    retry: 1
  })
}

/**
 * One cron call, wherever the job lives.
 *
 * The descriptor from `host.profileRoutes()` is what routes it, for a local route
 * as much as a remote one — the SDK's own guidance is that registry-aware plugins
 * pass the descriptor so two sources exposing the same profile name cannot
 * collide — and it goes through that source without foregrounding it, so asking a
 * sleeping SSH box does not steal the active chat. `profile` rides along as the
 * backend's own name for that route, so the store written is the right one.
 */
function cronCall(route, params) {
  const scoped = { ...params, profile: ((route && route.targetProfile) || alertScope().profile) }

  if (route && typeof host.requestProfile === 'function') {
    return host.requestProfile(route, 'cron.manage', scoped)
  }

  if (route && route.mode === 'remote') {
    throw new Error('This Desktop build cannot reach another connection. Update Hermes Desktop.')
  }

  return host.request('cron.manage', scoped)
}

/**
 * What this plugin created, read back from every destination it can reach.
 *
 * One unreachable host must not empty the list, and must not read as "you have
 * no alerts" either: the failures come back with the answer so the pane can say
 * which host it could not ask.
 */
function useAlerts() {
  const source = useSource()
  const destinations = useDestinations()
  const routes = destinations.data || []

  return useQuery({
    queryKey: alertsKey(source),
    queryFn: async () => {
      const answers = await Promise.all(
        routes.map(async (route) => {
          try {
            const data = await cronCall(route, { action: 'list', include_disabled: true })
            const ours = (data && Array.isArray(data.jobs) ? data.jobs : []).filter(isAniListJob)

            return { failed: null, ours, route }
          } catch (error) {
            console.warn('[anilist] alerts: could not ask', routeId(route), error)

            return { failed: route, ours: [] }
          }
        })
      )
      const ours = answers.flatMap((answer) => answer.ours.map((job) => ({ job, route: answer.route })))

      return {
        failed: answers.map((answer) => answer.failed).filter(Boolean),
        // `items` is what the Alerts pane lists; `all` is everything this plugin
        // owns there (the digest included) and is what the destination fallback
        // reads — "where my jobs already are" must see a lone digest too.
        all: ours,
        items: ours.filter(({ job }) => isAlert(job))
      }
    },
    enabled: routes.length > 0,
    staleTime: 15000,
    refetchInterval: false,
    retry: 1
  })
}

/** The alert armed for one show's episode, on whichever host holds it. */
function alertFor(alerts, mediaId, episode) {
  return (
    ((alerts && alerts.items) || []).find(({ job }) => {
      const match = ALERT_RE.exec(String(job.name || ''))

      return !!match && Number(match[1]) === Number(mediaId) && Number(match[2]) === Number(episode)
    }) || null
  )
}

/** The tag is for finding the job again; the reader only needs the rest. */
function alertTitle(job) {
  return String((job && job.name) || '').replace(/^\[anilist[^\]]*\]\s*/i, '')
}

/**
 * The scheduler's own words for a run that did not happen, trimmed for a row.
 *
 * `blocked_config` is not a failed run: the pre-dispatch validation refused it and
 * **no LLM call was made**, which is a host configuration problem — the provider
 * the job resolves to is not usable there.
 */
function alertFailure(job) {
  const reason = String((job && (job.last_error || job.last_fire_error || job.last_delivery_error)) || '').trim()

  return reason.length > 220 ? `${reason.slice(0, 217)}…` : reason
}

function alertStateLabel(job, t) {
  const status = String((job && job.last_status) || '')

  if (status === 'blocked_config') return t('alertBlocked')
  if (status === 'error') return t('alertRunFailed')

  return ''
}

/** "hoy 19:30" / "17 oct 19:30" — when a job will fire, in the reader's calendar. */
function runAtLabel(iso, t) {
  const date = new Date(iso || 0)
  if (Number.isNaN(date.getTime())) return ''

  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const today = new Date()

  if (date.toDateString() === today.toDateString()) return `${t('dayToday')} ${time}`

  return `${date.getDate()} ${t('monthName', date.getMonth())} ${time}`
}

function writeAlert(source, work) {
  return work().then((result) => {
    void queryClient.invalidateQueries({ queryKey: alertsKey(source) })

    return result
  })
}

/**
 * The one-shot: an ISO timestamp is a "once" job in the cron store, so this fires
 * at the moment AniList says the episode airs and then never again. Created on the
 * destination the reader picked, which is what decides where it fires.
 */
function createAlert(source, t, item, episode, airingAt, route, deliver) {
  return writeAlert(source, () =>
    cronCall(route, {
      action: 'add',
      name: `${ALERT_PREFIX}:${item.id}:e${episode}] ${item.title} — EP ${episode}`,
      schedule: new Date((airingAt || 0) * 1000).toISOString(),
      prompt: t('alertPrompt', item.title, episode, `https://anilist.co/anime/${item.id}`),
      // Where the notification comes out. `local` means the run only surfaces in
      // whichever app owns that store — right on this device, useless on a box
      // you chose precisely because it has a channel.
      deliver
    })
  )
}

function dropAlert(source, job, route) {
  return writeAlert(source, () => cronCall(route, { action: 'remove', name: job.job_id }))
}

function holdAlert(source, job, paused, route) {
  return writeAlert(source, () => cronCall(route, { action: paused ? 'pause' : 'resume', name: job.job_id }))
}

/**
 * The destination a new job should use: the one chosen last, then the host where
 * this plugin already has jobs, then the active connection.
 *
 * Remembering this (and the channel) is the difference between picking a host and
 * a delivery target on every single alert and never thinking about it again — a
 * reader whose notifications live on one box should not have to say so twice, and
 * if jobs already exist somewhere, that is where they belong.
 */
function preferredRoute(routes, remembered, fallback) {
  const list = routes || []
  const wanted = [remembered, fallback]

  for (const id of wanted) {
    const found = list.find((route) => routeId(route) === id)
    if (found) return found
  }

  return list[0] || null
}

/** What a destination is called: the reader's own device, or the connection serving it. */
function alertDestinationLabel(route, t) {
  const name = (route && route.mode === 'local') || !(route && route.label) ? t('destinationLocal') : route.label
  const profile = String((route && (route.targetProfile || route.profile)) || '')

  return profile && profile !== 'default' ? `${name} · ${profile}` : name
}

/** "VPS Zonda · Telegram" — where the job lives, and where it comes out. */
function alertRouteLabel(route, job, t) {
  const where = alertDestinationLabel(route, t)
  const deliver = String((job && job.deliver) || '')
  const channel = deliver && deliver !== 'local' ? deliver.split(':')[0] : ''

  return channel ? `${where} · ${DELIVERY_NAMES[channel] || channel}` : where
}

/**
 * A destination picker that scales: the registry can expose any number of
 * (connection, profile) routes, and a segmented track stops reading past three.
 * Radix renders a blank trigger when `value` matches no item (the SDK's own trap),
 * so a remembered route that disappeared falls back to the first real one here.
 */
function DestinationSelect({ onChange, routes, t, value }) {
  const active = routes.some((route) => routeId(route) === value) ? value : routeId(routes[0])

  return jsxs(Select, {
    onValueChange: (next) => {
      haptic('selection')
      onChange(next)
    },
    value: active,
    children: [
      jsx(SelectTrigger, { className: 'min-w-56', children: jsx(SelectValue, {}) }),
      jsx(SelectContent, {
        children: routes.map((route) =>
          jsx(SelectItem, { value: routeId(route), children: alertDestinationLabel(route, t) }, routeId(route))
        )
      })
    ]
  })
}

// ─── daily digest ───────────────────────────────────────────────────────────

function isDigest(job) {
  return String((job && job.name) || '').toLowerCase().startsWith(DIGEST_PREFIX)
}

/**
 * The ids the digest should ask about: what can still air.
 *
 * The prompt carries them because the job runs on whichever host the reader
 * picked, and that host may not have this plugin installed — so the prompt has to
 * stand on its own (the public API, no tool of ours to promise). A list of ids is
 * also the smallest form that survives titles changing.
 */
function digestIds(entries) {
  return (entries || [])
    .filter((entry) => !entry.status || DIGEST_STATUSES.includes(String(entry.status)))
    .map((entry) => Number(entry.id))
    .filter((id) => Number.isFinite(id))
}

/** `0 9 * * *` — the one schedule form that reads back exactly as written. */
function digestSchedule(hour) {
  return `0 ${Number(hour) || DEFAULT_SETTINGS.digestHour} * * *`
}

function digestJobName(t, hour) {
  return `${DIGEST_PREFIX} ${t('digestJobName')} — ${String(hour).padStart(2, '0')}:00`
}

function createDigest(source, t, ids, route, deliver, hour) {
  return writeAlert(source, () =>
    cronCall(route, {
      action: 'add',
      name: digestJobName(t, hour),
      schedule: digestSchedule(hour),
      prompt: t('digestPrompt', ids.join(', ')),
      deliver
    })
  )
}

/**
 * One message a day with what airs from the reader's list.
 *
 * A cron job like an alert — same store, same destination, same delivery target —
 * but recurring, and its schedule is a cron expression so the app's own editor can
 * read it back instead of guessing at a display string. The ids are baked in when
 * it is armed: re-arm to refresh them.
 */
function DigestPanel() {
  const t = usePluginI18n(ID)
  const source = useSource()
  const alerts = useAlerts()
  const destinations = useDestinations()
  const tracked = useTracked()
  const settings = useValue($settings)
  const routes = destinations.data || []
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const ids = digestIds(tracked.entries)
  const existing = (alerts.data && alerts.data.all) || []
  const armed = existing.find((item) => isDigest(item.job)) || null
  const active = preferredRoute(routes, settings.alertRoute, existing[0] && routeId(existing[0].route))
  const remote = !!active && active.mode !== 'local'
  const deliver = remote ? settings.alertDelivery : 'local'
  const run = (work) => {
    setBusy(true)
    setFailure(null)

    return work()
      .catch((error) => setFailure(error))
      .finally(() => setBusy(false))
  }

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx(SectionTitle, { children: t('digestTitle') }),
      jsx('div', {
        className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
        children: t('digestHint', ids.length)
      }),
      armed
        ? jsxs('div', {
            className: 'flex flex-wrap items-center gap-2',
            children: [
              jsx(Badge, { variant: 'muted', children: runAtLabel(armed.job.next_run_at, t) }),
              jsx('span', {
                className: 'truncate text-[0.6875rem] text-(--ui-text-quaternary)',
                children: alertRouteLabel(armed.route, armed.job, t)
              }),
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'sm',
                disabled: busy,
                onClick: () => {
                  haptic('tap')
                  void run(() => dropAlert(source, armed.job, armed.route))
                },
                children: t('alertRemove')
              })
            ]
          })
        : jsxs('div', {
            className: 'flex flex-col gap-2',
            children: [
              jsx(SettingsRow, {
                label: t('digestHour'),
                children: jsx(SegmentedControl, {
                  onChange: (hour) => {
                    haptic('selection')
                    saveSettings({ digestHour: Number(hour) })
                  },
                  options: DIGEST_HOURS.map((hour) => ({ id: String(hour), label: t('digestAt', hour) })),
                  value: String(settings.digestHour)
                })
              }),
              routes.length > 0
                ? jsx(SettingsRow, {
                    label: t('alertDestination'),
                    children: jsx(DestinationSelect, {
                      onChange: (next) => saveSettings({ alertRoute: next }),
                      routes,
                      t,
                      value: routeId(active)
                    })
                  })
                : null,
              remote
                ? jsx(SettingsRow, {
                    label: t('alertDeliveryLabel'),
                    children: jsx(SegmentedControl, {
                      onChange: (next) => {
                        haptic('selection')
                        saveSettings({ alertDelivery: next })
                      },
                      options: ALERT_DELIVERIES.map((id) => ({
                        id,
                        label: id === 'local' ? t('deliverLocal') : DELIVERY_NAMES[id] || id
                      })),
                      value: settings.alertDelivery
                    })
                  })
                : null,
              jsx(Button, {
                type: 'button',
                variant: 'default',
                size: 'sm',
                disabled: busy || !active || ids.length === 0,
                onClick: () => {
                  haptic('tap')
                  void run(() => createDigest(source, t, ids, active, deliver, settings.digestHour))
                },
                children: t('digestArm')
              })
            ]
          }),
      failure
        ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: t('alertFailed') })
        : null
    ]
  })
}

/**
 * The alert for the next episode, on the show's own page — and the host it should
 * run on.
 *
 * Offered only when AniList knows when that episode is (an alert with no time is a
 * job that never fires), and in both signing states, because a cron job does not
 * care whether the reader is signed in. The destination is not decoration: this
 * device only surfaces the run in the app, while a box with its own gateway and a
 * messaging channel is the one that actually reaches a phone.
 */
function AlertControl({ show, t }) {
  const source = useSource()
  const alerts = useAlerts()
  const destinations = useDestinations()
  const settings = useValue($settings)
  const routes = destinations.data || []
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const episode = show.nextEpisode

  if (!episode || !show.airingAt) return null

  const armed = alertFor(alerts.data, show.id, episode)
  const existing = (alerts.data && alerts.data.all) || []
  const active = preferredRoute(routes, settings.alertRoute, existing[0] && routeId(existing[0].route))
  // This device has exactly one sensible answer: the run shows up in the app that
  // is already open. Another host is the case where the channel matters.
  const remote = !!active && active.mode !== 'local'
  const delivery = remote ? settings.alertDelivery : 'local'
  const run = (work) => {
    setBusy(true)
    setFailure(null)

    return work()
      .catch((error) => setFailure(error))
      .finally(() => setBusy(false))
  }

  return jsxs('div', {
    className: 'flex flex-col gap-1 pt-1',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2',
        children: [
          armed
            ? [
                jsx(Badge, {
                  variant: 'muted',
                  children: t('alertActive', episode, runAtLabel(armed.job.next_run_at, t))
                }),
                jsx(Button, {
                  type: 'button',
                  variant: 'ghost',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => {
                    haptic('tap')
                    void run(() => dropAlert(source, armed.job, armed.route))
                  },
                  children: t('alertRemove')
                })
              ]
            : jsx(Button, {
                type: 'button',
                // The primary action of a show's page deserves the primary look.
                variant: 'default',
                size: 'sm',
                disabled: busy || !active,
                onClick: () => {
                  haptic('tap')
                  void run(() => createAlert(source, t, show, episode, show.airingAt, active, delivery))
                },
                children: t('alertAdd', episode)
              })
        ]
      }),
      // Armed, the row says where it lives; before that, this is the picker. One
      // destination means no choice worth showing.
      armed
        ? jsx('div', {
            className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
            children: alertRouteLabel(armed.route, armed.job, t)
          })
        : routes.length > 1
          ? jsxs('div', {
              className: 'flex flex-wrap items-center gap-2',
              children: [
                jsx('div', {
                  className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
                  children: t('alertDestination')
                }),
                jsx(DestinationSelect, {
                  onChange: (next) => saveSettings({ alertRoute: next }),
                  routes,
                  t,
                  value: routeId(active)
                })
              ]
            })
          : null,
      // A destination that is not this device exists for its channel: name it.
      !armed && remote
        ? jsxs('div', {
            className: 'flex flex-wrap items-center gap-2',
            children: [
              jsx('div', {
                className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
                children: t('alertDeliveryLabel')
              }),
              jsx(SegmentedControl, {
                onChange: (next) => {
                  haptic('selection')
                  saveSettings({ alertDelivery: next })
                },
                options: ALERT_DELIVERIES.map((id) => ({
                  id,
                  label: id === 'local' ? t('deliverLocal') : DELIVERY_NAMES[id] || id
                })),
                value: settings.alertDelivery
              })
            ]
          })
        : null,
      failure
        ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: t('alertFailed') })
        : null
    ]
  })
}

// ─── account (AniList sign-in) ──────────────────────────────────────────────

/** Where the sign-in stands, per source. The token itself never comes back here. */
function useAccount() {
  const source = useSource()

  return useQuery({
    queryKey: [SOURCE, source.id, source.profile, 'account'],
    queryFn: () => rest('/account'),
    staleTime: 30000,
    refetchInterval: false,
    retry: 1
  })
}

/** The page AniList shows the token on — the pin flow, no callback server. */
function authorizeUrl(clientId) {
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`
}

const ANILIST_DEVELOPER_URL = 'https://anilist.co/settings/developer'
/** The redirect the pin flow needs, shown verbatim: it must match exactly. */
const ANILIST_PIN_REDIRECT = 'https://anilist.co/api/v2/oauth/pin'

/** What to say when a sign-in write fails: AniList's own verdict when we have it. */
function failureStatus(error, t) {
  const status = error && (error.statusCode || error.status)

  if (status === 401) return t('accountTokenRejected')
  if (status === 422) return t('accountClientIdInvalid')

  return String((error && error.message) || error)
}

/**
 * Sign-in, in the pane that hosts every other preference. Deliberately manual:
 * AniList has no redirect-free login for a desktop app, so the flow is
 * "create an app → authorize → paste the token back here" — and the token goes
 * straight to the backend, never into this window's storage.
 */
function AccountPanel() {
  const t = usePluginI18n(ID)
  const source = useSource()
  const account = useAccount()
  const [draft, setDraft] = useState(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)

  const data = account.data || {}
  const storedClientId = data.clientId || ''
  // The field follows the stored value until the user types; then it is theirs.
  const clientValue = draft === null ? storedClientId : draft
  // Every user brings their own app: the plugin ships no shared identity, so the
  // authorize URL is always built from the id the user registered themselves.
  const clientId = clientValue.trim()
  const key = [SOURCE, source.id, source.profile, 'account']

  const run = (work) => {
    setBusy(true)
    setFailure(null)

    return work()
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: key })
      })
      .catch((error) => setFailure(error))
      .finally(() => setBusy(false))
  }

  const open = (url) => {
    haptic('tap')
    if (osDoor) void osDoor.openExternal(url)
  }

  const saveClient = () =>
    run(() => rest('/account', { method: 'PUT', body: { clientId: clientValue.trim() } }))

  /**
   * Getting a token saves the id on the way out.
   *
   * The field alone is enough to build the authorize URL, so without this the
   * sign-in works and the id is silently forgotten — the pane then comes back
   * with an empty Client ID and a disabled button, and the answer to "where do
   * I put it again?" lives on AniList's developer page. Opening first keeps the
   * tab a direct result of the click; the write follows on its own.
   */
  const getToken = () => {
    haptic('tap')
    open(authorizeUrl(clientId))
    if (clientValue.trim() !== storedClientId) void saveClient()
  }

  const connect = () =>
    run(() =>
      rest('/account', { method: 'PUT', body: { token: token.trim() } }).then((result) => {
        // Only on success: a rejected token must stay in the field to be fixed.
        setToken('')

        return result
      })
    )

  const disconnect = () => run(() => rest('/account', { method: 'DELETE' }))

  if (account.isLoading) {
    return jsxs('div', {
      className: 'flex flex-col gap-2',
      children: [jsx(Skeleton, { className: 'h-4 w-28' }), jsx(Skeleton, { className: 'h-8 w-full' })]
    })
  }

  if (account.isError) {
    return isMissingBackend(account.error)
      ? jsx(ErrorState, {
          title: t('backendMissing'),
          description: t('backendHint', host.state.profile.get() || 'default')
        })
      : jsx(ErrorState, {
          title: t('unreachable'),
          description: String((account.error && account.error.message) || account.error),
          children: jsx(Button, {
            type: 'button',
            size: 'sm',
            onClick: () => void account.refetch(),
            children: t('retry')
          })
        })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-2',
        children: [
          jsx('div', {
            className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
            children: t('account')
          }),
          data.connected ? jsx(Badge, { variant: 'success', children: t('accountConnected') }) : null
        ]
      }),
      data.connected
        ? jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              data.viewer && data.viewer.avatar
                ? jsx('img', {
                    alt: '',
                    className: 'h-8 w-8 shrink-0 rounded-full object-cover',
                    src: data.viewer.avatar
                  })
                : null,
              jsxs('div', {
                className: 'min-w-0 flex-1',
                children: [
                  jsx('div', {
                    className: 'truncate text-xs text-(--ui-text-secondary)',
                    children: t('accountConnectedAs', (data.viewer && data.viewer.name) || '')
                  }),
                  data.viewer && data.viewer.url
                    ? jsx('button', {
                        type: 'button',
                        className:
                          'block max-w-full truncate text-left text-[0.6875rem] text-(--ui-text-quaternary) hover:text-(--ui-text-primary)',
                        onClick: () => open(data.viewer.url),
                        children: t('accountOpenProfile')
                      })
                    : null
                ]
              }),
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'sm',
                disabled: busy,
                onClick: disconnect,
                children: t('accountDisconnect')
              })
            ]
          })
        : jsxs('div', {
            className: 'flex flex-col gap-2',
            children: [
              jsx('div', {
                className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
                children: t('accountHint')
              }),
              // Three steps, in the order they have to happen, each with its own
              // control: nothing to guess, and no shared app to inherit.
              jsx('div', {
                className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
                children: t('accountStepApp')
              }),
              jsx('code', {
                className:
                  'min-w-0 truncate rounded bg-(--chrome-action-hover) px-1.5 py-0.5 text-[0.6875rem] text-(--ui-text-secondary)',
                title: ANILIST_PIN_REDIRECT,
                children: ANILIST_PIN_REDIRECT
              }),
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'sm',
                onClick: () => open(ANILIST_DEVELOPER_URL),
                children: t('accountOpenDeveloper')
              }),
              jsx('div', {
                className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
                children: t('accountStepClientId')
              }),
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(Input, {
                    className: 'min-w-0 flex-1',
                    onChange: (event) => setDraft(event.target.value),
                    placeholder: t('accountClientId'),
                    value: clientValue
                  }),
                  jsx(Button, {
                    type: 'button',
                    variant: 'secondary',
                    size: 'sm',
                    disabled: busy || !clientValue.trim() || clientValue === storedClientId,
                    onClick: saveClient,
                    children: t('accountSave')
                  })
                ]
              }),
              jsx('div', {
                className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
                children: t('accountStepToken')
              }),
              jsx(Button, {
                type: 'button',
                variant: 'outline',
                size: 'sm',
                disabled: !clientId,
                onClick: getToken,
                children: t('accountGetToken')
              }),
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(Input, {
                    className: 'min-w-0 flex-1',
                    onChange: (event) => setToken(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' && token.trim()) connect()
                    },
                    placeholder: t('accountToken'),
                    type: 'password',
                    value: token
                  }),
                  jsx(Button, {
                    type: 'button',
                    size: 'sm',
                    disabled: busy || !token.trim(),
                    onClick: connect,
                    children: t('accountConnect')
                  })
                ]
              }),
              data.reason === 'invalid'
                ? jsx('div', {
                    className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
                    children: t('accountStaleToken')
                  })
                : null
            ]
          }),
      failure
        ? jsx('div', {
            className: 'text-[0.6875rem] text-(--ui-text-secondary)',
            children: failureStatus(failure, t)
          })
        : null
    ]
  })
}

/** One alert: what it is, where it runs, when it fires, and what you can do to it. */
function AlertRow({ job, route, t }) {
  const source = useSource()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const paused = job.state === 'paused' || job.enabled === false
  const broken = alertStateLabel(job, t) !== ''
  const run = (work) => {
    setBusy(true)
    setFailure(null)

    return work()
      .catch((error) => setFailure(error))
      .finally(() => setBusy(false))
  }

  return jsxs('div', {
    className: 'flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-(--chrome-action-hover)',
    children: [
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsx('div', {
            className: 'truncate text-xs text-(--ui-text-secondary)',
            title: alertTitle(job),
            children: alertTitle(job)
          }),
          jsxs('div', {
            className: 'flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-quaternary)',
            children: [
              jsx('span', { children: failure ? t('alertFailed') : runAtLabel(job.next_run_at, t) }),
              // Which host holds it, and which channel it comes out of, decide
              // whether it reaches you at all — so they are part of the row.
              jsx('span', { className: 'truncate', children: alertRouteLabel(route, job, t) }),
              paused ? jsx(Badge, { variant: 'muted', children: t('alertPaused') }) : null,
              // A job that did not run says so here: the pane is where the alert
              // was armed, so it is where the reason belongs, not only in the
              // app's job inspector.
              broken
                ? jsx('span', {
                    className: 'shrink-0 text-destructive',
                    title: alertFailure(job),
                    children: alertStateLabel(job, t)
                  })
                : null
            ]
          })
        ]
      }),
      jsx(Button, {
        type: 'button',
        variant: 'ghost',
        size: 'sm',
        disabled: busy,
        onClick: () => {
          haptic('tap')
          void run(() => holdAlert(source, job, !paused, route))
        },
        children: paused ? t('alertResume') : t('alertPause')
      }),
      jsx(Button, {
        type: 'button',
        variant: 'ghost',
        size: 'sm',
        disabled: busy,
        onClick: () => {
          haptic('tap')
          void run(() => dropAlert(source, job, route))
        },
        children: t('alertRemove')
      })
    ]
  })
}

/**
 * The alerts this plugin created, from the stores that actually hold them — every
 * destination it can reach, each row naming its host. The pane has to be able to
 * cancel what it started, and only the gateway that owns a job can do that.
 */
function AlertsPanel() {
  const t = usePluginI18n(ID)
  const alerts = useAlerts()
  const label = jsx(SectionTitle, { children: t('alerts') })
  const items = (alerts.data && alerts.data.items) || []
  const failed = (alerts.data && alerts.data.failed) || []

  if (alerts.isLoading) {
    return jsxs('div', {
      className: 'flex flex-col gap-2',
      children: [label, jsx(Skeleton, { className: 'h-8 w-full' })]
    })
  }

  // A gateway that cannot answer is not "no alerts": say which it is.
  if (alerts.isError) {
    return jsxs('div', {
      className: 'flex flex-col gap-1',
      children: [label, jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: t('alertsUnavailable') })]
    })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      label,
      items.length === 0
        ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: t('alertEmpty') })
        : jsx('div', {
            className: 'flex flex-col',
            children: items.map(({ job, route }) => jsx(AlertRow, { job, route, t }, `${routeId(route)}:${job.job_id}`))
          }),
      failed.length > 0
        ? jsx('div', {
            className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
            children: failed.map((route) => t('alertsHostUnreachable', alertDestinationLabel(route, t))).join(' ')
          })
        : null
    ]
  })
}

/**
 * Settings: client-side preferences (they shape what is shown, never what is
 * fetched), then the account it will not touch without a token, then the alerts
 * it created outside Hermes.
 */
function SettingsPanel() {
  const t = usePluginI18n(ID)
  const settings = useValue($settings)
  const destinations = useDestinations().data || []
  const alertJobs = useAlerts().data
  // Everything this plugin owns there (alerts and the digest): the destination
  // rung is "where my jobs already are", not "where my alerts are".
  const owned = (alertJobs && alertJobs.all) || []
  const [filter, setFilter] = useAiringFilter()

  return jsxs('div', {
    className: 'flex flex-col gap-3',
    children: [
      // The account first: it is the one setting that has a step outside Hermes.
      jsx(SectionTitle, { children: t('sectionAccount') }),
      jsx(AccountPanel, {}),
      jsx(Separator, {}),
      // Alerts are cron jobs in the profile's own store — same class of thing:
      // real state that lives outside the plugin, with a list worth showing.
      jsx(AlertsPanel, {}),
      jsx(Separator, {}),
      // The digest is the other half of the same idea: a job this plugin owns,
      // in the profile's own store, delivering where the reader chose.
      jsx(DigestPanel, {}),
      jsx(Separator, {}),
      // The default the two panes above open on: set it once here instead of
      // choosing a host and a channel on every alert.
      jsx(SettingsRow, {
        label: t('settingAlertRoute'),
        children: destinations.length
          ? jsx(DestinationSelect, {
              onChange: (next) => saveSettings({ alertRoute: next }),
              routes: destinations,
              t,
              value: routeId(preferredRoute(destinations, settings.alertRoute, owned[0] && routeId(owned[0].route)))
            })
          : jsx(Skeleton, { className: 'h-7 w-56' })
      }),
      jsx('div', {
        className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
        children: t('settingAlertRouteHint')
      }),
      jsx(Separator, {}),
      jsx(SectionTitle, { children: t('sectionPreferences') }),
      jsx(SettingsRow, {
        label: t('settingTitleLanguage'),
        children: jsx(SegmentedControl, {
          onChange: (titleLanguage) => {
            haptic('selection')
            saveSettings({ titleLanguage })
          },
          options: [
            { id: 'english', label: t('titleEnglish') },
            { id: 'romaji', label: t('titleRomaji') },
            { id: 'native', label: t('titleNative') }
          ],
          value: settings.titleLanguage
        })
      }),
      jsx(SettingsRow, {
        label: t('settingWindow'),
        children: jsx(SegmentedControl, {
          onChange: (days) => {
            haptic('selection')
            saveSettings({ windowDays: Number(days) })
          },
          options: WINDOW_DAYS.map((days) => ({ id: String(days), label: t('daysShort', days) })),
          value: String(settings.windowDays)
        })
      }),
      jsx(SettingsRow, {
        label: t('settingDefaultFilter'),
        children: jsx(SegmentedControl, {
          onChange: (next) => {
            haptic('selection')
            setFilter(next)
          },
          options: [
            { id: 'today', label: t('filterToday') },
            { id: 'week', label: t('daysShort', settings.windowDays) },
            { id: 'list', label: t('filterList') }
          ],
          value: filter
        })
      }),
      jsx(SettingsRow, {
        label: t('settingCovers'),
        children: jsx(SegmentedControl, {
          onChange: (choice) => {
            haptic('selection')
            saveSettings({ covers: choice === 'on' })
          },
          options: [
            { id: 'on', label: t('settingOn') },
            { id: 'off', label: t('settingOff') }
          ],
          value: settings.covers ? 'on' : 'off'
        })
      }),
      jsx('div', {
        className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
        children: t('settingsAuthNote')
      })
    ]
  })
}

/** A group heading inside a panel — the same quiet caps the alert panes use. */
function SectionTitle({ children }) {
  return jsx('div', {
    className: 'text-[0.6875rem] font-medium uppercase tracking-wide text-(--ui-text-quaternary)',
    children
  })
}

/** The switcher the workspace uses: airing · catalog · settings. */
function ViewTabs({ onChange, t, value }) {
  return jsx(SegmentedControl, {
    onChange: (next) => {
      haptic('selection')
      onChange(next)
    },
    options: [
      { id: 'upcoming', label: t('tabUpcoming') },
      { id: 'browse', label: t('seasons') },
      { id: 'settings', label: t('settings') }
    ],
    // Drilling into a show is a step inside Upcoming, not a fourth tab: the tab
    // strip keeps showing which view the drill came from.
    value: value === 'detail' ? 'upcoming' : value
  })
}

/** Upcoming episodes: the airing feed plus its window filter. */
function UpcomingPanel({ compact = true }) {
  const t = usePluginI18n(ID)
  const airing = useAiring()
  // "My list" is whatever `tracked` says it is — the account's list when one is
  // connected, the local watchlist otherwise. The filter itself never branches.
  const tracked = useTracked()
  const ids = tracked.ids
  const [filter, setFilter] = useAiringFilter()
  const { windowDays } = useValue($settings)
  // Pages beyond the first, gathered by "show more". They live beside the panel
  // (a scroll position) instead of in the query cache (shared data): the other
  // surfaces should not inherit how far this one was scrolled.
  const [more, setMore] = useState({ hasMore: null, items: [], loading: false })

  // A different window, or leaving the multi-day view, starts the tail over.
  useEffect(() => {
    setMore({ hasMore: null, items: [], loading: false })
  }, [filter, windowDays])

  const head = (airing.data && airing.data.items) || []
  const items = withinFilter(mergeAiring(head, more.items), filter, ids)
  const hasMore = more.hasMore === null ? !!((airing.data || {}).hasNextPage) : more.hasMore

  const loadMore = () => {
    const last = items[items.length - 1]
    if (!last || more.loading) return

    haptic('tap')
    setMore((prev) => ({ ...prev, loading: true }))

    // The cursor is the last row's own air time, so a deeper page can neither
    // repeat a row nor skip one that aired while the panel was open.
    void rest(`/airing?days=${windowDays}&after=${last.airingAt || 0}`)
      .then((page) => {
        setMore((prev) => ({
          hasMore: !!(page && page.hasNextPage),
          items: [...prev.items, ...((page && page.items) || [])],
          loading: false
        }))
      })
      .catch((error) => {
        console.warn('[anilist] show more failed:', error)
        setMore((prev) => ({ ...prev, loading: false }))
      })
  }

  if (airing.isLoading) {
    return jsxs('div', {
      className: 'flex flex-col gap-2',
      children: [jsx(Skeleton, { className: 'h-4 w-40' }), jsx(Skeleton, { className: 'h-4 w-56' })]
    })
  }

  if (airing.isError) {
    return isMissingBackend(airing.error)
      ? jsx(ErrorState, {
          title: t('backendMissing'),
          description: t('backendHint', host.state.profile.get() || 'default')
        })
      : jsx(ErrorState, {
          title: t('unreachable'),
          description: String((airing.error && airing.error.message) || airing.error),
          children: jsx(Button, {
            type: 'button',
            size: 'sm',
            onClick: () => void airing.refetch(),
            children: t('retry')
          })
        })
  }

  // What the list draws, computed once: the workspace container needs a definite
  // height, the popover one sizes to its content — both render the same rows.
  const rows =
    filter === 'today'
      ? items.map((item) => airingRow(item, t, tracked))
      : groupByDay(items).map((group) =>
          jsxs(
            'div',
            {
              className: 'flex flex-col',
              children: [
                jsxs('div', {
                  className: 'flex items-center gap-2 pt-1',
                  children: [
                    jsx('div', {
                      className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
                      children: dayLabel(group.items[0].airingAt, t)
                    }),
                    jsx(Separator, { className: 'flex-1' })
                  ]
                }),
                ...group.items.map((item) => airingRow(item, t, tracked))
              ]
            },
            group.key
          )
        )

  return jsxs('div', {
    className: 'flex min-h-0 flex-col gap-1',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-center justify-between gap-2',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-1',
            children: [
              jsx('div', { className: 'text-xs font-medium text-(--ui-text-secondary)', children: t('upcoming') }),
              // A named action, not a bare ↻: the label says what it refreshes.
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'xs',
                onClick: () => {
                  haptic('tap')
                  void airing.refetch()
                },
                children: t('refresh')
              })
            ]
          }),
          jsx(SegmentedControl, {
            onChange: (next) => {
              haptic('selection')
              setFilter(next)
            },
            options: [
              { id: 'today', label: t('filterToday') },
              { id: 'week', label: t('daysShort', windowDays) },
              { id: 'list', label: t('filterList') }
            ],
            value: filter
          })
        ]
      }),
      // A connected account's list takes a moment to arrive; showing "nothing
      // airs" in the meantime would be an answer we do not have yet.
      filter === 'list' && tracked.isLoading
        ? jsxs('div', {
            className: 'flex flex-col gap-2',
            children: [jsx(Skeleton, { className: 'h-8 w-full' }), jsx(Skeleton, { className: 'h-8 w-4/5' })]
          })
        : items.length === 0
        ? jsx(EmptyState, {
            title: filter === 'today' ? t('emptyToday') : filter === 'list' ? t('emptyList') : t('empty')
          })
        : compact
          ? jsx('div', {
              // A definite height is what the kit's ScrollArea needs — and 20rem for
              // two rows leaves the popover half empty. A plain capped scroller
              // grows with the list and starts scrolling at the cap: no measurement,
              // no magic row height. (Both classes are in the compiled CSS.)
              className: 'max-h-80 overflow-y-auto pr-1',
              children: jsx('div', { className: 'flex flex-col', children: rows })
            })
          : jsx(ScrollArea, {
              className: 'flex-1',
              style: { minHeight: 0 },
              children: jsx('div', { className: 'flex flex-col', children: rows })
            }),
      // Only in the multi-day view: "today" would page into tomorrow, where the
      // rows are filtered out again and the click would look broken.
      hasMore && filter !== 'today'
        ? jsxs('div', {
            className: 'flex items-center justify-between gap-2 pt-1',
            children: [
              jsx('div', {
                className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
                children: t('moreHint', windowDays)
              }),
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'micro',
                disabled: more.loading,
                onClick: loadMore,
                children: more.loading ? t('loadingMore') : t('loadMore')
              })
            ]
          })
        : null
    ]
  })
}

/** "in 3d" for what is still coming, "12 sep" for what already aired. */
function episodeWhen(episode, t, now = Date.now() / 1000) {
  const at = episode.airingAt || 0

  return at > now ? countdown(at, t) : airedDate(at, t)
}

function useAnime(id) {
  const source = useSource()

  return useQuery({
    queryKey: [SOURCE, source.id, source.profile, 'anime', id],
    // 25 rides along so the episode list can keep counting in pages of 25.
    queryFn: () => rest(`/anime/${id}?episodes=25`),
    enabled: !!id,
    staleTime: BROWSE_STALE_MS,
    refetchInterval: false,
    retry: 1
  })
}

/** Write one field of an entry (status, progress) and leave the rest alone. */
function saveWatch(source, id, patch) {
  return writeWatchlist(source, () => rest(`/watchlist/${id}`, { method: 'PUT', body: patch }))
}

/** What tracking a show from its own page carries when it is not tracked yet. */
function entryFromDetail(show) {
  return {
    id: show.id,
    cover: show.cover || null,
    title: show.title || null,
    totalEpisodes: show.episodes || null,
    format: show.format || null
  }
}

/** "Fri 18 Sep · 10:30" — the day and hour an episode lands, spelled out. */
function airingWhen(airingAt, t) {
  const at = new Date((airingAt || 0) * 1000)

  return `${t('dayName', at.getDay())} ${airedDate(airingAt, t)} · ${clockTime(airingAt)}`
}

/** How much synopsis fits beside the cover before it needs a "read more". */
const SYNOPSIS_CLAMP = '6.5rem'

/**
 * The clip, plus the fade that says "there is more" once the text runs past it.
 *
 * A mask rather than a painted gradient: it fades the prose into whatever surface
 * sits behind it, so the same rule reads correctly in a light and a dark theme
 * instead of hardcoding the pane's colour. A synopsis that fits gets no fade and
 * no button — nothing may imply text that does not exist.
 */
function synopsisStyle(open, clipped) {
  if (open) return undefined

  const clip = { maxHeight: SYNOPSIS_CLAMP, overflow: 'hidden' }

  if (!clipped) return clip

  const fade = 'linear-gradient(to bottom, rgba(0, 0, 0, 1) 60%, rgba(0, 0, 0, 0) 100%)'

  return { ...clip, WebkitMaskImage: fade, maskImage: fade }
}

/**
 * The synopsis, in the one gap this page has: beside the cover art, under the
 * metadata. Prose belongs where the room already is, not appended to the bottom
 * of the page where it would push the schedule further down.
 *
 * Clipped to the art's height with the rest one click away — and the button only
 * appears when the text actually runs past the clip, because a "read more" that
 * reveals nothing is worse than no button at all.
 */
function Synopsis({ t, text }) {
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const box = useRef(null)

  // Measured every render rather than on a dependency list: the pane can be
  // resized, and a same-value setState is a no-op, so this settles immediately.
  useEffect(() => {
    const node = box.current

    if (node && !open) setClipped(node.scrollHeight > node.clientHeight + 1)
  })

  if (!text) {
    return jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: t('noDescription') })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx('div', {
        className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
        children: t('synopsis')
      }),
      jsx('div', {
        ref: box,
        className: 'whitespace-pre-line break-words text-xs text-(--ui-text-secondary)',
        style: synopsisStyle(open, clipped),
        children: text
      }),
      clipped || open
        ? jsx(Button, {
            type: 'button',
            variant: 'ghost',
            size: 'micro',
            className: 'self-start',
            onClick: () => {
              haptic('tap')
              setOpen((prev) => !prev)
            },
            children: open ? t('readLess') : t('readMore')
          })
        : null
    ]
  })
}

/** One day of the calendar: marked when something airs, named when it is next. */
function DayCell({ cell, isNext, isPicked, isToday, onPick, t }) {
  const marked = cell.items.length > 0
  const label = isNext ? t('episode', cell.items[0].episode) : ''
  const skin = isNext
    ? 'bg-(--chrome-action-hover) font-semibold text-(--ui-text-primary)'
    : isPicked && marked
      ? 'bg-(--ui-bg-tertiary) text-(--ui-text-primary)'
      : isToday
        ? 'font-semibold text-(--ui-text-primary)'
        : 'text-(--ui-text-secondary)'
  const children = [
    jsx('span', { children: String(cell.day) }, 'day'),
    label ? jsx('span', { className: 'text-[0.5625rem]', children: label }, 'ep') : null,
    marked && !label ? jsx('span', { className: 'text-[0.5625rem] leading-none', children: '•' }, 'dot') : null
  ]

  if (!marked) {
    return jsx('div', {
      className: `flex flex-col items-center justify-center rounded-sm py-1 text-[0.6875rem] leading-none ${
        cell.inMonth ? '' : 'opacity-50'
      } text-(--ui-text-quaternary)`,
      children: children[0]
    })
  }

  return jsx('button', {
    type: 'button',
    className: `flex cursor-pointer flex-col items-center justify-center rounded-sm py-1 text-[0.6875rem] leading-none ${
      cell.inMonth ? '' : 'opacity-50'
    } ${skin}`,
    onClick: () => onPick(cell.key),
    children
  })
}

/**
 * The air dates as a calendar.
 *
 * A column of "EP 1 — 3 Jul" leaves the reader to do the arithmetic; a month grid
 * answers the real question — which day does this show land on — at a glance. Days
 * that carry an episode are marked, the next one is filled and names its episode,
 * and the day you pick lists what airs on it. All of it in the reader's own
 * timezone: the schedule is published in UTC, and nobody tracks a show in UTC.
 */
function EpisodeCalendar({ episodes, t }) {
  const now = Date.now() / 1000
  const [cursor, setCursor] = useState(() => calendarMonth(episodes, now))
  const [picked, setPicked] = useState(() => {
    const next = nextAiring(episodes, now)
    const aired = (episodes || []).filter((episode) => episode && episode.airingAt)
    // Nothing left to air? Then the last episode is the one worth showing.
    const last = aired.sort((a, b) => a.airingAt - b.airingAt)[aired.length - 1]

    return dayKey((next && next.airingAt) || (last && last.airingAt) || now)
  })
  const cells = monthGrid(episodes, cursor.year, cursor.month)
  const next = nextAiring(episodes, now)
  const nextKey = next ? dayKey(next.airingAt) : ''
  const todayKey = dayKey(now)
  const pickedCell = cells.find((cell) => cell.key === picked && cell.items.length)
  const left = (episodes || []).filter((episode) => episode && (episode.airingAt || 0) > now).length
  const move = (step) => {
    haptic('selection')
    setCursor((prev) => {
      const at = new Date(prev.year, prev.month + step, 1)

      return { year: at.getFullYear(), month: at.getMonth() }
    })
  }

  return jsxs('div', {
    className: 'flex flex-col gap-2 rounded-md border border-(--ui-stroke-secondary) p-2',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-2',
        children: [
          jsx('div', {
            className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
            children: t('scheduleTitle')
          }),
          jsxs('div', {
            className: 'flex items-center gap-1',
            children: [
              jsx(Tip, {
                label: t('previousMonth'),
                children: jsx(Button, {
                  type: 'button',
                  variant: 'ghost',
                  size: 'micro',
                  disabled: !hasEpisodesOutside(episodes, cursor.year, cursor.month, -1),
                  onClick: () => move(-1),
                  children: '‹'
                })
              }),
              jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'micro',
                onClick: () => {
                  haptic('tap')
                  setCursor(calendarMonth(episodes, now))
                  setPicked(todayKey)
                },
                children: t('dayToday')
              }),
              jsx(Tip, {
                label: t('nextMonth'),
                children: jsx(Button, {
                  type: 'button',
                  variant: 'ghost',
                  size: 'micro',
                  disabled: !hasEpisodesOutside(episodes, cursor.year, cursor.month, 1),
                  onClick: () => move(1),
                  children: '›'
                })
              })
            ]
          })
        ]
      }),
      jsxs('div', {
        className: 'flex items-center justify-between gap-2',
        children: [
          jsx('div', {
            className: 'text-xs font-medium text-(--ui-text-primary)',
            children: monthHeading(cursor.year, cursor.month, t)
          }),
          left
            ? jsx('div', {
                className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
                children: t('leftToAir', left)
              })
            : null
        ]
      }),
      jsxs('div', {
        className: 'grid gap-0.5',
        // Seven columns is a calendar, not a Tailwind scale step the kit ships.
        style: { gridTemplateColumns: 'repeat(7, 1fr)' },
        children: [
          ...[0, 1, 2, 3, 4, 5, 6].map((day) =>
            jsx(
              'div',
              {
                className: 'text-center text-[0.5625rem] uppercase text-(--ui-text-quaternary)',
                children: t('dayName', day)
              },
              `weekday:${day}`
            )
          ),
          ...cells.map((cell) =>
            jsx(
              DayCell,
              {
                cell,
                isNext: cell.key === nextKey,
                isPicked: cell.key === picked,
                isToday: cell.key === todayKey,
                onPick: (key) => {
                  haptic('selection')
                  setPicked(key)
                },
                t
              },
              cell.key
            )
          )
        ]
      }),
      pickedCell
        ? jsx('div', {
            className: 'flex flex-col gap-0.5 border-t border-(--ui-stroke-secondary) pt-1',
            children: pickedCell.items.map((episode) =>
              jsxs(
                'div',
                {
                  className: 'flex items-center justify-between gap-2 text-[0.6875rem]',
                  children: [
                    jsx('span', {
                      className: 'shrink-0 text-(--ui-text-secondary)',
                      children: t('episode', episode.episode)
                    }),
                    jsx('span', {
                      className: 'truncate text-(--ui-text-quaternary)',
                      children: `${clockTime(episode.airingAt)} · ${episodeWhen(episode, t)}`
                    })
                  ]
                },
                `picked:${episode.episode}`
              )
            )
          })
        : null
    ]
  })
}

/**
 * Every episode, in columns: the weekday, the date and the hour each one lands.
 * "3 Jul" alone does not say whether that was a Friday or what time it went up,
 * and those are the two things a reader checking a schedule wants.
 */
function EpisodeTable({ episodes, hasMore, loading, next, onLoadMore, t }) {
  const columns = '2.5rem 2rem 3.75rem 1fr'
  const heads = [t('columnEpisode'), t('columnDay'), t('columnDate'), t('columnTime')]

  return jsxs('div', {
    className: 'flex flex-col',
    children: [
      jsxs('div', {
        className: 'grid gap-2 border-b border-(--ui-stroke-secondary) pb-1',
        style: { gridTemplateColumns: columns },
        children: heads.map((head, index) =>
          jsx(
            'div',
            {
              className: `text-[0.5625rem] uppercase tracking-wide text-(--ui-text-quaternary)${
                index === heads.length - 1 ? ' text-right' : ''
              }`,
              children: head
            },
            head
          )
        )
      }),
      ...episodes.map((episode) => {
        const isNext = !!next && next.episode === episode.episode
        const aired = (episode.airingAt || 0) <= Date.now() / 1000

        return jsxs(
          'div',
          {
            className: `grid gap-2 py-0.5 text-[0.6875rem] ${
              isNext
                ? 'font-semibold text-(--ui-text-primary)'
                : aired
                  ? 'text-(--ui-text-quaternary) opacity-60'
                  : 'text-(--ui-text-secondary)'
            }`,
            style: { gridTemplateColumns: columns },
            children: [
              jsx('div', { children: String(episode.episode) }),
              jsx('div', { children: t('dayName', new Date((episode.airingAt || 0) * 1000).getDay()) }),
              jsx('div', { children: airedDate(episode.airingAt, t) }),
              jsx('div', { className: 'text-right', children: clockTime(episode.airingAt) })
            ]
          },
          `ep:${episode.episode}`
        )
      }),
      hasMore
        ? jsx('div', {
            className: 'flex justify-end pt-1',
            children: jsx(Button, {
              type: 'button',
              variant: 'ghost',
              size: 'micro',
              disabled: loading,
              onClick: onLoadMore,
              children: loading ? t('loadingMore') : t('loadMore')
            })
          })
        : null
    ]
  })
}

/**
 * The tracking status, as a select. AniList's vocabulary is six values and a
 * segmented track stops reading past three — the same reason the alert
 * destinations are a select. Radix renders an empty trigger when no item matches
 * `value`, so an unknown status falls back to the first real one.
 */
function StatusSelect({ onChange, options, t, value }) {
  const active = options.includes(value) ? value : options[0]

  return jsxs('div', {
    className: 'flex min-w-40 flex-col gap-1',
    children: [
      jsx('div', {
        className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
        children: t('watchStatus')
      }),
      jsxs(Select, {
        onValueChange: (next) => {
          haptic('selection')
          onChange(next)
        },
        value: active,
        children: [
          jsx(SelectTrigger, { className: 'h-7 w-full text-xs', children: jsx(SelectValue, {}) }),
          jsx(SelectContent, {
            children: options.map((status) =>
              jsx(SelectItem, { value: status, children: t('watchStatusName', status) }, status)
            )
          })
        ]
      })
    ]
  })
}

/**
 * One show, drilled into: what it is, where the reader is in it, and the episode
 * list — all inside one scroll area, so the pane never fights itself for height.
 */
function DetailPanel({ compact = false }) {
  const t = usePluginI18n(ID)
  const source = useSource()
  const { titleLanguage } = useValue($settings)
  const mediaId = useValue($detailId)
  const detail = useAnime(mediaId)
  const tracked = useTracked()
  const watch = watchRow(source, useWatchlist())
  // Which list answers here is not this pane's business: `tracked` already made
  // that decision, so the controls below only have to ask "is it tracked?".
  const entry = tracked.entry(mediaId)
  // What "show more" has gathered past the page that rides along with the detail.
  const [more, setMore] = useState({ hasMore: null, items: [], loading: false })

  useEffect(() => {
    setMore({ hasMore: null, items: [], loading: false })
  }, [mediaId])

  if (!mediaId) return null

  if (detail.isLoading) {
    return jsxs('div', {
      className: 'flex flex-col gap-2',
      children: [
        jsx(Skeleton, { className: 'h-32 w-20' }),
        jsx(Skeleton, { className: 'h-4 w-3/4' }),
        jsx(Skeleton, { className: 'h-4 w-1/2' })
      ]
    })
  }

  if (detail.isError) {
    return isMissingBackend(detail.error)
      ? jsx(ErrorState, {
          title: t('backendMissing'),
          description: t('backendHint', host.state.profile.get() || 'default')
        })
      : jsx(ErrorState, {
          title: t('unreachable'),
          description: String((detail.error && detail.error.message) || detail.error),
          children: jsx(Button, {
            type: 'button',
            size: 'sm',
            onClick: () => void detail.refetch(),
            children: t('retry')
          })
        })
  }

  const show = detail.data || {}
  const title = titleOf(show, titleLanguage)
  const first = show.episodesList || []
  const seen = new Set(first.map((episode) => episode.episode))
  const episodesList = [...first, ...more.items.filter((episode) => !seen.has(episode.episode))].sort(
    (a, b) => (a.airingAt || 0) - (b.airingAt || 0)
  )
  const hasMore = more.hasMore === null ? !!show.hasNextPage : more.hasMore
  // One reading of "the episode this page is about": the card, the calendar's
  // filled day and the table's highlighted row all read it, so they cannot
  // disagree. The API's own `nextEpisode` is the fallback for a show whose
  // per-episode schedule AniList has not published yet.
  const next =
    nextAiring(episodesList) ||
    (show.nextEpisode && show.airingAt ? { episode: show.nextEpisode, airingAt: show.airingAt } : null)

  const backToFeed = () => {
    haptic('tap')
    $workspaceView.set('upcoming')
  }

  const addToList = () => {
    haptic('tap')
    void saveWatch(source, show.id, entryFromDetail(show))
  }

  const stepProgress = (next) => {
    haptic('tap')
    const clamped = Math.max(0, next)

    // Stepping the progress of an untracked show starts tracking it.
    void saveWatch(source, show.id, entry ? { progress: clamped } : { ...entryFromDetail(show), progress: clamped })
  }

  const stepAccountProgress = (next) => {
    haptic('tap')
    // Same reading as the local path: stepping an untracked show is what starts
    // tracking it, and AniList's own default for a new entry is "watching".
    void tracked.account.setProgress(show.id, Math.max(0, next))
  }

  const loadMore = () => {
    if (more.loading) return
    haptic('tap')
    setMore((prev) => ({ ...prev, loading: true }))

    // The list rides along 25 at a time, so the next page follows from its length.
    const page = 1 + Math.ceil(episodesList.length / 25)

    void rest(`/anime/${mediaId}/episodes?page=${page}&per_page=25`)
      .then((result) => {
        setMore((prev) => ({
          hasMore: !!(result && result.hasNextPage),
          items: [...prev.items, ...((result && result.items) || [])],
          loading: false
        }))
      })
      .catch((error) => {
        console.warn('[anilist] show more episodes failed:', error)
        setMore((prev) => ({ ...prev, loading: false }))
      })
  }

  return jsx(ScrollArea, {
    className: compact ? 'h-80' : 'flex-1',
    style: compact ? undefined : { minHeight: 0 },
    children: jsxs('div', {
      className: 'flex flex-col gap-3',
      children: [
        jsxs('div', {
          className: 'flex items-center justify-between gap-2',
          children: [
            jsxs('div', {
              className: 'flex min-w-0 items-center gap-2',
              children: [
                jsx(Button, {
                  type: 'button',
                  variant: 'ghost',
                  size: 'sm',
                  onClick: backToFeed,
                  children: `← ${t('back')}`
                }),
                jsx('div', {
                  className: 'min-w-0 truncate text-sm font-medium text-(--ui-text-primary)',
                  title,
                  children: title
                })
              ]
            }),
            jsx(Tip, {
              label: t('openOnAniList'),
              children: jsx(Button, {
                type: 'button',
                variant: 'ghost',
                size: 'sm',
                onClick: () => {
                  haptic('tap')
                  if (osDoor) void osDoor.openExternal(show.url || `https://anilist.co/anime/${show.id}`)
                },
                children: '↗'
              })
            })
          ]
        }),
        jsxs('div', {
          className: 'flex items-start gap-3',
          children: [
            show.cover
              ? jsx('img', {
                  alt: '',
                  className: 'h-32 w-20 shrink-0 rounded object-cover',
                  src: show.cover
                })
              : null,
            jsxs('div', {
              className: 'flex min-w-0 flex-1 flex-col gap-1',
              children: [
                jsxs('div', {
                  className: 'flex flex-wrap items-center gap-1',
                  children: [
                    show.format ? jsx(Badge, { variant: 'muted', children: show.format }) : null,
                    show.status ? jsx(Badge, { variant: 'muted', children: show.status }) : null,
                    show.episodes
                      ? jsx(Badge, { variant: 'muted', children: t('episodeCount', show.episodes) })
                      : null,
                    show.seasonYear
                      ? jsx('span', {
                          className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
                          children: String(show.seasonYear)
                        })
                      : null,
                    show.duration
                      ? jsx('span', {
                          className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
                          children: `${show.duration} min`
                        })
                      : null
                  ]
                }),
                jsxs('div', {
                  className: 'flex flex-wrap items-center gap-2 text-[0.6875rem] text-(--ui-text-quaternary)',
                  children: [
                    show.score ? jsx('span', { children: t('scoreOutOf', show.score) }) : null,
                    show.studio ? jsx('span', { className: 'truncate', children: show.studio }) : null,
                    show.genres && show.genres.length
                      ? jsx('span', { className: 'truncate', children: show.genres.join(' · ') })
                      : null
                  ]
                }),
                // The gap beside the art is the only room this page has to spare,
                // so the prose goes in it instead of pushing the schedule down.
                jsx(Synopsis, { t, text: show.description }, `synopsis:${mediaId}`)
              ]
            })
          ]
        }),
        // What the page exists for: the next episode, its day and hour, and the
        // one action that follows from it.
        next
          ? jsxs('div', {
              className: 'flex flex-col gap-2 rounded-md border border-(--ui-stroke-secondary) p-2',
              children: [
                jsxs('div', {
                  className: 'flex flex-wrap items-center justify-between gap-2',
                  children: [
                    jsxs('div', {
                      className: 'flex min-w-0 items-center gap-2',
                      children: [
                        jsx('div', {
                          className:
                            'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
                          children: t('nextEpisode')
                        }),
                        jsx('div', {
                          className: 'text-xs font-medium text-(--ui-text-primary)',
                          children: t('episode', next.episode)
                        }),
                        jsx('div', {
                          className: 'text-[0.6875rem] text-(--ui-text-secondary)',
                          children: countdown(next.airingAt, t)
                        })
                      ]
                    }),
                    jsx('div', {
                      className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
                      children: airingWhen(next.airingAt, t)
                    })
                  ]
                }),
                // Independent of the account: an alert is a cron job, and the air
                // dates it needs are public — signed out works the same.
                jsx(AlertControl, { show, t })
              ]
            })
          : null,
        jsxs('div', {
          className: 'flex flex-wrap items-end gap-3 pt-1',
          children: tracked.account
            ? entry
              ? [
                  // The account's own entry: its status and progress are what is
                  // written, and removing it deletes the entry on AniList.
                  jsx(
                    StatusSelect,
                    {
                      onChange: (status) => void tracked.account.setStatus(show.id, status, show.episodes),
                      options: ACCOUNT_STATUSES,
                      t,
                      value: entry.status
                    },
                    'status'
                  ),
                  jsx(ProgressStepper, { entry, onStep: stepAccountProgress, show, t }, 'progress'),
                  jsx(
                    Button,
                    {
                      type: 'button',
                      variant: 'ghost',
                      size: 'sm',
                      onClick: () => askRemoval(show, title),
                      children: t('removeFromList')
                    },
                    'remove'
                  )
                ]
              : jsx(Button, {
                  type: 'button',
                  variant: 'secondary',
                  size: 'sm',
                  onClick: () => {
                    haptic('tap')
                    void tracked.account.add(show)
                  },
                  children: t('addToList')
                })
            : entry
              ? [
                  jsx(
                    StatusSelect,
                    {
                      onChange: (status) => void saveWatch(source, show.id, { status }),
                      options: WATCH_STATUSES,
                      t,
                      value: entry.status
                    },
                    'status'
                  ),
                  jsx(ProgressStepper, { entry, onStep: stepProgress, show, t }, 'progress'),
                  jsx(
                    Button,
                    {
                      type: 'button',
                      variant: 'ghost',
                      size: 'sm',
                      onClick: () => {
                        haptic('tap')
                        void watch.drop(show.id)
                      },
                      children: t('removeFromList')
                    },
                    'remove'
                  )
                ]
              : jsx(Button, {
                  type: 'button',
                  variant: 'secondary',
                  size: 'sm',
                  onClick: addToList,
                  children: t('addToList')
                })
        }),
        // The calendar first, then every episode in columns: the grid locates the
        // reader in the schedule, the table answers "and the rest?".
        episodesList.length === 0
          ? jsxs('div', {
              className: 'flex flex-col gap-2',
              children: [
                jsxs('div', {
                  className: 'flex items-center gap-2 pt-1',
                  children: [
                    jsx('div', {
                      className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
                      children: t('episodesTitle')
                    }),
                    jsx(Separator, { className: 'flex-1' })
                  ]
                }),
                jsx('div', {
                  className: 'pt-1 text-[0.6875rem] text-(--ui-text-quaternary)',
                  children: t('noEpisodes')
                })
              ]
            })
          : jsxs('div', {
              className: 'flex flex-col gap-2',
              children: [
                jsx(EpisodeCalendar, { episodes: episodesList, t }, `calendar:${mediaId}`),
                jsxs('div', {
                  className: 'flex items-center gap-2 pt-1',
                  children: [
                    jsx('div', {
                      className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)',
                      children: t('episodesTitle')
                    }),
                    jsx(Separator, { className: 'flex-1' })
                  ]
                }),
                jsx(EpisodeTable, {
                  episodes: episodesList,
                  hasMore,
                  loading: more.loading,
                  next,
                  onLoadMore: loadMore,
                  t
                })
              ]
            })
      ]
    })
  })
}

// ─── UI ─────────────────────────────────────────────────────────────────────

function OriginLine() {
  const t = usePluginI18n(ID)
  const source = useSource()
  const label = source.label || (source.id === 'local' ? t('localDevice') : source.id)
  return jsxs('div', {
    className: 'flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-quaternary)',
    children: [
      jsx('span', { className: 'uppercase tracking-wide', children: t('title') }),
      jsx('span', { children: '·' }),
      jsx('span', { children: t('origin', label, source.profile) })
    ]
  })
}

/**
 * Track / untrack in one tap — and the one place the account's own reading of a
 * show shows up. Connected, a tracked row carries its status and progress beside
 * the star: "in my list" is a fact about AniList now, and it is worth seeing.
 *
 * Always visible: a tracker's primary action must not depend on the pointer
 * happening to rest on a row, and `group-hover` reveals were what made it look
 * missing.
 */
function WatchStar({ entry, onToggle, t, watched }) {
  return jsxs('div', {
    className: 'flex shrink-0 items-center gap-1',
    children: [
      entry
        ? jsx(Tip, {
            label: t('accountEntryTip'),
            children: jsx(Badge, {
              variant: 'muted',
              children: trackedLabel(entry, entry.totalEpisodes, t)
            })
          })
        : null,
      jsx(Tip, {
        label: watched ? t('untrack') : t('track'),
        children: jsx(Button, {
          type: 'button',
          variant: 'ghost',
          size: 'sm',
          className: watched ? 'text-(--ui-text-primary)' : 'text-(--ui-text-quaternary)',
          onClick: onToggle,
          children: watched ? '★' : '☆'
        })
      })
    ]
  })
}

/**
 * The one confirmation in this plugin: taking a show off the list deletes the
 * entry on AniList, and its score, notes and progress go with it. A tap that did
 * that silently would be the most expensive mistake this UI can make.
 *
 * Mounted once, by the chip (which is always in the status bar), so the popover
 * and the workspace tab ask through the same dialog — it renders through a portal,
 * so where it is mounted does not matter.
 */
function RemovalDialog() {
  const t = usePluginI18n(ID)
  const tracked = useTracked()
  const pending = useValue($pendingRemoval)

  return jsx(ConfirmDialog, {
    confirmLabel: t('confirmRemoveAction'),
    description: t('confirmRemoveBody'),
    destructive: true,
    onClose: () => $pendingRemoval.set(null),
    // ConfirmDialog owns the pending → done → close beat and shows whatever this
    // throws, inline. An account that went away mid-dialog writes nothing.
    onConfirm: () => (tracked.account ? tracked.account.remove(pending.id) : undefined),
    open: !!pending,
    title: t('confirmRemoveTitle', (pending && pending.title) || '')
  })
}

function AiringRow({ entry, item, onToggle, t, watched }) {
  const { covers, titleLanguage } = useValue($settings)
  const title = titleOf(item, titleLanguage)

  return jsxs('div', {
    className:
      'group flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 hover:bg-(--chrome-action-hover)',
    // The whole row is the door to the detail. Aiming at the text of a truncated
    // title is a small game nobody should have to play.
    role: 'button',
    tabIndex: 0,
    onClick: () => {
      haptic('selection')
      openDetail(item.id)
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        haptic('selection')
        openDetail(item.id)
      }
    },
    children: [
      covers && item.cover
        ? jsx('img', { alt: '', className: 'h-12 w-8 shrink-0 rounded object-cover', src: item.cover })
        : null,
      jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsx('div', {
            className: 'truncate text-xs text-(--ui-text-secondary)',
            title,
            children: title
          }),
          jsxs('div', {
            className: 'flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-quaternary)',
            children: [
              jsx(Badge, { variant: 'muted', children: episodeLabel(item, t) }),
              jsx('span', { children: countdown(item.airingAt, t) })
            ]
          })
        ]
      }),
      jsx(WatchStar, {
        entry,
        onToggle: (event) => {
          event.stopPropagation()
          if (onToggle) onToggle()
        },
        t,
        watched
      }),
      jsx(Tip, {
        label: t('openOnAniList'),
        children: jsx(Button, {
          type: 'button',
          variant: 'ghost',
          size: 'sm',
          className: 'text-(--ui-text-quaternary)',
          onClick: (event) => {
            event.stopPropagation()
            haptic('tap')
            if (osDoor) void osDoor.openExternal(`https://anilist.co/anime/${item.id}`)
          },
          children: '↗'
        })
      })
    ]
  })
}

/**
 * The popover is the airing feed and the filters that belong to it — the same
 * ones it always had — and nothing else. The catalog and the settings moved to the
 * workspace, where there is room to read them instead of a tab strip squeezed into
 * a status-bar menu.
 */
function PopoverBody({ onClose }) {
  const t = usePluginI18n(ID)

  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx(OriginLine, {}),
      jsx(UpcomingPanel, { compact: true }),
      jsx(Separator, {}),
      // Two named doors out of here: the full feed, and the one place every
      // setting lives. Search stays in the workspace's Catalog tab (and in the
      // palette) instead of being squeezed into a status-bar menu.
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx(Button, {
            type: 'button',
            variant: 'outline',
            size: 'sm',
            onClick: () => {
              haptic('tap')
              onClose()
              openWorkspaceOrSay('upcoming')
            },
            children: t('openUpcoming')
          }),
          jsx(Button, {
            type: 'button',
            variant: 'outline',
            size: 'sm',
            onClick: () => {
              haptic('tap')
              onClose()
              openWorkspaceOrSay('settings')
            },
            children: t('openSettings')
          })
        ]
      })
    ]
  })
}

function NextChip() {
  const t = usePluginI18n(ID)
  const airing = useAiring()
  const tracked = useTracked()
  const alerts = useAlerts()
  const { titleLanguage, windowDays } = useValue($settings)
  // Controlled so the footer's buttons can close this menu on their way out.
  const [open, setOpen] = useState(false)
  const items = (airing.data && airing.data.items) || []
  // The chip answers one question: what airs next among the shows this reader
  // tracks. `useAiring` already refetches every minute, so it rolls over to the
  // following episode on its own as each one goes out.
  const coming = comingAiring(items, tracked.ids)
  const next = coming[0] || null
  // How many more land inside the same horizon — the chip says "there is more"
  // rather than cycling through them, because a status bar that moves on its own
  // is one you cannot read.
  const more = Math.max(0, coming.length - 1)
  // Whether a reminder is armed for the very episode being counted down to — the
  // one question about alerts the chip can answer without opening anything.
  const armed = next ? alertFor(alerts.data, next.id, next.episode) : null
  // A bare countdown says how long, not what for.
  const nextTitle = next ? titleOf(next, titleLanguage) : ''
  // Within the hour the chip stops being a postcard and starts being a notice.
  const imminent = !!next && next.airingAt - Date.now() / 1000 <= 3600
  // While either list is still arriving the chip claims nothing: "nothing airs"
  // and "not loaded yet" must not look the same.
  const settling = !next && (airing.isLoading || tracked.isLoading)
  const empty = !next && !settling
  const emptyLabel = tracked.ids.size ? t('chipNothingAiring') : t('chipNothingTracked')
  const emptyHint = tracked.ids.size ? t('chipNothingAiringHint', windowDays) : t('chipNothingTrackedHint')
  // The hover text is where the chip can be complete: the show, when, whose list,
  // and how many more of yours are inside the same horizon.
  const chipTitle = next
    ? [
        nextTitle,
        episodeTag(next, t),
        countdown(next.airingAt, t),
        t('chipScope'),
        armed ? t('chipAlertArmed') : '',
        more ? t('chipMoreHint', more, CHIP_COMING_HOURS) : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : empty
      ? emptyHint
      : t('chipLabel')

  // The chip's face, as one element: a left click opens the panel and a right
  // click opens the menu, and Radix's Slots compose both onto the same node.
  const chipButton = jsx('button', {
    type: 'button',
    // The hover text carries the scope too: "whose show is this" is the one thing
    // about the chip that is invisible at a glance.
    title: chipTitle,
    className: cn(
      'inline-flex h-full items-center gap-1.5 px-1.5 text-[0.6875rem] transition-colors',
      'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'
    ),
    onClick: () => haptic('tap'),
    children: [
      // The bar's other items are plain words; this one carries a time, so it
      // wears an icon and keeps that time the brightest mark in the chip.
      jsx(Codicon, {
        name: chipIcon(next && next.airingAt),
        size: '0.75rem',
        className: cn('shrink-0', imminent && 'text-(--ui-text-primary)')
      }),
      jsx('span', {
        className: 'text-[0.625rem] uppercase tracking-wide opacity-60',
        children: 'anilist'
      }),
      // Named, not just counted down to. Truncation is inline because the compiled
      // Tailwind carries no arbitrary max-width.
      next ? jsx('span', { className: 'truncate', style: { maxWidth: '9rem' }, children: nextTitle }) : null,
      // Which episode, not only when it lands.
      next && episodeTag(next, t)
        ? jsx('span', { className: 'shrink-0 opacity-60', children: episodeTag(next, t) })
        : null,
      next
        ? jsx('span', {
            className: cn('shrink-0 font-medium tabular-nums', imminent && 'text-(--ui-text-primary)'),
            children: countdown(next.airingAt, t)
          })
        : empty
          ? jsx('span', { className: 'truncate opacity-60', children: emptyLabel })
          : null,
      // A reminder is armed for this very episode: one bell says so without
      // opening anything.
      armed ? jsx(Codicon, { name: 'bell', size: '0.625rem', className: 'shrink-0 opacity-60' }) : null,
      // "One of two" is worth saying; cycling between them is not.
      more ? jsx('span', { className: 'shrink-0 opacity-60', children: t('chipMore', more) }) : null
    ]
  })

  const openNextShow = () => {
    haptic('tap')
    setOpen(false)
    if (next && openDetail(next.id)) return
    host.notify({ kind: 'info', message: 'AniList: ' + t('chipFallback') })
  }

  const openNextOnAniList = () => {
    haptic('tap')
    setOpen(false)
    if (next && osDoor) void osDoor.openExternal(`https://anilist.co/anime/${next.id}`)
  }

  const refreshNow = () => {
    haptic('tap')
    setOpen(false)
    void queryClient.invalidateQueries({ queryKey: [SOURCE] })
    host.notify({ kind: 'info', message: t('refreshed') })
  }

  return jsx(Popover, {
    open,
    onOpenChange: (nextOpen) => setOpen(nextOpen),
    children: [
      // Right-click is where a status item's actions belong — the app's own items
      // open a menu there — and a left click still opens the panel.
      jsxs(ContextMenu, {
        children: [
          jsx(ContextMenuTrigger, {
            asChild: true,
            children: jsx(PopoverTrigger, { asChild: true, children: chipButton })
          }),
          jsxs(ContextMenuContent, {
            className: 'min-w-52',
            // The bar sits at the bottom of the window: keep the menu clear of it.
            collisionPadding: { bottom: 44, left: 8, right: 8, top: 8 },
            onCloseAutoFocus: (event) => event.preventDefault(),
            children: [
              // The show-specific actions need a show to act on.
              next
                ? jsx(ContextMenuItem, {
                    onSelect: openNextShow,
                    children: [
                      jsx(Codicon, { name: 'arrow-right', size: '0.875rem' }, 'icon'),
                      jsx('span', { children: t('menuOpenShow') }, 'label')
                    ]
                  })
                : null,
              next
                ? jsx(ContextMenuItem, {
                    onSelect: openNextOnAniList,
                    children: [
                      jsx(Codicon, { name: 'link-external', size: '0.875rem' }, 'icon'),
                      jsx('span', { children: t('openOnAniList') }, 'label')
                    ]
                  })
                : null,
              next ? jsx(ContextMenuSeparator, {}) : null,
              jsx(ContextMenuItem, {
                onSelect: refreshNow,
                children: [
                  jsx(Codicon, { name: 'refresh', size: '0.875rem' }, 'icon'),
                  jsx('span', { children: t('menuRefresh') }, 'label')
                ]
              }),
              jsx(ContextMenuItem, {
                onSelect: () => {
                  haptic('tap')
                  setOpen(false)
                  openWorkspaceOrSay('settings')
                },
                children: [
                  jsx(Codicon, { name: 'settings-gear', size: '0.875rem' }, 'icon'),
                  jsx('span', { children: t('openSettings') }, 'label')
                ]
              })
            ]
          })
        ]
      }),
      jsx(PopoverContent, {
        align: 'end',
        side: 'top',
        sideOffset: 8,
        // Wider than the kit's 18rem default: the season track, the year stepper
        // and a search field all want room. Width is inline because the compiled
        // Tailwind ships no w-96; the max keeps Radix's collision math honest on
        // a narrow window.
        style: { maxWidth: 'var(--radix-popover-content-available-width)', width: '24rem' },
        // A status-bar popover must not dismiss because the pointer travelled
        // toward it. Escape and a click outside still close it; a focus change
        // the user never asked for does not. Each dismissal logs which event
        // fired so desktop.log shows the mechanism instead of a guess.
        onEscapeKeyDown: () => console.log('[anilist] popover dismiss: escape'),
        onFocusOutside: (event) => {
          console.log('[anilist] popover dismiss attempt: focus-outside (prevented)')
          event.preventDefault()
        },
        onPointerDownOutside: () => console.log('[anilist] popover dismiss: pointerdown-outside'),
        children: jsx(PopoverBody, { onClose: () => setOpen(false) })
      }),
      // One dialog for the whole plugin, mounted beside the popover rather than
      // inside it: the workspace tab asks through it too, and a confirm dialog
      // must not disappear with the surface that happened to open it.
      jsx(RemovalDialog, {})
    ]
  })
}

// ─── plugin ─────────────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'AniList',
  // Opt-in on purpose: the plugin reads a network API and will own an OAuth
  // credential and cron jobs. It inventories in Capabilities → Plugins, off
  // until the user turns it on.
  defaultEnabled: false,
  register(ctx) {
    rest = ctx.rest
    osDoor = ctx.os
    store = ctx.storage
    // Storage only exists after register(): re-read so a saved preference wins.
    $settings.set(normalizeSettings(store && store.get ? store.get(SETTINGS_KEY, null) : null))
    ctx.i18n.register(STRINGS)
    t = ctx.i18n.t
    void refreshConnections()

    ctx.registerMany([
      {
        id: 'chip',
        area: 'statusBar.right',
        order: 130,
        render: () => jsx(NextChip, {})
      },
      {
        id: 'seasons',
        area: PALETTE_AREA,
        data: {
          id: 'anilist.seasons',
          label: t('paletteSeasons'),
          keywords: ['anime', 'anilist', 'season', 'search', 'browse', 'temporadas'],
          run: () => {
            if (openAniListWorkspace('browse')) return
            // No main-area door on this desktop: point at the surface that has one.
            host.notify({ kind: 'info', message: 'AniList: ' + t('chipFallback') })
          }
        }
      },
      {
        id: 'settings',
        area: PALETTE_AREA,
        data: {
          id: 'anilist.settings',
          label: t('paletteSettings'),
          keywords: ['anime', 'anilist', 'settings', 'preferences', 'ajustes', 'configuracion'],
          run: () => {
            if (openAniListWorkspace('settings')) return
            host.notify({ kind: 'info', message: 'AniList: ' + t('chipFallback') })
          }
        }
      },
      {
        id: 'refresh',
        area: PALETTE_AREA,
        data: {
          id: 'anilist.refresh',
          label: t('paletteRefresh'),
          keywords: ['anime', 'anilist', 'refresh'],
          run: () => {
            void queryClient.invalidateQueries({ queryKey: [SOURCE] })
            host.notify({ kind: 'info', message: t('refreshed') })
          }
        }
      }
    ])
  }
}
