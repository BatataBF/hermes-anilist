"""Offline tests for the AniList response normalizers.

No network: the payloads below are trimmed copies of real AniList responses
(verified against https://graphql.anilist.co), so a schema drift surfaces here
instead of in the pane.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))

import plugin_api

MEDIA_PAYLOAD = {
    "Page": {
        "pageInfo": {"total": 5000, "currentPage": 1, "lastPage": 250, "hasNextPage": True},
        "media": [
            {
                "id": 21,
                "title": {"romaji": "ONE PIECE", "english": "One Piece", "native": "ONE PIECE"},
                "coverImage": {"medium": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21.jpg", "color": "#e4a15d"},
                "format": "TV",
                "status": "RELEASING",
                "season": "FALL",
                "seasonYear": 1999,
                "episodes": None,
                "averageScore": 88,
                "nextAiringEpisode": {"episode": 1179, "airingAt": 1789913760, "timeUntilAiring": 59093},
            },
            {
                "id": 189046,
                "title": {"romaji": "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season", "english": None, "native": None},
                "coverImage": {"medium": None, "color": None},
                "format": None,
                "status": "RELEASING",
                "season": None,
                "seasonYear": None,
                "episodes": None,
                "averageScore": None,
                "nextAiringEpisode": None,
            },
        ],
    }
}

AIRING_PAYLOAD = {
    "Page": {
        "pageInfo": {"total": 120, "hasNextPage": True},
        "airingSchedules": [
            {"episode": 12, "airingAt": 1789911000, "media": {"id": 194829, "title": {"romaji": "Katainaka", "english": None}, "episodes": 12, "coverImage": {"medium": None}}},
            {"episode": 12, "airingAt": 1789909200, "media": {"id": 177000, "title": {"romaji": "Sekai Saikyou", "english": None}, "coverImage": {"medium": None}}},
        ],
    }
}


def test_media_page_prefers_english_then_romaji():
    page = plugin_api.normalize_media_page(MEDIA_PAYLOAD)
    assert page["items"][0]["title"] == "One Piece"
    assert page["items"][1]["title"].startswith("Re:Zero")
    assert page["hasNextPage"] is True
    assert page["page"] == 1


def test_media_page_survives_missing_optional_blocks():
    item = plugin_api.normalize_media_page(MEDIA_PAYLOAD)["items"][1]
    assert item["nextEpisode"] is None
    assert item["airingAt"] is None
    assert item["cover"] is None


def test_airing_is_sorted_by_air_time():
    items = plugin_api.normalize_airing(AIRING_PAYLOAD)["items"]
    assert [item["airingAt"] for item in items] == sorted(item["airingAt"] for item in items)
    assert items[0]["episode"] == 12
    assert items[0]["id"] == 177000


def test_airing_titles_fall_back_to_romaji():
    items = plugin_api.normalize_airing(AIRING_PAYLOAD)["items"]
    assert items[1]["title"] == "Katainaka"


def test_seasons_are_the_four_anilist_accepts():
    assert plugin_api.VALID_SEASONS == ("WINTER", "SPRING", "SUMMER", "FALL")


def test_cache_expiry_and_stale_fallback():
    plugin_api._cache.clear()
    assert plugin_api._fresh("k") is None
    plugin_api._store("k", {"v": 1}, ttl=-1)          # already expired
    assert plugin_api._fresh("k") is None
    assert plugin_api._stale("k") == {"v": 1}          # still there for the rate-floor path


def test_the_cache_stays_bounded_and_forgets_the_oldest_first():
    plugin_api._cache.clear()
    for index in range(plugin_api.CACHE_MAX_ENTRIES + 40):
        plugin_api._store(f"answer:{index}", index, 300.0)

    assert len(plugin_api._cache) == plugin_api.CACHE_MAX_ENTRIES
    assert "answer:295" in plugin_api._cache        # the newest answer survived
    assert "answer:0" not in plugin_api._cache      # the oldest made room


def test_a_brand_new_answer_survives_its_own_insertion():
    plugin_api._cache.clear()
    for index in range(plugin_api.CACHE_MAX_ENTRIES):
        plugin_api._store(f"answer:{index}", index, 300.0)

    plugin_api._store("answer:new", 1, 300.0)

    assert "answer:new" in plugin_api._cache


def test_rate_floor_trips_below_five_remaining():
    plugin_api._rate["remaining"] = None
    assert plugin_api._rate_exhausted() is False
    plugin_api._rate["remaining"] = 5
    assert plugin_api._rate_exhausted() is False
    plugin_api._rate["remaining"] = 4
    assert plugin_api._rate_exhausted() is True
    plugin_api._rate["remaining"] = None               # reset for other tests


def test_media_page_exposes_every_title_language():
    items = plugin_api.normalize_media_page(MEDIA_PAYLOAD)["items"]

    assert items[0]["titles"] == {"romaji": "ONE PIECE", "english": "One Piece", "native": "ONE PIECE"}
    assert items[0]["title"] == "One Piece"                 # the default pick is unchanged
    assert items[1]["titles"]["english"] == ""              # AniList's null -> empty, never None
    assert items[1]["titles"]["romaji"].startswith("Re:Zero")


def test_airing_rows_expose_every_title_language():
    items = plugin_api.normalize_airing(AIRING_PAYLOAD)["items"]

    assert items[0]["titles"]["romaji"] == "Sekai Saikyou"
    assert items[0]["titles"]["english"] == ""
    assert items[1]["title"] == "Katainaka"                 # romaji fallback still works


# ─── routes (offline: AniList is stubbed at the transport, the way the gateway
#      mounts the router, so the request/validation path is the real one) ──────

PREFIX = "/api/plugins/hermes-anilist"


@pytest.fixture
def api(monkeypatch):
    """The router mounted under its real prefix, with `_graphql` stubbed."""
    calls: list = []

    async def fake_graphql(query, variables):
        calls.append(variables)
        return MEDIA_PAYLOAD

    monkeypatch.setattr(plugin_api, "_graphql", fake_graphql)
    plugin_api._cache.clear()
    plugin_api._rate["remaining"] = None

    app = FastAPI()
    app.include_router(plugin_api.router, prefix=PREFIX)

    return SimpleNamespace(client=TestClient(app), calls=calls)


def test_search_normalizes_like_every_other_media_page(api):
    response = api.client.get(f"{PREFIX}/search", params={"q": "one piece"})

    assert response.status_code == 200
    page = response.json()
    assert page["items"][0]["title"] == "One Piece"
    assert page["hasNextPage"] is True

    posted = api.calls[0]
    assert posted["search"] == "one piece"
    assert posted["perPage"] == 20
    assert "_SEARCH_QUERY" not in posted          # a variables dict, not the doc


def test_search_spends_one_request_across_case_and_padding(api):
    api.client.get(f"{PREFIX}/search", params={"q": "One Piece"})
    api.client.get(f"{PREFIX}/search", params={"q": "  one piece "})

    assert len(api.calls) == 1                    # second hit the TTL cache


def test_search_trims_before_sending_and_before_keying(api):
    api.client.get(f"{PREFIX}/search", params={"q": "  dandadan  "})

    assert api.calls[0]["search"] == "dandadan"


def test_search_rejects_queries_that_cannot_match(api):
    for bad in ("", "a", " ", "   ", "a" * 101):
        response = api.client.get(f"{PREFIX}/search", params={"q": bad})

        assert response.status_code == 422

    assert api.calls == []                        # rejected before spending budget


def test_search_bounds_per_page(api):
    response = api.client.get(f"{PREFIX}/search", params={"q": "dandadan", "per_page": 99})

    assert response.status_code == 422


def test_unknown_route_is_a_404_under_the_plugin_prefix(api):
    assert api.client.get(f"{PREFIX}/nope").status_code == 404


def test_health_reports_the_shared_cache_and_budget(api):
    api.client.get(f"{PREFIX}/search", params={"q": "one piece"})
    body = api.client.get(f"{PREFIX}/health").json()

    assert body["ok"] is True
    assert body["cached_queries"] == 1
    assert body["endpoint"] == "https://graphql.anilist.co"


def test_every_request_identifies_the_plugin_and_only_carries_a_token_when_given():
    anonymous = plugin_api._headers()
    assert anonymous["User-Agent"].startswith("hermes-anilist/")
    assert "Authorization" not in anonymous

    signed = plugin_api._headers("tok")
    assert signed["Authorization"] == "Bearer tok"


# ─── the airing window (fetched as several cursor pages, served as one feed) ──


def _airing_page(times, has_next):
    return {
        "Page": {
            "pageInfo": {"total": 120, "hasNextPage": has_next},
            "airingSchedules": [
                {
                    "episode": index + 1,
                    "airingAt": at,
                    "media": {
                        "id": 1000 + index,
                        "title": {"romaji": f"Show {index}", "english": None},
                        "coverImage": {"medium": None},
                    },
                }
                for index, at in enumerate(times)
            ],
        }
    }


def _client(monkeypatch, fake_graphql, calls):
    monkeypatch.setattr(plugin_api, "_graphql", fake_graphql)
    plugin_api._cache.clear()
    plugin_api._rate["remaining"] = None
    app = FastAPI()
    app.include_router(plugin_api.router, prefix=PREFIX)

    return TestClient(app)


def test_airing_stitches_the_window_instead_of_stopping_at_page_one(monkeypatch):
    """A "7 day" view has to reach day 7, not end where the first page ended."""
    calls = []
    now = int(time.time())

    async def fake_graphql(query, variables):
        calls.append(variables)
        if len(calls) == 1:
            # a full page that still claims more: exactly the shape that used to
            # truncate the feed at ~day 2
            return _airing_page([now + 3600 * (i + 1) for i in range(50)], True)
        # a short page closes the window
        return _airing_page([now + 86400 * 3, now + 86400 * 5], False)

    body = _client(monkeypatch, fake_graphql, calls).get(f"{PREFIX}/airing", params={"days": 7}).json()

    assert len(body["items"]) == 52
    assert body["hasNextPage"] is False
    assert len(calls) == 2
    assert abs(calls[0]["from"] - now) <= 2                      # the head starts "now"
    assert calls[1]["from"] == now + 3600 * 50                   # resumes strictly after the last row
    assert calls[0]["to"] == now + 7 * 86400                     # and both ask for the same window
    assert [item["airingAt"] for item in body["items"]] == sorted(item["airingAt"] for item in body["items"])


def test_airing_stops_at_the_page_cap(monkeypatch):
    """A dense season must not turn one refresh into an unbounded burst."""
    calls = []

    async def fake_graphql(query, variables):
        calls.append(variables)
        start = variables["from"]

        return _airing_page([start + 600 * (i + 1) for i in range(50)], True)

    body = _client(monkeypatch, fake_graphql, calls).get(f"{PREFIX}/airing").json()

    assert len(calls) == plugin_api.MAX_AIRING_PAGES
    assert len(body["items"]) == 50 * plugin_api.MAX_AIRING_PAGES
    assert body["hasNextPage"] is True                           # there IS more; say so rather than lie


def test_airing_drops_rows_that_fall_outside_the_window(monkeypatch):
    """AniList can hand back a row past `to`; the feed is the window, not the page."""
    calls = []
    now = int(time.time())

    async def fake_graphql(query, variables):
        calls.append(variables)

        return _airing_page([now + 3600, now + 100 * 86400], False)

    body = _client(monkeypatch, fake_graphql, calls).get(f"{PREFIX}/airing", params={"days": 7}).json()

    assert [item["airingAt"] for item in body["items"]] == [now + 3600]


def test_airing_cursor_resumes_after_it_and_keys_the_cache(monkeypatch):
    """'Show more' picks up after the last row on screen — and repeats are free."""
    calls = []
    now = int(time.time())
    cursor = now + 3600 * 30

    async def fake_graphql(query, variables):
        calls.append(variables)

        return _airing_page([variables["from"] + 60], False)

    client = _client(monkeypatch, fake_graphql, calls)

    client.get(f"{PREFIX}/airing", params={"days": 7, "after": cursor})
    assert calls[0]["from"] == cursor + 1

    client.get(f"{PREFIX}/airing", params={"days": 7, "after": cursor})
    assert len(calls) == 1                                       # the cursor, not the clock, keyed the cache

    # A cursor from a stale head never makes us re-fetch the past.
    client.get(f"{PREFIX}/airing", params={"days": 7, "after": now - 10000})
    assert calls[1]["from"] >= now


def test_airing_rejects_a_negative_cursor(api):
    assert api.client.get(f"{PREFIX}/airing", params={"after": -1}).status_code == 422

    assert api.calls == []                                       # rejected before spending budget


def test_airing_stops_stitching_when_the_budget_is_low(monkeypatch):
    """The floor protects the host's shared 30/minute: a stitched window must not
    spend the last of it on a continuation page."""
    calls = []
    now = int(time.time())

    async def fake_graphql(query, variables):
        calls.append(variables)
        return _airing_page([now + 3600 * (i + 1) for i in range(50)], True)

    client = _client(monkeypatch, fake_graphql, calls)
    plugin_api._rate["remaining"] = plugin_api.RATE_FLOOR - 1
    body = client.get(f"{PREFIX}/airing", params={"days": 7}).json()

    assert len(calls) == 1                     # the first page is what we pay for…
    assert len(body["items"]) == 50            # …and it is served
    assert body["hasNextPage"] is True         # there IS more; we simply did not spend it


# ─── one show: the detail pane's data ────────────────────────────────────────

DETAIL_PAYLOAD = {
    "Media": {
        "id": 164212,
        "title": {"romaji": "GIRLS BAND CRY", "english": "Girls Band Cry", "native": "ガールズバンドクライ"},
        # `asHtml: false` is text-with-`<br>`, not plain text.
        "description": "Nina moves to Tokyo.<br>Line two.<br/><b>Spoiler</b>-free",
        "coverImage": {"medium": "m.jpg", "large": "l.jpg", "color": "#ffffff"},
        "bannerImage": "banner.jpg",
        "format": "TV",
        "status": "FINISHED",
        "episodes": 13,
        "duration": 24,
        "genres": ["Drama", "Music"],
        "averageScore": 83,
        "popularity": 120000,
        "season": "SPRING",
        "seasonYear": 2024,
        "siteUrl": "https://anilist.co/anime/164212",
        "studios": {"nodes": [{"name": "Toei Animation"}]},
        "nextAiringEpisode": None,
        "airingSchedule": {
            "pageInfo": {"total": 13, "currentPage": 1, "lastPage": 1, "hasNextPage": False},
            "nodes": [
                {"episode": 2, "airingAt": 1789911000, "timeUntilAiring": -100},
                {"episode": 1, "airingAt": 1789909200, "timeUntilAiring": -900},
            ],
        },
    }
}


def test_detail_turns_the_description_into_plain_text():
    detail = plugin_api.normalize_detail(DETAIL_PAYLOAD)

    assert detail["description"] == "Nina moves to Tokyo.\nLine two.\nSpoiler-free"


def test_detail_orders_the_episode_list_and_keeps_the_show_shape():
    detail = plugin_api.normalize_detail(DETAIL_PAYLOAD)

    assert [episode["episode"] for episode in detail["episodesList"]] == [1, 2]
    assert detail["hasNextPage"] is False
    assert (detail["studio"], detail["score"], detail["episodes"], detail["cover"]) == (
        "Toei Animation",
        83,
        13,
        "l.jpg",                                                 # the large cover, not the medium one
    )
    assert detail["genres"] == ["Drama", "Music"]
    assert detail["nextEpisode"] is None                         # finished shows have none


def test_detail_survives_a_show_without_a_schedule_or_studio():
    detail = plugin_api.normalize_detail({"Media": {"id": 7, "title": {"romaji": "Nothing"}}})

    assert detail["id"] == 7
    assert detail["description"] == ""
    assert detail["episodesList"] == []
    assert detail["hasNextPage"] is False
    assert detail["studio"] is None and detail["genres"] == []


def test_episodes_page_is_just_the_schedule():
    page = plugin_api.normalize_episodes(DETAIL_PAYLOAD)

    assert [episode["episode"] for episode in page["items"]] == [1, 2]
    assert page["hasNextPage"] is False


def test_airing_rows_carry_the_show_length():
    items = {item["id"]: item for item in plugin_api.normalize_airing(AIRING_PAYLOAD)["items"]}

    assert items[194829]["totalEpisodes"] == 12                   # the row's "EP 12/12"
    assert items[177000]["totalEpisodes"] is None                 # length unknown stays unknown


# ─── watchlist (the plugin's own state, bound the way register(ctx) binds it) ─


class _FakeState:
    """`ctx.state`'s surface with nothing on disk: get/set over JSON-rounded values."""

    def __init__(self, seed=None):
        self.data = json.loads(json.dumps(seed)) if seed else {}
        self.writes = 0

    def get(self, key, default=None):
        return self.data.get(key, default)

    def set(self, key, value):
        self.data[key] = json.loads(json.dumps(value))
        self.writes += 1


