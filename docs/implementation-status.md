# 1차 구현 기록

## 현재 구현

- 온톨로지 / 밴픽 / 아이템 세 페이지 내비게이션.
- 브라우저 JavaScript의 typed `Map` graph: Champion, Item, Ability, Role, Trait, Patch 노드와 역할·특성·스킬·아이템 조합·빌드 후보 관계.
- 챔피언/아이템 이름·ID 검색, 패치·역할·관계 유형 필터, 직접 연결 관계와 출처/검토 상태 표시, patch mismatch 차단. 아이템 카드는 조합 후보의 반대 방향 관계도 표시한다.
- 기존 수동 밴픽, 선호도·자가평가 숙련도, 규칙 기반 픽 추천 및 아이템 초안을 세 페이지에 연결.
- 의미 프로필이 없는 챔피언은 내 챔피언 풀에 있을 때만 `데이터 부족` 후보로 표시한다. 역할 가산점·조합 규칙 없이 개인 입력만 반영하고 역할 확인 주의 문구를 붙인다.
- 그래프는 노드별 인접 인덱스로 관계를 조회한다. 관계 그래프는 이웃을 최대 24개까지 그리고 전체 개수를 함께 표시한다.
- 온톨로지 빌드 후보는 prototype/editing 템플릿임을 표시하며 patch-validated로 주장하지 않는다.
- 로컬 백엔드는 `.cache/riot-data.json`에 Data Dragon snapshot을 원자 저장한다. champion/item version ID를 독립 관리하며 시작 시·6시간마다 realm을 확인한다. 브라우저는 백엔드의 마지막 스냅샷을 읽고 수동 새로고침은 백엔드에 즉시 확인을 요청한다.
- 패시브/QWER 스킬은 champion version으로 구분해 백엔드에 챔피언별 지연 저장한다. 캐시 miss일 때만 상세 JSON을 요청하며 champion version 변경 시 스킬 캐시를 폐기한다.
- 추가 npm 의존성이나 DB는 없다. 오프라인에서는 브라우저의 마지막 정상 snapshot 또는 명시적인 예제 catalog를 사용한다.
- OP.GG 조회 기능은 기존 로컬 proxy를 유지한다. champion analysis item build는 patch scope를 모르는 별도 통계 영역에 표시하고, 픽 점수에는 반영하지 않는다.

## 검증 상태

