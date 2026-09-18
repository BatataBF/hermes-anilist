"""The agent's half of hermes-anilist: tools a model can call.

The reading is done by ``dashboard/plugin_api.py`` — the same functions the
desktop pane reads through — so the agent and the app cannot disagree about a
show, a list, or which entry the cache holds. This module is the adapter:
schemas, argument marshalling, and the words a model needs to use them well.

Two rules shape what these tools return:

- **Token discipline.** A list can carry hundreds of entries and every variant of
  every title; what comes back here is the part a model answers from. Tools that
  echo everything they fetched crowd out the conversation they exist to inform.
- **No invented facts.** A score AniList has not published comes back as ``null``,
  a release with no year as ``null``. The tool reports; it never fills in.

Registered by ``register(ctx)`` in ``__init__.py``. ``register_tools(ctx)`` here is
the same registration under the name the plugin loader looks for.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from . import ROUTES_MODULE

TOOLSET = "anilist"

_NO_BACKEND = (
    "The AniList plugin's data layer is not importable in this process "
    f"({ROUTES_MODULE}); run this on a host where the plugin is installed."
)


def _result(payload: Dict[str, Any]) -> str:
    """The registry's own JSON envelope, imported where it exists.

    Imported per call on purpose: registration also happens in processes that
    never dispatch a tool — ``hermes plugins validate`` runs ``register(ctx)`` in a
    scratch subprocess whose ``sys.path`` is not Hermes' own — and an import that
    fails there reads as "the plugin declares tools it never registers".
    """
    from tools.registry import tool_result

    return tool_result(payload)


def _error(message: str) -> str:
    """A tool error in the shape the registry renders. See ``_result``."""
    from tools.registry import tool_error

    return tool_error(message)


def _routes():
    """The plugin's own backend module, whichever door loaded it.

    The desktop's web server executes ``dashboard/plugin_api.py`` under a
    synthetic module name, and the tools run in that same process — taking the
    module from ``sys.modules`` is what keeps ONE pooled HTTP client and ONE cache
    behind both surfaces. A process with no web server (a CLI session) loads it
    here instead, under the same name, so the two paths can never mint a second
    client against AniList's shared budget.
    """
    module = sys.modules.get(ROUTES_MODULE)
    if module is not None:
        return module

    path = Path(__file__).resolve().parent / "dashboard" / "plugin_api.py"
    if not path.is_file():
        return None

    spec = importlib.util.spec_from_file_location(ROUTES_MODULE, path)
    if spec is None or spec.loader is None:
        return None

    module = importlib.util.module_from_spec(spec)
    sys.modules[ROUTES_MODULE] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        # Never leave a half-executed module cached: the next call would take it
        # from sys.modules and fail somewhere less obvious.
        sys.modules.pop(ROUTES_MODULE, None)
        raise

    return module


def _check_backend_present() -> bool:
    """Reachability, not surface: is the pane's data layer available here at all?

    Cheap on purpose — ``check_fn`` results are cached process-wide, so this must
    not be the thing that imports the backend.
    """
    if ROUTES_MODULE in sys.modules:
        return True

    return (Path(__file__).resolve().parent / "dashboard" / "plugin_api.py").is_file()


def _media_id(args: Dict[str, Any]) -> Optional[int]:
    """AniList ids are integers on the wire; a float or a string arrives as either."""
    raw = args.get("id")
    if raw is None or raw == "":
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None

    return value if value > 0 else None


def _limit(args: Dict[str, Any], default: int, cap: int = 50) -> int:
    try:
        value = int(str(args.get("limit")))
    except (TypeError, ValueError):
        return default

    return max(1, min(cap, value))


def _days(args: Dict[str, Any], default: int = 7) -> int:
    try:
        value = int(str(args.get("days")))
    except (TypeError, ValueError):
        return default

    return max(1, min(30, value))


# ─── anilist_list ───────────────────────────────────────────────────────────


def _entry_row(entry: Dict[str, Any]) -> Dict[str, Any]:
    """One list row, as much as an answer needs.

    ``titles`` (romaji/english/native) is deliberately left out: three variants per
    row is noise in a context window, and ``anilist_show`` carries them for the one
    show a question is actually about.
    """
    return {
        "id": entry.get("id"),
        "title": entry.get("title"),
        "status": entry.get("status"),
        "progress": entry.get("progress"),
        "totalEpisodes": entry.get("totalEpisodes"),
        "score": entry.get("score"),
        "format": entry.get("format"),
        # Season and year come from the account list only; the device's own list
        # never stored them, so they stay absent rather than guessed.
        "season": entry.get("season"),
        "seasonYear": entry.get("seasonYear"),
        "nextEpisode": entry.get("nextEpisode"),
        "airingAt": entry.get("airingAt"),
        "url": entry.get("siteUrl") or f"https://anilist.co/anime/{entry.get('id')}",
    }


async def _handle_list(args: Dict[str, Any], **kw) -> str:
    """The list the reader tracks, narrowed and joined with the airing window.

    ``**kw`` is not decoration: the tool dispatcher forwards context it knows
    (``task_id``, ``session_id``) to every handler, and a signature that refuses
    them fails at call time with a TypeError the model reads as a broken tool.
    """
    routes = _routes()
    if routes is None:
        return _error(_NO_BACKEND)

    wanted = str(args.get("filter") or "all").strip().lower()
    status = str(args.get("status") or "").strip().lower()
    limit = _limit(args, 50)

    try:
        listing = await routes.read_entries()
    except Exception as exc:  # noqa: BLE001 - the surface that reports failures is this string
        return _error(f"Could not read the AniList list: {type(exc).__name__}: {exc}")

    entries = listing.get("entries") or []

    # The window is only fetched when the question needs it: "what airs out of my
    # list" is a join, "what am I watching" is not.
    airing: List[Dict[str, Any]] = []
    if wanted in ("airing", "behind") or args.get("with_next_episode"):
        try:
            airing = (await routes.read_airing(days=_days(args))).get("items") or []
        except Exception as exc:  # noqa: BLE001 - a missing window must not hide the list
            airing = []
            window_error = f"{type(exc).__name__}: {exc}"
        else:
            window_error = None
    else:
        window_error = None

    if status:
        entries = [entry for entry in entries if str(entry.get("status") or "").lower() == status]

    rows = routes.filter_entries(entries, wanted if wanted in routes.ENTRY_FILTERS else "all", airing)

    return _result(
        {
            "store": listing.get("store"),
            "connected": listing.get("connected"),
            "reason": listing.get("reason"),
            "filter": wanted,
            "count": len(rows),
            "matched": len(entries),
            # Saying so beats a silently short list.
            "truncated": len(rows) > limit,
            "limit": limit,
            "windowError": window_error,
            "entries": [_entry_row(row) for row in rows[:limit]],
        }
    )


ANILIST_LIST_SCHEMA = {
    "name": "anilist_list",
    "description": (
        "Read the anime list this reader tracks: their AniList account's list when they are signed "
        "in, this device's own list otherwise (the answer names which one it was). Each row carries "
        "status, progress, the show's total episodes, the reader's score and — when it is still "
        "airing — the next episode and when it lands. Each row also carries the show's season and "
        "season year when AniList knows them, which is how 'what am I watching this season' is "
        "answered exactly. Use filter='airing' for 'what of mine airs', "
        "filter='behind' for shows whose next episode is past what they have watched, "
        "filter='not_started' for tracked shows with nothing watched yet."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "filter": {
                "type": "string",
                # Keep in step with ENTRY_FILTERS in dashboard/plugin_api.py: an
                # unknown filter answers everything, so drift degrades rather
                # than lying.
                "enum": ["all", "airing", "behind", "not_started"],
                "description": "How to narrow the list. Default: all.",
            },
            "status": {
                "type": "string",
                "enum": ["watching", "rewatching", "planned", "completed", "paused", "dropped"],
                "description": "Only entries in this AniList status. Default: every status.",
            },
            "with_next_episode": {
                "type": "boolean",
                "description": "Attach each show's next episode (and its air time) even without a filter.",
            },
            "days": {
                "type": "integer",
                "description": "How far ahead 'airing' looks, in days (1-30). Default: 7.",
            },
            "limit": {"type": "integer", "description": "Rows to return (1-50). Default: 50."},
        },
        "required": [],
    },
}


# ─── anilist_show ───────────────────────────────────────────────────────────


def _relation_row(relation: Dict[str, Any], tracked: set) -> Dict[str, Any]:
    return {
        "relation": relation.get("relation"),
        "id": relation.get("id"),
        "title": relation.get("title"),
        "format": relation.get("format"),
        "status": relation.get("status"),
        "episodes": relation.get("episodes"),
        "seasonYear": relation.get("seasonYear"),
        "score": relation.get("score"),
        "url": relation.get("url"),
        # The question behind "what is related to this" is usually "have I already
        # seen it", and the reader's own list is the only place that knows.
        "inMyList": str(relation.get("id")) in tracked,
    }


async def _handle_show(args: Dict[str, Any], **kw) -> str:
    """One show, with the reader's own entry and its neighbours in the catalogue.

    ``**kw`` carries the dispatcher's context (``task_id``, ``session_id``); a
    handler that refuses it fails before it can answer anything.
    """
    routes = _routes()
    if routes is None:
        return _error(_NO_BACKEND)

    media_id = _media_id(args)
    resolved: Optional[Dict[str, Any]] = None

    if media_id is None:
        term = str(args.get("title") or "").strip()
        if len(term) < 2:
            return _error("Give an AniList id in 'id', or a title of at least two characters in 'title'.")

        try:
            found = await routes.read_search(term, 1, 5)
        except Exception as exc:  # noqa: BLE001
            return _error(f"Could not search AniList for {term!r}: {type(exc).__name__}: {exc}")

        matches = found.get("items") or []
        if not matches:
            return _error(f"No AniList anime matches {term!r}.")

        media_id = matches[0].get("id")
        # Which show this resolved to is part of the answer: a model that asked for
        # a name deserves to know which one it got, and what else it passed over.
        resolved = {
            "query": term,
            "id": media_id,
            "title": matches[0].get("title"),
            "otherMatches": [item.get("title") for item in matches[1:4]],
        }

    try:
        detail = await routes.read_show(media_id, _limit(args, 12, cap=50))
    except Exception as exc:  # noqa: BLE001
        return _error(f"Could not read AniList show {media_id}: {type(exc).__name__}: {exc}")

    # The reader's own entry rides along: "is this good" is half AniList's score
    # and half what they already said about it.
    try:
        listing = await routes.read_entries()
    except Exception:  # noqa: BLE001 - a missing list is not a missing show
        listing = {"store": None, "connected": None, "entries": []}

    entries = listing.get("entries") or []
    tracked = {str(entry.get("id")) for entry in entries}
    mine = next((entry for entry in entries if str(entry.get("id")) == str(media_id)), None)

    return _result(
        {
            "store": listing.get("store"),
            "connected": listing.get("connected"),
            "resolvedFrom": resolved,
            "show": {
                "id": detail.get("id"),
                "title": detail.get("title"),
                "titles": detail.get("titles"),
                "format": detail.get("format"),
                "status": detail.get("status"),
                "episodes": detail.get("episodes"),
                "duration": detail.get("duration"),
                "season": detail.get("season"),
                "seasonYear": detail.get("seasonYear"),
                "studio": detail.get("studio"),
                "genres": detail.get("genres"),
                "tags": detail.get("tags"),
                # null means AniList has no score for it — never 0.
                "score": detail.get("score"),
                "popularity": detail.get("popularity"),
                "favourites": detail.get("favourites"),
                "rankings": detail.get("rankings"),
                "scoreDistribution": detail.get("scoreDistribution"),
                "url": detail.get("url"),
                "nextEpisode": detail.get("nextEpisode"),
                "airingAt": detail.get("airingAt"),
                "description": detail.get("description"),
            },
            "inMyList": (
                {
                    "status": mine.get("status"),
                    "progress": mine.get("progress"),
                    "totalEpisodes": mine.get("totalEpisodes"),
                    "score": mine.get("score"),
                }
                if mine
                else None
            ),
            "relations": [_relation_row(item, tracked) for item in detail.get("relations") or []],
            "recommendations": [
                {
                    "id": item.get("id"),
                    "title": item.get("title"),
                    "format": item.get("format"),
                    "seasonYear": item.get("seasonYear"),
                    "score": item.get("score"),
                    "votes": item.get("votes"),
                    "inMyList": str(item.get("id")) in tracked,
                    "url": item.get("url"),
                }
                for item in detail.get("recommendations") or []
            ],
            "episodes": detail.get("episodesList") or [],
            "episodesTruncated": bool(detail.get("hasNextPage")),
        }
    )


ANILIST_SHOW_SCHEMA = {
    "name": "anilist_show",
    "description": (
        "Everything AniList knows about one anime, plus what this reader already did with it: title "
        "variants, format, status, episode count and duration, studio, genres, tags, the average "
        "score (0-100, null when AniList has none), how many people have it in their list, its "
        "all-time rankings, the score distribution, the description, the next episode, the episode "
        "list, related works (sequels, prequels, side stories — each flagged with whether it is "
        "already in the reader's list) and the community's recommendations. The reader's own entry "
        "(status, progress, their score) comes back as inMyList. Pass an AniList 'id', or a 'title' "
        "and the tool resolves it (and says which show it resolved to)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "description": "AniList media id (the number in anilist.co/anime/<id>)."},
            "title": {"type": "string", "description": "A title to search for when the id is unknown."},
            "limit": {
                "type": "integer",
                "description": "How many schedule entries to return with the show (1-50). Default: 12.",
            },
        },
        "required": [],
    },
}


# ─── registration ───────────────────────────────────────────────────────────

_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "anilist_list": ANILIST_LIST_SCHEMA,
    "anilist_show": ANILIST_SHOW_SCHEMA,
}

_HANDLERS: Dict[str, Callable[..., Any]] = {
    "anilist_list": _handle_list,
    "anilist_show": _handle_show,
}

_EMOJI = {"anilist_list": "📋", "anilist_show": "🎬"}


def register_tools(ctx) -> None:
    """Register the AniList tools. Called once by the plugin loader (or by register())."""
    for name, schema in _SCHEMAS.items():
        ctx.register_tool(
            name=name,
            toolset=TOOLSET,
            schema=schema,
            handler=_HANDLERS[name],
            check_fn=_check_backend_present,
            is_async=True,
            description=schema["description"],
            emoji=_EMOJI.get(name, ""),
        )
