# OP.GG champion item build contract

## Purpose

Show commonly used item choices for a manually selected champion when an editorial build profile is missing or too generic. OP.GG remains a separate statistical reference; it does not change pick scores or claim the current patch's optimal build.

## Source and request

- Source: public OP.GG MCP endpoint `https://mcp-api.op.gg/mcp`, read-only `lol_get_champion_analysis`.
- Required observed inputs: `game_mode`, `champion`, `position`, and `desired_output_fields`; `tier` is optional. Requests are made only after the user submits the OP.GG form.
- Item output paths observed in a successful public read call: `data.starter_items`, `data.boots`, `data.core_items`, `data.fourth_items[]`, `data.fifth_items[]`, `data.sixth_items[]`, and `data.last_items[]`.
- Region and patch were not returned as verified scope in the observed response. Requested tier is also not treated as returned scope.

## Observed response and transform

The MCP response is class-style text rather than JSON. Each response starts with declarations such as `class Data: summary,core_items,boots,starter_items,last_items,fourth_items,fifth_items,sixth_items` and `class CoreItems: ids,ids_names,play,win,pick_rate`. The declared order depends on the requested fields (for example `summary` comes first when summary stats are requested). The adapter names positional values only from these declarations. A response without a `class Data` declaration, or with a value count that differs from it, is shown as unavailable instead of guessed. The adapter parses this bounded grammar; it does not execute or evaluate response text.

2026-11-08 fix: the earlier adapter assumed a fixed order `core, boots, starter, fourth, fifth, sixth, last`. The observed order puts `last_items` before `fourth_items`, so the 4th/5th/6th/last groups were mislabelled, and every group shifted when summary stats were requested. Tests now use the captured live fixture.

For each returned item ID, the adapter requires a matching item in the currently loaded Riot Data Dragon catalog and checks Summoner's Rift map/store purchase constraints. Unknown, unavailable, or restricted items are omitted and their IDs are reported. Displayed item names, icons, and prices come from the current Data Dragon item version, while pick rate and sample counts remain attributed to OP.GG.

## Output and failure behavior

- The item page displays OP.GG groups separately from the editorial template, with source, fetched time, current Data Dragon item version, play count, wins, and pick rate.
- A query for a different champion/position is not shown as the selected champion's build.
- A patch change invalidates display of previously parsed candidates until a new query is made.
- Missing item fields, an unsupported response shape, non-purchasable items, or unavailable official item data produce an explicit unavailable state. The app retains its local template as a fallback.
- Because the observed OP.GG item response did not establish the statistics patch, the UI warns that statistics patch/region are unknown even though item IDs are checked against the current Riot catalog.

## Freshness and retention

The user initiates each query. Parsed results live in the current browser session only; they are not persisted or refreshed in the background. The original response remains available in the existing expandable OP.GG result view.

## Live fixtures and filter scope (2026-11-08)

Captured with the local read-only client into `tests/fixtures/opgg/`:

- `tools-list.json`: allowed tools and their input schemas.
- `champion-analysis-success.json`: Ahri / ranked / mid with summary stats and all item build fields.
- `champion-analysis-trends.json`: Ahri / ranked / mid / gold with `data.trends.pick`.
- `champion-analysis-failure-unknown-champion.json`: provider error `Unknown champion provided.`
- `champion-analysis-failure-unsupported-region.json`: local validation rejects `region` because the schema has no such input.

| Scope | Request input | Evidence in response | Judgment |
|---|---|---|---|
| Tier | yes, optional free string. Omitted means all-tier aggregate. | Not echoed. `gold` and `challenger` returned different sample sizes (63,451 vs 279 plays). | Filter applied: yes. Returned scope label: unknown. |
| Position | yes, enum `top/mid/jungle/adc/support` | Not echoed. | Applied: yes (required input). Returned label: unknown. |
| Queue | `game_mode` enum `ranked/flex/urf/aram/nexus_blitz` | Not echoed. Whether `ranked` means solo/duo only is not stated. | Partially known: unknown for solo/duo. |
| Region | no input | Not echoed. | no. Region scope unknown. |
| Patch | no input | `data.trends.pick.version` returned `"16.22"` with `created_at`. Whether summary and build stats share that patch is not stated. | Patch filter: no. Returned patch: unknown for build/summary, candidate source for task 1.1. |

Until task 1.1 maps these into `MetaEstimate.returnedScope`, the UI keeps treating region and patch scope as unknown.
