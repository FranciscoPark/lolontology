// 고정 시나리오로 추천 제약·패치 분리·설명 근거·근거 그룹 ablation을 평가한다.
// 실제 경기 선택 레이블이 없으므로 Recall@K·NDCG와 메타 통계 기여는 산출하지 않고 그 사유를 보고한다.
// 사용: npm run evaluate            (요약 출력)
//       npm run evaluate -- --write (docs/evaluation-report.md 갱신)
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PROFILES, ROLES} from '../src/ontology.js';
import {assign, buildDraft, emptyState, normalizeState, recommendPicks} from '../src/engine.js';
import {isPurchasable} from '../src/templates.js';
import {createOntology} from '../src/graph.js';

const root = resolve(import.meta.dirname, '..');
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
export const EVAL_PATCHES = ['16.20.1', '16.22.1'];
export const ABLATIONS = {
  '전체 근거': [],
  '개인 입력 제외': ['personal'],
  '조합 규칙 제외': ['composition'],
  '맞라인 규칙 제외': ['matchup'],
  역할만: ['personal', 'composition', 'matchup'],
};

export function loadCatalog(version) {
  return readJson(`tests/fixtures/ddragon/catalog-${version}.json`);
}

// 시드 고정 생성 시나리오: 프로필 챔피언만으로 역할·픽·밴·풀을 무작위 배치한다.
export function generatedScenarios(count = 200, seed = 20261108) {
  let value = seed;
  const random = () => (value = (value * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ids = Object.keys(PROFILES);
  const take = list => list.splice(Math.floor(random() * list.length), 1)[0];
  return Array.from({length: count}, (_, index) => {
    const remaining = [...ids],
      role = ROLES[Math.floor(random() * ROLES.length)];
    const scenario = {id: `generated-${index + 1}`, role, allies: [], enemies: [], bans: [], pool: [], personal: {}};
    for (let slot = 0; slot < 5; slot++) {
      if (ROLES[slot] !== role && random() < 0.6) scenario.allies[slot] = take(remaining);
      if (random() < 0.7) scenario.enemies[slot] = take(remaining);
    }
    for (let slot = 0; slot < 6; slot++) if (random() < 0.5) scenario.bans[slot] = take(remaining);
    for (let i = 0; i < 4; i++) {
      const id = take(remaining);
      scenario.pool.push(id);
      scenario.personal[id] = {preference: Math.floor(random() * 3), mastery: Math.floor(random() * 5) - 1};
      if (scenario.personal[id].mastery < 0) scenario.personal[id].mastery = null;
    }
    return scenario;
  });
}

function stateFor(scenario, catalog) {
  const state = normalizeState({...emptyState(), ...scenario}, catalog);
  return scenario.own ? assign(state, 'allies', ROLES.indexOf(state.role), scenario.own, catalog) : state;
}

export function pickViolations(state, picks, catalog) {
  const problems = [];
  const own = ROLES.indexOf(state.role),
    taken = new Set([...state.allies.filter((_, i) => i !== own), ...state.enemies, ...state.bans].filter(Boolean));
  for (const pick of picks) {
    if (taken.has(pick.id)) problems.push(`이미 픽·밴된 ${pick.id}`);
    if (!catalog.champions.some(champion => champion.id === pick.id)) problems.push(`카탈로그에 없는 ${pick.id}`);
    const userRoles = state.pool.includes(pick.id) ? state.personal[pick.id]?.roles || [] : [];
    if (userRoles.length && !userRoles.includes(state.role)) problems.push(`지정 역할 밖 ${pick.id}`);
    if (PROFILES[pick.id] && !PROFILES[pick.id].roles.includes(state.role)) problems.push(`역할 밖 ${pick.id}`);
    if (!PROFILES[pick.id] && !state.pool.includes(pick.id)) problems.push(`풀 밖 미주석 ${pick.id}`);
    if (state.poolOnly && !state.pool.includes(pick.id)) problems.push(`풀 제한 위반 ${pick.id}`);
    if (pick.score !== pick.reasons.reduce((sum, reason) => sum + reason.points, 0))
      problems.push(`점수와 근거 합 불일치 ${pick.id}`);
  }
  return problems;
}

export function itemViolations(draft, catalog, graph) {
  if (draft.status !== 'ready') return [];
  const problems = [],
    itemVersion = catalog.itemVersion;
  const items = [draft.start, draft.boots, ...draft.core, ...draft.alternatives].filter(Boolean);
  for (const item of items) {
    if (!catalog.items[item.id]) problems.push(`패치 ${itemVersion}에 없는 아이템 ${item.id}`);
    else if (!isPurchasable(catalog.items[item.id], draft.championId)) problems.push(`구매 불가 아이템 ${item.id}`);
    if (item.version && item.version !== itemVersion) problems.push(`다른 패치 아이템 ${item.id}@${item.version}`);
  }
  if (draft.itemVersion !== itemVersion) problems.push(`초안 패치 ${draft.itemVersion} ≠ ${itemVersion}`);
  for (const alternative of draft.alternatives) {
    if (draft.core.some(item => item.id === alternative.id)) problems.push(`코어와 중복된 대안 ${alternative.id}`);
    if (!alternative.path?.length) problems.push(`경로 없는 대안 ${alternative.id}`);
    else if (alternative.path.some(key => !graph.nodes.has(key))) problems.push(`그래프에 없는 경로 ${alternative.id}`);
  }
  return problems;
}

const top = (picks, count) => picks.slice(0, count).map(pick => pick.id);
const jaccard = (a, b) => {
  const union = new Set([...a, ...b]);
  return union.size ? a.filter(id => b.includes(id)).length / union.size : 1;
};

export function evaluate({patches = EVAL_PATCHES, scenarios} = {}) {
  const fixed = scenarios || readJson('tests/fixtures/eval/scenarios.json').scenarios;
  const all = [...fixed, ...generatedScenarios()];
  const report = {scenarioCount: all.length, fixedCount: fixed.length, patches: []};
  for (const version of patches) {
    const catalog = loadCatalog(version),
      graph = createOntology(catalog);
    const violations = [],
      ablation = Object.fromEntries(Object.keys(ABLATIONS).map(name => [name, {top1: 0, top3: 0, mainRank: []}]));
    let candidates = 0,
      withThree = 0,
      insufficient = 0,
      drafts = 0,
      alternatives = 0;
    for (const scenario of all) {
      const state = stateFor(scenario, catalog);
      const full = recommendPicks(state, catalog);
      violations.push(...pickViolations(state, full, catalog).map(problem => `${scenario.id}: ${problem}`));
      candidates += full.length;
      if (full.length >= 3) withThree++;
      insufficient += full.filter(pick => pick.dataStatus === 'insufficient').length;
      const main = Object.entries(state.personal).find(
        ([id, settings]) => settings.mastery === 3 && full.some(p => p.id === id),
      )?.[0];
      for (const [name, exclude] of Object.entries(ABLATIONS)) {
        const picks = recommendPicks(state, catalog, {exclude});
        violations.push(...pickViolations(state, picks, catalog).map(problem => `${scenario.id}/${name}: ${problem}`));
        if (top(picks, 1)[0] === top(full, 1)[0]) ablation[name].top1++;
        ablation[name].top3 += jaccard(top(picks, 3), top(full, 3));
        if (main) ablation[name].mainRank.push(picks.findIndex(pick => pick.id === main) + 1);
      }
      const ownId = state.allies[ROLES.indexOf(state.role)] || full[0]?.id;
      if (ownId) {
        const draftState = assign(state, 'allies', ROLES.indexOf(state.role), ownId, catalog);
        const draft = buildDraft(draftState, catalog, graph);
        if (draft.status === 'ready') {
          drafts++;
          alternatives += draft.alternatives.length;
        }
        violations.push(...itemViolations(draft, catalog, graph).map(problem => `${scenario.id}: ${problem}`));
      }
    }
    const average = list => (list.length ? list.reduce((sum, x) => sum + x, 0) / list.length : null);
    report.patches.push({
      version,
      violations,
      coverage: {
        averageCandidates: candidates / all.length,
        scenariosWithThree: withThree / all.length,
        insufficientShare: candidates ? insufficient / candidates : 0,
        drafts,
        averageAlternatives: drafts ? alternatives / drafts : 0,
      },
      ablation: Object.fromEntries(
        Object.entries(ablation).map(([name, value]) => [
          name,
          {
            top1Agreement: value.top1 / all.length,
            top3Jaccard: value.top3 / all.length,
            mainChampionAverageRank: average(value.mainRank),
            mainChampionCases: value.mainRank.length,
          },
        ]),
      ),
    });
  }
  report.notComputed = [
    {metric: 'Recall@K · NDCG', reason: '관측된 실제 픽·구매 선택 레이블이 없다.'},
    {
      metric: 'OP.GG 메타 기여 ablation',
      reason: 'OP.GG 응답이 지역·패치 범위를 밝히지 않아 메타 통계를 추천에 반영하지 않는다(Plans 3.1).',
    },
    {metric: '승률 개선', reason: '독립 표본과 인과 설계가 없다. 제품 문구로 주장하지 않는다.'},
  ];
  return report;
}

const pct = value => `${(value * 100).toFixed(1)}%`;

export function renderReport(report) {
  const lines = [
    '# 추천 평가 보고서',
    '',
    '`npm run evaluate -- --write`로 생성한다. 실제 경기 레이블이 아니라 고정·생성 시나리오에 대한 제약·설명·민감도 평가다.',
    '',
    `시나리오 ${report.scenarioCount}개 (고정 ${report.fixedCount}개, 시드 고정 생성 ${report.scenarioCount - report.fixedCount}개). 패치마다 그 패치의 Data Dragon 카탈로그로만 평가한다.`,
    '',
    '## 제약 위반과 커버리지',
    '',
    '| 패치 | 제약 위반 | 평균 후보 수 | 후보 3명 이상 | 데이터 부족 후보 비율 | 아이템 초안 | 초안당 상황별 대안 |',
    '|---|---|---|---|---|---|---|',
    ...report.patches.map(
      p =>
        `| ${p.version} | ${p.violations.length}건 | ${p.coverage.averageCandidates.toFixed(1)} | ${pct(p.coverage.scenariosWithThree)} | ${pct(p.coverage.insufficientShare)} | ${p.coverage.drafts}개 | ${p.coverage.averageAlternatives.toFixed(2)} |`,
    ),
    '',
    '제약 위반에는 픽·밴된 챔피언 추천, 역할·풀 제한 위반, 점수와 근거 합 불일치, 해당 패치에 없거나 구매할 수 없는 아이템, 다른 패치 아이템 혼입, 경로가 없거나 그래프에 없는 대안이 포함된다.',
    '',
    '## 근거 그룹 ablation',
    '',
    '전체 근거 순위와 비교한 값이다. 주력 챔피언 평균 순위는 자가평가 숙련도가 `주력`인 풀 챔피언이 후보에 있는 시나리오만 센다.',
    '',
    '| 패치 | 구성 | 1위 일치 | 상위 3명 Jaccard | 주력 챔피언 평균 순위 (사례) |',
    '|---|---|---|---|---|',
    ...report.patches.flatMap(p =>
      Object.entries(p.ablation).map(
        ([name, a]) =>
          `| ${p.version} | ${name} | ${pct(a.top1Agreement)} | ${a.top3Jaccard.toFixed(3)} | ${a.mainChampionAverageRank === null ? '-' : a.mainChampionAverageRank.toFixed(2)} (${a.mainChampionCases}) |`,
      ),
    ),
    '',
    '## 산출하지 않은 지표',
    '',
    ...report.notComputed.map(item => `- ${item.metric}: ${item.reason}`),
    '',
  ];
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = evaluate();
  const markdown = renderReport(report);
  if (process.argv.includes('--write')) writeFileSync(resolve(root, 'docs', 'evaluation-report.md'), markdown);
  console.log(markdown);
  const violations = report.patches.flatMap(p => p.violations.map(v => `${p.version} ${v}`));
  for (const violation of violations.slice(0, 20)) console.error(`위반  ${violation}`);
  process.exit(violations.length ? 1 : 0);
}
