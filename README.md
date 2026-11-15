# Rift Draft

수동 밴·픽과 개인 선호도·숙련도로 픽 후보를 비교하고, 선택한 챔피언과 상대 조합으로 아이템 초안을 만드는 로컬 웹 프로토타입.

## 실행

Node.js 20.11 이상. 실행에는 외부 npm 의존성이나 데이터베이스가 필요 없다. 린트·포맷 같은 개발 도구(ESLint, Prettier)만 `npm install`로 설치한다. `.github/workflows/ci.yml`은 원격 저장소에 올리면 PR·push마다 검사·테스트·빌드·smoke를 실행한다.

```sh
npm start
```

브라우저에서 `http://127.0.0.1:4173`을 연다. 로컬 서버만 수신한다. 공식 Data Dragon 동기화와 OP.GG 조회는 이 서버가 담당한다.

## 웹 데모 (GitHub Pages)

`npm run build:pages`는 서버 없이 볼 수 있는 데모를 `site/`에 만든다. `site/`는 단일 HTML과, 빌드할 때 받은 Data Dragon 카탈로그(`game-data.json`)로 이루어진다.

| 기능 | 웹 데모 |
|---|---|
| 밴픽 추천·아이템 초안·온톨로지 그래프 | 동작 (배포 시점 공식 카탈로그) |
| 챔피언 스킬 | 브라우저가 Data Dragon에서 직접 받음 |
| OP.GG 통계 조회 | 꺼짐. 서버 프록시가 필요하므로 `npm start`로만 사용 |

`.github/workflows/pages.yml`이 다음 시점에 다시 빌드·배포한다:
- `main`에 push할 때
- 매주 월요일 (새 패치 반영)
- 수동 실행할 때

처음 한 번은 저장소 Settings → Pages → Source를 **GitHub Actions**로 바꿔야 한다. 무료 계정에서는 공개 저장소에서만 Pages를 쓸 수 있다. `npm run smoke:site`는 `site/`를 정적 HTTP로 열어 데모 모드를 확인한다.

### 고지와 정책

공개 데모를 위해 화면 푸터에 다음 고지를 넣었다.
- Riot Games 표준 비보증 문구 (영문 원문과 한글 번역)
- 비상업 팬 프로젝트이며 광고·결제가 없다는 안내
- 추천은 참고용 초안이며 결과를 보장하지 않는다는 안내
- 계정·소환사 정보를 받지 않고, 입력은 브라우저에만 저장된다는 안내
- 데이터 출처(Riot Data Dragon, © Riot Games)
- OP.GG와 제휴 관계가 없다는 안내

Riot API 키는 쓰지 않으며, Data Dragon은 키 없이 공개된 정적 데이터다. 소환사 조회 도구는 개인정보 때문에 허용 목록에서 뺐다. 유료화·광고를 붙이거나 Riot API를 쓰려면 Riot 개발자 포털 제품 등록과 정책 재확인이 먼저다.

## JavaScript 온톨로지

온톨로지는 `src/graph.js`에서 현재 Data Dragon 카탈로그와 검토 상태가 기록된 편집 프로필을 노드·관계로 조립한다. 검색과 관계 탐색, 아이템 빌드 후보 조회는 모두 브라우저의 JavaScript에서 처리한다. 고정된 소규모 카탈로그와 개인 밴픽에는 DB 서버·자격 증명·시드 절차가 필요 없다.

전체 champion/item 데이터는 로컬 백엔드가 KR realm을 확인해 자동으로 갱신하고 `.cache/riot-data.json`에 저장한다. Champion과 Item Data Dragon 버전 ID는 따로 추적하며, 서버 시작 때와 6시간 간격으로 버전을 확인한다. 브라우저는 실행 시 백엔드의 마지막 정상 스냅샷을 읽고, 버튼을 누르면 서버가 즉시 Riot 버전을 확인한다. 챔피언 스킬은 champion 버전으로 관리하고, 브라우저나 백엔드에 캐시되지 않은 챔피언을 열 때만 상세 데이터를 요청한다. 패치가 바뀌면 백엔드가 이전 스킬 캐시를 폐기하고 새 버전의 스킬을 필요 시 다시 가져온다. 오프라인에서는 마지막 브라우저 저장본 또는 예제 데이터로 동작한다. OP.GG 조회도 로컬 서버 proxy를 사용한다.