- 2026-11-08: `npm run check`(전체 JS 문법 + Prettier), `npm test` (61 tests), `npm run build`, `npm run smoke` 통과.
- 2026-11-08: 이전 `dist/index.html`은 `build.mjs`가 `graph.js`·`opgg-build.js`를 번들하지 않아 시작 직후 `createOntology is not defined`로 중단됐다. 번들러가 import 그래프를 따르도록 고쳤고 번들 계약 테스트와 headless Chrome smoke를 추가했다.
- 2026-11-08: 일반 터미널에서 `npm start`가 기동했고 KR realm 16.22.1 동기화(173 champions, 863 items), `/api/game-data`, `/api/champion-abilities`, `/api/opgg/tools` 응답을 확인했다. 아래 `listen EPERM` 기록은 2026-10-08 작업 환경의 제약이며 현재는 해소됐다.
- 2026-11-08: headless Chrome으로 서버 모드 화면의 공식 데이터 표시, 새로고침 시 로컬 상태 복원, 미주석 풀 챔피언 후보 선택→아이템 페이지 이동, 패치 노드 그래프 상한, 아이템 검색을 확인했다. 콘솔 오류는 없었다.
- 성능 관측(16.22.1, 로컬): 그래프 1,054 노드·6,965 관계 생성 약 4ms. 아이템 전체 검색은 인접 인덱스 도입 전 약 193ms에서 약 2ms로 줄었다.
- Data Dragon backend store tests cover independent version IDs, atomic snapshot persistence/reload, lazy ability cache, patch invalidation, and last-known-good behavior after a failed update.
- Graph tests cover ability relationships and independent champion/item patch filtering as well as existing relation, unknown-annotation, recipe/build-candidate, role filter, and result-bound behavior.
- 외부 공개 확인: [KR realm](https://ddragon.leagueoflegends.com/realms/kr.json)의 현재 Data Dragon 버전은 `16.20.1`; [해당 버전 아이템 JSON](https://ddragon.leagueoflegends.com/cdn/16.20.1/data/ko_KR/item.json)은 HTTP 200과 870개 항목을 반환하며 ID `1055`, `6655`가 존재한다. 브라우저 공개 조회 결과이며 앱의 로컬 런타임 적재 검증과는 구분한다.
- [OP.GG 공식 README](https://github.com/opgginc/opgg-mcp/blob/main/README.md)와 공개 MCP `tools/list`에서 endpoint, Streamable HTTP 및 현재 조회 schema를 확인했다. `lol_get_champion_analysis`는 `game_mode`, `champion`, `position`, `desired_output_fields`가 필수이고 `tier`는 선택이다. `lol_list_lane_meta_champions`는 `desired_output_fields`가 필수이며 포지션만 선택할 수 있다. 두 도구 모두 지역·패치 필터가 없고, 언어 설정은 지역 필터가 아니다.
- 화면의 OP.GG 조회 form은 live schema로부터 enum/필수 필드와 `desired_output_fields` 선택지를 만든다. 공개 읽기 조회로 Ahri/ranked/mid 표본의 승률·픽률·밴률과 아이템 빌드 항목의 `ids`, `play`, `win`, `pick_rate`를 확인했다. 통계 빌드는 아이템 페이지에 별도 표시하며 픽 점수에는 반영하지 않는다. 응답은 지역·패치를 명시하지 않으므로 그 통계 범위는 미확인으로 남긴다.
- (2026-10-08 기록, 2026-11-08 해소) 실제 브라우저 렌더링 및 로컬 서버 smoke test: 당시 작업 환경에서 `npm start`가 `listen EPERM`으로 거부되고 Data Dragon 요청도 `fetch failed`여서 미검증. 일반 사용자 터미널에서 서버 재시작 후 확인이 필요하다.
- 2026-10-08 공개 read-only OP.GG MCP 호출에서 champion analysis item 경로와 class-style `Data/CoreItems` 응답을 확인했다. UI는 item field paths를 요청하고 ID, pick rate, play, win을 읽어 현재 Data Dragon 아이템 ID와 상점/맵 조건으로 검증한 뒤 별도 표시한다. API 응답이 일반 JSON이 아니라 class-style text라서 adapter는 관측된 문법만 parse하며 `eval`하지 않는다. parser fixture tests cover core, boots, starter, 4/5/6th and last item groups, and omission of invalid IDs.
- OP.GG MCP tool discovery와 통계 tool call은 공개 브라우저 경로에서 성공했다. 2026-11-08 로컬 proxy의 `tools/list`와 Data Dragon backend HTTP 경로도 확인했다. 로컬 proxy를 통한 `tools/call` 화면 흐름은 아직 사람이 확인하지 않았다.
- 전략적 추천 품질, 최신 패치 템플릿 적합성: 미검증.

## 현재 주장할 수 있는 결과

현재 카탈로그 규모에서는 일반 JavaScript 객체 그래프로 화면의 검색과 직접 관계 조회, 아이템 template 경로를 처리한다. 데이터베이스는 필요하지 않다. 다중 사용자 공유 상태, 영속 match history, 데이터/응답 규모의 한계가 확인되면 그래프 DB를 다시 평가한다.

## 다음 필수 작업

사람이 직접 하는 세 페이지 클릭 QA(역할 변경, 밴/픽 입력, 개인화 수정, OP.GG 연결 실패 화면)를 기록한다. 로컬 저장 데이터 전체 삭제 UI(Plans 1.3, 2.7)를 추가한다. OP.GG 응답 범위 검증(Plans 0.1, 1.1)은 계속 남아 있다. 파이프라인 계약은 [data-pipeline-contract.md](data-pipeline-contract.md)에 기록했다.
