import {PROFILES} from './ontology.js';
const itemRows = [
  ['1055', '도란의 검'],
  ['1056', '도란의 반지'],
  ['1054', '도란의 방패'],
  ['3865', '세계 지도집'],
  ['3078', '삼위일체'],
  ['3053', '스테락의 도전'],
  ['3071', '칠흑의 양날 도끼'],
  ['3068', '태양불꽃 방패'],
  ['3075', '가시 갑옷'],
  ['3065', '정령의 형상'],
  ['3115', '내셔의 이빨'],
  ['4633', '균열 생성기'],
  ['3157', '존야의 모래시계'],
  ['6655', '루덴의 동반자'],
  ['4645', '그림자불꽃'],
  ['3089', '라바돈의 죽음모자'],
  ['3142', '요우무의 유령검'],
  ['6694', '세릴다의 원한'],
  ['3814', '밤의 끝자락'],
  ['6672', '크라켄 학살자'],
  ['3031', '무한의 대검'],
  ['3094', '고속 연사포'],
  ['3042', '무라마나'],
  ['3004', '마나무네'],
  ['3153', '몰락한 왕의 검'],
  ['3124', '구인수의 격노검'],
  ['3085', '루난의 허리케인'],
  ['3190', '강철의 솔라리 펜던트'],
  ['3109', '기사의 맹세'],
  ['3050', '지크의 융합'],
  ['6617', '월석 재생기'],
  ['3504', '불타는 향로'],
  ['3107', '구원'],
  ['3020', '마법사의 신발'],
  ['3047', '판금 장화'],
  ['3111', '헤르메스의 발걸음'],
  ['3006', '광전사의 군화'],
  ['3158', '명석함의 아이오니아 장화'],
  ['3139', '헤르메스의 시미터'],
  ['3033', '필멸자의 운명'],
  ['3165', '모렐로노미콘'],
  ['3135', '공허의 지팡이'],
  ['3036', '도미닉 경의 인사'],
  ['3156', '맬모셔스의 아귀'],
  ['3102', '밴시의 장막'],
];
export function fallbackCatalog() {
  return {
    mode: 'demo',
    version: null,
    championVersion: null,
    itemVersion: null,
    abilitiesVersion: null,
    loadedAt: null,
    champions: Object.values(PROFILES).map(p => ({id: p.id, name: p.name, tags: []})),
    items: Object.fromEntries(
      itemRows.map(([id, name]) => [
        id,
        {
          id,
          name,
          demo: true,
          description: '구조 확인용 예제 아이템. 현재 패치의 가격·효과·구매 가능 여부는 검증되지 않았습니다.',
        },
      ]),
    ),
  };
}
export function normalizeCatalog(championVersion, champions, itemVersionOrData, maybeItems) {
  const itemVersion = maybeItems ? itemVersionOrData : championVersion,
    items = maybeItems || itemVersionOrData;
  if (
    !/^\d+\.\d+\.\d+$/.test(championVersion) ||
    !/^\d+\.\d+\.\d+$/.test(itemVersion) ||
    !champions?.data ||
    !items?.data ||
    champions.version !== championVersion ||
    items.version !== itemVersion
  )
    throw Error('챔피언 또는 아이템 패치 데이터 형식 불일치');
  const list = Object.values(champions.data)
    .filter(c => typeof c.id === 'string' && typeof c.name === 'string')
    .map(c => ({id: c.id, key: c.key, name: c.name, tags: c.tags || [], image: c.image?.full}));
  if (list.length < 1) throw Error('챔피언 목록이 비어 있습니다');
  return {
    mode: 'official',
    version: championVersion,
    championVersion,
    itemVersion,
    abilitiesVersion: championVersion,
    loadedAt: new Date().toISOString(),
    champions: list,
    items: Object.fromEntries(Object.entries(items.data).map(([id, i]) => [id, {...i, id, version: itemVersion}])),
    abilities: {},
  };
}
export function normalizeChampionAbilities(version, championId, detail) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || detail?.version !== version) throw Error('챔피언 스킬 데이터 패치 불일치');
  const champion = detail?.data?.[championId];
  if (!champion) throw Error('챔피언 스킬 데이터가 없습니다');
  const plain = value =>
    String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  const row = (slot, value) => ({
    id: `${championId}:${slot}`,
    slot,
    name: String(value?.name || slot),
    description: plain(value?.description || value?.tooltip),
    image: value?.image?.full ? {group: slot === 'PASSIVE' ? 'passive' : 'spell', full: value.image.full} : null,
  });
  const entries = [
    ...(champion.passive ? [row('PASSIVE', champion.passive)] : []),
    ...(Array.isArray(champion.spells)
      ? champion.spells.map((spell, index) => row(['Q', 'W', 'E', 'R'][index] || `SPELL${index + 1}`, spell))
      : []),
  ].filter(ability => ability.name && ability.description);
  if (!entries.length) throw Error('챔피언 스킬 데이터가 비어 있습니다');
  return entries;
}
export function mergeCachedAbilities(previous, next) {
  const previousChampionVersion = previous?.championVersion || previous?.version,
    nextChampionVersion = next?.championVersion || next?.version;
  return previousChampionVersion === nextChampionVersion && previous?.abilities
    ? {...next, abilities: {...(previous.abilities || {}), ...(next.abilities || {})}}
    : next;
}
export async function loadChampionAbilities(catalog, championId) {
  const version = catalog.championVersion || catalog.version;
  if (catalog.mode !== 'official' || !version) throw Error('공식 데이터 모드에서만 스킬을 불러올 수 있습니다');
  const cached = catalog.abilities?.[championId];
  if (Array.isArray(cached) && cached.length) return cached;
  const champion = catalog.champions.find(entry => entry.id === championId);
  if (!champion) throw Error('챔피언을 찾을 수 없습니다');
  const response = await fetch(
    `/api/champion-abilities?champion=${encodeURIComponent(championId)}&version=${encodeURIComponent(catalog.abilitiesVersion || version)}`,
    {signal: AbortSignal.timeout(15000)},
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Error(body.error || `스킬 서버 HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data.version !== (catalog.abilitiesVersion || version) || !Array.isArray(data.abilities))
    throw Error('백엔드 스킬 응답의 버전 또는 형식이 다릅니다');
  return data.abilities;
}
export async function loadOfficial({refresh = false} = {}) {
  const response = await fetch(refresh ? '/api/game-data/refresh' : '/api/game-data', {
    method: refresh ? 'POST' : 'GET',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Error(body.error || `게임 데이터 서버 HTTP ${response.status}`);
  }
  const data = await response.json();
  if (
    data?.mode !== 'official' ||
    !data.championVersion ||
    !data.itemVersion ||
    !Array.isArray(data.champions) ||
    !data.items
  )
    throw Error('백엔드 카탈로그 응답 형식이 올바르지 않습니다');
  return data;
}
export function portrait(catalog, id) {
  const c = catalog.champions.find(c => c.id === id),
    version = catalog.championVersion || catalog.version;
  return version && c?.image
    ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${encodeURIComponent(c.image)}`
    : null;
}
export function itemImage(catalog, id) {
  const version = catalog.itemVersion || catalog.version;
  return version ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${encodeURIComponent(id)}.png` : null;
}
export function abilityImage(catalog, ability) {
  const group = ability?.image?.group,
    full = ability?.image?.full,
    version = catalog.abilitiesVersion || catalog.championVersion || catalog.version;
  return version && ['passive', 'spell'].includes(group) && typeof full === 'string'
    ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/${group}/${encodeURIComponent(full)}`
    : null;
}
