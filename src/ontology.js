// Editorial prototype annotations, not Riot-provided matchup data or validated patch balance.
import {DRAFT_ROWS} from './champion-drafts.js';
export const RULE_VERSION = 'draft-rules-0.1';
export const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
export const ROLE_NAMES = {TOP: '탑', JUNGLE: '정글', MID: '미드', ADC: '바텀', SUPPORT: '서포터'};
export const TRAITS = {
  engage: '이니시',
  peel: '아군 보호',
  frontline: '전방 유지',
  waveclear: '웨이브 정리',
  sustain: '회복',
  range: '원거리 견제',
  cc: '군중제어',
};
// id, Korean name, roles, damage tendency, build family, qualitative effects.
const rows = [
  ['Aatrox', '아트록스', ['TOP'], 'physical', 'fighter', ['frontline', 'sustain']],
  ['Garen', '가렌', ['TOP'], 'physical', 'fighter', ['frontline']],
  ['Darius', '다리우스', ['TOP'], 'physical', 'fighter', ['frontline', 'sustain']],
  ['Fiora', '피오라', ['TOP'], 'physical', 'fighter', ['sustain']],
  ['Camille', '카밀', ['TOP'], 'physical', 'fighter', ['engage']],
  ['Malphite', '말파이트', ['TOP'], 'magic', 'tank', ['frontline', 'engage', 'cc']],
  ['Ornn', '오른', ['TOP'], 'mixed', 'tank', ['frontline', 'engage', 'cc']],
  ['Gwen', '그웬', ['TOP'], 'magic', 'apfighter', ['sustain']],
  ['Shen', '쉔', ['TOP'], 'mixed', 'tank', ['frontline', 'peel', 'cc']],
  ['Renekton', '레넥톤', ['TOP'], 'physical', 'fighter', ['frontline', 'cc', 'sustain']],
  ['LeeSin', '리 신', ['JUNGLE'], 'physical', 'fighter', ['engage', 'peel']],
  ['Vi', '바이', ['JUNGLE'], 'physical', 'fighter', ['engage', 'cc']],
  ['JarvanIV', '자르반 4세', ['JUNGLE'], 'physical', 'fighter', ['engage', 'frontline', 'cc']],
  ['Amumu', '아무무', ['JUNGLE', 'SUPPORT'], 'magic', 'tank', ['engage', 'frontline', 'cc']],
  ['Sejuani', '세주아니', ['JUNGLE'], 'mixed', 'tank', ['frontline', 'engage', 'cc']],
  ['Khazix', '카직스', ['JUNGLE'], 'physical', 'assassin', []],
  ['Lillia', '릴리아', ['JUNGLE'], 'magic', 'apfighter', ['cc', 'waveclear']],
  ['Ahri', '아리', ['MID'], 'magic', 'mage', ['cc', 'waveclear']],
  ['Annie', '애니', ['MID', 'SUPPORT'], 'magic', 'mage', ['cc', 'engage']],
  ['Orianna', '오리아나', ['MID'], 'magic', 'mage', ['waveclear', 'peel', 'cc']],
  ['Viktor', '빅토르', ['MID'], 'magic', 'mage', ['waveclear', 'range']],
  ['Lux', '럭스', ['MID', 'SUPPORT'], 'magic', 'mage', ['cc', 'range', 'peel']],
  ['Syndra', '신드라', ['MID'], 'magic', 'mage', ['waveclear', 'cc', 'range']],
  ['Zed', '제드', ['MID'], 'physical', 'assassin', []],
  ['Yasuo', '야스오', ['MID', 'TOP'], 'physical', 'critfighter', ['waveclear']],
  ['Yone', '요네', ['MID', 'TOP'], 'mixed', 'critfighter', ['engage', 'waveclear']],
  ['Akali', '아칼리', ['MID', 'TOP'], 'magic', 'apassassin', []],
  ['Galio', '갈리오', ['MID'], 'magic', 'mage', ['frontline', 'engage', 'peel', 'cc']],
  ['Jinx', '징크스', ['ADC'], 'physical', 'marksman', ['range']],
  ['Caitlyn', '케이틀린', ['ADC'], 'physical', 'marksman', ['range']],
  ['Ashe', '애쉬', ['ADC', 'SUPPORT'], 'physical', 'marksman', ['engage', 'cc', 'range']],
  ['Jhin', '진', ['ADC'], 'physical', 'marksman', ['cc', 'range']],
  ['Ezreal', '이즈리얼', ['ADC'], 'physical', 'spellmarksman', ['range']],
  ['Kaisa', '카이사', ['ADC'], 'mixed', 'onhit', []],
  ['Vayne', '베인', ['ADC'], 'mixed', 'onhit', []],
  ['Sivir', '시비르', ['ADC'], 'physical', 'marksman', ['waveclear']],
  ['Leona', '레오나', ['SUPPORT'], 'magic', 'supporttank', ['frontline', 'engage', 'cc']],
  ['Nautilus', '노틸러스', ['SUPPORT'], 'magic', 'supporttank', ['frontline', 'engage', 'cc']],
  ['Thresh', '쓰레쉬', ['SUPPORT'], 'magic', 'supporttank', ['engage', 'peel', 'cc']],
  ['Braum', '브라움', ['SUPPORT'], 'magic', 'supporttank', ['frontline', 'peel', 'cc']],
  ['Lulu', '룰루', ['SUPPORT'], 'magic', 'enchanter', ['peel', 'cc']],
  ['Janna', '잔나', ['SUPPORT'], 'magic', 'enchanter', ['peel', 'cc']],
  ['Soraka', '소라카', ['SUPPORT'], 'magic', 'enchanter', ['peel', 'sustain']],
  ['Nami', '나미', ['SUPPORT'], 'magic', 'enchanter', ['peel', 'sustain', 'cc']],
];
// 처음 44명은 prototype, 나머지는 사람 검토 전 초안(draft)이다.
const profileEntries = (entries, source, reviewStatus) =>
  entries.map(([id, name, roles, damage, build, traits]) => [
    id,
    {id, name, roles, damage, build, traits, source, reviewStatus},
  ]);