def _watch_client(monkeypatch, seed=None):
    state = _FakeState(seed)
    monkeypatch.setattr(plugin_api, "_state", state)
    app = FastAPI()
    app.include_router(plugin_api.router, prefix=PREFIX)

    return SimpleNamespace(client=TestClient(app), state=state)


def test_watchlist_starts_empty(monkeypatch):
    body = _watch_client(monkeypatch).client.get(f"{PREFIX}/watchlist").json()

    assert body == {"items": [], "count": 0}


def test_watchlist_add_writes_through_the_state_door(monkeypatch):
    watch = _watch_client(monkeypatch)
    response = watch.client.put(
        f"{PREFIX}/watchlist/164212",
        json={"status": "watching", "title": "Girls Band Cry", "totalEpisodes": 13, "cover": "l.jpg"},
    )

    assert response.status_code == 200
    entry = response.json()
    assert (entry["id"], entry["status"], entry["progress"]) == (164212, "watching", 0)
    assert entry["addedAt"] > 0
    # persisted in the plugin's own state, not merely echoed back
    assert watch.state.data["watchlist"]["164212"]["title"] == "Girls Band Cry"
    assert watch.client.get(f"{PREFIX}/watchlist").json()["count"] == 1


def test_watchlist_progress_tick_keeps_the_rest(monkeypatch):
    watch = _watch_client(monkeypatch)
    watch.client.put(
        f"{PREFIX}/watchlist/164212",
        json={"status": "completed", "title": "Girls Band Cry", "totalEpisodes": 13},
    )
    added_at = watch.state.data["watchlist"]["164212"]["addedAt"]

    updated = watch.client.put(f"{PREFIX}/watchlist/164212", json={"progress": 7}).json()

    assert updated["progress"] == 7
    assert updated["status"] == "completed"                      # a bare tick resets nothing
    assert updated["title"] == "Girls Band Cry"
    assert updated["addedAt"] == added_at                        # still the first time it was tracked


