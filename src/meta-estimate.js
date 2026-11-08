// OP.GG 응답을 출처·범위가 분리된 내부 통계 객체(MetaEstimate)로 정규화한다.
//
// 원칙
// - requestedScope는 실제로 보낸 인자만 기록한다. 보낼 수 없는 범위는 'not-requestable'이다.
// - returnedScope는 응답이 명시한 값만 기록한다. 없으면 'unknown'이며 요청값을 복사하지 않는다.
// - 응답에 없는 통계는 null로 두고 0으로 채우지 않는다.
// - usableForRanking은 모든 범위가 응답으로 확인되고 요청과 일치할 때만 true다.
import {resultText} from './opgg-ui.js';
import {parseOpggText} from './opgg-text.js';

export const UNKNOWN = 'unknown';
export const NOT_REQUESTABLE = 'not-requestable';
export const SCOPE_KEYS = ['region', 'queue', 'role', 'tier', 'patch'];

// OP.GG 영문 표시명 중 Data Dragon ID와 영숫자 비교로 맞지 않는 것만 명시한다.
const CHAMPION_ALIASES = {wukong: 'MonkeyKing', nunuwillump: 'Nunu', nunu: 'Nunu', renataglasc: 'Renata'};
const token = value =>
  String(value ?? '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function resolveProviderChampion(name, catalog) {
  const wanted = token(name);
  if (!wanted) return null;
  const alias = CHAMPION_ALIASES[wanted];
  const champions = catalog?.champions || [];
  if (alias && champions.some(champion => champion.id === alias)) return alias;
  return champions.find(champion => token(champion.id) === wanted || token(champion.key) === wanted)?.id ?? null;
}

const rate = value => (Number.isFinite(value) && value >= 0 && value <= 1 ? value : null);
const count = value => (Number.isInteger(value) && value >= 0 ? value : null);
const integer = value => (Number.isInteger(value) ? value : null);

function statistic(raw, definition) {
  return {
    definition,
    winRate: rate(raw?.win_rate),
    pickRate: rate(raw?.pick_rate),
    banRate: rate(raw?.ban_rate),
    play: count(raw?.play),
    providerTier: integer(raw?.tier),
    providerRank: integer(raw?.rank),
  };
}

function requestedScope(tool, args) {
  return {
    region: NOT_REQUESTABLE,
    queue: tool === 'lol_get_champion_analysis' ? (args.game_mode ?? UNKNOWN) : NOT_REQUESTABLE,
    role: args.position ?? UNKNOWN,
    // 스키마 설명: tier를 생략하면 전 티어 집계다. 라인 메타 도구에는 tier 입력이 없다.
    tier:
      tool === 'lol_get_champion_analysis' ? (args.tier ? String(args.tier).toLowerCase() : 'all') : NOT_REQUESTABLE,
    patch: NOT_REQUESTABLE,
  };
}

const unknownScope = () => Object.fromEntries(SCOPE_KEYS.map(key => [key, UNKNOWN]));

function trendObservations(data) {
  const observations = [];
  for (const [kind, trend] of Object.entries(data?.trends || {})) {
    if (trend && typeof trend === 'object' && typeof trend.version === 'string' && /^\d+\.\d+$/.test(trend.version))
      observations.push({
        field: `data.trends.${kind}.version`,
        value: trend.version,
        observedAt: typeof trend.created_at === 'string' ? trend.created_at : null,
        appliesTo: `trends.${kind}`,
      });
  }
  return observations;
}

export function rankingGate(estimate) {
  const reasons = [];
  for (const key of SCOPE_KEYS) {
    const returned = estimate.returnedScope[key],
      requested = estimate.requestedScope[key];
    if (returned === UNKNOWN) reasons.push(`${key} 반환 범위 미확인`);
    else if (requested !== NOT_REQUESTABLE && requested !== returned)
      reasons.push(`${key} 요청(${requested})과 반환(${returned}) 불일치`);
  }
  if (estimate.sampleSize === UNKNOWN) reasons.push('표본 정의 미확인');
  return {usable: reasons.length === 0, reasons};
}

function finalize(estimate) {
  const gate = rankingGate(estimate);
  return {...estimate, usableForRanking: gate.usable, rankingBlockers: gate.reasons};
}

function base(call) {
  return {
    source: 'OP.GG MCP',
    tool: call.tool,
    endpoint: call.source ?? null,
    providerVersion: call.provider?.version ? `${call.provider.name || 'OP.GG'} ${call.provider.version}` : UNKNOWN,
    fetchedAt: call.fetchedAt ?? null,
  };
}

// call: /api/opgg/query 응답 ({tool, arguments, fetchedAt, provider, result})
export function normalizeOpggCall(call, catalog) {
  const args = call?.arguments || {};
  let root;
  try {
    root = parseOpggText(resultText(call?.result || {}));
  } catch (error) {
    return {status: 'unavailable', reason: `OP.GG 응답 형식을 해석하지 못했습니다: ${error.message}`, estimates: []};
  }
  const data = root?.data;
  if (!data) return {status: 'unavailable', reason: 'OP.GG 응답에 data가 없습니다.', estimates: []};
  const observations = trendObservations(data),
    unresolved = [],
    estimates = [];

  if (call.tool === 'lol_get_champion_analysis') {
    const stats = data.summary?.average_stats;
    if (stats) {
      const championId = resolveProviderChampion(args.champion, catalog);
      if (!championId) unresolved.push(String(args.champion));
      estimates.push(
        finalize({
          ...base(call),
          kind: 'champion-position-summary',
          championId,
          providerChampion: args.champion ?? null,
          requestedScope: requestedScope(call.tool, args),
          returnedScope: unknownScope(),
          statistic: statistic(stats, 'OP.GG data.summary.average_stats · 집계 방식 비공개'),
          sampleSize: UNKNOWN,
          observations,
        }),
      );
    }
  } else if (call.tool === 'lol_list_lane_meta_champions') {
    for (const [position, rows] of Object.entries(data.positions || {})) {
      for (const row of Array.isArray(rows) ? rows : []) {
        const championId = resolveProviderChampion(row?.champion, catalog);
        if (!championId) {
          unresolved.push(String(row?.champion));
          continue;
        }
        estimates.push(
          finalize({
            ...base(call),
            kind: 'lane-meta',
            championId,
            providerChampion: row.champion,
            requestedScope: requestedScope(call.tool, args),
            // 응답의 positions.<name> 키는 응답이 명시한 포지션이다.
            returnedScope: {...unknownScope(), role: position},
            statistic: statistic(row, `OP.GG data.positions.${position}[] · 집계 방식 비공개`),
            sampleSize: UNKNOWN,
            observations,
          }),
        );
      }
    }
  } else return {status: 'unavailable', reason: `정규화하지 않는 도구: ${call.tool}`, estimates: []};

  if (!estimates.length)
    return {
      status: 'unavailable',
      reason: '응답에 정규화할 통계가 없습니다. 요약 통계나 라인 메타 필드를 요청했는지 확인하세요.',
      estimates,
      unresolved,
      observations,
    };
  return {status: 'ready', estimates, unresolved, observations};
}
