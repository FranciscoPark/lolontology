import {parseOpggText} from './opgg-text.js';
// Only schema-advertised parameters are sent. Historical patches and rank brackets
// are not assumed to exist merely because the OP.GG website has those controls.
export function fieldKind(key) {
  const k = key.toLowerCase();
  if (/tier|rank/.test(k)) return 'tier';
  if (/patch|version/.test(k)) return 'patch';
  if (/region/.test(k)) return 'region';
  if (/position|lane|role/.test(k)) return 'role';
  if (/champion/.test(k)) return 'champion';
  return 'other';
}
export function matchEnum(value, values) {
  if (!values) return value;
  return values.find(v => String(v).toLowerCase() === String(value).toLowerCase());
}
export function supportedFilters(tool) {
  return new Set(Object.keys(tool.inputSchema?.properties || {}).map(fieldKind));
}
export function missingRequestedFilters(tool) {
  return ['region', 'tier', 'patch', 'role'].filter(kind => !supportedFilters(tool).has(kind));
}
export function filterLabel(kind) {
  return {region: '서버', tier: '티어', patch: '패치', role: '포지션'}[kind] || kind;
}
export function outputFieldOptions(schema) {
  const item = schema?.items || {},
    options = [...(item.oneOf || []), ...(item.anyOf || [])],
    nested = options.flatMap(option => (option.const ? [option.const] : option.enum || []));
  return [...(item.enum || []), ...nested, ...(schema?.enum || [])].filter(value => typeof value === 'string');
}
export const OPGG_ITEM_BUILD_FIELDS = [
  'data.starter_items',
  'data.boots',
  'data.core_items',
  'data.fourth_items[]',
  'data.fifth_items[]',
  'data.sixth_items[]',
  'data.last_items[]',
];
export const OPGG_SUMMARY_FIELDS = [
  'data.summary.average_stats.{ban_rate,pick_rate,play,rank,tier,win_rate}',
  'data.trends.pick.{created_at,rank,rate,version}',
];
const OPGG_POSITIONS = {TOP: 'top', JUNGLE: 'jungle', MID: 'mid', ADC: 'adc', SUPPORT: 'support'};
export const opggPosition = role => OPGG_POSITIONS[role] || null;
// 스키마가 선택지를 enum으로 주지 않는 도구에 쓸 기본 응답 필드. 2026-11-08 tools/list 설명의 닫힌 목록에서 골랐다.
export function defaultOutputFields(toolName, role) {
  if (toolName === 'lol_get_champion_analysis') return [...OPGG_SUMMARY_FIELDS, ...OPGG_ITEM_BUILD_FIELDS];
  if (toolName === 'lol_list_lane_meta_champions') {
    const position = opggPosition(role) || 'mid';
    return [`data.positions.${position}[].{ban_rate,champion,pick_rate,play,rank,tier,win_rate}`];
  }
  return [];
}
export function suggestedOutputFields(schema) {
  return outputFieldOptions(schema).filter(value =>
    /(win_rate|pick_rate|ban_rate|kda|rank|tier|play|role_rate|position|core_items|boots|starter_items|fourth_items|fifth_items|sixth_items|last_items)/i.test(
      value,
    ),
  );
}
// `a.{x,y}, b[]`처럼 중괄호·대괄호 안의 쉼표는 필드 표기의 일부이므로 바깥 쉼표에서만 나눈다.
export function splitFieldList(value) {
  const parts = [];
  let depth = 0,
    current = '';
  for (const char of String(value)) {
    if (char === '{' || char === '[') depth++;
    else if ((char === '}' || char === ']') && depth > 0) depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}
export function serializeArguments(entries, schema) {
  const grouped = new Map();
  for (const [key, value] of entries) {
    if (value === '') continue;
    const values = grouped.get(key) || [];
    values.push(value);
    grouped.set(key, values);
  }
  return Object.fromEntries(
    [...grouped].map(([key, values]) => {
      const field = schema.properties[key];
      if (!field) throw Error(`지원하지 않는 조회 조건: ${key}`);
      if (field.type === 'array') return [key, field.items?.enum ? values : values.flatMap(splitFieldList)];
      if (values.length > 1) throw Error(`중복 조회 조건: ${key}`);
      const value = values[0];
      return [
        key,
        ['integer', 'number'].includes(field.type)
          ? Number(value)
          : field.type === 'boolean'
            ? value === 'true'
            : value,
      ];
    }),
  );
}
export function resultText(result) {
  if (result.structuredContent) return JSON.stringify(result.structuredContent, null, 2);
  return (result.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');
}
// 요약 통계는 응답의 class 선언으로 이름을 붙인 data.summary.average_stats에서만 읽는다.
export function parseChampionAnalysisStats(result) {
  let stats;
  try {
    stats = parseOpggText(resultText(result))?.data?.summary?.average_stats;
  } catch {
    return null;
  }
  if (!stats) return null;
  const {play, win_rate: winRate, pick_rate: pickRate, ban_rate: banRate, tier, rank} = stats;
  if (
    !Number.isInteger(play) ||
    play < 0 ||
    [winRate, pickRate, banRate].some(rate => !Number.isFinite(rate) || rate < 0 || rate > 1) ||
    !Number.isInteger(tier) ||
    !Number.isInteger(rank)
  )
    return null;
  return {play, winRate, pickRate, banRate, tier, rank};
}