def test_watchlist_rejects_an_unknown_status_without_writing(monkeypatch):
    watch = _watch_client(monkeypatch)

    for bad in ("", "binge", "WATCHING", "dropped "):
        assert watch.client.put(f"{PREFIX}/watchlist/1", json={"status": bad}).status_code == 422

    assert watch.state.writes == 0


def test_watchlist_rejects_a_negative_progress(monkeypatch):
    watch = _watch_client(monkeypatch)

    assert watch.client.put(f"{PREFIX}/watchlist/1", json={"progress": -1}).status_code == 422
    assert watch.state.writes == 0


def test_watchlist_remove_reports_whether_it_was_there(monkeypatch):
    watch = _watch_client(monkeypatch)
    watch.client.put(f"{PREFIX}/watchlist/164212", json={"title": "Girls Band Cry"})

    assert watch.client.delete(f"{PREFIX}/watchlist/164212").json() == {"id": 164212, "removed": True}
    assert watch.client.delete(f"{PREFIX}/watchlist/164212").json()["removed"] is False
    assert watch.client.get(f"{PREFIX}/watchlist").json() == {"items": [], "count": 0}


def test_watchlist_treats_a_corrupt_store_as_empty(monkeypatch):
    watch = _watch_client(monkeypatch, seed={"watchlist": "not a mapping"})

    assert watch.client.get(f"{PREFIX}/watchlist").json() == {"items": [], "count": 0}
    assert watch.client.put(f"{PREFIX}/watchlist/3", json={"title": "New"}).status_code == 200
    assert watch.client.get(f"{PREFIX}/watchlist").json()["count"] == 1


