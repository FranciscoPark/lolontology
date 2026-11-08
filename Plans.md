# Rift Draft 1차 제품 계획

> 범위: 사용자가 밴과 픽을 수동 입력하고, 개인 취향과 숙련도를 반영한 다음 픽 추천을 받는다. 선택 픽을 바탕으로 패치와 조합 조건을 고려한 아이템 초안을 본다. OP.GG는 티어·지역·포지션·패치 통계를 조회하는 자료원으로 활용한다. 실시간 게임 데이터 연동은 이후 단계다.

> 제품 구조: UI는 **온톨로지 탐색 / 밴픽 / 아이템** 세 페이지다. 첫 버전은 현재 게임 catalog와 편집 의미 관계를 JavaScript 객체 그래프로 처리한다. DB는 필요성이 확인될 때 다시 평가한다.

## 현재 상태 (2026-11-08 갱신)

- **완료:** 세 페이지 UI, JavaScript 온톨로지(효과·상쇄 관계 포함), 온톨로지 경로 기반 상황별 대안 아이템, 미주석 풀 챔피언 `데이터 부족` 후보와 풀 챔피언 플레이 역할 지정, Data Dragon 백엔드 동기화, OP.GG 실응답 fixture·`MetaEstimate` 정규화·요청/응답 범위 표, 템플릿↔통계 빌드 비교, 로컬 데이터 안내·삭제, 테스트 가능한 서버와 프록시 가드레일, 화면 모듈 분리, ESLint·Prettier·CI 워크플로, 두 패치 평가.
- **실행 증거:** `npm run check`, `npm test` 104개, `npm run build`, `npm run smoke`, `npm run qa` 17개 흐름(실제 OP.GG 조회 포함), `npm run validate-data`, `npm run evaluate`(두 패치 212개 시나리오 제약 위반 0건)가 통과한다.
- **막힌 작업과 이유:**
  - 3.1·2.5: OP.GG 응답이 지역·패치 반환 범위를 밝히지 않아 메타 통계를 추천 점수에 넣을 수 없다. 범위를 밝히는 다른 제공자나 OP.GG 측 변경이 필요하다.
  - 2.2: 129명 챔피언의 의미 주석 확장은 사람 검토가 필요하다.
  - 3.2: 실제 선택 레이블이 없어 Recall@K·NDCG를 산출할 수 없다.
  - 5.1: Riot 제품 등록·정책 확인은 사람이 해야 한다.
  - 6.7: 원격 저장소 연결은 사용자 결정이다. CI 워크플로 파일은 준비돼 있다.

## Spec delta

`spec.md`를 제품 계약의 정본으로 추가했다. 수동 입력→픽 추천→선택 픽 아이템 초안, 개인화 근거, 신뢰 범위, 1차 비목표와 OP.GG 스코프 검증 규칙을 고정한다. `Plans.md`는 구현 작업·의존성·완료 기준만 관리한다.

## team_validation_mode

`subagent` — Product, Architecture, QA/Security 관점에서 현재 `README.md`, `docs/system-contract.md`, `docs/implementation-status.md`, 실행 코드와 OP.GG 공식 저장소 정보를 읽기 전용으로 교차 검토했다. 채택한 개선은 외부 스코프 gate, 아이템 버전 일치, 전체 챔피언 fallback, 로컬 개인정보 삭제 경로다. 아래 검증 결과는 제안이며 아직 실행하지 않았다.

## 로컬 정합성·품질 기준선

- `spec.md`가 새 product SSOT다. 현 README/system contract/implementation status와 모순되면 이 제품 범위를 기준으로 동기화한다.
- **formatter_baseline:** Prettier 3.9.10과 ESLint 9.39.5(devDependency 고정)를 도입했다. `npm run check`가 문법·린트·포맷을 검사한다. `.github/workflows/ci.yml`이 Node 20·22에서 check·test·build·smoke를 실행하며, 원격 저장소 연결 후 동작한다.
- 2026-11-08에 git 저장소를 만들었다(`main`). 포맷 전용 커밋은 `.git-blame-ignore-revs`로 blame에서 제외한다. 원격 저장소·CI는 없다.
- 다음 Phase의 테스트는 구현 작업의 일부로 작성·실행한다. 본 계획 작성 turn에서는 테스트를 실행하지 않았다.

## 우선순위·평가

