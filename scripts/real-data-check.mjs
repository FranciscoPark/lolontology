// OP.GG 실제 통계로 추천 규칙을 점검한다. 역할 주석·피해 유형·아이템 템플릿·조합 점수·추천 순위를 각각 실제 지표와 비교한다.
// 사용: npm run real-check                (캐시가 있으면 재사용, 없으면 OP.GG 조회 · 약 4분)
//       npm run real-check -- --refresh   (다시 조회)
//       npm run real-check -- --write     (docs/real-data-report.md 갱신)
// 원본 응답은 .cache/real-data/에 저장한다. OP.GG 데이터는 저장소에 올리지 않는다.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {OpggClient} from './opgg.mjs';
import {DataDragonStore} from './data-dragon-store.mjs';
import {PROFILES, ROLES, ROLE_NAMES, profileFor} from '../src/ontology.js';
import {RULE_GROUPS, buildDraft, emptyState, laneMatchup, normalizeState, recommendPicks} from '../src/engine.js';
import {parseOpggText} from '../src/opgg-text.js';
import {OPGG_ITEM_BUILD_FIELDS, opggPosition, resultText} from '../src/opgg-ui.js';
import {resolveProviderChampion} from '../src/meta-estimate.js';
import {parseOpggItemBuild} from '../src/opgg-build.js';
import {compareBuilds} from '../src/build-compare.js';
import {generatedScenarios} from './evaluate.mjs';

const root = resolve(import.meta.dirname, '..'),
  cacheDir = resolve(root, '.cache', 'real-data');
export const PER_ROLE = 12;
const SPACING_MS = 3300; // OP.GG 분당 20회 제한 아래로 유지
const ANALYSIS_FIELDS = [
  'data.damage_type',
  'data.summary.average_stats.{play,win_rate}',
  'data.synergies.jungle[].{synergy_champion_name,synergy_position,play,win}',
  'data.synergies.mid[].{synergy_champion_name,synergy_position,play,win}',
  'data.synergies.adc[].{synergy_champion_name,synergy_position,play,win}',
  'data.synergies.support[].{synergy_champion_name,synergy_position,play,win}',
  'data.strong_counters[].{champion_name,play,win}',
  'data.weak_counters[].{champion_name,play,win}',
  ...OPGG_ITEM_BUILD_FIELDS,
];
const POSITION_ROLE = {TOP: 'TOP', JUNGLE: 'JUNGLE', MID: 'MID', ADC: 'ADC', SUPPORT: 'SUPPORT', BOTTOM: 'ADC'};
const DAMAGE_TYPE = {AD: 'physical', AP: 'magic', BOTH: 'mixed'};

