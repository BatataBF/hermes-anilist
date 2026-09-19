"""hermes-anilist — backend routes.

Mounted by the gateway/serve process under ``/api/plugins/hermes-anilist/``.
Every request to AniList happens here, for three reasons:

* the renderer never holds a credential (it has full app authority, no sandbox);
* the 30 requests/minute budget is per host, so the cache must be shared across
  windows, connections and profiles rather than duplicated per window;
* an HTTP hop is the only network door a desktop plugin has anyway.

Media routes are read-only and public: AniList needs no API key for media data.
The token-gated ones (sign-in, the account's list) read their credential through
``agent.secret_scope`` and never hand it back to the renderer.
"""

from __future__ import annotations

import hashlib
import os
import re
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel, Field, StrictBool, field_validator

router = APIRouter()

ANILIST_ENDPOINT = "https://graphql.anilist.co"
REQUEST_TIMEOUT_SECONDS = 15.0

# Media data changes slowly; the airing feed changes on the minute it matters.
MEDIA_CACHE_TTL_SECONDS = 300.0
AIRING_CACHE_TTL_SECONDS = 60.0
# The account's list is ours to read, not ours to write (write-back comes later),
# so a short hold is enough to keep one window's re-renders off the shared budget.
LIST_CACHE_TTL_SECONDS = 60.0

# AniList allows 30 requests/minute. Below this floor we serve cached data
# instead of spending budget, so a busy window can never starve the others.
RATE_FLOOR = 5

VALID_SEASONS = ("WINTER", "SPRING", "SUMMER", "FALL")

# key -> (expires_at, payload)
_cache: Dict[str, Tuple[float, Any]] = {}
# Last rate-limit headers seen from AniList.
_rate: Dict[str, Optional[int]] = {"limit": None, "remaining": None}
_rate_checked_at = 0.0


# ─── cache ───────────────────────────────────────────────────────────────────


def _fresh(key: str) -> Optional[Any]:
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    return None


def _stale(key: str) -> Optional[Any]:
    """Last value for ``key`` regardless of expiry — the rate-floor fallback.

    Returning slightly old data beats returning an error when the only reason
    we cannot refresh is our own budget.
    """
    hit = _cache.get(key)
    return hit[1] if hit else None


# How many distinct answers one process may hold. Every key is "one question" (a
# query at a page, a window at a cursor) and a long-lived gateway mints hundreds
# of them over a season, so the cache has to forget on purpose.
CACHE_MAX_ENTRIES = 256


def _evict(keep: str) -> None:
    """Make room: expired entries first, then the ones closest to expiring."""
    now = time.time()
    for key in [k for k, (expires_at, _) in _cache.items() if expires_at <= now and k != keep]:
        _cache.pop(key, None)

    while len(_cache) > CACHE_MAX_ENTRIES:
        oldest = min((key for key in _cache if key != keep), key=lambda key: _cache[key][0], default=None)
        if oldest is None:
            break
        _cache.pop(oldest, None)


def _store(key: str, value: Any, ttl: float) -> Any:
    _cache[key] = (time.time() + ttl, value)
    if len(_cache) > CACHE_MAX_ENTRIES:
        _evict(key)

    return value


def _rate_exhausted() -> bool:
    remaining = _rate.get("remaining")
    return remaining is not None and remaining < RATE_FLOOR


# ─── AniList transport ───────────────────────────────────────────────────────


def _error_message(response: "httpx.Response") -> Optional[str]:
    """AniList's own sentence, when the body carries one — 4xx is otherwise opaque."""
    try:
        first = (response.json().get("errors") or [{}])[0] or {}
    except Exception:  # noqa: BLE001 - a body that is not JSON is no message, not an error
        return None

    return first.get("message")


# AniList's public endpoint answered 403 to an anonymous agent string (first seen
# when the digest prompt called it), and it asks clients to identify themselves.
USER_AGENT = "hermes-anilist/0.7.0 (+https://github.com/BatataBF/hermes-anilist)"

# One client for the process: a refresh of the airing feed stitches up to
# MAX_AIRING_PAGES requests and every one of them used to pay its own TCP+TLS
# setup. The gateway/serve process runs a single event loop, which is what makes
# a module-level client safe here; `is_closed` rebuilds after a teardown.
_client: Optional["httpx.AsyncClient"] = None


def _headers(token: Optional[str] = None) -> Dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    return headers


def _http() -> "httpx.AsyncClient":
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=True)

    return _client


async def _graphql(query: str, variables: Dict[str, Any], token: Optional[str] = None) -> Dict[str, Any]:
    payload = {"query": query, "variables": variables}
    try:
        response = await _http().post(ANILIST_ENDPOINT, json=payload, headers=_headers(token))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"AniList is unreachable: {exc}") from exc

    global _rate_checked_at
    for header, slot in (("x-ratelimit-limit", "limit"), ("x-ratelimit-remaining", "remaining")):
        raw = response.headers.get(header)
        if raw is not None and raw.isdigit():
            _rate[slot] = int(raw)
    _rate_checked_at = time.time()

    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="AniList rate limit reached, try again shortly.")
    if token and response.status_code == 401:
        # Only a 401 is about the token. A 400 is a malformed query, and reporting
        # that as "token rejected" sends whoever reads it hunting the wrong thing.
        raise HTTPException(status_code=401, detail="AniList rejected that token.")
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=_error_message(response) or f"AniList returned HTTP {response.status_code}.",
        )

    body = response.json()
    if body.get("errors"):
        first = (body["errors"] or [{}])[0].get("message", "unknown error")
        raise HTTPException(status_code=502, detail=f"AniList rejected the query: {first}")
    return body.get("data") or {}


async def _cached(cache_key: str, ttl: float, fetch: Callable[[], Awaitable[Dict[str, Any]]]) -> Dict[str, Any]:
    """Cache and budget guard around a fetch, whether it is one request or a stitched few."""
    cached = _fresh(cache_key)
    if cached is not None:
        return cached
    if _rate_exhausted():
        fallback = _stale(cache_key)
        if fallback is not None:
            return fallback
    return _store(cache_key, await fetch(), ttl)


async def _cached_graphql(cache_key: str, ttl: float, query: str, variables: Dict[str, Any]) -> Dict[str, Any]:
    return await _cached(cache_key, ttl, lambda: _graphql(query, variables))


# ─── GraphQL documents ───────────────────────────────────────────────────────

_MEDIA_FIELDS = """
  id
  title { romaji english native }
  coverImage { medium color }
  format
  status
  season
  seasonYear
  episodes
  averageScore
  nextAiringEpisode { episode airingAt timeUntilAiring }
"""

