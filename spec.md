# Rift Draft 제품 명세

상태: 2026-10-08, 1차 범위. 로컬 프로토타입에서 확인한 사용자 흐름과 다음 구현 목표를 고정한다. 공개·출시 승인을 뜻하지 않는다.

## Purpose

LoL 밴픽과 픽 조합을 사용자가 직접 입력하고, 사용자 선호·숙련도를 고려한 픽 후보와 선택 픽의 아이템 초안을 보여준다. OP.GG 통계는 실제 조회 범위를 확인한 뒤 패치·리그·포지션 문맥에 맞게 후보를 보완한다.

## Application Structure

The UI has three primary pages that share the same patch-aware ontology and profile:

1. **Ontology** — search champions and items, inspect their typed relationships and evidence, and filter by patch, role, or relation. This is a read-only exploration surface with no arbitrary query language.
2. **Ban-pick** — manually enter bans and both teams' picks, set the user's role, and receive next-pick candidates based on available slots, draft context, champion pool, preference, mastery, and only verified meta statistics. The user chooses the pick.
3. **Items** — choose a champion and draft context to view a patch-valid item build draft, component paths, situational alternatives, and recommendation evidence. Item selection or purchase is never automated.

Navigation, patch/data status, and profile preferences are shared across pages. The first release is a normal web application; live game-state integration remains out of scope.

## Architecture

- Build an in-memory JavaScript graph from the currently loaded Data Dragon catalog and reviewed-state editorial annotations. Nodes have typed IDs; relationships are explicit objects with source, patch, and review status where applicable.
- Keep the first version client-side: ontology search, direct-neighbor lookup, draft scoring, and item-template traversal are deterministic JavaScript operations over a bounded catalog. No database, server credentials, import service, or deployment dependency is required.
- Preserve a stable, storage-independent graph contract so a graph database can be added later if shared data, persistent match history, or query volume justifies it. Revisit Neo4j Community Edition or another OSS option at that point, including license and operations review.

## Users And Workflows

1. 사용자가 KR 서버, 소환사의 협곡 솔로/듀오, 희망 통계 티어와 조회 가능한 패치를 선택한다.
2. 밴과 아군·상대의 공개 픽을 수동 입력하고 자신의 역할을 선택한다.
3. 챔피언 풀, 선호도, 자가평가 숙련도를 설정한다.
4. 앱은 아직 픽·밴되지 않고 해당 역할에서 선택할 수 있는 후보를 보여준다. 조합 적합도, 개인 선호, 숙련도, 통계가 반영된 항목과 신뢰 정도를 구별한다.
5. 사용자가 픽을 선택하면 같은 패치의 아이템 정보와 조합을 고려한 아이템 빌드 초안과 상황별 대안을 본다.
6. OP.GG 결과의 실제 패치·리그·역할 범위가 요청과 일치하지 않거나 확인되지 않으면 통계를 추천에 반영하지 않고 그 차이를 표시한다.

## Core Rules

- 픽·밴·아이템 구매는 사용자가 결정한다. 1차 버전은 수동 입력과 조회 중심이며 자동 픽·밴·구매나 실시간 경기 연결을 하지 않는다.
- 챔피언 풀 포함, 선호도, 자가평가 숙련도, 팀 조합, 메타 통계는 서로 다른 추천 근거로 표시한다. 미입력을 0점 숙련으로 추정하지 않는다.
- 정적 사실, 사람이 작성한 의미 주석, OP.GG 통계, 추천 점수를 각각 출처·버전과 함께 추적한다.
- OP.GG 통계는 요청·응답의 패치, 티어 집단, 지역, 큐, 포지션 범위가 확인된 경우에만 반영한다. 범위를 추정하거나 지원되지 않는 필터를 조용히 무시하지 않는다.
- 챔피언/아이템 정보와 구매 제약은 동일한 Data Dragon 버전에서 읽는다. Riot 데이터 버전과 OP.GG 패치 표기는 별도로 보존하고 명시적인 매핑 없이는 비교하지 않는다.
- 표본 수·정의·불확실성이 충분히 확인되지 않은 통계는 승률 개선이나 인과 효과로 표현하지 않는다.
- 알 수 없는 챔피언·효과·통계 범위는 `unknown`으로 표시하며 부재나 0으로 간주하지 않는다.

## Data And Contracts

- 정적 게임 데이터: Data Dragon의 지역 realm과 같은 패치에서 읽은 champion/item 데이터.
- 온톨로지: JavaScript `Map` 기반 `Champion`, `Role`, `Trait`, `Item`, `Patch` 노드와 `PLAYS_ROLE`, `HAS_TRAIT`, `BUILDS_FROM`, `HAS_BUILD_CANDIDATE`, `AVAILABLE_IN` 관계. Graph identity is stable within an entity type; patch-specific facts and estimates retain their own version/scope.
- Graph access: typed pure functions for ontology search/neighborhood and role-specific item candidates. Bound result count and relationship depth; validate entity type, IDs, and patch against the loaded catalog.
- OP.GG 외부 응답: 허용된 MCP 읽기 도구만 호출한다. 내부 통계 객체에 source, fetchedAt, requestedScope, returnedScope, statisticDefinition, sampleSize, providerVersion을 보존한다. 실제 응답에 없는 값은 추측해 채우지 않는다.
- 사용자 로컬 설정: 밴픽 상태, 역할, 선택 챔피언 풀, 선호도, 자가평가 숙련도 및 조회 조건. 저장 항목과 OP.GG로 보내는 조회 필드를 화면에 알리고 사용자가 모두 지울 수 있게 한다.
- 추천 출력: 후보 챔피언/아이템, 근거별 기여, 패치/통계 범위, 데이터 신선도, 한계와 대안.

## Non-Goals

- 실시간 게임 상태·인벤토리 연동, 라이브 오버레이.
- 게임 클라이언트에 행동을 쓰거나 사용자를 대신한 픽·밴·구매.
- Riot 계정 로그인/개인 프로필 수집, 숨겨진 상대 정보 또는 계정 추적.
- 1차 출시에서 학습 모델이 승률을 높인다는 주장.
- 수동 검토 없이 LLM이 생성한 효과·상성 주석을 사실로 채택하는 기능.

## Open Decisions

- OP.GG MCP 도구가 현재 시점에 정확한 티어, 게임 큐, 서버, 라인, 과거 패치를 각각 필터링하는지와 응답에 실제 반환 범위를 넣는지 확인이 필요하다.
- 표본 최소치와 신뢰도 표시 기준은 MCP 응답의 실제 표본 수와 정의를 확인한 뒤 확정한다.
- 공개 배포 전 Riot 제품 등록, 정책 심사, 고지 문구·데이터 보존 계획을 확인한다.
- 현재 규모에서 클라이언트 메모리 그래프가 충분한지 사용성·성능으로 확인한다. 공유 상태/다중 사용자 요구가 생길 때 DB 도입을 다시 결정한다.

## Links

- [Riot LoL Developer Docs](https://developer.riotgames.com/docs/lol)
- [OP.GG MCP](https://op.gg/open-source/opgg-mcp)
- [현재 구현/검증 기록](docs/implementation-status.md)
- [구현 계획](Plans.md)