def test_watchlist_lists_newest_first(monkeypatch):
    watch = _watch_client(
        monkeypatch,
        seed={"watchlist": {"1": {"id": 1, "addedAt": 100}, "2": {"id": 2, "addedAt": 200}}},
    )

    body = watch.client.get(f"{PREFIX}/watchlist").json()

    assert [item["id"] for item in body["items"]] == [2, 1]


# ─── settings (the host owns the preferences; every device reads them) ───────


def _settings_client(monkeypatch, seed=None):
    state = _FakeState(seed)
    monkeypatch.setattr(plugin_api, "_state", state)
    app = FastAPI()
    app.include_router(plugin_api.router, prefix=PREFIX)

    return SimpleNamespace(client=TestClient(app), state=state)


def test_settings_start_empty_and_the_backend_invents_no_defaults(monkeypatch):
    """Defaults are the desktop half's business: the host stores choices, not a schema."""
    body = _settings_client(monkeypatch).client.get(f"{PREFIX}/settings").json()

    assert body == {"settings": {}}


def test_settings_partial_save_merges_instead_of_replacing(monkeypatch):
    host = _settings_client(monkeypatch)

    host.client.put(f"{PREFIX}/settings", json={"windowDays": 14, "titleLanguage": "romaji"})
    body = host.client.put(f"{PREFIX}/settings", json={"covers": False}).json()

    assert body["settings"] == {"windowDays": 14, "titleLanguage": "romaji", "covers": False}
    # and the store is the same answer the next device reads
    assert host.client.get(f"{PREFIX}/settings").json()["settings"]["windowDays"] == 14
    assert host.state.data["settings"]["titleLanguage"] == "romaji"


def test_settings_reject_a_value_outside_its_enum_without_writing(monkeypatch):
    host = _settings_client(monkeypatch)

    for patch in (
        {"windowDays": 5},
        {"digestHour": 10},
        {"titleLanguage": "spanish"},
        {"alertDelivery": "email"},
        {"defaultFilter": "year"},
    ):
        response = host.client.put(f"{PREFIX}/settings", json=patch)

        assert response.status_code == 422, patch
        assert "must be one of" in response.json()["detail"]

    assert host.state.writes == 0


