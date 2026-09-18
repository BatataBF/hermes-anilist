"""Offline tests for the reads the agent half shares with the routes.

Same contract as ``tests/test_plugin_api.py``: no network, and the payloads are
trimmed copies of real AniList responses (verified against
https://graphql.anilist.co), so a schema drift surfaces here instead of in a
tool's JSON.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))

import plugin_api

# ─── fixtures: real shapes, trimmed ─────────────────────────────────────────

# Shingeki no Kyojin: one SEQUEL, one PREQUEL, one side story — the order
# AniList returns them in is not the order a reader wants them in.
RELATIONS_MEDIA = {
    "relations": {
        "edges": [
            {
                "relationType": "SIDE_STORY",
                "node": {
                    "id": 18397,
                    "title": {"romaji": "Shingeki no Kyojin OVA", "english": None, "native": None},
                    "coverImage": {"medium": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx18397.jpg"},
                    "format": "OVA",
                    "status": "FINISHED",
                    "episodes": 3,
                    "averageScore": 74,
                    "seasonYear": 2013,
                },
            },
            {
                "relationType": "PREQUEL",
                "node": {
                    "id": 104578,
                    "title": {"romaji": "Shingeki no Kyojin: Chronicle", "english": None, "native": None},
                    "coverImage": {},
                    "format": "MOVIE",
                    "status": "FINISHED",
                    "episodes": 1,
                    "averageScore": 62,
                    "seasonYear": 2020,
                },
            },
            {
                "relationType": "SEQUEL",
                "node": {
                    "id": 20605,
                    "title": {"romaji": "Shingeki no Kyojin Season 2", "english": "Attack on Titan Season 2", "native": None},
                    "coverImage": {"medium": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20605.jpg"},
                    "format": "TV",
                    "status": "FINISHED",
                    "episodes": 12,
                    "averageScore": 84,
                    "seasonYear": 2017,
                },
            },
            {"relationType": "CHARACTER", "node": {}},
        ]
    }
}

TAGS_MEDIA = {
    "tags": [
        {"name": "Super Power", "rank": 81, "isGeneralSpoiler": False},
        {"name": "Tragedy", "rank": 89, "isGeneralSpoiler": True},
        {"name": "Kaiju", "rank": 93, "isGeneralSpoiler": False},
        {"name": "Military", "rank": 88, "isGeneralSpoiler": False},
    ]
}

RANKINGS_MEDIA = {
    "rankings": [
        {"rank": 74, "type": "RATED", "context": "highest rated all time"},
        {"rank": 1, "type": "POPULAR", "context": "most popular all time"},
        {"rank": None, "type": "RATED", "context": "highest rated winter 2013"},
    ]
}

RECOMMENDATIONS_MEDIA = {
    "recommendations": {
        "nodes": [
            {
                "rating": 2869,
                "mediaRecommendation": {
                    "id": 11061,
                    "title": {"romaji": "Hunter x Hunter (2011)", "english": "Hunter x Hunter", "native": None},
                    "coverImage": {"medium": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx11061.jpg"},
                    "format": "TV",
                    "averageScore": 89,
                    "seasonYear": 2011,
                },
            },
            {"rating": 10, "mediaRecommendation": None},
        ]
    }
}

DETAIL_PAYLOAD = {
    "Media": {
        "id": 16498,
        "title": {"romaji": "Shingeki no Kyojin", "english": "Attack on Titan", "native": None},
        "description": "Several hundred years ago, humans were nearly exterminated<br>by titans.",
        "coverImage": {"large": "large.jpg", "medium": "medium.jpg"},
        "format": "TV",
        "status": "FINISHED",
        "episodes": 25,
        "duration": 24,
        "genres": ["Action", "Drama"],
        "averageScore": 85,
        "popularity": 1055279,
        "favourites": 78560,
        "season": "SPRING",
        "seasonYear": 2013,
        "siteUrl": "https://anilist.co/anime/16498",
        "studios": {"nodes": [{"name": "Wit Studio"}]},
        "nextAiringEpisode": None,
        "airingSchedule": {"pageInfo": {"hasNextPage": False}, "nodes": []},
        **RELATIONS_MEDIA,
        **TAGS_MEDIA,
        **RANKINGS_MEDIA,
        **RECOMMENDATIONS_MEDIA,
        "stats": {"scoreDistribution": [{"score": 100, "amount": 3175}, {"score": 90, "amount": 12000}]},
    }
}


# ─── the show's own facts ───────────────────────────────────────────────────


def test_normalize_detail_carries_what_the_agent_asks_about():
    detail = plugin_api.normalize_detail(DETAIL_PAYLOAD)

    assert detail["score"] == 85
    assert detail["favourites"] == 78560
    assert detail["studio"] == "Wit Studio"
    # The plain-text pass still runs on the description.
    assert "<br>" not in detail["description"]
    for key in ("relations", "tags", "rankings", "recommendations", "scoreDistribution"):
        assert key in detail, key


def test_relations_lead_with_what_comes_next_in_the_story():
    relations = plugin_api.normalize_relations(DETAIL_PAYLOAD["Media"])

    # A node with no id is not a show and must not become a row.
    assert [item["relation"] for item in relations] == ["SEQUEL", "PREQUEL", "SIDE_STORY"]
    sequel = relations[0]

    assert sequel["id"] == 20605
    assert sequel["title"] == "Attack on Titan Season 2"
    assert sequel["episodes"] == 12
    assert sequel["score"] == 84
    assert sequel["url"].endswith("/anime/20605")


def test_relations_survive_a_show_anilist_has_no_relatives_for():
    assert plugin_api.normalize_relations({}) == []
    assert plugin_api.normalize_relations({"relations": {}}) == []
    assert plugin_api.normalize_relations({"relations": {"edges": []}}) == []


def test_tags_drop_spoilers_and_lead_with_the_load_bearing_ones():
    tags = plugin_api.normalize_tags(TAGS_MEDIA)

    assert [tag["name"] for tag in tags] == ["Kaiju", "Military", "Super Power"]
    assert all(tag["name"] != "Tragedy" for tag in tags), "a spoiler tag is not a description"


def test_tags_are_capped_but_a_cap_never_invents_one():
    assert len(plugin_api.normalize_tags(TAGS_MEDIA, limit=2)) == 2
    assert plugin_api.normalize_tags({"tags": []}) == []


def test_rankings_keep_the_context_that_makes_a_rank_mean_something():
    rankings = plugin_api.normalize_rankings(RANKINGS_MEDIA)

    assert len(rankings) == 2, "a rank without a number is not a rank"
    assert rankings[0] == {"rank": 74, "type": "RATED", "context": "highest rated all time"}


def test_recommendations_shape_a_row_and_keep_the_vote_count():
    recs = plugin_api.normalize_recommendations(RECOMMENDATIONS_MEDIA)

    assert len(recs) == 1, "a recommendation with no media behind it is not one"
    assert recs[0]["id"] == 11061
    assert recs[0]["title"] == "Hunter x Hunter"
    assert recs[0]["votes"] == 2869


def test_score_distribution_reads_low_to_high():
    dist = plugin_api.normalize_score_distribution(DETAIL_PAYLOAD["Media"])

    # AniList returns the buckets unsorted; a distribution that reads 100 → 90 is
    # a list, not a shape.
    assert dist == [{"score": 90, "amount": 12000}, {"score": 100, "amount": 3175}]
    assert plugin_api.normalize_score_distribution({}) == []


# ─── the reader's own list: filter_entries ──────────────────────────────────

NOW = 1_789_000_000

ENTRIES = [
    {"id": 1, "title": "Airing, on track", "status": "watching", "progress": 3, "totalEpisodes": 12},
    {"id": 2, "title": "Airing, behind", "status": "watching", "progress": 1, "totalEpisodes": 12},
    {"id": 3, "title": "Planned, nothing seen", "status": "planned", "progress": 0, "totalEpisodes": 12},
    {"id": 4, "title": "Finished long ago", "status": "completed", "progress": 12, "totalEpisodes": 12},
    {"id": 5, "title": "Planned and not airing", "status": "planned", "progress": 0, "totalEpisodes": 12},
]

# The window's own rows: 1 and 2 air, 4 has nothing left to air.
AIRING = [
    {"id": 1, "episode": 4, "airingAt": NOW + 3600, "title": "Airing, on track", "totalEpisodes": 12},
    {"id": 2, "episode": 2, "airingAt": NOW + 7200, "title": "Airing, behind", "totalEpisodes": 12},
]


def test_no_filter_returns_everything_with_its_next_episode_attached():
    rows = plugin_api.filter_entries(ENTRIES, "all", AIRING)

    assert len(rows) == 5
    assert rows[0]["nextEpisode"] == 4
    assert rows[0]["airingAt"] == NOW + 3600
    assert rows[3]["nextEpisode"] is None, "a finished show has no next episode"


def test_airing_narrows_to_what_is_still_to_come():
    rows = plugin_api.filter_entries(ENTRIES, "airing", AIRING)

    assert [row["id"] for row in rows] == [1, 2]


def test_behind_is_progress_before_the_episode_that_already_landed():
    rows = plugin_api.filter_entries(ENTRIES, "behind", AIRING)

    # Episode 4 of show 1 is next and it has seen 3: on track. Show 2 is next on
    # episode 2 having seen 1 — also on track. Neither is behind, and that is the
    # point: "behind" is about episodes that already aired, not the next one.
    assert rows == []


def test_behind_finds_the_shows_whose_next_episode_already_passed_them():
    rows = plugin_api.filter_entries(
        [
            {"id": 1, "title": "Behind", "status": "watching", "progress": 1, "totalEpisodes": 12},
            {"id": 2, "title": "On track", "status": "watching", "progress": 3, "totalEpisodes": 12},
        ],
        "behind",
        [
            {"id": 1, "episode": 4, "airingAt": NOW + 3600},
            {"id": 2, "episode": 4, "airingAt": NOW + 3600},
        ],
    )

    assert [row["id"] for row in rows] == [1]


def test_not_started_is_planned_with_nothing_watched():
    rows = plugin_api.filter_entries(ENTRIES, "not_started", AIRING)

    assert [row["id"] for row in rows] == [3, 5]


def test_an_unknown_filter_is_all_not_an_empty_answer():
    rows = plugin_api.filter_entries(ENTRIES, "nonsense", AIRING)

    assert len(rows) == 5


def test_a_local_entry_reads_its_next_episode_from_the_window_too():
    # The local list keeps fewer fields than the account's; the join must not
    # assume the account's shape.
    rows = plugin_api.filter_entries(
        [{"id": 1, "title": "Local", "status": "watching", "progress": 3, "totalEpisodes": 12}],
        "all",
        AIRING,
    )

    assert rows[0]["nextEpisode"] == 4


# ─── the reads the tools call ───────────────────────────────────────────────


@pytest.fixture
def local_state(monkeypatch):
    """Signed out, with one show tracked on this device."""
    monkeypatch.setattr(plugin_api, "read_token", lambda: None)
    monkeypatch.setattr(
        plugin_api,
        "_watchlist",
        lambda: {"21": {"id": 21, "title": "One Piece", "status": "watching", "progress": 1000, "totalEpisodes": None}},
    )


def test_read_entries_says_which_store_answered(local_state):
    result = asyncio.run(plugin_api.read_entries())

    assert result["store"] == "local"
    assert result["connected"] is False
    assert [entry["id"] for entry in result["entries"]] == [21]


def test_read_entries_prefers_the_account_when_signed_in(monkeypatch):
    monkeypatch.setattr(plugin_api, "read_token", lambda: "token")

    async def _listing(token):
        assert token == "token"

        return {"entries": [{"id": 16498, "title": "Attack on Titan", "status": "completed", "progress": 25}]}

    monkeypatch.setattr(plugin_api, "_read_list", _listing)
    result = asyncio.run(plugin_api.read_entries())

    assert result["store"] == "anilist"
    assert result["connected"] is True
    assert result["entries"][0]["id"] == 16498


def test_a_token_that_stopped_working_falls_back_to_the_local_list(local_state, monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setattr(plugin_api, "read_token", lambda: "stale")

    async def _listing(_token):
        raise HTTPException(status_code=401, detail="Invalid token")

    monkeypatch.setattr(plugin_api, "_read_list", _listing)
    result = asyncio.run(plugin_api.read_entries())

    assert result["store"] == "local"
    assert result["reason"] == "invalid"
