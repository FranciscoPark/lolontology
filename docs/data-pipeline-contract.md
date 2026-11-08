# Riot Data Dragon backend pipeline contract

## Purpose and consumers

- Purpose: serve patch-consistent champion and item catalogs for manual draft, item drafts, and ontology browsing; provide champion abilities only when requested.
- Consumers: local Rift Draft browser through `/api/game-data` and `/api/champion-abilities`.
- Owner: the local Rift Draft server process.

## Sources and lineage

- Source: Riot Data Dragon KR realm and localized `ko_KR` champion, item, and per-champion detail JSON.
- The realm's `n.champion` and `n.item` version IDs are stored independently. Ability detail uses the champion version ID.
- Transform: `src/catalog.js` validates version-bound input; `scripts/data-dragon-store.mjs` validates the realm, stores normalized records, and records check/update timestamps.
- Persistent output: `.cache/riot-data.json`, atomically replaced after validation. This generated cache is excluded from source control.

## Output contract

- Catalog fields: `championVersion`, `itemVersion`, `abilitiesVersion`, `loadedAt`, `checkedAt`, champion list, item map, and per-champion ability map.
- A champion or item record is only associated with the version ID of its own Data Dragon response. A patch ID mismatch rejects that response.
- Catalog commits require at least 100 champions and 100 items in addition to matching response version IDs.
- Ability records use champion ID plus slot (`PASSIVE`, `Q`, `W`, `E`, `R`) as stable keys, and retain localized name, plain-text description, image path, source, and champion patch.
- Automatic version check runs at server startup and every six hours. A skill detail is fetched only on first request for that champion and version.

## Failure and recovery

- A failed realm check, malformed response, or incomplete new catalog keeps the last valid snapshot. A new snapshot is committed only after validation and via temporary-file rename.
- Failed first startup with no valid snapshot returns an API error; the browser retains its local snapshot or demo fallback.
- Manual refresh forces a realm check and re-fetches the base champion/item datasets. Versioned skills remain cached when the champion version is unchanged; a new champion version invalidates them and they are fetched on demand.
- Restarting `npm start` reloads the persisted snapshot before the next automatic check.

## Monitoring

- Server logs report version IDs, record counts, duration, and skill-cache fills. Payload contents are not logged.
- Tests cover independent version IDs, persistence, lazy ability caching, patch invalidation, and last-known-good recovery.