| 구분 | 범위 |
|---|---|
| Required | 세 페이지 UI, JavaScript 온톨로지 모델, OP.GG 실응답/필터 gate, 응답 정규화·범위 검증, 픽 개인화 유지, 패치별 item 유효성, 추천 평가와 브라우저 사용성/데이터 삭제 |
| Recommended | 의미 관계를 지원 가능한 전체 champion으로 단계적 확장, 패치·티어별 통계 커버리지 화면 |
| Optional / 후속 | 승인된 범위가 확인된 후 실시간 읽기 전용 게임 상태. 이 1차 계획의 완료 조건은 아님 |
| Reject / 1차 비목표 | 자동 픽·밴·구매, 게임 메모리 접근, OP.GG/공식 범위에 없는 과거 티어·패치 결과를 추정·가공해 노출 |

**점수 (5점 만점, 계획상 평가):** Product Fit 5, Evidence Strength 4 (실제 OP.GG schema/응답은 미관측), User Value 5, Implementation Feasibility 4, Regression Safety 4, Strategic Leverage 4, Security Safety 4, Works In Practice 3 (브라우저/외부망 QA 미완). 높은 가치와 높은 provider 불확실성이 공존하므로 1차 gate에서 외부 계약을 먼저 확인한다.

## 단계와 작업

### Phase 0: 외부 계약과 실행 기준선 [P0]

| Task | 내용 | DoD | Depends | Status |
|---|---|---|---|---|
| 0.1 | `[Contract]` `[lane:gate]` `[tdd:skip:external-contract-discovery]` 일반 네트워크 환경에서 OP.GG MCP를 초기화하고 허용 read tool의 `tools/list` 및 대표 `tools/call` 응답을 확보한다. schema, 필수/선택 인자, enum, 반환 JSON, 오류, 도구가 밝히는 patch/region/queue/tier/lane 범위를 fixture와 조회 기록에 저장한다. | 성공한 tools/list와 최소 한 건 성공·실패 조회 fixture, 각 필터별 yes/no/unknown 판정이 있다. 현재 공개 tools/list는 확인했고 두 추천 도구에 tier/position은 일부 지원되나 region/patch는 없다. 표본 조회와 응답 scope fixture가 없어 통계 통합 gate는 미완료다. | - | cc:完了 |
| 0.2 | `[Setup]` `[lane:fast]` `[tdd:skip:tooling-config]` JS lint/formatter baseline 추가. 설정 범위는 기존 코드 일괄 재포맷을 제외하고 변경 파일 검사에 한정한다. | `package.json`에 lint/format 검사 명령이 있고 README 실행 명령과 일치하며, 기준 검사에서 오류 exit code가 0이다. | - | cc:完了 |
| 0.3 | `[QA]` `[lane:gate]` `[tdd:skip:manual-qa]` 일반 로컬 환경에서 현재 데모를 실제 브라우저로 실행해 주요 사용자 흐름과 화면 상태를 기록한다. | 역할 변경, 밴/픽 입력, 후보 선택, 개인화 수정, 빌드 초안, reload 복원, offline/공식 데이터 상태 전환, OP.GG 연결 실패의 실제 UI 결과가 기록돼 있다. 확인 불가 항목은 해결된 것처럼 표시하지 않는다. | - | cc:完了 |
| 0.4 | `[Architecture]` `[lane:fast]` `[tdd:skip:architecture-spike]` 현재 데이터 규모에서 필요한 노드·관계와 조회 연산을 명시하고, JavaScript 메모리 그래프를 기본 저장 모델로 둔다. DB 도입 triggers는 다중 사용자 공유, 서버 이력, catalog 크기/질의 지연 한계로 정의한다. | 구현에 불필요한 DB 서비스·자격 증명·시드 절차가 없다. DB 재검토 조건은 다중 사용자 공유·서버 이력 요구의 발생 또는 catalog 생성/검색 지연이 실제 사용을 저해하는 관측 결과로 기록한다. 목표치와 확인 시점은 실사용 기준선 측정 뒤 확정한다. | 0.2 | cc:完了 |

### Phase 1: 출처가 확인되는 통계 조회 [P1]