추후 데이터량, 다중 사용자 공유, 서버 측 이력·통계 질의가 커지면 동일한 노드/관계 계약을 그래프 DB로 옮길 수 있다. 지금은 Neo4j를 선택하지 않는다.

서버 없이 화면을 여는 방법:

```sh
npm run build
open dist/index.html
```

`dist/index.html`은 서버 없이 실행하는 수동 추천용 단일 파일이며, 백엔드 기반 최신 공식 데이터와 OP.GG 조회는 `npm start`가 필요하다. 네트워크가 없으면 외부 글꼴·공식 데이터·아이콘 대신 기본 글꼴과 예제 또는 마지막 브라우저 저장 데이터로 동작한다.

## 사용 흐름

1. 내 역할을 선택하고 아군·상대 픽, 밴한 챔피언을 입력한다.
2. **내 챔피언 풀 · 편집**에서 플레이할 챔피언을 추가하고 선호도·숙련도·플레이 역할을 개별 설정한다. 플레이 역할을 지정하면 그 챔피언은 지정한 역할에서만 후보가 된다.
3. 선호도는 보통/선호/최선호, 숙련도는 미입력/연습 중/기본 가능/익숙함/주력으로 구분한다. 숙련도는 자가평가이며 Riot mastery 점수로 위장하지 않는다.
4. 후보의 근거와 한계를 확인한 뒤 **이 픽 선택**을 누른다. 앱의 내 역할 슬롯에 반영되며 게임 클라이언트를 조작하지 않는다.
5. 시작·신발·코어 후보와 상대 회복/피해 성향에 따른 교체 후보를 비교한다.
6. 백엔드는 KR realm의 챔피언·아이템 버전을 따로 확인하고 최신 카탈로그를 저장한다. 화면의 **최신 데이터 새로고침**은 백엔드에 즉시 확인을 요청한다. 현재 적용된 두 버전과 마지막 저장 시각을 화면에서 확인한다.

초기화는 밴·픽만 지우며 챔피언 풀·선호도·숙련도·조회 조건은 유지한다. **예시 조합**은 시연을 위해 예시 챔피언 풀과 자가평가도 함께 채운다.

## 추천 범위

- 의미 프로필: 44개 챔피언(현재 카탈로그 173명). 의미 주석이 없는 챔피언은 사용자가 내 챔피언 풀에 넣었을 때만 `데이터 부족` 후보로 표시한다. 이때 역할 가산점과 조합 규칙은 적용하지 않고 풀·선호도·숙련도만 반영하며, 해당 역할에서 플레이하는 챔피언인지 사용자가 확인해야 한다. 아이템 초안은 포지션·Data Dragon 태그 기반 일반 템플릿으로 제한해 표시한다.
- 온톨로지 페이지는 전체 Champion/Item catalog를 검색하고 패치, 역할, 관계 유형으로 필터링한다. 역할·효과 같은 의미 관계는 현재 프로토타입 44개 프로필 범위만 표시한다. OP.GG 통계는 아직 온톨로지나 추천 점수에 반영하지 않는다.
- 픽 점수 = 역할 기본값 + 챔피언 풀 + 선호도 + 자가평가 숙련도 + 조합 보완 규칙. 승률이나 학습된 가치 함수가 아니다.
- 골드·아이템·경기 상태의 실시간 수집은 없다.
- 기본 아이템 초안은 유형별 예제 템플릿이다. OP.GG 챔피언 분석을 수동 조회하면 응답된 아이템 조합·픽률·표본 수를 별도 표시하고, 아이템 ID는 현재 Data Dragon 패치에서 구매 가능한지 확인한다. OP.GG 응답은 통계 패치를 검증하지 않으므로 챔피언별 최신 최적 빌드로 주장하지 않는다.
- 공식 모드에서는 소환사의 협곡 사용 여부·구매 가능·상점 노출·챔피언 조건으로 후보를 제한한다. 예제 모드의 아이템은 최신 가격·효과·합법성 미검증으로 표시한다.
- 상황별 대안 아이템은 온톨로지 경로(상대 챔피언의 효과 → 그 효과를 상쇄하는 효과 → 아이템)를 따라 고르고, 카드에 사용한 경로를 표시한다. 효과·상쇄 관계는 검토 전 편집 주석이다.
- 정글 시작 아이템은 동료 선택을 임의 확정하지 않고 생략한다. 대안 목록은 기존 코어에 모두 추가하라는 지시가 아니다.