export const PROFILES = Object.fromEntries([
  ...profileEntries(rows, 'editorial-v0', 'prototype'),
  ...profileEntries(DRAFT_ROWS, 'editorial-draft-v1', 'draft'),
]);
export const SOURCE = 'https://developer.riotgames.com/docs/lol#data-dragon';

// 효과 어휘와 대응 관계. 상황별 대안 아이템은 이 관계를 그래프에서 따라가 고른다.
// 편집 규칙이며 패치별 수치 검증 결과가 아니다.
export const EFFECT_RULE_SOURCE = 'editorial-effect-rules-v0';
export const EFFECTS = {
  healing: '회복',
  'healing-reduction': '회복 감소',
  'magic-damage': '마법 피해',
  'magic-resist': '마법 저항력',
  durability: '전방 내구도',
  'magic-penetration': '마법 관통',
  'armor-penetration': '방어구 관통',
};
// 상대 챔피언 프로필에서 위협 효과를 만드는 규칙. weight 합이 minWeight 이상일 때 대응을 검토한다.
// 마법 피해는 혼합 피해 챔피언을 0.5로 센다(기존 composition 규칙과 같음).
export const THREAT_RULES = [
  {effect: 'healing', trait: 'sustain', minWeight: 1},
  {effect: 'magic-damage', damage: {magic: 1, mixed: 0.5}, minWeight: 2},
  {effect: 'durability', trait: 'frontline', minWeight: 2},
];
export const MITIGATIONS = [
  ['healing-reduction', 'healing'],
  ['magic-resist', 'magic-damage'],
  ['magic-penetration', 'durability'],
  ['armor-penetration', 'durability'],
];
const AP = ['mage', 'apfighter', 'apassassin'];
// 아이템이 제공하는 대응 효과와 그 아이템이 맞는 빌드 유형.
export const ITEM_EFFECTS = [
  {item: '3165', effect: 'healing-reduction', families: AP, note: '효과 적용과 팀 내 중복을 확인하세요.'},
  {
    item: '3033',
    effect: 'healing-reduction',
    families: ['marksman', 'onhit', 'spellmarksman', 'critfighter'],
    note: '기본 경로와 교체 비교하세요.',
  },
  {item: '3102', effect: 'magic-resist', families: AP},
  {item: '3156', effect: 'magic-resist', families: ['fighter', 'assassin', 'marksman', 'onhit', 'spellmarksman']},
  {item: '3135', effect: 'magic-penetration', families: AP, note: '상대가 마법 저항력을 쌓을 경우 검토하세요.'},
  {
    item: '3036',
    effect: 'armor-penetration',
    families: ['marksman', 'onhit'],
    note: '상대가 방어력을 쌓을 경우 검토하세요.',
  },
];