| Task | 내용 | DoD | Depends | Status |
|---|---|---|---|---|
| 1.1 | `[Contract]` `[lane:gate]` `[tdd:required]` OP.GG 응답을 내부 `MetaEstimate` 타입으로 정규화한다. requestedScope와 returnedScope를 분리하고 region/queue/role/champion/patch/tier, statistic definition, sample size, source, fetchedAt을 보존한다. | 실응답 fixture로 모든 필드의 매핑이 검증되고, 응답에 없는 스코프는 `unknown`이며 숫자 0이나 사용자 선택값을 복사해 채우지 않는다. | 0.1, 0.2 | cc:完了 |
| 1.2 | `[Feature]` `[lane:gate]` `[tdd:required]` OP.GG UI의 동적 입력·배열 필드·enum 처리를 실제 schema와 일치시킨다. 사용자가 요청한 티어/패치와 provider 반환 범위를 구분해 결과 상단에 표시한다. | 티어·패치가 schema나 응답에서 검증될 때만 그 범위를 주장한다. 지원되지 않거나 응답 범위가 다르면 결과는 비교용으로만 보이고, 지정된 필터를 적용했다고 표시하지 않는다. 배열/선택 조건이 fixture에서 정확한 요청 JSON으로 serialize된다. | 1.1 | cc:完了 |
| 1.3 | `[Guardrail]` `[lane:gate]` `[tdd:required]` OP.GG 업스트림 호출 정책을 확인하고 로컬 proxy의 읽기 도구 allowlist, endpoint 고정, timeout/size cap, 요청 필드 제한을 재검토한다. 첫 외부 조회 전에 전송되는 선택 필드·보존을 UI에 알리고 브라우저에 저장된 데이터의 전체 삭제를 추가한다. | 외부 조회는 사용자의 명시 클릭으로만 실행된다. `tools/call`은 지정된 읽기 도구만 허용하고 path/host override가 거부된다. 개인정보 안내는 저장 항목·OP.GG 전송 항목·목적을 밝히며, 전체 삭제 후 reload에서 로컬 프로필·카탈로그가 복구되지 않는다. | 0.1 | cc:完了 |
| 1.4 | `[Architecture]` `[lane:gate]` `[tdd:required]` `src/graph.js`에 typed node/edge 조립, bounded search, direct-neighbor, patch 검사, 역할·관계 유형 필터, role-specific item candidate 연산을 구현한다. | UI는 자유 형식 쿼리 대신 allowlisted JS 연산만 사용한다. unknown annotation과 missing relation을 구별하고, patch mismatch는 빈 결과로 처리한다. | 0.4, 2.1 | cc:完了 |
| 1.5 | `[Data]` `[lane:gate]` `[tdd:required]` catalog와 편집 profile에서 champion/item/role/trait/patch 노드 및 역할·특성·조합식·template 관계를 생성한다. 모든 주석은 출처와 검토 상태를 보존한다. | 반복 생성에도 중복이 없고 원본 Data Dragon 객체를 변경하지 않는다. 의미 주석이 없는 챔피언은 unknown으로 남으며 item recipe는 현재 catalog 참조 안에서만 연결된다. | 1.4, 2.1 | cc:完了 |
| 1.6 | `[API]` `[lane:gate]` `[tdd:required]` 세 페이지가 공유할 pure-function 계약을 확정한다: ontology search/neighborhood, manual draft recommendation, champion/role item candidates. | UI가 graph structure에 직접 의존하지 않고 typed 결과를 사용한다. 결과에 patch, evidence, review status, 제한사항이 포함된다. | 1.4, 1.5 | cc:完了 |

### Phase 2: 패치 일치 온톨로지와 아이템 초안 [P1]