def test_settings_accept_numeric_enums_sent_as_floats(monkeypatch):
    """JSON has one number type: 7.0 is the choice "7", and it is stored as an int."""
    host = _settings_client(monkeypatch)

    stored = host.client.put(f"{PREFIX}/settings", json={"windowDays": 7.0, "digestHour": 9.0}).json()["settings"]

    assert stored == {"windowDays": 7, "digestHour": 9}
    assert isinstance(host.state.data["settings"]["windowDays"], int)


def test_settings_refuse_a_boolean_where_a_number_belongs(monkeypatch):
    """True == 1 in Python; a flag smuggled into an int enum renders as nothing a user chose."""
    host = _settings_client(monkeypatch)

    assert host.client.put(f"{PREFIX}/settings", json={"windowDays": True}).status_code == 422
    assert host.client.put(f"{PREFIX}/settings", json={"covers": "yes"}).status_code == 422
    assert host.state.writes == 0


def test_settings_drop_a_key_this_build_never_heard_of(monkeypatch):
    """Forward compatibility: a newer desktop's unknown key must not cost it the whole save."""
    host = _settings_client(monkeypatch)

    body = host.client.put(f"{PREFIX}/settings", json={"windowDays": 3, "futurePreference": "x"}).json()

    assert body["settings"] == {"windowDays": 3}
    assert "futurePreference" not in host.state.data["settings"]


def test_settings_refuse_an_explicit_null(monkeypatch):
    """"Absent" means untouched; a null is a value nobody can render."""
    host = _settings_client(monkeypatch)

    assert host.client.put(f"{PREFIX}/settings", json={"windowDays": None}).status_code == 422
    assert host.state.writes == 0


def test_settings_bound_the_alert_route_and_keep_the_rest_of_the_save(monkeypatch):
    host = _settings_client(monkeypatch)

    assert host.client.put(f"{PREFIX}/settings", json={"alertRoute": "vps-zonda:default"}).status_code == 200
    assert host.client.put(f"{PREFIX}/settings", json={"alertRoute": "x" * 121}).status_code == 422
    assert host.state.data["settings"]["alertRoute"] == "vps-zonda:default"


def test_settings_do_not_rewrite_the_store_when_nothing_changed(monkeypatch):
    """A device re-sending what the host already has must not touch the file."""
    host = _settings_client(monkeypatch, seed={"settings": {"windowDays": 7}})

    body = host.client.put(f"{PREFIX}/settings", json={"windowDays": 7, "covers": False}).json()

    assert body["settings"] == {"windowDays": 7, "covers": False}
    assert host.state.writes == 1  # the new `covers` only


def test_settings_treat_a_corrupt_store_as_empty(monkeypatch):
    host = _settings_client(monkeypatch, seed={"settings": "not a mapping"})

    assert host.client.get(f"{PREFIX}/settings").json() == {"settings": {}}
    assert host.client.put(f"{PREFIX}/settings", json={"covers": False}).json()["settings"] == {"covers": False}


def test_settings_enums_are_the_contract_the_desktop_half_renders():
    """Pinned on purpose: the desktop half pins the same sets in
    tools/test_plugin_helpers.mjs, so a drift fails a suite instead of a pane."""
    assert plugin_api.SETTINGS_ENUMS == {
        "defaultFilter": ("today", "week", "list"),
        "titleLanguage": ("english", "romaji", "native"),
        "windowDays": (3, 7, 14),
        "alertDelivery": ("local", "telegram", "discord"),
        "digestHour": (8, 9, 12, 20),
    }
    assert plugin_api.SETTINGS_FLAGS == ("covers",)
    assert plugin_api.SETTINGS_TEXT == {"alertRoute": 120}


# ─── account (sign-in: a public client id in state, the token in the profile's .env) ─


VIEWER_PAYLOAD = {
    "Viewer": {
        "id": 42,
        "name": "anilist-user",
        "avatar": {"medium": "https://s4.anilist.co/avatar.jpg"},
        "siteUrl": "https://anilist.co/user/anilist-user",
    }
}


def _account_client(monkeypatch, token=None, refuse=False, seed=None):
    """The routes with a fake state and the credential seams stubbed: nothing on disk."""
    plugin_api._cache.clear()
    state = _FakeState(seed)
    monkeypatch.setattr(plugin_api, "_state", state)
    monkeypatch.setattr(plugin_api, "read_token", lambda: token)
    saved = {}
    monkeypatch.setattr(plugin_api, "_save_token", lambda value: saved.update(token=value))
    monkeypatch.setattr(plugin_api, "_clear_token", lambda: True)
    calls = []

    async def fake_graphql(query, variables, token=None):
        calls.append({"token": token, "variables": variables})
        if refuse:
            raise plugin_api.HTTPException(status_code=401, detail="AniList rejected that token.")

        return VIEWER_PAYLOAD

    monkeypatch.setattr(plugin_api, "_graphql", fake_graphql)
    app = FastAPI()
    app.include_router(plugin_api.router, prefix=PREFIX)

    return SimpleNamespace(client=TestClient(app), calls=calls, saved=saved, state=state)


def test_account_reports_disconnected_without_a_token(monkeypatch):
    account = _account_client(monkeypatch)

    body = account.client.get(f"{PREFIX}/account").json()

    assert body == {"clientId": None, "connected": False, "reason": None, "viewer": None}
    assert account.calls == []                                   # nothing to ask AniList about


def test_account_never_hands_the_token_back(monkeypatch):
    account = _account_client(monkeypatch, token="one-year-jwt-token")

    response = account.client.get(f"{PREFIX}/account")

    assert response.json()["connected"] is True
    assert response.json()["viewer"]["name"] == "anilist-user"
    assert "one-year-jwt-token" not in response.text
    # The token reached the transport as a bearer credential, not as data.
    assert account.calls[0]["token"] == "one-year-jwt-token"