const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const pp = value => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%p`;
const mean = values => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);
const wait = ms => new Promise(done => setTimeout(done, ms));

async function cached(name, refresh, fetcher) {
  const file = resolve(cacheDir, `${name}.json`);
  if (!refresh && existsSync(file)) return {call: JSON.parse(readFileSync(file, 'utf8')), fresh: false};
  const call = await fetcher();
  writeFileSync(file, JSON.stringify(call));
  return {call, fresh: true};
}

export async function collect({refresh = false, catalog, log = console.log} = {}) {
  mkdirSync(cacheDir, {recursive: true});
  const client = new OpggClient();
  let last = 0;
  const throttled = async (name, tool, args) =>
    (
      await cached(name, refresh, async () => {
        await wait(Math.max(0, last + SPACING_MS - Date.now()));
        last = Date.now();
        return client.call(tool, args);
      })
    ).call;
  const lanes = {};
  for (const role of ROLES) {
    const position = opggPosition(role);
    const call = await throttled(`lane-${position}`, 'lol_list_lane_meta_champions', {
      position,
      desired_output_fields: [`data.positions.${position}[].{champion,play,win_rate,pick_rate}`],
    });
    lanes[role] = (parseOpggText(resultText(call.result))?.data?.positions?.[position] || [])
      .map(row => ({...row, id: resolveProviderChampion(row.champion, catalog)}))
      .filter(row => row.id);
    log(`라인 메타 ${ROLE_NAMES[role]} ${lanes[role].length}명`);
  }
  const analyses = [];
  for (const role of ROLES) {
    const sample = lanes[role]
      .filter(row => PROFILES[row.id])
      .sort((a, b) => b.play - a.play)
      .slice(0, PER_ROLE);
    for (const row of sample) {
      const position = opggPosition(role);
      try {
        const call = await throttled(`analysis-${position}-${row.id}`, 'lol_get_champion_analysis', {
          champion: row.id,
          position,
          game_mode: 'ranked',
          desired_output_fields: ANALYSIS_FIELDS,
        });
        analyses.push({role, id: row.id, call, data: parseOpggText(resultText(call.result))?.data});
        log(`챔피언 분석 ${ROLE_NAMES[role]} ${row.id}`);
      } catch (error) {
        log(`챔피언 분석 실패 ${ROLE_NAMES[role]} ${row.id}: ${error.message}`);
      }
    }
  }
  return {lanes, analyses};
}

const rate = row => (row && row.play > 0 && Number.isFinite(row.win) ? row.win / row.play : null);

// A. 역할 주석: 주석한 포지션이 실제로 플레이되는지, 실제 주류 포지션이 주석에 빠졌는지
export function roleCheck(lanes, catalog) {
  const listed = Object.fromEntries(ROLES.map(role => [role, new Map(lanes[role].map(row => [row.id, row]))]));
  const offMeta = [],
    missing = [];
  let annotated = 0;
  for (const [id, profile] of Object.entries(PROFILES)) {
    if (!catalog.champions.some(champion => champion.id === id)) continue;
    for (const role of profile.roles) {
      annotated++;
      if (!listed[role].has(id)) offMeta.push({id, role});
    }
  }
  for (const role of ROLES)
    for (const row of lanes[role])
      if (row.pick_rate >= 0.01 && PROFILES[row.id] && !PROFILES[row.id].roles.includes(role))
        missing.push({id: row.id, role, pickRate: row.pick_rate, play: row.play});
  return {annotated, offMeta, missing};
}

// B. 피해 유형: OP.GG damage_type(AD/AP/BOTH)과 포지션별 주석 비교
export function damageCheck(analyses) {
  const rows = analyses
    .filter(entry => DAMAGE_TYPE[entry.data?.damage_type])
    .map(entry => ({
      ...entry,
      ours: profileFor(entry.id, entry.role).damage,
      theirs: DAMAGE_TYPE[entry.data.damage_type],
    }));
  return {total: rows.length, mismatches: rows.filter(row => row.ours !== row.theirs)};
}

// C. 아이템 템플릿: 상대 입력 없이 만든 코어 3개가 OP.GG 빌드 통계에 나오는지
export function itemCheck(analyses, catalog) {
  const rows = [];
  for (const entry of analyses) {
    const state = normalizeState({...emptyState(), role: entry.role}, catalog);
    state.allies[ROLES.indexOf(entry.role)] = entry.id;
    const draft = buildDraft(state, catalog);
    const external = parseOpggItemBuild(entry.call.result, catalog, {
      championId: entry.id,
      arguments: entry.call.arguments,
      fetchedAt: entry.call.fetchedAt,
    });
    const comparison = compareBuilds(draft, external);
    if (comparison.status !== 'ready') continue;
    const core = comparison.rows.filter(row => row.slot.startsWith('코어'));
    const topCore = new Set(
      external.groups.find(group => group.key === 'core_items')?.choices[0]?.items.map(item => item.id) || [],
    );
    rows.push({
      id: entry.id,
      role: entry.role,
      family: draft.family || draft.label || '',
      matched: comparison.coreOverlap.matched,
      total: comparison.coreOverlap.total,
      topCoreHits: core.filter(row => topCore.has(row.item.id)).length,
      missedNames: core.filter(row => !row.stat).map(row => row.item.name),
      popularNames: comparison.statOnly
        .slice(0, 3)
        .map(row => row.item?.name)
        .filter(Boolean),
    });
  }
  return rows;
}

const compositionPoints = candidate =>
  candidate.reasons.filter(reason => RULE_GROUPS.composition.includes(reason.rule)).reduce((s, r) => s + r.points, 0);

// D. 조합 점수: OP.GG 듀오 시너지(같은 팀 두 챔피언의 실제 승률)에서 우리 조합 보완 점수가 승률 상승과 맞는지
export function synergyCheck(analyses, catalog) {
  const pairs = [];
  for (const entry of analyses) {
    const base = entry.data?.summary?.average_stats?.win_rate;
    if (!Number.isFinite(base)) continue;
    for (const rows of Object.values(entry.data.synergies || {}))
      for (const row of Array.isArray(rows) ? rows : []) {
        const partner = resolveProviderChampion(row.synergy_champion_name, catalog),
          partnerRole = POSITION_ROLE[row.synergy_position];
        const winRate = rate(row);
        if (!partner || !partnerRole || partnerRole === entry.role || winRate === null || !PROFILES[partner]) continue;
        const state = normalizeState({...emptyState(), role: entry.role}, catalog);
        state.allies[ROLES.indexOf(partnerRole)] = partner;
        const candidate = recommendPicks(state, catalog).find(pick => pick.id === entry.id);
        if (!candidate) continue;
        pairs.push({
          id: entry.id,
          role: entry.role,
          partner,
          partnerRole,
          play: row.play,
          lift: winRate - base,
          points: compositionPoints(candidate),
        });
      }
  }
  const withPoints = pairs.filter(pair => pair.points > 0),
    without = pairs.filter(pair => pair.points === 0);
  return {
    pairs,
    withPoints,
    without,
    liftWith: mean(withPoints.map(p => p.lift)),
    liftWithout: mean(without.map(p => p.lift)),
  };
}

// E. 맞라인 상성: 같은 라인 상대에 따른 실제 승률 폭과, 엔진의 맞라인 규칙이 유리·불리 방향을 맞히는 비율
export function counterCheck(analyses, catalog) {
  let correct = 0,
    decided = 0,
    pairs = 0;
  for (const entry of analyses)
    for (const [kind, rows] of [
      [1, entry.data?.strong_counters],
      [-1, entry.data?.weak_counters],
    ])
      for (const row of Array.isArray(rows) ? rows : []) {
        const opponent = resolveProviderChampion(row.champion_name, catalog);
        if (!PROFILES[opponent]) continue;
        pairs++;
        const result = laneMatchup(profileFor(entry.id, entry.role), profileFor(opponent, entry.role));
        if (!result) continue;
        decided++;
        if (Math.sign(result.score) === kind) correct++;
      }
  const rows = analyses
    .map(entry => {
      const strong = (entry.data?.strong_counters || []).map(rate).filter(v => v !== null),
        weak = (entry.data?.weak_counters || []).map(rate).filter(v => v !== null);
      return strong.length && weak.length
        ? {id: entry.id, role: entry.role, best: Math.max(...strong), worst: Math.min(...weak)}
        : null;
    })
    .filter(Boolean);
  return {
    rows,
    spread: mean(rows.map(row => row.best - row.worst)),
    pairs,
    decided,
    accuracy: decided ? correct / decided : null,
  };
}

// F. 추천 순위: 무작위 조합에서 상위 3 후보의 실제 포지션 승률·메타 포함 비율을 전체 후보 평균과 비교
export function rankingCheck(lanes, catalog, count = 300) {
  const byRole = Object.fromEntries(ROLES.map(role => [role, new Map(lanes[role].map(row => [row.id, row]))]));
  const top = [],
    all = [];
  let topListed = 0,
    topTotal = 0;
  for (const scenario of generatedScenarios(count)) {
    const state = normalizeState({...emptyState(), ...scenario, pool: [], personal: {}}, catalog);
    const picks = recommendPicks(state, catalog);
    const meta = byRole[state.role];
    for (const pick of picks.slice(0, 3)) {
      topTotal++;
      if (meta.has(pick.id)) {
        topListed++;
        top.push(meta.get(pick.id).win_rate);
      }
    }
    for (const pick of picks) if (meta.has(pick.id)) all.push(meta.get(pick.id).win_rate);
  }
  return {scenarios: count, topWin: mean(top), allWin: mean(all), topListed: topListed / topTotal};
}

// 이 보고서로 고친 내용과 그 근거. 숫자는 2026-11-15 수집 데이터 기준이다.
const HISTORY = [
  '## 7. 해석: 무엇이 실제와 맞고 무엇이 안 맞는가',
  '',
  '- **효과적인 것: 챔피언 특성 기반 맞라인 판단.** 상대의 전방 유지·교전 시작 특성은 불리, 상대의 사거리 견제 특성은 유리, 마법 피해로 물리 피해 챔피언을 상대하면 유리했다. 챔피언 단위 5분할 교차 검증에서 특성 조합만으로 유리·불리 방향을 68.5% 맞혔다. 온톨로지의 특성(trait)·피해 유형 주석이 실제 상성을 설명하는 힘이 있다는 뜻이다.',
  '- **효과적인 것: 피해 유형 주석.** 표본 60건 중 55건이 OP.GG 분류와 같다. 다른 5건(요네·유나라·노틸러스·블리츠크랭크)은 혼합 피해를 어디까지 볼지의 차이라 고치지 않았다.',
  '- **효과가 확인되지 않은 것: 조합 보완 점수.** 듀오 기준으로는 점수가 붙은 쌍과 아닌 쌍의 승률 변화가 차이가 없다. 보완 규칙은 아군 5명 전체에 빈 역할이 있을 때를 위한 것이라 두 명 단위 데이터로는 검증할 수 없고, 효과를 주장하지 않는다. 듀오 데이터에서는 보완 여부보다 교전 시작·전방 유지 특성을 가진 아군이 있을 때 승률 상승이 조금 컸다(+3.0%p 대 사거리형 +1.8%p).',
  '- **안 맞았던 것: 역할 주석 일부와 아이템 템플릿.** 아래처럼 고쳤다.',
  '',
  '## 8. 이 보고서로 고친 것',
  '',
  '| 항목 | 수정 전 | 수정 후 | 내용 |',
  '| --- | --- | --- | --- |',
  '| 역할 주석 | 206/223 실제 등장 | 218/218 | 실제로 거의 플레이되지 않는 포지션 17건 제거(서포터 세트·말파이트·애니, 정글 렐·올라프, 미드 카르마·루시안 등), 픽률 2% 이상인데 빠진 포지션 11건 추가(정글 키아나·나피리·초가스·제이스·제드·자이라, 바텀 코르키·야스오·빅토르, 탑 베인, 서포터 뽀삐) |',
  '| 아이템 템플릿 | 표본 밖 52.9% | 표본 밖 68.8% | 전사·암살자·치명타 전사·원거리 딜러·탱커 서포터·강화형 서포터 코어를 같은 유형 챔피언의 실제 구매 빈도로 다시 골랐다. 챔피언을 반으로 나눠 한쪽으로 고르고 다른 쪽으로 검증한 값이다 |',
  '| 맞라인 규칙 | 없음 | 방향 일치 약 67% | 같은 라인 상대가 입력되면 ±4~8점. 대칭 규칙이라 A가 B에 유리하면 B는 A에 불리하다. 규칙에 쓸 특성은 이 데이터를 보고 골랐으므로 67%는 표본 안 수치이고, 표본 밖 근거는 교차 검증 68.5%다 |',
  '| 추천 상위 3 | 라인 메타 포함 91.0% | 100% | 역할 주석 수정 효과 |',
  '',
  '남은 한계: 1% 픽률 포지션 누락(위 목록)은 비주류로 보고 넣지 않았다. 추천 상위 3의 실제 승률은 전체 후보 평균과 같다. 엔진은 챔피언의 현재 패치 강세를 보지 않으므로 이는 예상된 결과이며, 메타 통계를 점수에 넣으려면 범위 검증(Plans 3.1)이 먼저 필요하다.',
  '',
];

export function report({lanes, analyses}, catalog, fetchedAt) {
  const roles = roleCheck(lanes, catalog),
    damage = damageCheck(analyses),
    items = itemCheck(analyses, catalog),
    synergy = synergyCheck(analyses, catalog),
    counters = counterCheck(analyses, catalog),
    ranking = rankingCheck(lanes, catalog);
  const name = id => catalog.champions.find(champion => champion.id === id)?.name || id;
  const coreMatched = items.reduce((s, r) => s + r.matched, 0),
    coreTotal = items.reduce((s, r) => s + r.total, 0);
  const lines = [
    '# 실제 데이터 점검 보고서',
    '',
    `- 생성: ${fetchedAt} · 데이터: OP.GG MCP (랭크 게임, 서버·티어 기본값) · Data Dragon ${catalog.championVersion}`,
    `- 표본: 포지션별 라인 메타 전체 + 포지션별 판수 상위 ${PER_ROLE}명 챔피언 분석 ${analyses.length}건`,
    '- 재생성: `npm run real-check -- --refresh --write`. 원본 응답은 저장소에 넣지 않는다.',
    '- OP.GG 통계는 상관관계이며 인과가 아니다. 승률은 소수 둘째 자리로 반올림된 값이 섞여 있어 1%p 미만 차이는 해석하지 않는다.',
    '',
    '## 요약',
    '',
    '| 점검 | 결과 | 해석 |',
    '| --- | --- | --- |',
    `| 역할 주석 | ${roles.annotated - roles.offMeta.length}/${roles.annotated} 실제 라인 메타에 등장 · 주류 포지션 누락 ${roles.missing.length}건 | 등장하지 않는 조합은 비주류이거나 주석 오류 |`,
    `| 피해 유형 | ${damage.total - damage.mismatches.length}/${damage.total} 일치 | OP.GG damage_type 기준 |`,
    `| 아이템 코어 | ${coreTotal ? pct(coreMatched / coreTotal) : '-'} (${coreMatched}/${coreTotal})가 실제 빌드 통계에 등장 | 템플릿 6개 유형은 이 데이터로 다시 골라 표본 안 수치다. 표본 밖 검증은 아래 수정 기록 참고 |`,
    `| 조합 보완 점수 | 점수 있음 ${synergy.withPoints.length}쌍 승률 변화 ${synergy.liftWith === null ? '-' : pp(synergy.liftWith)} · 점수 없음 ${synergy.without.length}쌍 ${synergy.liftWithout === null ? '-' : pp(synergy.liftWithout)} | OP.GG 상위 시너지 쌍만 있어 편향됨 |`,
    `| 맞라인 상성 | 유리·불리 상대 승률 차이 평균 ${counters.spread === null ? '-' : pp(counters.spread)} · 맞라인 규칙 방향 일치 ${counters.accuracy === null ? '-' : pct(counters.accuracy)} (${counters.decided}/${counters.pairs}쌍 판단) | 조합 규칙보다 큰 신호. 무작위는 50% |`,
    `| 추천 상위 3 | 실제 포지션 승률 평균 ${ranking.topWin === null ? '-' : pct(ranking.topWin)} (전체 후보 ${ranking.allWin === null ? '-' : pct(ranking.allWin)}) · 라인 메타 포함 ${pct(ranking.topListed)} | 무작위 조합 ${ranking.scenarios}개, 개인 설정 제외 |`,
    '',
    '## 1. 역할 주석',
    '',
    '주석상 그 포지션 후보인데 OP.GG 해당 포지션 라인 메타 목록(일정 판수 이상)에 없는 경우:',
    '',
    ...ROLES.map(role => {
      const ids = roles.offMeta.filter(row => row.role === role).map(row => name(row.id));
      return `- ${ROLE_NAMES[role]} (${ids.length}): ${ids.join(', ') || '없음'}`;
    }),
    '',
    'OP.GG에서 픽률 1% 이상인데 주석 포지션에 없는 경우:',
    '',
    ...(roles.missing.length
      ? roles.missing.map(
          row =>
            `- ${name(row.id)} ${ROLE_NAMES[row.role]} · 픽률 ${pct(row.pickRate)} · ${row.play.toLocaleString()}게임`,
        )
      : ['- 없음']),
    '',
    '## 2. 피해 유형',
    '',
    ...(damage.mismatches.length
      ? damage.mismatches.map(
          row => `- ${name(row.id)} ${ROLE_NAMES[row.role]}: 주석 ${row.ours} · OP.GG ${row.theirs}`,
        )
      : ['- 불일치 없음']),
    '',
    '## 3. 아이템 템플릿',
    '',
    `템플릿 코어 중 OP.GG 빌드 통계(코어·4~6번째·마지막 아이템)에 등장한 개수. 가장 많이 쓰이는 코어 조합과 그대로 겹친 아이템은 ${items.reduce((s, r) => s + r.topCoreHits, 0)}/${coreTotal}개.`,
    '',
    '| 챔피언 | 포지션 | 등장 | 통계에 없는 템플릿 아이템 | 실제로 많이 쓰는데 템플릿에 없는 아이템 |',
    '| --- | --- | --- | --- | --- |',
    ...items
      .sort((a, b) => a.matched / a.total - b.matched / b.total)
      .map(
        row =>
          `| ${name(row.id)} | ${ROLE_NAMES[row.role]} | ${row.matched}/${row.total} | ${row.missedNames.join(', ') || '-'} | ${row.popularNames.join(', ') || '-'} |`,
      ),
    '',
    '## 4. 조합 보완 점수와 듀오 승률',
    '',
    '챔피언 C의 OP.GG 시너지 목록에 있는 아군 P를 입력했을 때 C가 받는 조합 보완 점수와, 둘이 같은 팀일 때 C의 실제 승률 변화(듀오 승률 − C 평균)를 비교했다.',
    'OP.GG는 포지션별 상위 시너지 3명만 주므로 전반적으로 승률이 높은 쌍에 치우쳐 있다. 두 집단의 차이만 본다.',
    '',
    `- 조합 점수가 붙은 쌍 ${synergy.withPoints.length}개: 평균 ${synergy.liftWith === null ? '-' : pp(synergy.liftWith)}`,
    `- 조합 점수가 0인 쌍 ${synergy.without.length}개: 평균 ${synergy.liftWithout === null ? '-' : pp(synergy.liftWithout)}`,
    '',
    '## 5. 맞라인 상성',
    '',
    '같은 포지션 상대에 따라 승률이 얼마나 달라지는지(가장 유리한 상대 승률 − 가장 불리한 상대 승률). 엔진의 맞라인 규칙(`laneMatchup`)은 OP.GG가 꼽은 유리·불리 상대의 방향을 아래 비율로 맞힌다. OP.GG 목록은 극단적인 상대만 담으므로 평범한 매치업에서는 정확도가 더 낮을 수 있다.',
    '',
    `- 방향 일치 ${counters.accuracy === null ? '-' : pct(counters.accuracy)} · 판단 ${counters.decided}쌍 / 전체 ${counters.pairs}쌍 (특성이 같아 중립인 쌍은 판단하지 않음)`,
    '',
    ...counters.rows
      .sort((a, b) => b.best - b.worst - (a.best - a.worst))
      .slice(0, 10)
      .map(
        row =>
          `- ${name(row.id)} ${ROLE_NAMES[row.role]}: ${pct(row.worst)} ~ ${pct(row.best)} (${pp(row.best - row.worst)})`,
      ),
    '',
    '## 6. 추천 상위 3의 실제 성적',
    '',
    `시드 고정 무작위 조합 ${ranking.scenarios}개(개인 설정 제외)에서 상위 3 후보의 실제 포지션 승률 평균은 ${ranking.topWin === null ? '-' : pct(ranking.topWin, 2)}, 같은 상황 전체 후보 평균은 ${ranking.allWin === null ? '-' : pct(ranking.allWin, 2)}이다. 상위 3 중 OP.GG 라인 메타 목록에 있는 비율은 ${pct(ranking.topListed)}.`,
    '',
    ...HISTORY,
  ];
  return {
    markdown: lines.join('\n'),
    summary: {roles, damage, items, synergy, counters, ranking, coreMatched, coreTotal},
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const refresh = process.argv.includes('--refresh'),
    write = process.argv.includes('--write');
  const store = new DataDragonStore({file: resolve(root, '.cache', 'riot-data.json')});
  const catalog = await store.sync();
  const data = await collect({refresh, catalog});
  const {markdown} = report(data, catalog, new Date().toISOString().slice(0, 10));
  if (write) writeFileSync(resolve(root, 'docs', 'real-data-report.md'), markdown);
  console.log(markdown);
}