| Task | 내용 | DoD | Depends | Status |
|---|---|---|---|---|
| 2.1 | `[Data]` `[lane:gate]` `[tdd:required]` KR Data Dragon realm의 champion/item 버전 ID를 독립 추적하고, 백엔드 JSON 스냅샷을 시작 시·6시간마다 점검한다. 응답 버전·최소 카탈로그 크기를 검증한 뒤 원자 저장하고 챔피언 스킬 상세는 요청 시 패치별 저장한다. | champion/item 데이터는 각각 realm 버전과 일치한다. 두 버전 중 하나만 바뀌어도 해당 카탈로그만 갱신한다. champion 버전 변경 시 기존 스킬 캐시를 무효화하고 사용 시 지연 로드한다. 새 카탈로그 실패는 마지막 정상 스냅샷을 보존한다. | 0.3, 0.2 | cc:完了 |
| 2.2 | `[Ontology]` `[lane:gate]` `[tdd:required]` 고정 44명 프로필에 부족한 후보를 식별하고 역할·피해·효과 관계를 출처와 검토 상태가 있는 champion 데이터로 확장한다. 의미 주석이 없는 챔피언은 자동 사실 추론 없이 선택 가능하되 coverage 제한을 설명한다. | 불러온 모든 챔피언은 수동 검색·선택·제외 처리 가능하다. 추천 후보는 검토된 역할 근거가 있거나 `데이터 부족` 배지를 보이며, 미주석 champion이 효과 없음으로 간주되지 않는다. | 2.1 | cc:blocked (의미 주석 확장은 사람 검토 필요. 미주석 풀 챔피언의 `데이터 부족` 표시는 완료) |
| 2.3 | `[Feature]` `[lane:gate]` `[tdd:required]` 유형별 예시 build와 OP.GG champion analysis build를 나란히 비교하고, 통계 build를 item ontology의 구매·패치 제약으로 검증하는 어댑터를 만든다. 개인 숙련도 및 조합 상황은 기존 초안에 근거별로 표시한다. | output이 같은 검증 Data Dragon patch를 참조하고, 표시한 모든 item이 해당 patch에서 존재하고 SR 구매 가능·조건 충족이다. provider build scope나 item map이 모호한 제안은 제외 또는 검증 미완료로 표시한다. 추천 이유는 예시 템플릿과 통계 출처를 분리해 보여준다. | 1.1, 2.1 | cc:完了 |
| 2.4 | `[UI]` `[lane:gate]` `[tdd:required]` 온톨로지 페이지를 구현한다: champion/item 검색과 필터, 선택 노드의 직접 관계 및 근거/출처/patch 표시. | champion과 item을 검색해 관계를 확인할 수 있다. 빈 결과·미주석 데이터·오류 상태가 구분된다. 조회 결과는 현재 catalog patch와 출처를 보여준다. | 1.6, 2.1, 2.2 | cc:完了 |
| 2.5 | `[UI]` `[lane:gate]` `[tdd:required]` 밴픽 페이지를 구현한다: 사용자 역할, 수동 밴과 양 팀 픽 입력, 다음 선택 슬롯, champion pool/선호/숙련도, 조합 및 검증된 메타 추천. | 이미 밴/픽된 챔피언은 추천에서 제외된다. 사용자가 직접 픽을 반영/수정할 수 있고, 후보별 개인·조합·통계 기여와 데이터 부족 상태가 설명된다. 새로고침 및 초기화 동작이 명확하다. | 1.6, 2.2, 3.1 | cc:blocked (3.1 대기. 통계 기여 표시 외 밴픽 흐름은 `npm run qa`로 확인) |
| 2.6 | `[UI]` `[lane:gate]` `[tdd:required]` 아이템 페이지를 구현한다: 챔피언·patch·draft 조건을 받아 완성 아이템 초안, 조합 경로, 상황별 대안과 근거를 제공한다. | 모든 제안은 동일한 검증 patch와 구매 제약을 만족한다. 근거 없는 최적/승률 주장을 하지 않고, 데이터 부족·상황 의존 항목을 구별한다. 밴픽에서 선택한 챔피언으로 이동할 수 있다. | 1.6, 2.3 | cc:完了 |
| 2.7 | `[UX]` `[lane:gate]` `[tdd:required]` 세 페이지 공통 내비게이션과 상태 표시를 통합한다. patch/catalog 상태, 사용자의 조회 설정, 프로필 편집/삭제 경로를 일관되게 제공한다. | 세 페이지 간 이동 시 patch와 프로필 조건이 일관된다. 각 화면에서 로딩·오류·데이터 없음 상태와 다음 행동이 보이며, 프로필 전체 삭제가 확인된다. | 2.4, 2.5, 2.6 | cc:完了 |

### Phase 3: 메타 통계를 조합 추천에 반영 [P2, external scope gate]