def test_account_caches_the_viewer_instead_of_re_asking(monkeypatch):
    account = _account_client(monkeypatch, token="tok")

    account.client.get(f"{PREFIX}/account")
    account.client.get(f"{PREFIX}/account")

    assert len(account.calls) == 1


def test_account_validates_a_pasted_token_before_storing_it(monkeypatch):
    account = _account_client(monkeypatch)

    response = account.client.put(f"{PREFIX}/account", json={"clientId": "1234", "token": "  pasted-token  "})

    assert response.status_code == 200
    assert response.json()["connected"] is True
    assert account.saved["token"] == "pasted-token"              # trimmed, not stored raw
    assert account.state.data["account"]["clientId"] == "1234"   # the public half, in state
    assert "pasted-token" not in response.text


def test_account_refuses_to_store_a_token_anilist_rejects(monkeypatch):
    account = _account_client(monkeypatch, refuse=True)

    response = account.client.put(f"{PREFIX}/account", json={"token": "bad-token"})

    assert response.status_code == 401
    assert account.saved == {}                                   # nothing was kept


def test_account_names_an_invalid_stored_token(monkeypatch):
    body = _account_client(monkeypatch, token="stale", refuse=True).client.get(f"{PREFIX}/account").json()

    assert (body["connected"], body["reason"]) == (False, "invalid")


def test_account_put_without_a_token_only_saves_the_client_id(monkeypatch):
    account = _account_client(monkeypatch)

    body = account.client.put(f"{PREFIX}/account", json={"clientId": "999"}).json()

    assert body["connected"] is False
    assert account.state.data["account"]["clientId"] == "999"
    assert account.calls == []                                   # no token, no AniList call


def test_account_rejects_a_junk_client_id(monkeypatch):
    account = _account_client(monkeypatch)

    for bad in ("abc!def", "1234 5678", "x" * 41):
        assert account.client.put(f"{PREFIX}/account", json={"clientId": bad}).status_code == 422

    assert account.state.data == {}


def test_account_sign_out_drops_the_token_and_keeps_the_client_id(monkeypatch):
    account = _account_client(monkeypatch, token="tok", seed={"account": {"clientId": "1234"}})

    body = account.client.delete(f"{PREFIX}/account").json()

    assert body["removed"] is True
    assert body["clientId"] == "1234"                            # re-typing it would be busywork
    assert body["connected"] is False


# ─── the account's list (the import: read-only, no writing back yet) ─────────

LIST_PAYLOAD = {
    "MediaListCollection": {
        "lists": [
            {
                "name": "Watching",
                "status": "CURRENT",
                "isCustomList": False,
                "entries": [
                    {
                        "id": 900001,
                        "mediaId": 21,
                        "status": "CURRENT",
                        "progress": 1178,
                        "score": 90,
                        "media": {
                            "id": 21,
                            "title": {"romaji": "ONE PIECE", "english": "One Piece", "native": "ONE PIECE"},
                            "episodes": None,
                            "format": "TV",
                            "coverImage": {"medium": "https://s4.anilist.co/file/cover/bx21.jpg"},
                            "siteUrl": "https://anilist.co/anime/21",
                        },
                    }
                ],
            },
            {
                "name": "Completed",
                "status": "COMPLETED",
                "isCustomList": False,
                "entries": [
                    {
                        "id": 900002,
                        "mediaId": 194829,
                        "status": "COMPLETED",
                        "progress": 12,
                        "score": 80,
                        "media": {
                            "id": 194829,
                            "title": {"romaji": "Katainaka", "english": None, "native": None},
                            "episodes": 12,
                            "format": "TV",
                            "coverImage": {"medium": None},
                            "siteUrl": "https://anilist.co/anime/194829",
                        },
                    }
                ],
            },
            {
                # A custom list repeats shows that are already in a status list:
                # counting it would double everything the user filed there.
                "name": "Favourites",
                "status": None,
                "isCustomList": True,
                "entries": [
                    {
                        "id": 900003,
                        "mediaId": 21,
                        "status": "CURRENT",
                        "progress": 1178,
                        "score": 100,
                        "media": {"id": 21, "title": {"romaji": "ONE PIECE"}, "episodes": None, "format": "TV", "coverImage": {}, "siteUrl": None},
                    }
                ],
            },
        ]
    }
}


def _list_client(monkeypatch, token=None, payload=None, refuse=False, seed=None):
    """The routes with AniList stubbed: the viewer query and the list query answered separately."""
    plugin_api._cache.clear()
    monkeypatch.setattr(plugin_api, "_state", _FakeState(seed))
    monkeypatch.setattr(plugin_api, "read_token", lambda: token)
    listed_payload = LIST_PAYLOAD if payload is None else payload
    calls = []

    async def fake_graphql(query, variables, token=None):
        calls.append({"query": query, "token": token, "variables": variables})
        if refuse:
            raise plugin_api.HTTPException(status_code=401, detail="AniList rejected that token.")

        return listed_payload if "MediaListCollection" in query else VIEWER_PAYLOAD

    monkeypatch.setattr(plugin_api, "_graphql", fake_graphql)
    app = FastAPI()
    app.include_router(plugin_api.router, prefix=PREFIX)

    return SimpleNamespace(client=TestClient(app), calls=calls)


def test_list_is_empty_and_silent_when_signed_out(monkeypatch):
    """Signed out is the ordinary case, not a failure — and it costs no request."""
    listed = _list_client(monkeypatch)

    response = listed.client.get(f"{PREFIX}/list")

    assert response.status_code == 200
    assert response.json() == {"connected": False, "entries": [], "counts": {}, "total": 0}
    assert listed.calls == []


