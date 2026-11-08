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
export function suggestedOutputFields(schema) {
  return outputFieldOptions(schema).filter(value =>
    /(win_rate|pick_rate|ban_rate|kda|rank|tier|play|role_rate|position|core_items|boots|starter_items|fourth_items|fifth_items|sixth_items|last_items)/i.test(
      value,
    ),
  );
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
      if (field.type === 'array')
        return [
          key,
          field.items?.enum
            ? values
            : values.flatMap(value =>
                value
                  .split(',')
                  .map(part => part.trim())
                  .filter(Boolean),
              ),
        ];
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
// OP.GG 텍스트 응답은 `class Data: summary,core_items,...` 줄로 각 class의 위치 인자 이름을 선언한다.
// 선언 순서는 요청한 필드에 따라 바뀌므로 위치를 고정 가정하지 않고 이 선언으로 이름을 붙인다.
export function parseClassSchema(text) {
  const schema = {};
  for (const [, name, fields] of String(text).matchAll(/^class\s+(\w+):\s*([\w,\s]*)$/gm))
    schema[name] = fields
      .split(',')
      .map(field => field.trim())
      .filter(Boolean);
  return schema;
}
export function parseChampionAnalysisStats(result) {
  const text = resultText(result),
    match = text.match(/AverageStats\(([^()]*)\)/);
  if (!match) return null;
  const values = match[1].split(',').map(value => Number(value.trim()));
  if (values.some(value => !Number.isFinite(value))) return null;
  // 선언이 없을 때만 2026-10-08에 관측한 공식 6개 필드 순서를 사용한다.
  const fields = parseClassSchema(text).AverageStats || ['play', 'win_rate', 'pick_rate', 'ban_rate', 'tier', 'rank'];
  if (fields.length !== values.length) return null;
  const named = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
  const {play, win_rate: winRate, pick_rate: pickRate, ban_rate: banRate, tier, rank} = named;
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