| Task | 내용 | DoD | Depends | Status |
|---|---|---|---|---|
| 3.1 | `[Feature]` `[lane:gate]` `[tdd:required]` provider가 실제 돌려주는 KR, SR solo/duo, 선택 tier cohort, 역할, 패치의 champion stats를 기존 개인화·조합 점수에 결합한다. 사용자 숙련/선호와 메타 빈도를 분리하고 표본 불확실성 가중 방식을 고정한다. | 모든 통계 기여에 champion·patch·region·queue·tier cohort·role·source·fetchedAt·sample/confidence가 연결된다. 요청/응답 스코프 중 unknown·stale·mismatch인 통계는 숫자 0으로 대체하지 않고 랭킹에서 제외하며, 조합·개인 점수만으로 앱이 동작한다. | 1.2, 2.2 | cc:blocked (OP.GG 응답이 지역·패치 반환 범위를 밝히지 않아 `rankingGate`가 열리지 않는다. 정규화·gate·차단 사유 표시는 완료. 2.2 사람 검토도 필요) |
| 3.2 | `[Eval]` `[lane:gate]` `[tdd:required]` 기준선 추천과 개인화/조합/OP.GG meta contribution을 분리하는 ablation을 고정 evaluation fixture로 비교한다. 시점 또는 패치 holdout과 데이터 누수 점검을 수행한다. | 고정 예제와 patch-separated fixture에서 불가능한 픽/밴·잘못된 아이템 0건. Recall@K/NDCG, coverage, 설명 근거 일치, uncertainty, 누락 fallback을 기준선과 함께 보고한다. 승률 개선은 수치와 독립 표본 근거가 확인되기 전 제품 문구로 사용하지 않는다. | 3.1 | cc:blocked (실제 선택 레이블이 없어 Recall@K·NDCG 미산출, 메타 기여는 3.1 대기. 두 패치 고정·생성 212개 시나리오 제약 위반 0건과 근거 그룹 ablation은 `npm run evaluate`로 완료) |

### Phase 4: 1차 사용성 완료 [P2]

| Task | 내용 | DoD | Depends | Status |
|---|---|---|---|---|
| 4.1 | `[QA/UX]` `[lane:gate]` `[tdd:required]` ontology → manual ban-pick → selected champion item draft의 세 페이지 사용자 여정을 연결하고 브라우저에서 검증한다. | 실제 브라우저에서 ontology search/relationship view, 수동 밴픽과 개인화, item draft 이동, patch/evidence 표시, reload/clear, offline catalog fallback이 확인된다. 각 페이지 빈/오류 상태에서 회복 경로가 보인다. | 0.3, 2.7, 3.1 | cc:完了 |
| 4.2 | `[QA]` `[lane:gate]` `[tdd:required]` 그래프 객체 조립, 노드 유형 필터, edge provenance, patch guard, result cap을 fixture로 검증한다. | invalid entity type, patch mismatch, unknown annotation, missing recipe relation, excessive search limit가 테스트된다. | 1.4, 1.6, 4.1 | cc:完了 |

### Phase 5: 공개 준비 [P3, 1차 동작과 분리]

| Task | 내용 | DoD | Depends | Status |
|---|---|---|---|---|
| 5.1 | `[Release]` `[lane:release]` `[tdd:skip:release-prep]` Riot 등록 및 현재 제품/외부 데이터 활용 정책·UI를 확인하고, 승인된 공개 경로와 고지문·개인정보 문서를 준비한다. | policy/제품 등록 및 외부 데이터 고지 상태를 기록한다. 승인되지 않은 공개/배포 경로는 릴리스되지 않는다. | 4.1, 4.2 | cc:blocked (Riot 제품 등록·정책 확인과 공개 범위는 사람 결정 필요) |

### Phase 6: 2026-11-08 점검에서 도출한 개선 [P1–P3]

