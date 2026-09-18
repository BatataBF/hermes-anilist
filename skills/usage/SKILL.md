---
name: usage
description: AniList agent tools — reading the reader's own list, answering "is this good", finding the sequels they are missing, and the rules that keep writes honest.
---

# Using the AniList tools

Two tools, both reading the list the reader actually tracks — their AniList account's list when they
are signed in, this device's own list otherwise. **Every answer names which store it came from**
(`store: "anilist" | "local"`); say it when the distinction matters ("that is from this device's
list — sign in to AniList and I can see the rest").

| The reader asks | Reach for |
|---|---|
| "qué estoy viendo", "qué me falta", "qué tengo en planning" | `anilist_list` (`status` narrows) |
| "qué de lo mío emite", "qué sale esta semana de mi lista" | `anilist_list` with `filter: "airing"` |
| "en qué estoy atrasado" | `anilist_list` with `filter: "behind"` |
| "qué arranco", "qué tengo sin empezar" | `anilist_list` with `filter: "not_started"` |
| "¿es bueno X?", "de qué trata", "cuánto dura" | `anilist_show` |
| "¿qué secuelas me faltan?", "¿qué sigue de X?" | `anilist_show` → `relations` (each row carries `inMyList`) |
| "algo parecido a X" | `anilist_show(X)` → `recommendations` (with their vote counts) |

Titles resolve themselves: pass `title` and the tool answers with `resolvedFrom` — always check it,
because the reader may have meant the second match, not the first.

## What the numbers mean

- **`score` is AniList's community average, on a 0–100 scale, and it means what the scale says**: 85
  is very good, 62 is mediocre, 40 is poorly received. `null` means AniList has no score for it —
  say that instead of guessing, and never present a score you were not given.
- **`rankings` are all-time placements with their context** ("#74 highest rated", "#1 most popular").
  Quote the context or the rank says nothing.
- **`popularity` and `favourites`** are counts, not quality: a show can be watched by a million
  people and rated 55.
- **`tags.rank`** is how central a tag is to the work (0–100), and AniList's general-spoiler tags are
  already filtered out. Still: a tag list is not a plot summary — do not narrate it as one.
- **`votes` on a recommendation** is how many people made that pairing. A 4-vote pairing is a hunch,
  not a consensus.
- **`progress` vs `totalEpisodes`**: `null` total means AniList does not know how long the show is
  (common for long-running series) — say "still airing" rather than inventing a length.

## Rules that keep this honest

1. **Never state a fact the tool did not return.** No scores, dates, episode counts or relations from
   memory — titles and memory diverge, and the reader will notice.
2. **Their own score is theirs.** If they scored a show 40 and AniList says 88, report both; do not
   average them into an opinion nobody gave.
3. **Spoilers**: the tags and the description are AniList's own "spoiler-free" text. Do not go beyond
   them — no plot reveals, even for shows from years ago, unless the reader asks about the plot.
4. **Reads are free; nothing in these two tools writes.** Adding, marking watched, planning, scoring
   and removing are not in this toolset yet: if the reader asks for one, say what you *can* show and
   offer the page (`url`), instead of pretending it happened.
5. **Timestamps are Unix seconds**; convert to the reader's own timezone before saying "tomorrow", and
   prefer the relative phrasing the countdown implies ("in about 2 hours").