_TRENDING_QUERY = f"""
query ($page: Int, $perPage: Int) {{
  Page(page: $page, perPage: $perPage) {{
    pageInfo {{ total currentPage lastPage hasNextPage }}
    media(type: ANIME, sort: TRENDING_DESC) {{ {_MEDIA_FIELDS} }}
  }}
}}
"""

_SEASON_QUERY = f"""
query ($season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int) {{
  Page(page: $page, perPage: $perPage) {{
    pageInfo {{ total currentPage lastPage hasNextPage }}
    media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {{ {_MEDIA_FIELDS} }}
  }}
}}
"""

# SEARCH_MATCH only means something alongside `search`, and it keeps the most
# literal title matches first instead of burying them under whatever is popular.
_SEARCH_QUERY = f"""
query ($search: String, $page: Int, $perPage: Int) {{
  Page(page: $page, perPage: $perPage) {{
    pageInfo {{ total currentPage lastPage hasNextPage }}
    media(type: ANIME, search: $search, sort: SEARCH_MATCH) {{ {_MEDIA_FIELDS} }}
  }}
}}
"""

_AIRING_QUERY = """
query ($from: Int, $to: Int, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    pageInfo { total hasNextPage }
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      episode
      airingAt
      media { id title { romaji english native } episodes coverImage { medium } }
    }
  }
}
"""

# One show, everything the detail pane shows — plus what an agent asks and the
# pane never did: the catalogue it sits next to (relations), what the community
# pairs it with, where it ranks, what its tags are and how its scores spread.
# `asHtml: false` keeps the description as text (AniList still leaves the odd
# `<br>` in, stripped below).
_DETAIL_QUERY = """
query ($id: Int, $page: Int, $perPage: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    description(asHtml: false)
    coverImage { medium large color }
    bannerImage
    format
    status
    episodes
    duration
    genres
    averageScore
    popularity
    favourites
    season
    seasonYear
    siteUrl
    studios(isMain: true) { nodes { name } }
    nextAiringEpisode { episode airingAt timeUntilAiring }
    rankings { rank type context }
    tags { name rank isGeneralSpoiler }
    stats { scoreDistribution { score amount } }
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english native }
          coverImage { medium }
          format
          status
          episodes
          averageScore
          seasonYear
          siteUrl
        }
      }
    }
    recommendations(sort: RATING_DESC, perPage: 6) {
      nodes {
        rating
        mediaRecommendation {
          id
          title { romaji english native }
          coverImage { medium }
          format
          averageScore
          seasonYear
          siteUrl
        }
      }
    }
    airingSchedule(page: $page, perPage: $perPage) {
      pageInfo { total currentPage lastPage hasNextPage }
      nodes { episode airingAt timeUntilAiring }
    }
  }
}
"""

# The episode list on its own, for "show more" past the first page of detail.
_EPISODES_QUERY = """
query ($id: Int, $page: Int, $perPage: Int) {
  Media(id: $id, type: ANIME) {
    airingSchedule(page: $page, perPage: $perPage) {
      pageInfo { total currentPage lastPage hasNextPage }
      nodes { episode airingAt timeUntilAiring }
    }
  }
}
"""


# ─── normalization (pure — covered by tests/) ─────────────────────────────────


def _title_parts(node: Dict[str, Any]) -> Dict[str, str]:
    """Every title AniList offers for a node, so the UI picks the language it shows.

    AniList returns ``null`` for the variants it has no name in; those come back
    as empty strings so a caller can fall through with ``or``.
    """
    titles = node.get("title") or {}
    return {
        "romaji": titles.get("romaji") or "",
        "english": titles.get("english") or "",
        "native": titles.get("native") or "",
    }


def _title(node: Dict[str, Any]) -> str:
    titles = _title_parts(node)
    return titles["english"] or titles["romaji"] or titles["native"] or "Untitled"


def normalize_media_page(data: Dict[str, Any]) -> Dict[str, Any]:
    page = data.get("Page") or {}
    info = page.get("pageInfo") or {}
    items: List[Dict[str, Any]] = []
    for node in page.get("media") or []:
        next_airing = node.get("nextAiringEpisode") or None
        items.append(
            {
                "id": node.get("id"),
                "title": _title(node),
                "titles": _title_parts(node),
                "cover": (node.get("coverImage") or {}).get("medium"),
                "accent": (node.get("coverImage") or {}).get("color"),
                "format": node.get("format"),
                "status": node.get("status"),
                "season": node.get("season"),
                "seasonYear": node.get("seasonYear"),
                "episodes": node.get("episodes"),
                "score": node.get("averageScore"),
                "nextEpisode": (next_airing or {}).get("episode"),
                "airingAt": (next_airing or {}).get("airingAt"),
            }
        )
    return {
        "items": items,
        "page": info.get("currentPage"),
        "lastPage": info.get("lastPage"),
        "hasNextPage": bool(info.get("hasNextPage")),
        "total": info.get("total"),
    }


def normalize_airing(data: Dict[str, Any]) -> Dict[str, Any]:
    page = data.get("Page") or {}
    items: List[Dict[str, Any]] = []
    for entry in page.get("airingSchedules") or []:
        media = entry.get("media") or {}
        items.append(
            {
                "id": media.get("id"),
                "title": _title(media),
                "titles": _title_parts(media),
                "cover": (media.get("coverImage") or {}).get("medium"),
                "episode": entry.get("episode"),
                "airingAt": entry.get("airingAt"),
                # The row's "EP 7/12": the airing number and the show's length.
                "totalEpisodes": media.get("episodes"),
            }
        )
    items.sort(key=lambda item: item.get("airingAt") or 0)
    return {"items": items, "hasNextPage": bool((page.get("pageInfo") or {}).get("hasNextPage"))}


def _list_entry(node: Dict[str, Any]) -> Dict[str, Any]:
    """One list entry, said the way the rest of this plugin already says entries.

    The status translation lives here and nowhere else: a row asks "is this
    tracked?" and never which store answered, and the write path maps back with
    ``ANILIST_STATUS``.
    """
    media = node.get("media") or {}
    raw = (node.get("status") or "").upper()

    return {
        "id": media.get("id") or node.get("mediaId"),
        "entryId": node.get("id"),
        "status": LIST_STATUS_VOCABULARY.get(raw) or raw.lower() or "unknown",
        "progress": node.get("progress") or 0,
        "score": node.get("score") or 0,
        "title": _title(media),
        "titles": _title_parts(media),
        "cover": (media.get("coverImage") or {}).get("medium"),
        "format": media.get("format"),
        "totalEpisodes": media.get("episodes"),
        # Which broadcast season it belongs to: "what am I watching this season"
        # is a question about the calendar, not about progress.
        "season": media.get("season"),
        "seasonYear": media.get("seasonYear"),
        "siteUrl": media.get("siteUrl"),
    }


