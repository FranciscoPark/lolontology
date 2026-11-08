import {ITEM_EFFECTS} from './ontology.js';
// 역할·피해 유형별 편집 아이템 템플릿과 구매 가능 판정.
// 그래프(graph.js)와 추천 엔진(engine.js)이 함께 사용하므로 둘 중 어느 쪽에도 의존하지 않는다.
export const BUILD_TEMPLATES = {
  fighter: {
    start: '1055',
    core: ['3078', '3071', '3053', '3153', '3156'],
    boots: '3047',
    label: '공격력·체력 기반 전투',
  },
  tank: {
    start: '1054',
    core: ['3068', '3075', '3065', '3190', '3109'],
    boots: '3047',
    label: '체력·저항력 중심 전방 유지',
  },
  apfighter: {
    start: '1056',
    core: ['3115', '4633', '3157', '3089', '3135'],
    boots: '3020',
    label: '주문력 기반 지속 전투',
  },
  mage: {start: '1056', core: ['6655', '4645', '3089', '3157', '3135'], boots: '3020', label: '주문력 중심 스킬 피해'},
  assassin: {start: '1055', core: ['3142', '6694', '3814', '3033', '3036'], boots: '3158', label: '공격력 기반 기습'},
  apassassin: {
    start: '1056',
    core: ['4645', '3157', '3089', '3135', '3165'],
    boots: '3020',
    label: '주문력 기반 순간 피해',
  },
  critfighter: {
    start: '1055',
    core: ['3153', '3031', '3053', '3078', '3036', '3033'],
    boots: '3006',
    label: '기본 공격과 생존력',
  },
  marksman: {
    start: '1055',
    core: ['6672', '3094', '3031', '3153', '3036', '3033'],
    boots: '3006',
    label: '기본 공격 중심 지속 피해',
  },
  spellmarksman: {
    start: '1055',
    core: ['3078', '3004', '6694', '3031', '3036', '3153'],
    boots: '3158',
    label: '스킬과 기본 공격 연계',
  },
  onhit: {
    start: '1055',
    core: ['3153', '3124', '3085', '6672', '3031', '3036'],
    boots: '3006',
    label: '기본 공격 적중 효과',
  },
  supporttank: {
    start: '3865',
    core: ['3190', '3109', '3050', '3107', '6617'],
    boots: '3111',
    label: '아군 보호와 교전 보조',
  },
  enchanter: {start: '3865', core: ['6617', '3504', '3107', '3190', '3109'], boots: '3158', label: '아군 강화·보호'},
};
// 상대 피해 성향에 따른 방어 신발과 서포터 시작 아이템.
export const DEFENSIVE_BOOTS = {magic: '3111', physical: '3047'};
export const SUPPORT_START = '3865';
// 템플릿 밖에서 추천에 쓰는 아이템. scripts/validate-data.mjs가 패치마다 검사한다.
export const SITUATIONAL_ITEMS = [
  ...new Set([...Object.values(DEFENSIVE_BOOTS), SUPPORT_START, ...ITEM_EFFECTS.map(entry => entry.item)]),
];
export function fallbackBuildFamily(champion, role) {
  const tags = new Set(champion?.tags || []);
  if (role === 'TOP') return tags.has('Tank') ? 'tank' : tags.has('Mage') ? 'mage' : 'fighter';
  if (role === 'JUNGLE')
    return tags.has('Assassin') ? 'assassin' : tags.has('Tank') ? 'tank' : tags.has('Mage') ? 'apfighter' : 'fighter';
  if (role === 'MID') return tags.has('Assassin') ? 'assassin' : tags.has('Mage') ? 'mage' : 'fighter';
  if (role === 'BOTTOM' || role === 'ADC') return tags.has('Mage') ? 'spellmarksman' : 'marksman';
  if (role === 'SUPPORT') return tags.has('Tank') ? 'supporttank' : 'enchanter';
  return null;
}
export function isPurchasable(item, championId) {
  return (
    !!item &&
    (item.demo === true ||
      (item.maps?.['11'] === true &&
        item.gold?.purchasable === true &&
        item.inStore !== false &&
        !item.requiredAlly &&
        (!item.requiredChampion || item.requiredChampion === championId)))
  );
}
// 지원 역할에서 프로필 빌드 유형이 우선하고, 없으면 Data Dragon 태그로 추정한다.
export function buildFamily(profile, champion, role) {
  if (role === 'SUPPORT' && profile?.build === 'tank') return 'supporttank';
  return profile?.build || fallbackBuildFamily(champion, role);
}
