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

logger = logging.getLogger(__name__)

PLUGIN_ID = "hermes-anilist"

# What ``hermes_cli.web_server`` names the plugin's api module in sys.modules
# (``hermes_dashboard_plugin_<name>`` from the manifest's name).
ROUTES_MODULE = f"hermes_dashboard_plugin_{PLUGIN_ID}"


def register(ctx) -> None:
    """Wire the plugin's agent-side contributions. Called once at startup."""
    logger.debug("%s: register(ctx) called (no agent-side contributions yet)", PLUGIN_ID)
    _bind_plugin_state(ctx)


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
    except Exception:  # noqa: BLE001 - the lazy door is the fallback, not a crash
        logger.warning("%s: could not bind ctx.state to the dashboard routes", PLUGIN_ID, exc_info=True)
