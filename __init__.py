"""hermes-anilist — agent half.

The desktop UI lives in ``desktop/plugin.js`` and the HTTP backend in
``dashboard/plugin_api.py``. This module is the native plugin entry point: it is
imported by the plugin manager when the plugin is enabled, and it is where
agent-facing surfaces (tools, a CLI subcommand, a bundled skill) will be
registered.

Phase 0 registers nothing: the manifest declares no tools, hooks or middleware,
so ``hermes plugins validate`` compares an empty declaration against an empty
registration on purpose. Adding a tool here means adding it to
``provides_tools`` in ``plugin.yaml`` in the same change.

L2 adds one bridge, not a contribution: the dashboard routes need the plugin's
profile-scoped state, and the web server imports that file itself under a
synthetic module name without handing it any context.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

PLUGIN_ID = "hermes-anilist"

# What ``hermes_cli.web_server`` names the plugin's api module in sys.modules
# (``hermes_dashboard_plugin_<name>`` from the manifest's name).
ROUTES_MODULE = f"hermes_dashboard_plugin_{PLUGIN_ID}"

# The skill the agent loads for the how-and-when of the tools: not in
# ``~/.hermes/skills/`` and not in ``<available_skills>``, so the tool
# descriptions are where it gets named.
SKILL_NAME = "usage"
SKILL_PATH = "skills/usage/SKILL.md"


def register(ctx) -> None:
    """Wire the plugin's agent-side contributions. Called once at startup."""
    logger.debug("%s: register(ctx) called", PLUGIN_ID)
    _bind_plugin_state(ctx)
    _register_tools(ctx)
    _register_skill(ctx)


def _register_tools(ctx) -> None:
    """The agent's AniList tools. Declared in ``provides_tools``, so registration and
    declaration must move together (``hermes plugins validate`` compares them)."""
    try:
        from .tools import register_tools
    except Exception:  # a broken import must not disable the whole plugin
        logger.warning("%s: tools.py could not be imported; agent tools unavailable", PLUGIN_ID, exc_info=True)

        return

    register_tools(ctx)


def _register_skill(ctx) -> None:
    """The skill that teaches when to reach for those tools. Read-only, explicit-load."""
    path = Path(__file__).resolve().parent / SKILL_PATH
    if not path.is_file():
        logger.debug("%s: no %s; skipping skill registration", PLUGIN_ID, SKILL_PATH)

        return

    try:
        ctx.register_skill(
            SKILL_NAME,
            path,
            description=(
                "How and when to use the hermes-anilist agent tools: reading the reader's own list, "
                "answering 'is it good', finding sequels they are missing, and the rules that keep "
                "writes safe."
            ),
            frontmatter={"name": SKILL_NAME, "description": "AniList tools: lists, shows, and the honesty rules"},
        )
    except Exception:  # a skill is a nicety, not the feature
        logger.warning("%s: skill %s could not be registered", PLUGIN_ID, SKILL_NAME, exc_info=True)


def _bind_plugin_state(ctx) -> None:
    """Hand the dashboard routes the state the loader cannot give them.

    ``hermes_cli.web_server._mount_plugin_api_routes`` executes
    ``dashboard/plugin_api.py`` under the synthetic name above and passes no
    context, so ``ctx.state`` is bridged here instead. The routes resolve it
    lazily and can build the same ``PluginState`` themselves, which is why a
    failure here must not take the plugin down: registration crashing disables
    the plugin, and losing the watchlist is a smaller loss than losing the
    plugin. Hence the narrow guard — logged, never raised into the loader.
    """
    routes = sys.modules.get(ROUTES_MODULE)
    if routes is None:
        # Mounting already happened or has not happened yet; either way the lazy
        # door in the routes covers it.
        logger.debug("%s: dashboard routes not in sys.modules; state resolves lazily", PLUGIN_ID)

        return

    bind = getattr(routes, "bind_state", None)
    if bind is None:
        logger.debug("%s: routes expose no bind_state; state resolves lazily", PLUGIN_ID)

        return

    try:
        bind(ctx.state)
    except Exception:  # the lazy door is the fallback, not a crash
        logger.warning("%s: could not bind ctx.state to the dashboard routes", PLUGIN_ID, exc_info=True)
