"""The agent half's contract with Hermes' tool runtime.

What is under test is the wiring — registration, the context kwargs the
dispatcher passes to every handler, and the shape a handler hands back. The
reads are stubbed here on purpose: ``tests/test_agent_reads.py`` owns the
payloads, this file owns the boundary where a plugin meets the dispatcher.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard"))

import plugin_api  # noqa: E402

# What ``__init__.py`` expects to find in sys.modules: the web server loads the
# plugin's api module under this name.
ROUTES_MODULE = "hermes_dashboard_plugin_hermes-anilist"

PLUGIN_PACKAGE = "hermes_anilist_under_test"


class RecordingContext:
    """The slice of PluginContext registration touches, and nothing else."""

    def __init__(self) -> None:
        self.tools: dict = {}
        self.skills: list = []
        self.state = None

    def register_tool(self, name, toolset=None, schema=None, handler=None, **kwargs) -> None:
        self.tools[name] = {
            "toolset": toolset,
            "schema": schema,
            "handler": handler,
            **kwargs,
        }

    def register_skill(self, name, path=None, **kwargs) -> None:
        self.skills.append({"name": name, "path": path, **kwargs})


@pytest.fixture
def agent(monkeypatch):
    """The plugin loaded the way the loader loads it: a package with a __path__.

    ``tools.py`` resolves its backend relative to that package, so the test has
    to be a package too — and the plugin's api module has to sit in ``sys.modules``
    under the name it looks for, which is how it finds the same client and cache
    the desktop pane reads through.
    """
    monkeypatch.setitem(sys.modules, ROUTES_MODULE, plugin_api)

    spec = importlib.util.spec_from_file_location(
        PLUGIN_PACKAGE,
        ROOT / "__init__.py",
        submodule_search_locations=[str(ROOT)],
    )
    assert spec is not None and spec.loader is not None
    package = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, PLUGIN_PACKAGE, package)
    spec.loader.exec_module(package)

    tools = importlib.import_module(f"{PLUGIN_PACKAGE}.tools")

    # The registry's envelopes (``tool_result`` / ``tool_error``) need Hermes' own
    # sys.path, which the plugin's test environment does not have. Capture the
    # payload instead of the string the model eventually sees.
    seen: dict = {}

    def _result(payload):
        seen["payload"] = payload
        return "result"

    def _error(message):
        seen["error"] = message
        return "error"

    monkeypatch.setattr(tools, "_result", _result)
    monkeypatch.setattr(tools, "_error", _error)

    ctx = RecordingContext()
    package.register(ctx)

    return {"tools": tools, "ctx": ctx, "seen": seen, "routes": plugin_api}


# ─── registration ───────────────────────────────────────────────────────────


def test_the_agent_half_registers_the_tools_the_manifest_declares(agent):
    """``plugin.yaml`` declares two names; the loader must find two handlers."""
    registered = agent["ctx"].tools

    assert set(registered) == {"anilist_list", "anilist_show"}

    for name, entry in registered.items():
        assert entry["toolset"] == "anilist"
        assert callable(entry["handler"])
        assert entry["schema"]["name"] == name
        assert entry["schema"]["parameters"]["type"] == "object"
        # Async work (HTTP) is bridged by the registry when this is set.
        assert entry["is_async"] is True


# ─── the dispatcher's context kwargs ────────────────────────────────────────


def test_every_handler_accepts_the_context_the_dispatcher_forwards(agent, monkeypatch):
    """Regression: the dispatcher calls handlers as ``handler(args, **context)``.

    ``model_tools.py`` forwards ``task_id`` and ``session_id`` to *every* tool
    call. A handler that only takes ``args`` blows up with a TypeError before it
    can read anything, and the model reads that as a broken tool.
    """
    monkeypatch.setattr(agent["routes"], "read_entries", _empty_entries)
    monkeypatch.setattr(agent["routes"], "read_airing", _quiet_window)
    monkeypatch.setattr(agent["routes"], "read_show", _one_show)

    for name, entry in agent["ctx"].tools.items():
        args = {"id": 16498} if name == "anilist_show" else {}

        asyncio.run(entry["handler"](args, task_id="t-1", session_id="s-1"))

        assert "error" not in agent["seen"], f"{name} refused the dispatcher's context"


async def _empty_entries():
    return {"store": "local", "connected": False, "reason": None, "entries": []}


async def _quiet_window(days=7):
    return {"items": []}


async def _one_show(media_id, episodes=12):
    return {"id": media_id, "title": "Shingeki no Kyojin", "episodes": 25, "relations": []}


# ─── the answers themselves ─────────────────────────────────────────────────


async def _tracked_entries():
    return {
        "store": "anilist",
        "connected": True,
        "reason": None,
        "entries": [
            {
                "id": 21,
                "title": "One Piece",
                "status": "watching",
                "progress": 1100,
                "totalEpisodes": None,
                "score": 0,
                "format": "TV",
                "season": "FALL",
                "seasonYear": 1999,
                "siteUrl": "https://anilist.co/anime/21",
            },
            {
                "id": 16498,
                "title": "Shingeki no Kyojin",
                "status": "completed",
                "progress": 25,
                "totalEpisodes": 25,
                "score": 90,
                "format": "TV",
                "season": "SPRING",
                "seasonYear": 2013,
                "siteUrl": "https://anilist.co/anime/16498",
            },
        ],
    }


def test_the_list_handler_says_which_store_answered_and_what_it_narrowed_to(agent, monkeypatch):
    monkeypatch.setattr(agent["routes"], "read_entries", _tracked_entries)

    asyncio.run(agent["ctx"].tools["anilist_list"]["handler"]({"filter": "all"}, task_id="t"))

    payload = agent["seen"]["payload"]

    assert payload["store"] == "anilist"
    assert payload["connected"] is True
    assert payload["filter"] == "all"
    # The plugin's own order (watching before completed), not the order they came in.
    assert [row["title"] for row in payload["entries"]] == ["One Piece", "Shingeki no Kyojin"]
    assert payload["entries"][1]["score"] == 90
    assert payload["entries"][1]["seasonYear"] == 2013


def test_the_list_handler_narrows_by_status_without_asking_anilist_again(agent, monkeypatch):
    monkeypatch.setattr(agent["routes"], "read_entries", _tracked_entries)

    asyncio.run(
        agent["ctx"].tools["anilist_list"]["handler"]({"status": "watching"}, task_id="t")
    )

    payload = agent["seen"]["payload"]

    assert payload["matched"] == 1
    assert payload["entries"][0]["title"] == "One Piece"


def test_a_dead_airing_window_still_answers_the_list(agent, monkeypatch):
    """The join is a nicety: a failed window must not hide what is tracked, and it
    must not invent airing rows either — the list loads, the schedule says why."""
    monkeypatch.setattr(agent["routes"], "read_entries", _tracked_entries)

    async def _boom(days=7):
        raise RuntimeError("AniList said 429")

    monkeypatch.setattr(agent["routes"], "read_airing", _boom)

    asyncio.run(agent["ctx"].tools["anilist_list"]["handler"]({"filter": "airing"}, task_id="t"))

    payload = agent["seen"]["payload"]

    assert payload["matched"] == 2
    assert payload["entries"] == []
    assert "429" in payload["windowError"]


def test_the_show_handler_says_which_show_a_title_resolved_to(agent, monkeypatch):
    async def _search(term, page=1, per_page=15):
        return {
            "items": [
                {"id": 16498, "title": "Shingeki no Kyojin"},
                {"id": 20958, "title": "Shingeki no Kyojin Season 2"},
            ]
        }

    monkeypatch.setattr(agent["routes"], "read_search", _search)
    monkeypatch.setattr(agent["routes"], "read_show", _one_show)
    monkeypatch.setattr(agent["routes"], "read_entries", _tracked_entries)

    asyncio.run(agent["ctx"].tools["anilist_show"]["handler"]({"title": "attack on titan"}, task_id="t"))

    payload = agent["seen"]["payload"]

    assert payload["resolvedFrom"] == {
        "query": "attack on titan",
        "id": 16498,
        "title": "Shingeki no Kyojin",
        "otherMatches": ["Shingeki no Kyojin Season 2"],
    }
    # The reader's own entry rides along, so "is this good" has both halves.
    assert payload["inMyList"]["status"] == "completed"
    assert payload["inMyList"]["score"] == 90


def test_the_show_handler_refuses_a_question_it_cannot_look_up(agent):
    asyncio.run(agent["ctx"].tools["anilist_show"]["handler"]({}, task_id="t"))

    assert "id" in agent["seen"]["error"]


# ─── the bundled skill ──────────────────────────────────────────────────────


def test_the_skill_is_registered_and_the_file_is_there(agent):
    assert [skill["name"] for skill in agent["ctx"].skills] == ["usage"]

    path = ROOT / agent["ctx"].skills[0]["path"]

    assert path.is_file()