## OP.GG MCP

사용자가 제안한 [OP.GG MCP](https://op.gg/open-source/opgg-mcp)의 [공식 저장소](https://github.com/opgginc/opgg-mcp)가 공개한 Streamable HTTP 엔드포인트 `https://mcp-api.op.gg/mcp`를 사용하도록 연결 코드를 구현했다.

현재 구현:

- MCP initialize → initialized notification → tools/list → tools/call.
- 읽기 도구 `lol_get_champion_analysis`, `lol_list_lane_meta_champions`만 허용.
- 연결 시 실제 input schema를 읽고 서버가 지원하는 필드·enum으로 조회 UI 생성.
- 내 티어와 `EMERALD_PLUS` 같은 통계 범위를 자동으로 동일시하지 않음.
- 희망 패치·티어를 지원하지 않는 도구에는 해당 조건을 무시하고 호출하지 않음.
- 요청 조건·조회 시각·응답을 함께 표시. 텍스트 응답은 실행하지 않고 이스케이프하여 표시.
- 응답의 `class Data:` 필드 선언으로 아이템 그룹 이름을 붙인다. 선언이 없으면 추측하지 않고 미표시한다.
- OP.GG champion analysis의 item build 응답은 별도 통계 영역에 표시한다. 픽 추천 점수와 편집 템플릿에 합산하지 않는다.

실행 환경에서 OP.GG 공식 MCP endpoint의 공개 read-only `initialize`, `tools/list`, `lol_get_champion_analysis`를 확인했다. 아이템 build 경로와 class-style 응답을 fixture로 고정하고 adapter를 구현했다. 사용자가 `desired_output_fields`를 별도로 지정하지 않아도 관측된 아이템 빌드 필드를 기본 요청한다. 로컬 서버 proxy에서의 실조회 UI 검증과 OP.GG 응답의 실제 통계 patch/region 범위 확인은 남아 있다. 자세한 계약은 [OP.GG item build contract](docs/opgg-item-build-contract.md)에 기록했다.

후속 연결 검증 시 반드시 확인할 것: 도구 스키마 저장, 요청·응답의 patch/region/tier/role 범위 일치, 통계 단위·표본 수, 챔피언 숫자 ID 매핑, 빌드 아이템 ID와 Data Dragon 버전 일치. 웹사이트의 패치 필터 존재만으로 MCP의 과거 패치 지원을 가정하지 않는다.

## 검증

```sh
npm install      # 개발 도구(Prettier) 설치, 최초 1회
npm test         # 단위·계약 테스트
npm run check    # 모든 JS 문법 검사 + ESLint + Prettier 포맷 검사
npm run format   # Prettier 적용
npm run smoke    # dist 빌드 후 headless Chrome에서 콘솔 오류·첫 화면 렌더링 확인
npm run qa       # 로컬 서버 + headless Chrome으로 사용자 흐름 17개 검사 (Node 22+, OP.GG 장애 시 SKIP)
npm run validate-data  # 저장된 패치 데이터에서 템플릿 아이템·프로필 유효성 검사
npm run evaluate       # 두 패치·212개 시나리오 제약 위반·ablation 평가 (docs/evaluation-report.md)
```

추천 제약·개인화·조합 반응·아이템 적합성·그래프 인덱스와 이웃 상한·MCP 허용 도구·입력 검증·JSON/SSE 처리·단일 HTML 번들 계약 테스트 포함. 실제 밸런스 품질이나 승률 개선을 검증한 테스트가 아니다. `npm run smoke`는 Chrome이 필요하며 `CHROME_PATH`로 경로를 지정할 수 있다.

`npm run qa`는 역할 변경, 밴·픽 입력과 중복 방지, 추천 제외, 숙련도 반영, 픽→아이템 이동, 새로고침 복원, 초기화, OP.GG 연결 실패, 백엔드 실패 시 캐시 유지, 저장 데이터 삭제, 온톨로지 빈 결과·미주석·패치 불일치 상태를 실제 Chrome에서 검사한다. 공식 데이터 단계는 인터넷 연결이 필요하다.

서버는 `127.0.0.1`·`localhost` Host와 같은 Origin의 API 요청만 허용한다. OP.GG 프록시는 분당 20회로 제한한다.

## 구조

```text
src/ontology.js            편집한 챔피언 역할·효과 관계
src/engine.js              후보 제약, 개인화·조합 점수, 빌드 초안
src/templates.js           역할·피해 유형별 아이템 템플릿과 구매 가능 판정
src/build-compare.js       템플릿과 OP.GG 통계 빌드 비교
src/catalog.js             Data Dragon 로더와 명시적 예제 데이터
src/graph.js               JavaScript 온톨로지 객체(인접 인덱스)와 검색·이웃·아이템 관계 조회
src/opgg-ui.js             OP.GG 필터 분류·응답 표시 보조
src/opgg-build.js          OP.GG 아이템 빌드 응답 파서·현재 패치 구매 검증
src/app.js                 진입점: 세션 복원, 화면 연결, 데이터 새로고침·삭제
src/app-state.js           화면 공유 상태·브라우저 저장소·DOM 헬퍼
src/view-ontology.js       온톨로지 페이지(검색 카드·관계 그래프)
src/view-draft.js          밴픽 페이지·챔피언 선택·개인 설정
src/view-items.js          아이템 페이지(템플릿·통계 빌드·비교·그래프 후보)
src/view-opgg.js           OP.GG 연결·조회 양식
src/view-nav.js            페이지 전환
src/view-data.js           데이터 상태 표시줄
scripts/serve.mjs          로컬 정적 서버·Data Dragon API·고정 OP.GG 프록시
scripts/data-dragon-store.mjs  Data Dragon 스냅샷 동기화·원자 저장·스킬 지연 캐시
scripts/opgg.mjs           읽기 전용 MCP 전송·인자 검증
scripts/build.mjs          app.js의 import 그래프를 따라 단일 HTML 번들 생성
scripts/check.mjs          전체 JS 문법 검사
scripts/smoke-dist.mjs     headless Chrome dist smoke 검사
scripts/qa-browser.mjs     headless Chrome 사용자 흐름 QA
scripts/validate-data.mjs  패치별 편집 데이터 유효성 검사
scripts/evaluate.mjs       추천 제약·패치 분리·근거 ablation 평가
src/opgg-text.js           OP.GG class-style 응답 선언 기반 파서
src/meta-estimate.js       OP.GG 통계 MetaEstimate 정규화·추천 반영 gate
src/opgg-view.js           OP.GG 범위 표·메타 표 렌더링
tests/                     오프라인 기능·전송·번들 계약 테스트
tests/fixtures/opgg/       2026-11-08 OP.GG MCP 실응답 fixture
tests/fixtures/ddragon/    평가용 16.20.1·16.22.1 축약 카탈로그
tests/fixtures/eval/       고정 평가 시나리오
docs/                      조사, 시스템 계약, 검증 기록
Plans.md                   구현 작업·의존성·완료 기준
```
