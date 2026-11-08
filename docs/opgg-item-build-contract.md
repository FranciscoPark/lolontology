# OP.GG champion item build contract

## Purpose

Show commonly used item choices for a manually selected champion when an editorial build profile is missing or too generic. OP.GG remains a separate statistical reference; it does not change pick scores or claim the current patch's optimal build.

## Source and request

- Source: public OP.GG MCP endpoint `https://mcp-api.op.gg/mcp`, read-only `lol_get_champion_analysis`.
- Required observed inputs: `game_mode`, `champion`, `position`, and `desired_output_fields`; `tier` is optional. Requests are made only after the user submits the OP.GG form.
- Item output paths observed in a successful public read call: `data.starter_items`, `data.boots`, `data.core_items`, `data.fourth_items[]`, `data.fifth_items[]`, `data.sixth_items[]`, and `data.last_items[]`.
- Region and patch were not returned as verified scope in the observed response. Requested tier is also not treated as returned scope.

## Observed response and transform

The MCP response is class-style text rather than JSON. `Data` positional fields were observed in this order: `core_items`, `boots`, `starter_items`, `last_items`, `fourth_items`, `fifth_items`, `sixth_items`. A `CoreItems` value contains `ids[]`, `ids_names[]`, `play`, `win`, and `pick_rate`. The adapter parses this bounded grammar; it does not execute or evaluate response text.

For each returned item ID, the adapter requires a matching item in the currently loaded Riot Data Dragon catalog and checks Summoner's Rift map/store purchase constraints. Unknown, unavailable, or restricted items are omitted and their IDs are reported. Displayed item names, icons, and prices come from the current Data Dragon item version, while pick rate and sample counts remain attributed to OP.GG.

## Output and failure behavior

- The item page displays OP.GG groups separately from the editorial template, with source, fetched time, current Data Dragon item version, play count, wins, and pick rate.
- A query for a different champion/position is not shown as the selected champion's build.
- A patch change invalidates display of previously parsed candidates until a new query is made.
- Missing item fields, an unsupported response shape, non-purchasable items, or unavailable official item data produce an explicit unavailable state. The app retains its local template as a fallback.
- Because the observed OP.GG item response did not establish the statistics patch, the UI warns that statistics patch/region are unknown even though item IDs are checked against the current Riot catalog.

## Freshness and retention

The user initiates each query. Parsed results live in the current browser session only; they are not persisted or refreshed in the background. The original response remains available in the existing expandable OP.GG result view.