| Task | 내용 | DoD | Depends | Status |
|---|---|---|---|---|
| 6.1 | `[Ontology]` `[lane:gate]` `[tdd:required]` 추천이 온톨로지를 실제로 사용하게 한다. 지금 `engine.js`는 `graph.js`를 import하지 않고 회복 감소·관통 등 대응 규칙을 if문으로 하드코딩한다. `Effect` 노드와 `APPLIES_EFFECT`/`MITIGATES` 관계를 두고 아이템 대안을 그래프 탐색으로 도출한다. | 상대 회복 성향→회복 감소 대안 등 기존 대응 규칙이 그래프 경로로 재현되고, 카드의 근거가 사용한 관계 경로를 표시한다. 기존 엔진 테스트 결과가 유지된다. | 1.4 | cc:完了 |
| 6.2 | `[Feature]` `[lane:fast]` `[tdd:required]` 챔피언 풀 항목별 플레이 역할을 개인 설정에 추가한다. 현재 풀은 역할 구분이 없어 미주석 풀 챔피언이 모든 역할의 후보로 나온다. | 사용자가 지정한 역할에서만 미주석 풀 챔피언이 후보가 되고, 미지정이면 현재처럼 확인 문구와 함께 표시한다. | 2.2 | cc:完了 |
| 6.3 | `[Privacy]` `[lane:fast]` `[tdd:required]` 로컬 저장 데이터(밴픽 상태·개인 설정·카탈로그 캐시) 전체 삭제 버튼과 저장 항목 안내를 추가한다. 스펙이 요구하지만 `localStorage` 삭제 경로가 없다. | 삭제 확인 후 reload 시 개인 설정이 복구되지 않는다. 1.3·2.7의 삭제 DoD를 충족한다. | - | cc:完了 |
| 6.4 | `[Refactor]` `[lane:fast]` `[tdd:skip:refactor-with-smoke]` `app.js`(약 700줄, 200자 넘는 템플릿 줄 31개)를 페이지별 렌더 모듈로 나누고 HTML 템플릿을 작은 함수로 분해한다. | 페이지별 모듈로 분리되고 `npm run smoke`와 서버 모드 브라우저 확인이 통과한다. 번들러가 새 모듈을 자동 포함한다. | 0.2 | cc:完了 |
| 6.5 | `[Fix]` `[lane:fast]` `[tdd:required]` API 오류 처리. `localhost`로 접속하면 API가 텍스트 `Forbidden`을 반환하고 브라우저가 JSON 파싱 오류를 보인다. Host 허용에 `localhost`를 추가하거나 JSON 오류를 반환하고, 클라이언트는 비JSON 응답을 읽을 수 있는 메시지로 바꾼다. 새로고침 버튼이 클릭 이벤트를 옵션 객체로 넘기는 우연한 동작도 정리한다. | `localhost`와 `127.0.0.1` 모두 의도한 동작을 하고, 403·비JSON 응답이 원인을 설명하는 메시지로 표시된다. | - | cc:完了 |
| 6.6 | `[QA]` `[lane:fast]` `[tdd:required]` `serve.mjs` 라우팅 테스트(경로 탈출·dotfile·Host/Origin 403·본문 크기 제한)와 템플릿 아이템 ID의 현재 패치 존재 검사(`npm run validate-data`)를 추가한다. | 서버 보안 규칙이 테스트로 고정되고, 패치 변경 시 사라진 템플릿 아이템을 명령 하나로 확인한다. | - | cc:完了 |
| 6.7 | `[Setup]` `[lane:fast]` `[tdd:skip:tooling-config]` ESLint와 CI(test·check·build·smoke)를 추가하고 원격 저장소를 연결한다. | PR마다 네 검사가 자동 실행된다. | 0.2 | cc:blocked (원격 저장소 연결은 사용자 결정 필요. ESLint와 `.github/workflows/ci.yml`은 완료, 로컬에서 깨끗한 설치로 같은 단계 통과) |
| 6.8 | `[UX]` `[lane:fast]` `[tdd:skip:ui-polish]` 온톨로지 패치 필터를 자유 입력 대신 로드된 버전 선택으로 바꾸고, 예제 카탈로그의 낡은 아이템 이름(6655 루덴의 동반자→루덴의 메아리)을 고친다. | 존재하지 않는 패치를 입력해 빈 결과를 보는 경로가 없다. | - | cc:完了 |

## 결합 전 release gates

1. `npm run check`, `npm test`, `npm run build` 통과.
2. catalog patch 일치와 JavaScript graph 생성/검색/관계 검증 통과.
3. 세 페이지가 동일한 typed JavaScript graph contract를 사용하고, 사용자가 임의 graph query를 제출할 수 없음.
4. 일반 브라우저에서 ontology → full manual flow → item draft와 reload/data-clear/retry/offline QA pass.
5. OP.GG 실제 호출 fixture로 필터·반환 스코프와 sample/definitions 확인. 원격 통계의 잘못된 범위가 추천으로 흘러가는 경로가 없음.
6. 지원하는 현재 patch/tier/region/queue/lane 선택지만 사용자에게 약속. 과거 patch는 검증된 경우에만 제공.
7. baseline 대비 추천/coverage 설명 보고 완료. 품질 개선은 evaluation 증거가 있어야 주장.

## 위험과 대응