def test_list_asks_for_the_signed_in_users_own_list(monkeypatch):
    listed = _list_client(monkeypatch, token="tok")

    listed.client.get(f"{PREFIX}/list")

    list_call = next(call for call in listed.calls if "MediaListCollection" in call["query"])
    assert list_call["variables"]["userId"] == 42                 # the viewer's id, never the caller's
    assert list_call["token"] == "tok"


def test_list_speaks_the_same_status_vocabulary_as_the_local_watchlist(monkeypatch):
    """A row asks "is this tracked?" — it must not also have to ask which store answered."""
    listed = _list_client(monkeypatch, token="tok")

    entries = listed.client.get(f"{PREFIX}/list").json()["entries"]

    assert [entry["status"] for entry in entries] == ["watching", "completed"]   # CURRENT is "watching"
    assert set(entry["status"] for entry in entries) <= set(plugin_api.WATCH_STATUSES + ("rewatching",))


def test_list_skips_custom_lists_so_nothing_is_counted_twice(monkeypatch):
    listed = _list_client(monkeypatch, token="tok")

    body = listed.client.get(f"{PREFIX}/list").json()

    assert body["total"] == 2                                     # not 3: Favourites repeats ONE PIECE
    assert body["counts"] == {"watching": 1, "completed": 1}
    assert [entry["id"] for entry in body["entries"]] == [21, 194829]   # watching first


def test_list_carries_what_a_row_needs_to_render(monkeypatch):
    listed = _list_client(monkeypatch, token="tok")

    entry = listed.client.get(f"{PREFIX}/list").json()["entries"][0]

    assert entry["title"] == "One Piece"
    assert entry["progress"] == 1178
    assert entry["score"] == 90
    assert entry["cover"].endswith("bx21.jpg")
    assert entry["totalEpisodes"] is None                         # still airing: unknown length
    assert entry["siteUrl"] == "https://anilist.co/anime/21"


def test_list_falls_back_to_romaji_when_there_is_no_english_title(monkeypatch):
    listed = _list_client(monkeypatch, token="tok")

    entries = listed.client.get(f"{PREFIX}/list").json()["entries"]

    assert entries[1]["title"] == "Katainaka"


def test_list_holds_the_answer_between_renders(monkeypatch):
    """One window re-rendering is not a reason to spend the shared 30/min budget twice."""
    listed = _list_client(monkeypatch, token="tok")

    listed.client.get(f"{PREFIX}/list")
    listed.client.get(f"{PREFIX}/list")

    assert len(listed.calls) == 2                                 # the viewer, then the list — once each


def test_list_survives_a_token_that_stopped_working(monkeypatch):
    """A revoked token means no list, not a broken pane: /account already reports the sign-in."""
    listed = _list_client(monkeypatch, token="revoked", refuse=True)

    response = listed.client.get(f"{PREFIX}/list")

    assert response.status_code == 200
    assert response.json() == {
        "connected": False,
        "reason": "invalid",
        "entries": [],
        "counts": {},
        "total": 0,
    }


# ─── writing back (the other half of sign-in) ────────────────────────────────


def _write_client(monkeypatch, token: Optional[str] = "tok", refuse=False, listing=None):
    """The write routes with AniList stubbed: reads answer the list, mutations echo the write."""
    plugin_api._cache.clear()
    monkeypatch.setattr(plugin_api, "_state", _FakeState(None))
    monkeypatch.setattr(plugin_api, "read_token", lambda: token)
    listed = LIST_PAYLOAD if listing is None else listing
    calls = []

    async def fake_graphql(query, variables, token=None):
        calls.append({"query": query, "variables": variables, "token": token})
        if refuse:
            raise plugin_api.HTTPException(status_code=401, detail="AniList rejected that token.")

        if "MediaListCollection" in query:
            return listed

        if "SaveMediaListEntry" in query:
            nodes = [node for group in listed["MediaListCollection"]["lists"] for node in (group.get("entries") or [])]
            found = next((node for node in nodes if node["mediaId"] == variables["mediaId"]), None)
            media = (found or {}).get("media") or {
                "id": variables["mediaId"],
                "title": {"romaji": "Brand New Show", "english": None, "native": None},
                "episodes": None,
                "format": "TV",
                "coverImage": {"medium": None},
                "siteUrl": None,
            }

            # AniList writes only what it is given; the stub does the same, so a
            # test can prove a tick did not carry a status along with it.
            return {
                "SaveMediaListEntry": {
                    "id": (found or {}).get("id") or 999999,
                    "mediaId": variables["mediaId"],
                    "status": variables.get("status") or (found or {}).get("status") or "CURRENT",
                    "progress": variables.get("progress")
                    if variables.get("progress") is not None
                    else (found or {}).get("progress") or 0,
                    "score": 0,
                    "media": media,
                }
            }

        return {"DeleteMediaListEntry": {"deleted": True}}

    monkeypatch.setattr(plugin_api, "_graphql", fake_graphql)
    app = FastAPI()
    app.include_router(plugin_api.router, prefix=PREFIX)

    return SimpleNamespace(client=TestClient(app), calls=calls)


def _mutations(listed):
    """The writes only: the viewer and the list are queries, and both are noise here."""
    return [call for call in listed.calls if "mutation" in call["query"]]


def test_writing_to_the_list_needs_a_signed_in_account(monkeypatch):
    listed = _write_client(monkeypatch, token=None)

    response = listed.client.put(f"{PREFIX}/list/21", json={"status": "watching"})

    assert response.status_code == 401
    assert listed.calls == []                                    # nothing reached AniList


def test_a_status_change_speaks_anilists_own_enum(monkeypatch):
    """The wire wants CURRENT; every surface in the plugin says "watching"."""
    listed = _write_client(monkeypatch)

    body = listed.client.put(f"{PREFIX}/list/21", json={"status": "watching"}).json()

    assert _mutations(listed)[0]["variables"] == {"mediaId": 21, "status": "CURRENT"}
    assert body["status"] == "watching"                          # and it comes back translated


