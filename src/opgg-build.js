import {isPurchasable} from './engine.js';
import {parseClassSchema, resultText} from './opgg-ui.js';

function splitArguments(source) {
  const parts = [];
  let start = 0,
    depth = 0,
    quote = null,
    escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (source.slice(start).trim()) parts.push(source.slice(start).trim());
  return parts;
}
function callBody(text, name) {
  const token = `${name}(`,
    start = text.indexOf(token);
  if (start < 0) return null;
  const bodyStart = start + token.length;
  let depth = 1,
    quote = null,
    escaped = false;
  for (let i = bodyStart; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return text.slice(bodyStart, i);
  }
  return null;
}
function parseArray(source) {
  try {
    const value = JSON.parse(source);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
const CORE_FIELDS = ['ids', 'ids_names', 'play', 'win', 'pick_rate'];
function parseCore(source, fields = CORE_FIELDS) {
  const body = callBody(source, 'CoreItems');
  if (body === null) return null;
  const values = splitArguments(body);
  if (values.length !== fields.length) return null;
  const raw = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
  const ids = parseArray(raw.ids),
    names = parseArray(raw.ids_names),
    play = Number(raw.play),
    win = Number(raw.win),
    pickRate = Number(raw.pick_rate);
  if (
    !ids ||
    !names ||
    ids.some(id => !/^\d{1,7}$/.test(String(id))) ||
    !Number.isInteger(play) ||
    play < 0 ||
    !Number.isInteger(win) ||
    win < 0 ||
    win > play ||
    !Number.isFinite(pickRate) ||
    pickRate < 0 ||
    pickRate > 1
  )
    return null;
  return {ids: ids.map(String), names, play, win, pickRate};
}
function parseCoreList(source, fields) {
  const value = source.trim();
  if (value.startsWith('CoreItems(')) {
    const core = parseCore(value, fields);
    return core ? [core] : [];
  }
  const body = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : null;
  if (body === null) return [];
  return splitArguments(body)
    .map(entry => parseCore(entry, fields))
    .filter(Boolean);
}

const STAGES = [
  ['core_items', '코어 조합'],
  ['boots', '신발'],
  ['starter_items', '시작 아이템'],
  ['fourth_items', '4번째 아이템'],
  ['fifth_items', '5번째 아이템'],
  ['sixth_items', '6번째 아이템'],
  ['last_items', '마지막 아이템'],
];
export function parseOpggItemBuild(
  result,
  catalog,
  {championId, arguments: args = {}, fetchedAt = new Date().toISOString()} = {},
) {
  if (catalog?.mode !== 'official' || !catalog?.items || !championId)
    return {status: 'unavailable', reason: '현재 공식 아이템 패치가 준비되지 않았습니다.'};
  const text = resultText(result),
    body = callBody(text, 'Data');
  if (body === null) return {status: 'unavailable', reason: 'OP.GG 응답에 알려진 아이템 빌드 형식이 없습니다.'};
  // 위치 인자의 이름은 응답의 `class Data:` 선언으로만 정한다. 선언이 없거나 개수가 다르면 추측하지 않는다.
  const schema = parseClassSchema(text),
    names = schema.Data,
    values = splitArguments(body);
  if (!names || names.length !== values.length)
    return {status: 'unavailable', reason: 'OP.GG 응답에 필드 선언(class Data)이 없거나 값 개수와 다릅니다.'};
  if (!STAGES.some(([key]) => names.includes(key)))
    return {status: 'unavailable', reason: 'OP.GG 응답에 아이템 빌드 필드가 없습니다.'};
  const coreFields = schema.CoreItems || CORE_FIELDS;
  const raw = Object.fromEntries(
      STAGES.map(([key]) => [key, names.includes(key) ? parseCoreList(values[names.indexOf(key)], coreFields) : []]),
    ),
    omitted = [];
  const groups = [];
  for (const [key, label] of STAGES) {
    const choices = raw[key]
      .map(choice => {
        const items = choice.ids
          .map(id => {
            const item = catalog.items[id];
            if (!isPurchasable(item, championId)) {
              omitted.push(id);
              return null;
            }
            return item;
          })
          .filter(Boolean);
        return items.length ? {items, play: choice.play, win: choice.win, pickRate: choice.pickRate} : null;
      })
      .filter(Boolean);
    if (choices.length) groups.push({key, label, choices});
  }
  if (!groups.length)
    return {
      status: 'unavailable',
      reason: '현재 패치에서 구매 가능한 아이템 ID를 찾지 못했습니다.',
      omitted: [...new Set(omitted)],
    };
  return {
    status: 'ready',
    source: 'OP.GG MCP · lol_get_champion_analysis',
    championId,
    role: args.position || args.role || args.lane || null,
    tier: args.tier || null,
    requestedGameMode: args.game_mode || null,
    patch: null,
    itemVersion: catalog.itemVersion || catalog.version,
    fetchedAt,
    groups,
    omitted: [...new Set(omitted)],
    scopeWarning:
      'OP.GG 응답은 통계 패치를 확인해주지 않았습니다. 아이템은 현재 Riot Data Dragon 패치에서 구매 가능한지 확인했습니다.',
  };
}