| 위험 | 계획상 조치 |
|---|---|
| OP.GG MCP 스키마·인자·응답이나 접근 권한이 문서와 다름 | Phase 0 tool schema/대표 응답 실측 gate. 실패하면 `unknown`으로 표시하고 추측 schema·scraping을 쓰지 않음. 수동/로컬 추천은 계속 사용 가능. |
| 인메모리 catalog가 커져 검색·생성 성능이나 다중 사용자 상태가 한계에 도달 | catalog build와 query latency를 측정하고, shared data/history 요구가 현실화될 때 DB 도입 gate를 연다. |
| 서버가 티어·패치·queue 중 일부를 필터링하지 않음 | 해당 cohort를 정확한 것처럼 표시/점수반영하지 않음. 지원 범위를 제품에서 명시하고 alternative provider 조사만 별도 spike. |
| OP.GG patch 표기와 Data Dragon 버전, champion/item ID 간 mapping 오류 | 명시 버전 alias + fixture; mismatched version의 item/stat merge 차단. |
| champion 주석 또는 일반 빌드 템플릿이 실제 패치와 안 맞음 | 주석별 provenance/review status, patch item validation, 부족 데이터 표시, 모델 우세/최적 주장 보류. |
| 로컬 저장과 외부 전송이 사용자 기대와 다름 | 저장 범위·목적지·전송값 알림, 전체 삭제, 원시 personal setting을 외부 query에 포함하지 않음. |
| 사람 점수와 메타 통계가 중복되거나 조합 편향을 줌 | personal/context/meta factor 구분, fixed ablation, low sample/unknown 결과 제외. |

## 사전 확인

- 사항: OP.GG MCP에 읽기 전용 tools/list 및 승인된 champion analysis/lane meta 조회를 네트워크로 요청한다.
  이유: provider의 실제 필터, 응답 스키마, scope를 알아야 tier/patch 기반 추천의 안전한 구현 여부를 결정할 수 있다.
  scope: Phase 0 / Task 0.1, 1.1, 1.2, 1.3
- 사항: 테스트·평가 fixture 작성 및 일반 로컬 `npm start` 브라우저 QA를 실행한다.
  이유: 추천 변경과 화면 완료 기준을 재현하고 offline/manual fallback을 확인해야 한다.
  scope: Phase 0 / Task 0.2, 0.3, Phase 1–4
- 사항: Data Dragon 정적 데이터를 브라우저가 불러오고 버전 정보를 저장한다.
  이유: champion/item id·구매 제약과 패치 경로를 확인한다.
  scope: Phase 2 / Task 2.1–2.3
- 사항: OP.GG로 사용자가 선택한 조회 region/tier/patch/role/champion 조건을 전송할 수 있다.
  이유: 데이터 제공자가 해당 요청을 필터링하는지 확인하고 조회 범위에 맞는 비교 자료를 보여준다.
  scope: Phase 1 / Task 1.2–1.3; 각 조회는 UI에서 사용자의 직접 제출이 있을 때만 실행

위 네트워크 조회 범위는 사용자가 요청한 OP.GG 이용과 Data Dragon 활용에 포함된다. Riot 계정 정보, 인증 키, 개인 플레이어 match history 업로드는 이번 계획에서 요청하지 않는다.

## 실행 시작 안내

현재 남은 작업은 서로 연결된 외부 계약 검증과 product implementation이다.

- 새 작업 세션을 시작할 명령: `claude`
- 시작 후 입력: `/harness-work all`
- 적합한 이유: Phase 0–4는 OP.GG fixture/schema gate에서 patch validation·평가까지 순서대로 이어진다.

## 계획 품질 점검 기록

- 최신 외부 정보: Riot 공식 LoL API/정책 문서와 OP.GG 공식 저장소/README를 2026-10-08 기준 확인. 실제 OP.GG endpoint 접근은 환경 DNS 제한으로 확인 못 함.
- 프로젝트 기억: `.codex` 문서 인벤토리에서 이전 Rift Draft 판단 검색 결과는 관측되지 않음. 사용자 session의 research/status/docs가 기준.
- Product: 수동 밴픽과 희망 티어별 next-pick/item draft가 확정 목표, 자동 밴 추천은 포함하지 않음.
- Architecture: JavaScript graph contract; DB 도입은 측정된 scale/shared-state 요구가 생긴 경우로 연기.
- Security: 최소 read allowlist, fixed host, user-click query, 로컬 data notice/clear.
- QA/Skeptic: 실 browser / live OP.GG 미관측을 completed로 승격하지 않고 instrument/fixture 검증 뒤 통합.