def test_a_progress_tick_writes_an_absolute_value_and_nothing_else(monkeypatch):
    """A tick must not carry a status: it would reset the one the reader chose."""
    listed = _write_client(monkeypatch)

    body = listed.client.put(f"{PREFIX}/list/21", json={"progress": 9}).json()

    assert _mutations(listed)[0]["variables"] == {"mediaId": 21, "progress": 9}
    assert body["progress"] == 9
    assert body["status"] == "watching"                          # untouched, from the entry


def test_an_unknown_status_is_refused_before_anilist_hears_about_it(monkeypatch):
    listed = _write_client(monkeypatch)

    response = listed.client.put(f"{PREFIX}/list/21", json={"status": "binging"})

    assert response.status_code == 422
    assert listed.calls == []


def test_a_write_with_nothing_in_it_is_refused(monkeypatch):
    listed = _write_client(monkeypatch)

    response = listed.client.put(f"{PREFIX}/list/21", json={})

    assert response.status_code == 422
    assert listed.calls == []


def test_a_write_folds_into_the_cached_list_so_the_next_read_is_free(monkeypatch):
    """The mutation already told us the new state — re-asking AniList would pay twice."""
    listed = _write_client(monkeypatch)

    listed.client.get(f"{PREFIX}/list")                          # primes the cache: viewer + list
    listed.client.put(f"{PREFIX}/list/21", json={"status": "completed"})
    after_write = len(listed.calls)
    body = listed.client.get(f"{PREFIX}/list").json()
    written = next(entry for entry in body["entries"] if entry["id"] == 21)

    assert len(listed.calls) == after_write                      # served from cache, no new request
    assert written["status"] == "completed"                      # …and the cached read is not stale


def test_adding_a_show_the_account_never_had_lands_on_the_list(monkeypatch):
    listed = _write_client(monkeypatch)

    listed.client.get(f"{PREFIX}/list")
    listed.client.put(f"{PREFIX}/list/4242", json={"status": "planned"})
    body = listed.client.get(f"{PREFIX}/list").json()

    assert body["total"] == 3
    assert body["counts"] == {"watching": 1, "planned": 1, "completed": 1}
    # …and it lands in its own place in the list: watching, then planned, then completed.
    assert [entry["id"] for entry in body["entries"]] == [21, 4242, 194829]


def test_removing_resolves_the_entry_id_the_mutation_demands(monkeypatch):
    """DeleteMediaListEntry takes the ENTRY id; a row only knows the media id."""
    listed = _write_client(monkeypatch)

    listed.client.get(f"{PREFIX}/list")
    body = listed.client.delete(f"{PREFIX}/list/21").json()

    assert _mutations(listed)[0]["variables"] == {"id": 900001}       # the entry, not the media
    assert body == {"id": 21, "deleted": True}
    assert listed.client.get(f"{PREFIX}/list").json()["total"] == 1    # and the cache agrees


def test_removing_something_that_is_not_on_the_list_is_not_an_error(monkeypatch):
    listed = _write_client(monkeypatch)

    listed.client.get(f"{PREFIX}/list")
    body = listed.client.delete(f"{PREFIX}/list/4242").json()

    assert body == {"id": 4242, "deleted": False}
    assert _mutations(listed) == []                                   # nothing to delete, nothing sent


def test_a_revoked_token_says_so_on_a_write(monkeypatch):
    """Unlike a read, a write has to name the problem: silently doing nothing is a lie."""
    listed = _write_client(monkeypatch, refuse=True)

    response = listed.client.put(f"{PREFIX}/list/21", json={"status": "watching"})

    assert response.status_code == 401
    assert "rejected" in response.json()["detail"]


# ─── transport errors must name the right culprit ────────────────────────────


class _FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self.headers = {}
        self._payload = payload

    def json(self):
        return self._payload


def _fake_transport(response):
    """Stands in for httpx.AsyncClient: every POST answers with the same response.

    The production path pools one client per process (``plugin_api._http``), so a
    test must both provide this shape and reset the pool — otherwise the instance
    from the previous test is reused and answers with the wrong response.
    """
    class _Client:
        is_closed = False

        def __init__(self, *args, **kwargs):
            pass

        async def post(self, *args, **kwargs):
            return response

    return _Client


def _pooled_transport(monkeypatch, response):
    """Install the fake transport and drop whatever client the process pooled."""
    monkeypatch.setattr(plugin_api.httpx, "AsyncClient", _fake_transport(response))
    monkeypatch.setattr(plugin_api, "_client", None)


def test_a_malformed_query_is_not_reported_as_a_rejected_token(monkeypatch):
    """A 400 is our bug. Calling it "token rejected" sends the reader hunting the wrong thing."""
    payload = {
        "errors": [{"message": 'Cannot query field "episodes" on type "UserStatistics".', "status": 400}],
        "data": None,
    }
    _pooled_transport(monkeypatch, _FakeResponse(400, payload))

    with pytest.raises(plugin_api.HTTPException) as failure:
        asyncio.run(plugin_api._graphql("query { bad }", {}, token="tok"))

    assert failure.value.status_code == 502
    assert "Cannot query field" in failure.value.detail          # AniList's words, not a status code


def test_a_401_with_a_token_still_names_the_token(monkeypatch):
    _pooled_transport(monkeypatch, _FakeResponse(401, {"errors": []}))

    with pytest.raises(plugin_api.HTTPException) as failure:
        asyncio.run(plugin_api._graphql("query { Viewer { id } }", {}, token="stale"))

    assert failure.value.status_code == 401
    assert "rejected" in failure.value.detail
