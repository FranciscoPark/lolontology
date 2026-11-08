import {isPurchasable} from './templates.js';
import {resultText} from './opgg-ui.js';
import {parseOpggText} from './opgg-text.js';

const STAGES = [
  ['core_items', '코어 조합'],
  ['boots', '신발'],
  ['starter_items', '시작 아이템'],
  ['fourth_items', '4번째 아이템'],
  ['fifth_items', '5번째 아이템'],
  ['sixth_items', '6번째 아이템'],
  ['last_items', '마지막 아이템'],
];

function validCoreItems(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const {ids, ids_names: names, play, win, pick_rate: pickRate} = value;
  if (
    !Array.isArray(ids) ||
    !Array.isArray(names) ||
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
const coreList = value => (Array.isArray(value) ? value : value ? [value] : []).map(validCoreItems).filter(Boolean);

export function parseOpggItemBuild(
  result,
  catalog,
  {championId, arguments: args = {}, fetchedAt = new Date().toISOString()} = {},
) {
  if (catalog?.mode !== 'official' || !catalog?.items || !championId)
    return {status: 'unavailable', reason: '현재 공식 아이템 패치가 준비되지 않았습니다.'};
  // 필드 이름은 응답의 class 선언으로만 정한다. 선언이 없거나 값 개수가 다르면 추측하지 않는다.
  let data;
  try {
    data = parseOpggText(resultText(result))?.data;
  } catch (error) {
    return {status: 'unavailable', reason: `OP.GG 응답 형식을 해석하지 못했습니다: ${error.message}`};
  }
  if (!data || !STAGES.some(([key]) => key in data))
    return {status: 'unavailable', reason: 'OP.GG 응답에 아이템 빌드 필드가 없습니다.'};
  const omitted = [],
    groups = [];
  for (const [key, label] of STAGES) {
    const choices = coreList(data[key])
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