def _list_rank(entry: Dict[str, Any]) -> Tuple[int, str]:
    status = entry.get("status")

    return (
        LIST_STATUS_ORDER.index(status) if status in LIST_STATUS_ORDER else len(LIST_STATUS_ORDER),
        entry.get("title") or "",
    )


def _sorted_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(entries, key=_list_rank)


def _count_by_status(entries: List[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for entry in entries:
        status = entry.get("status") or "unknown"
        counts[status] = counts.get(status, 0) + 1

    return counts


def normalize_list(data: Dict[str, Any]) -> Dict[str, Any]:
    """The account's list, flattened into the shape a row already understands.

    Custom lists are skipped: a show filed under "Favourites" is already in one of
    the five status lists, so counting both would double it.
    """
    collection = data.get("MediaListCollection") or {}
    entries = _sorted_entries(
        [
            _list_entry(node)
            for group in collection.get("lists") or []
            if not group.get("isCustomList")
            for node in group.get("entries") or []
        ]
    )

    return {"entries": entries, "counts": _count_by_status(entries), "total": len(entries)}


_TAG_RE = re.compile(r"<[^>]+>")
_BREAK_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)


def _plain_text(value: Optional[str]) -> str:
    """AniList's `asHtml: false` is text-with-`<br>`, not plain text."""
    if not value:
        return ""

    return _TAG_RE.sub("", _BREAK_RE.sub("\n", value)).strip()


def normalize_schedule(schedule: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One show's own airing schedule, in order — the episode list."""
    episodes = [
        {
            "episode": node.get("episode"),
            "airingAt": node.get("airingAt"),
            "timeUntilAiring": node.get("timeUntilAiring"),
        }
        for node in (schedule.get("nodes") or [])
        if node.get("episode") is not None
    ]
    episodes.sort(key=lambda item: item.get("airingAt") or 0)

    return episodes


# The order a story reads in, not the order AniList returns relations in: what
# comes next first, then what came before, then the side material.
RELATION_ORDER = (
    "SEQUEL",
    "PREQUEL",
    "SIDE_STORY",
    "SPIN_OFF",
    "ALTERNATIVE",
    "SUMMARY",
    "ADAPTATION",
    "CHARACTER",
    "OTHER",
)


def _relation_rank(relation: Optional[str]) -> int:
    try:
        return RELATION_ORDER.index(relation or "")
    except ValueError:
        return len(RELATION_ORDER)


def normalize_relations(media: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every relative AniList files for a show, in the order a story reads.

    A relation edge with no node is AniList saying "related to something it will
    not name"; it is not a row.
    """
    edges = (media.get("relations") or {}).get("edges") or []
    items: List[Dict[str, Any]] = []

    for edge in edges:
        node = edge.get("node") or {}
        media_id = node.get("id")
        if not media_id:
            continue
        items.append(
            {
                "relation": edge.get("relationType"),
                "id": media_id,
                "title": _title(node),
                "titles": _title_parts(node),
                "cover": (node.get("coverImage") or {}).get("medium"),
                "format": node.get("format"),
                "status": node.get("status"),
                "episodes": node.get("episodes"),
                "score": node.get("averageScore"),
                "seasonYear": node.get("seasonYear"),
                "url": node.get("siteUrl") or f"https://anilist.co/anime/{media_id}",
            }
        )

    items.sort(key=lambda item: (_relation_rank(item.get("relation")), -(item.get("seasonYear") or 0)))

    return items


def normalize_tags(media: Dict[str, Any], limit: int = 12) -> List[Dict[str, Any]]:
    """The show's tags, heaviest first, with the general spoilers left out.

    ``rank`` is how central a tag is to the work; a tag AniList itself flags as a
    general spoiler is not a description to hand over unasked.
    """
    tags = [tag for tag in (media.get("tags") or []) if not tag.get("isGeneralSpoiler")]
    tags.sort(key=lambda tag: tag.get("rank") or 0, reverse=True)

    return [{"name": tag.get("name"), "rank": tag.get("rank")} for tag in tags[: max(0, limit)]]


def normalize_rankings(media: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The show's placements, context included — a rank without context says nothing."""
    return [
        {"rank": item.get("rank"), "type": item.get("type"), "context": item.get("context")}
        for item in (media.get("rankings") or [])
        if item.get("rank")
    ]


def normalize_recommendations(media: Dict[str, Any]) -> List[Dict[str, Any]]:
    """What the community pairs with this show, most-voted first.

    ``rating`` is how many people made the pairing, which is the only signal
    behind a community recommendation.
    """
    nodes = (media.get("recommendations") or {}).get("nodes") or []
    items: List[Dict[str, Any]] = []

    for node in nodes:
        related = node.get("mediaRecommendation") or {}
        media_id = related.get("id")
        if not media_id:
            continue
        items.append(
            {
                "id": media_id,
                "title": _title(related),
                "titles": _title_parts(related),
                "cover": (related.get("coverImage") or {}).get("medium"),
                "format": related.get("format"),
                "score": related.get("averageScore"),
                "seasonYear": related.get("seasonYear"),
                "votes": node.get("rating"),
                "url": related.get("siteUrl") or f"https://anilist.co/anime/{media_id}",
            }
        )

    items.sort(key=lambda item: item.get("votes") or 0, reverse=True)

    return items


def normalize_score_distribution(media: Dict[str, Any]) -> List[Dict[str, Any]]:
    """How the scores spread, low to high — a shape a mean cannot show."""
    points = (media.get("stats") or {}).get("scoreDistribution") or []
    items = [
        {"score": point.get("score"), "amount": point.get("amount") or 0}
        for point in points
        if point.get("score") is not None
    ]
    items.sort(key=lambda point: point["score"])

    return items


def normalize_detail(data: Dict[str, Any]) -> Dict[str, Any]:
    """A single show, shaped for the detail pane — and for the agent asking about it."""
    media = data.get("Media") or {}
    schedule = media.get("airingSchedule") or {}
    next_airing = media.get("nextAiringEpisode") or {}
    studios = (media.get("studios") or {}).get("nodes") or []
    cover = media.get("coverImage") or {}

    return {
        "id": media.get("id"),
        "title": _title(media),
        "titles": _title_parts(media),
        "description": _plain_text(media.get("description")),
        "cover": cover.get("large") or cover.get("medium"),
        "banner": media.get("bannerImage"),
        "format": media.get("format"),
        "status": media.get("status"),
        "episodes": media.get("episodes"),
        "duration": media.get("duration"),
        "genres": media.get("genres") or [],
        "score": media.get("averageScore"),
        "popularity": media.get("popularity"),
        "favourites": media.get("favourites"),
        "rankings": normalize_rankings(media),
        "tags": normalize_tags(media),
        "relations": normalize_relations(media),
        "recommendations": normalize_recommendations(media),
        "scoreDistribution": normalize_score_distribution(media),
        "season": media.get("season"),
        "seasonYear": media.get("seasonYear"),
        "url": media.get("siteUrl"),
        "studio": studios[0].get("name") if studios else None,
        "nextEpisode": next_airing.get("episode"),
        "airingAt": next_airing.get("airingAt"),
        "episodesList": normalize_schedule(schedule),
        "hasNextPage": bool((schedule.get("pageInfo") or {}).get("hasNextPage")),
    }


def normalize_episodes(data: Dict[str, Any]) -> Dict[str, Any]:
    schedule = (data.get("Media") or {}).get("airingSchedule") or {}

    return {
        "items": normalize_schedule(schedule),
        "hasNextPage": bool((schedule.get("pageInfo") or {}).get("hasNextPage")),
    }


# A 7-day window holds far fewer episodes than the feed's raw `total` suggests —
# 65 when this was measured, and one page of 50 stopped at day 2.5. That is why
# a "7 day" view ran out of days long before it ran out of window. Stitching the
# window costs two requests and makes the day sections reach its end; the cap
# keeps a dense season from turning one refresh into a burst against a shared
# 30/minute budget.
AIRING_PAGE_SIZE = 50
MAX_AIRING_PAGES = 3


async def _airing_window(days: int, per_page: int, after: Optional[int]) -> Dict[str, Any]:
    """Every episode in ``[now, now + days)`` — or every one after ``after``.

    Each step re-queries with a cursor rather than asking for the next offset:
    the window's origin is "now", so offset paging would slide under us as rows
    aired mid-fetch.
    """
    now = int(time.time())
    end = now + days * 86400
    cursor = now if after is None else max(now, after + 1)
    entries: List[Dict[str, Any]] = []
    has_next = False

    for _ in range(MAX_AIRING_PAGES):
        # The floor protects the host's shared 30/minute, and that budget is spent
        # by every other window and rule too. `entries` non-empty means the first
        # page already succeeded: stop stitching instead of spending the last of
        # the budget on a continuation page. `has_next` still holds the previous
        # page's answer, so the feed keeps its "there is more" footer.
        if entries and _rate_exhausted():
            break

        data = await _graphql(_AIRING_QUERY, {"from": cursor, "to": end, "perPage": per_page})
        page = data.get("Page") or {}
        rows = [
            row for row in (page.get("airingSchedules") or []) if cursor < (row.get("airingAt") or 0) <= end
        ]
        has_next = bool((page.get("pageInfo") or {}).get("hasNextPage"))
        if not rows:
            has_next = False
            break
        entries.extend(rows)
        cursor = rows[-1].get("airingAt") or cursor
        if cursor >= end or not has_next:
            break

    return {"Page": {"airingSchedules": entries, "pageInfo": {"hasNextPage": has_next}}}


# ─── watchlist (local until sign-in lands) ───────────────────────────────────

# AniList's own vocabulary, so sign-in can push these straight through to the
# account instead of translating a private one.
WATCH_STATUSES = ("watching", "completed", "planned", "paused", "dropped")
WATCHLIST_KEY = "watchlist"
PLUGIN_ID = "hermes-anilist"

# Bound from ``register(ctx)`` by the agent half: the dashboard loader imports
# this file itself (as ``hermes_dashboard_plugin_<id>``) and hands it no context,
# so the state has to arrive through an explicit door.
_state: Optional[Any] = None


def bind_state(state: Any) -> None:
    """Hand the routes their plugin-owned, profile-scoped state (``ctx.state``)."""
    global _state
    _state = state


def _state_door() -> Any:
    """The plugin state, resolved on first use.

    Plugin registration and route mounting are separate startup steps and their
    order is not ours to depend on, so nothing here reads at import time. The
    fallback builds the very ``PluginState`` the context would have handed over:
    same id, same namespace directory.
    """
    global _state
    if _state is None:
        from hermes_cli.plugins_state import PluginState

        _state = PluginState(PLUGIN_ID)

    return _state


def _watchlist() -> Dict[str, Dict[str, Any]]:
    """Stored entries keyed by media id.

    One state key holds the whole list, and ``PluginState.set`` writes under a
    lock, so a read-modify-write can never leave a half-updated list behind.
    """
    try:
        stored = _state_door().get(WATCHLIST_KEY, None)
    except Exception:  # noqa: BLE001 - a state store that cannot answer is an empty list
        return {}

    if not isinstance(stored, dict):
        return {}

    return {str(key): value for key, value in stored.items() if isinstance(value, dict)}


def _save_watchlist(entries: Dict[str, Dict[str, Any]]) -> None:
    _state_door().set(WATCHLIST_KEY, entries)


# ─── settings (one store for every device) ───────────────────────────────────

# Preferences live HERE rather than in each desktop's local storage: the plugin is
# installed once — on the host — and every device that connects should read the
# same window, title language and digest hour. A device-local copy silently
# diverges the moment a second machine opens the pane, so the old local blob is
# read exactly once, by the desktop half, only to seed a host that has nothing
# stored yet.
#
# The allowed values mirror the enums in desktop/plugin.js (`TITLE_LANGUAGES`,
# `WINDOW_DAYS`, `ALERT_DELIVERIES`, `DIGEST_HOURS`). Each side pins its own copy
# in its own suite, so a drift fails a test instead of a user's pane.
SETTINGS_KEY = "settings"

SETTINGS_ENUMS: Dict[str, Tuple[Any, ...]] = {
    "defaultFilter": ("today", "week", "list"),
    "titleLanguage": ("english", "romaji", "native"),
    "windowDays": (3, 7, 14),
    "alertDelivery": ("local", "telegram", "discord"),
    # A completed or dropped show cannot air; the digest hour is the moment of the
    # host's own day, since that is where the cron job fires.
    "digestHour": (8, 9, 12, 20),
}
SETTINGS_FLAGS = ("covers",)
# Free text: the destination is remembered as `connectionId:profile`, so it is
# longer than a connection id but never a document.
SETTINGS_TEXT: Dict[str, int] = {"alertRoute": 120}


def _settings() -> Dict[str, Any]:
    """Stored preferences, or an empty mapping when the host has none.

    An unreadable or corrupt store answers empty rather than raising: a device
    that cannot read a preference must fall back to its defaults, not lose the
    pane.
    """
    try:
        stored = _state_door().get(SETTINGS_KEY, None)
    except Exception:  # noqa: BLE001 - a state store that cannot answer holds no preferences
        return {}

    if not isinstance(stored, dict):
        return {}

    return {str(key): value for key, value in stored.items()}


def _save_settings(values: Dict[str, Any]) -> Dict[str, Any]:
    _state_door().set(SETTINGS_KEY, values)

    return values


def _check_enum(key: str, value: Any, allowed: Tuple[Any, ...]) -> Any:
    """One enum member, or a 422 naming the accepted set.

    Booleans are refused outright: ``True`` compares equal to ``1``, and a
    preference stored as the wrong type would render as a value nobody chose.
    """
    if isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{key} must be one of {', '.join(map(str, allowed))}")

    if isinstance(allowed[0], int):
        if not isinstance(value, (int, float)) or int(value) != value:
            raise HTTPException(status_code=422, detail=f"{key} must be one of {', '.join(map(str, allowed))}")
        value = int(value)

    if value not in allowed:
        raise HTTPException(status_code=422, detail=f"{key} must be one of {', '.join(map(str, allowed))}")

    return value


def clean_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    """The part of a partial save this backend can store.

    Unknown keys are DROPPED, not refused: a newer desktop that sends a key this
    build has never heard of must not lose the rest of its save — the same reason
    an unknown entry filter answers everything. A known key with a value outside
    its enum IS refused: storing it would leave every device rendering a
    preference nobody chose.
    """
    clean: Dict[str, Any] = {}

    for key, value in (patch or {}).items():
        if key in SETTINGS_FLAGS:
            if not isinstance(value, bool):
                raise HTTPException(status_code=422, detail=f"{key} must be true or false")
            clean[key] = value
        elif key in SETTINGS_ENUMS:
            clean[key] = _check_enum(key, value, SETTINGS_ENUMS[key])
        elif key in SETTINGS_TEXT:
            if not isinstance(value, str) or len(value) > SETTINGS_TEXT[key]:
                raise HTTPException(status_code=422, detail=f"{key} must be a string of at most {SETTINGS_TEXT[key]} characters")
            clean[key] = value

    return clean


# ─── account (AniList sign-in) ───────────────────────────────────────────────

# The token is a credential, so it lives where Hermes keeps credentials: the
# profile's `.env` — written through the same function `hermes config set` uses,
# and read back through the profile-safe secret scope, which fails closed in a
# multiplexed process with no scope bound instead of handing back whichever
# profile happened to launch the process.
TOKEN_ENV_VAR = "ANILIST_TOKEN"
ACCOUNT_KEY = "account"
VIEWER_CACHE_TTL_SECONDS = 300.0

_VIEWER_QUERY = """
query {
  Viewer {
    id
    name
    avatar { medium }
    siteUrl
  }
}
"""

# The account's own list. `userId` comes from the viewer, never from the caller:
# the token decides whose list this is, and nothing else may say otherwise.
_LIST_QUERY = """
query ($userId: Int) {
  MediaListCollection(userId: $userId, type: ANIME) {
    lists {
      name
      status
      isCustomList
      entries {
        id
        mediaId
        status
        progress
        score
        media {
          id
          title { romaji english native }
          episodes
          format
          season
          seasonYear
          coverImage { medium }
          siteUrl
        }
      }
    }
  }
}
"""

# AniList's enum, said in the vocabulary the rest of the plugin already speaks, so
# a row never has to know which store answered "is this tracked?" — and so the
# reverse map (for write-back, later) has exactly one place to live.
LIST_STATUS_VOCABULARY = {
    "CURRENT": "watching",
    "REPEATING": "rewatching",
    "PLANNING": "planned",
    "COMPLETED": "completed",
    "PAUSED": "paused",
    "DROPPED": "dropped",
}
# Watching first: a "my list" that opens on 49 completed shows is a list nobody reads.
LIST_STATUS_ORDER = ("watching", "rewatching", "paused", "planned", "completed", "dropped")

# The way back: our vocabulary in, AniList's enum out.
ANILIST_STATUS = {value: key for key, value in LIST_STATUS_VOCABULARY.items()}

# Write-back. `SaveMediaListEntry` takes the media id and creates the entry when
# it does not exist yet, writing only the fields it is given (so a progress tick
# never resets a status); `DeleteMediaListEntry` takes the ENTRY id — which is
# exactly why the read side carries `entryId` beside the media id.
_SAVE_ENTRY_MUTATION = """
mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) {
    id
    mediaId
    status
    progress
    score
    media {
      id
      title { romaji english native }
      episodes
      format
      coverImage { medium }
      siteUrl
    }
  }
}
"""

_DELETE_ENTRY_MUTATION = """
mutation ($id: Int) {
  DeleteMediaListEntry(id: $id) {
    deleted
  }
}
"""


def _account() -> Dict[str, Any]:
    """The public half of the sign-in: the client id the authorize URL needs."""
    stored = _state_door().get(ACCOUNT_KEY, None)

    return dict(stored) if isinstance(stored, dict) else {}


def _save_account(values: Dict[str, Any]) -> None:
    _state_door().set(ACCOUNT_KEY, {**_account(), **values})


def read_token() -> Optional[str]:
    """The account token, or None. Never logged, never handed to the renderer."""
    try:
        from agent.secret_scope import UnscopedSecretError, get_secret
    except Exception:  # noqa: BLE001 - outside Hermes' own process the secret scope is absent
        return os.environ.get(TOKEN_ENV_VAR) or None
    try:
        return get_secret(TOKEN_ENV_VAR) or None
    except UnscopedSecretError:
        # A process serving several profiles without a bound scope must not guess
        # whose token this is.
        return None


def _save_token(token: str) -> None:
    from hermes_cli.config import save_env_value

    save_env_value(TOKEN_ENV_VAR, token)


def _clear_token() -> bool:
    from hermes_cli.config import remove_env_value

    return bool(remove_env_value(TOKEN_ENV_VAR))


async def _viewer(token: str) -> Dict[str, Any]:
    """Who this token belongs to, asked of AniList (successes cached briefly).

    Keyed by a digest of the token so a rotation cannot serve the previous
    identity — and so the token itself is never a dict key somebody could dump.
    """
    key = "viewer:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
    cached = _fresh(key)
    if cached is not None:
        return cached

    data = await _graphql(_VIEWER_QUERY, {}, token=token)
    viewer = data.get("Viewer") or {}

    return _store(
        key,
        {
            "id": viewer.get("id"),
            "name": viewer.get("name"),
            "avatar": (viewer.get("avatar") or {}).get("medium"),
            "url": viewer.get("siteUrl"),
        },
        VIEWER_CACHE_TTL_SECONDS,
    )


def _account_state(
    client_id: Optional[str],
    connected: bool,
    reason: Optional[str],
    viewer: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Everything the sign-in pane needs — and deliberately not the token."""
    return {"clientId": client_id, "connected": connected, "reason": reason, "viewer": viewer}


async def _current_account() -> Dict[str, Any]:
    """The sign-in as it stands, token or not. `reason` names why a token fails."""
    client_id = _account().get("clientId")
    token = read_token()
    if not token:
        return _account_state(client_id, False, None, None)

    try:
        viewer = await _viewer(token)
    except HTTPException as exc:
        # `invalid` is the one the user can fix; anything else is AniList's problem.
        return _account_state(client_id, False, "invalid" if exc.status_code == 401 else "unreachable", None)

    return _account_state(client_id, True, None, viewer)


# ─── the account's list: read ────────────────────────────────────────────────


def _list_cache_key(token: str) -> str:
    """Keyed by a digest of the token: signing in as somebody else is a different
    list, and the token itself never becomes a key somebody could dump."""
    return "list:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]


async def _read_list(token: str) -> Dict[str, Any]:
    """What AniList says the account's list is — the cached answer while it is fresh."""

    async def fetch() -> Dict[str, Any]:
        viewer = await _viewer(token)          # whose list this is, never the caller's word
        data = await _graphql(_LIST_QUERY, {"userId": viewer.get("id")}, token=token)

        return {"connected": True, "viewer": viewer, **normalize_list(data)}

    return await _cached(_list_cache_key(token), LIST_CACHE_TTL_SECONDS, fetch)


def _rewrite_cached_list(
    token: str,
    rewrite: Callable[[List[Dict[str, Any]]], List[Dict[str, Any]]],
) -> None:
    """Fold a write into the cached list instead of throwing it away.

    The mutation already told us the entry's new state, so the next read is served
    from cache and is still fresh: a write costs one request, not two. With
    nothing cached there is nothing to fold, and the next read pays for itself.
    """
    key = _list_cache_key(token)
    hit = _cache.get(key)
    if not hit:
        return

    payload = hit[1]
    entries = _sorted_entries(rewrite(list(payload.get("entries") or [])))
    _store(
        key,
        {**payload, "entries": entries, "counts": _count_by_status(entries), "total": len(entries)},
        LIST_CACHE_TTL_SECONDS,
    )


@router.get("/list")
async def account_list() -> Dict[str, Any]:
    """The account's own list — or an honest empty shape when nobody is signed in.

    Signed out is not an error: the pane asks this on every render, and a 401
    would dress the ordinary "no account yet" case up as a failure. A token that
    stopped working lands here the same way, with ``reason`` naming it, because
    this is not the place to report a sign-in problem (``/account`` is).
    """
    token = read_token()
    if not token:
        return {"connected": False, "entries": [], "counts": {}, "total": 0}

    try:
        return await _read_list(token)
    except HTTPException as exc:
        if exc.status_code != 401:
            raise

        return {"connected": False, "reason": "invalid", "entries": [], "counts": {}, "total": 0}


# ─── the account's list: write ───────────────────────────────────────────────


class ListEntryUpdate(BaseModel):
    """What a row can change about the account's entry.

    Absolute values, never deltas: two windows stepping the same episode must not
    add up to two, and a retry after a timeout has to be safe to repeat.
    """

    status: Optional[str] = Field(None, description=" | ".join(LIST_STATUS_VOCABULARY.values()))
    progress: Optional[int] = Field(None, ge=0, le=100000)


def _require_token() -> str:
    """Writes need a signed-in account; unlike a read, saying so IS the answer."""
    token = read_token()
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to AniList before writing to your list.")

    return token


@router.put("/list/{media_id}")
async def list_put(entry: ListEntryUpdate, media_id: int = Path(..., ge=1)) -> Dict[str, Any]:
    """Add a show to the account's list, or change one field of its entry.

    ``SaveMediaListEntry`` is a partial write, so a progress tick cannot reset a
    status and a status change cannot reset the progress — and it creates the
    entry when there is none, which is what makes this the add path too.
    """
    token = _require_token()

    variables: Dict[str, Any] = {"mediaId": media_id}
    if entry.status is not None:
        if entry.status not in ANILIST_STATUS:
            raise HTTPException(status_code=422, detail=f"status must be one of {', '.join(ANILIST_STATUS)}.")
        variables["status"] = ANILIST_STATUS[entry.status]
    if entry.progress is not None:
        variables["progress"] = entry.progress
    if len(variables) == 1:
        raise HTTPException(status_code=422, detail="Nothing to write: send a status, a progress, or both.")

    data = await _graphql(_SAVE_ENTRY_MUTATION, variables, token=token)
    saved = _list_entry(data.get("SaveMediaListEntry") or {})
    _rewrite_cached_list(
        token,
        lambda entries: [item for item in entries if str(item.get("id")) != str(saved["id"])] + [saved],
    )

    return saved


@router.delete("/list/{media_id}")
async def list_delete(media_id: int = Path(..., ge=1)) -> Dict[str, Any]:
    """Take a show off the account's list.

    Destructive on AniList — the entry goes with whatever score, notes and
    progress it carried — which is why the UI asks before calling this, and why
    this resolves the entry id (the only id ``DeleteMediaListEntry`` accepts) from
    the list it already has.
    """
    token = _require_token()
    listing = await _read_list(token)                       # cached in the common case
    match = next(
        (item for item in listing.get("entries") or [] if str(item.get("id")) == str(media_id)),
        None,
    )
    entry_id = (match or {}).get("entryId")
    if not entry_id:
        # Not on the list: there is nothing to delete, and nothing went wrong.
        return {"id": media_id, "deleted": False}

    data = await _graphql(_DELETE_ENTRY_MUTATION, {"id": entry_id}, token=token)
    deleted = bool((data.get("DeleteMediaListEntry") or {}).get("deleted"))
    if deleted:
        _rewrite_cached_list(
            token,
            lambda entries: [item for item in entries if str(item.get("id")) != str(media_id)],
        )

    return {"id": media_id, "deleted": deleted}


# ─── reads the agent half shares with the routes ─────────────────────────────
#
# The agent's tools call these instead of a second copy of "which store answers,
# which cache key, which shape": the pane and the agent read the same functions,
# so they cannot drift into telling the reader two different things.


def _local_entries() -> List[Dict[str, Any]]:
    """This device's list, most recently tracked first — the order ``/watchlist`` answers in."""
    return sorted(_watchlist().values(), key=lambda entry: entry.get("addedAt") or 0, reverse=True)


async def read_entries() -> Dict[str, Any]:
    """Everything the reader tracks, and which store answered.

    The store choice is the one the desktop half makes in the client: a signed-in
    account answers, this device's own list answers when nobody is. A token that
    stopped working is not an error here — it degrades to the local list with
    ``reason`` naming it, exactly as ``/list`` already does.
    """
    token = read_token()
    if not token:
        return {"store": "local", "connected": False, "entries": _local_entries()}

    try:
        listing = await _read_list(token)
    except HTTPException as exc:
        if exc.status_code != 401:
            raise

        return {"store": "local", "connected": False, "reason": "invalid", "entries": _local_entries()}

    return {"store": "anilist", "connected": True, "entries": listing.get("entries") or []}


async def read_show(media_id: int, episodes: int = 12) -> Dict[str, Any]:
    """One show — the shape the detail pane gets, so the pane and an agent agree."""
    data = await _cached_graphql(
        f"anime:{media_id}:{episodes}",
        MEDIA_CACHE_TTL_SECONDS,
        _DETAIL_QUERY,
        {"id": media_id, "page": 1, "perPage": episodes},
    )

    return normalize_detail(data)


async def read_airing(days: int = 7, per_page: int = AIRING_PAGE_SIZE, after: Optional[int] = None) -> Dict[str, Any]:
    """The window of episodes about to air, from the cache the pane reads."""
    # The cursor, not the wall clock, keys the cache: a stale cursor and a live
    # one are different answers, but the same cursor one second later is not.
    cache_key = f"airing:{days}:{per_page}:{'head' if after is None else after}"

    return normalize_airing(await _cached(cache_key, AIRING_CACHE_TTL_SECONDS, lambda: _airing_window(days, per_page, after)))


async def read_search(term: str, page: int = 1, per_page: int = 10) -> Dict[str, Any]:
    """Free-text title search — how a name becomes an id."""
    text = str(term or "").strip()
    if len(text) < 2:
        raise HTTPException(status_code=422, detail="q must be at least 2 non-space characters.")

    data = await _cached_graphql(
        # Case and surrounding whitespace fold into one key: AniList matches
        # case-insensitively, so "One Piece" and "  one piece " are one request
        # against the shared budget, not two.
        f"search:{text.lower()}:{page}:{per_page}",
        MEDIA_CACHE_TTL_SECONDS,
        _SEARCH_QUERY,
        {"search": text, "page": page, "perPage": per_page},
    )

    return normalize_media_page(data)


# How the reader's own list can be narrowed. "Behind" is about the episodes that
# already landed: a next episode beyond your count means the ones before it went
# unwatched, which is the question a tracker actually asks.
ENTRY_FILTERS = ("all", "airing", "behind", "not_started")


def filter_entries(
    entries: List[Dict[str, Any]],
    wanted: str = "all",
    airing: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """The reader's list, with its next episode attached, optionally narrowed.

    An unknown filter answers everything rather than nothing: a filter nobody
    implements must not look like an empty list.
    """
    window = {str(item.get("id")): item for item in airing or [] if item.get("id") is not None}
    rows: List[Dict[str, Any]] = []

    for entry in entries or []:
        upcoming = window.get(str(entry.get("id"))) or {}
        rows.append({**entry, "nextEpisode": upcoming.get("episode"), "airingAt": upcoming.get("airingAt")})

    if wanted == "airing":
        return [row for row in rows if row["airingAt"]]

    if wanted == "behind":
        return [row for row in rows if row["nextEpisode"] and (row["nextEpisode"] - 1) > (row.get("progress") or 0)]

    if wanted == "not_started":
        return [row for row in rows if not (row.get("progress") or 0)]

    return rows


# ─── routes ──────────────────────────────────────────────────────────────────


@router.get("/health")
async def health() -> Dict[str, Any]:
    """Cheap liveness probe: the pane uses it to tell 'backend missing' from 'backend idle'."""
    return {
        "ok": True,
        "plugin": "hermes-anilist",
        "cached_queries": len(_cache),
        "rate_limit": {"limit": _rate["limit"], "remaining": _rate["remaining"], "checked_at": _rate_checked_at},
        "endpoint": ANILIST_ENDPOINT,
    }


@router.get("/trending")
async def trending(
    page: int = Query(1, ge=1, le=20),
    per_page: int = Query(12, ge=1, le=50),
) -> Dict[str, Any]:
    data = await _cached_graphql(
        f"trending:{page}:{per_page}",
        MEDIA_CACHE_TTL_SECONDS,
        _TRENDING_QUERY,
        {"page": page, "perPage": per_page},
    )
    return normalize_media_page(data)


@router.get("/season")
async def season(
    season: str = Query(..., description="WINTER | SPRING | SUMMER | FALL"),
    year: int = Query(..., ge=1940, le=2100),
    page: int = Query(1, ge=1, le=20),
    per_page: int = Query(20, ge=1, le=50),
) -> Dict[str, Any]:
    season_name = season.strip().upper()
    if season_name not in VALID_SEASONS:
        raise HTTPException(status_code=422, detail=f"season must be one of {', '.join(VALID_SEASONS)}.")
    data = await _cached_graphql(
        f"season:{season_name}:{year}:{page}:{per_page}",
        MEDIA_CACHE_TTL_SECONDS,
        _SEASON_QUERY,
        {"season": season_name, "seasonYear": year, "page": page, "perPage": per_page},
    )
    return normalize_media_page(data)


@router.get("/search")
async def search(
    q: str = Query(..., min_length=2, max_length=100, description="Free-text title search"),
    page: int = Query(1, ge=1, le=20),
    per_page: int = Query(20, ge=1, le=50),
) -> Dict[str, Any]:
    term = q.strip()
    if len(term) < 2:
        raise HTTPException(status_code=422, detail="q must be at least 2 non-space characters.")

    return await read_search(term, page, per_page)


@router.get("/airing")
async def airing(
    days: int = Query(7, ge=1, le=30),
    per_page: int = Query(AIRING_PAGE_SIZE, ge=1, le=50),
    after: Optional[int] = Query(
        None,
        ge=0,
        description="Unix seconds; return episodes strictly after this moment. Cursor for 'show more'.",
    ),
) -> Dict[str, Any]:
    return await read_airing(days, per_page, after)


# ─── one show ────────────────────────────────────────────────────────────────


@router.get("/anime/{media_id}")
async def anime(
    media_id: int = Path(..., ge=1),
    episodes: int = Query(12, ge=1, le=50, description="How many schedule entries ride along with the detail."),
) -> Dict[str, Any]:
    return await read_show(media_id, episodes)


@router.get("/anime/{media_id}/episodes")
async def anime_episodes(
    media_id: int = Path(..., ge=1),
    page: int = Query(1, ge=1, le=20),
    per_page: int = Query(25, ge=1, le=50),
) -> Dict[str, Any]:
    """The episode list alone — the detail pane's "show more"."""
    data = await _cached_graphql(
        f"episodes:{media_id}:{page}:{per_page}",
        MEDIA_CACHE_TTL_SECONDS,
        _EPISODES_QUERY,
        {"id": media_id, "page": page, "perPage": per_page},
    )

    return normalize_episodes(data)


# ─── watchlist routes ────────────────────────────────────────────────────────


class WatchEntry(BaseModel):
    """What a row knows about the show it is tracking.

    Every field is optional so a PUT can carry just the part that changed: a
    progress tick must not reset the title, and a title refresh must not reset
    the progress. Defaults land only when the entry is new.
    """

    status: Optional[str] = Field(None, description=" | ".join(WATCH_STATUSES))
    progress: Optional[int] = Field(None, ge=0, le=100000)
    title: Optional[str] = Field(None, max_length=300)
    cover: Optional[str] = Field(None, max_length=500)
    totalEpisodes: Optional[int] = Field(None, ge=0, le=100000)
    format: Optional[str] = Field(None, max_length=40)


@router.get("/watchlist")
async def watchlist() -> Dict[str, Any]:
    """Everything being tracked, most recently added first."""
    items = _local_entries()

    return {"items": items, "count": len(items)}


@router.put("/watchlist/{media_id}")
async def watchlist_put(entry: WatchEntry, media_id: int = Path(..., ge=1)) -> Dict[str, Any]:
    """Add or update one entry. Absent fields keep what the entry already had."""
    if entry.status is not None and entry.status not in WATCH_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of {', '.join(WATCH_STATUSES)}",
        )

    now = int(time.time())
    entries = _watchlist()
    current = entries.get(str(media_id)) or {}
    provided = {key: value for key, value in entry.model_dump().items() if value is not None}
    saved = {
        **current,
        **provided,
        "id": media_id,
        # Adding twice is not a re-add: the first time it was tracked sticks.
        "addedAt": current.get("addedAt") or now,
        "updatedAt": now,
    }
    saved.setdefault("status", "watching")
    saved.setdefault("progress", 0)
    entries[str(media_id)] = saved
    _save_watchlist(entries)

    return saved


@router.delete("/watchlist/{media_id}")
async def watchlist_delete(media_id: int = Path(..., ge=1)) -> Dict[str, Any]:
    entries = _watchlist()
    removed = entries.pop(str(media_id), None) is not None
    if removed:
        _save_watchlist(entries)

    return {"id": media_id, "removed": removed}


# ─── settings routes ─────────────────────────────────────────────────────────


class SettingsPatch(BaseModel):
    """A partial save: only the keys the user actually changed.

    Every field is optional so one toggle stores without every other preference
    riding along — the same rule the watchlist PUT follows. An explicit ``null``
    is not "clear it": it falls through to validation like any other bad value.

    Values are refused rather than coerced. Pydantic's lax mode reads the string
    ``"yes"`` as ``True``, and a preference stored from a guess is a preference
    nobody chose — the pane would then render a choice the reader never made.
    """

    covers: Optional[StrictBool] = None
    defaultFilter: Optional[str] = None
    titleLanguage: Optional[str] = None
    windowDays: Optional[int] = None
    alertDelivery: Optional[str] = None
    alertRoute: Optional[str] = Field(None, max_length=SETTINGS_TEXT["alertRoute"])
    digestHour: Optional[int] = None

    @field_validator("windowDays", "digestHour", mode="before")
    @classmethod
    def _numbers_are_sent_as_numbers(cls, value: Any) -> Any:
        """Text is not an hour. A float IS accepted — JSON has one number type."""
        if isinstance(value, (str, bool)) or value is None:
            raise ValueError("must be sent as a number")

        return value


@router.get("/settings")
async def settings_get() -> Dict[str, Any]:
    """The host's stored preferences — and the desktop half's mount probe.

    A device registers the chip, the palette commands and the panes only while
    this route answers on its ACTIVE connection, so an answer here doubles as the
    proof that the plugin is installed on the host being read. An empty mapping is
    a normal answer: the host is here, nobody has chosen anything yet.
    """
    return {"settings": _settings()}


@router.put("/settings")
async def settings_put(patch: SettingsPatch) -> Dict[str, Any]:
    """Merge one partial save into the host's preferences and return the result.

    The answer is what the store now holds, not what was sent: a newer desktop
    that sends a key this build drops sees the drop instead of believing a
    preference was saved. A save that changes nothing stores nothing — a device
    re-sending what the host already has must not rewrite the file.
    """
    stored = _settings()
    provided = clean_settings(patch.model_dump(exclude_unset=True))
    merged = {**stored, **provided}

    if any(stored.get(key) != value for key, value in provided.items()):
        _save_settings(merged)

    return {"settings": merged}


# ─── account routes ──────────────────────────────────────────────────────────


class AccountUpdate(BaseModel):
    """What the sign-in form sends: a public client id, and the pasted token once."""

    clientId: Optional[str] = Field(None, max_length=40, pattern=r"^[A-Za-z0-9_-]*$")
    token: Optional[str] = Field(None, max_length=4096)


@router.get("/account")
async def account() -> Dict[str, Any]:
    """Where the sign-in stands. Never includes the token, not even a prefix."""
    return await _current_account()


@router.put("/account")
async def account_put(entry: AccountUpdate) -> Dict[str, Any]:
    """Save the client id, and validate-then-store a pasted token.

    Validation comes before storage on purpose: keeping a token AniList refuses
    would leave the pane claiming a sign-in that does not work.
    """
    if entry.clientId is not None:
        _save_account({"clientId": entry.clientId.strip()})

    if not entry.token:
        # Nothing to validate: report where the sign-in already stands.
        return await _current_account()

    token = entry.token.strip()
    viewer = await _viewer(token)          # 401 when AniList refuses it
    _save_token(token)

    return _account_state(_account().get("clientId"), True, None, viewer)


@router.delete("/account")
async def account_delete() -> Dict[str, Any]:
    """Sign out. The client id stays: it is public, and re-typing it is busywork."""
    try:
        removed = _clear_token()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not remove the stored token: {exc}") from exc

    return {"removed": removed, **_account_state(_account().get("clientId"), False, None, None)}
