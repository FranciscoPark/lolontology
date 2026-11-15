// 포지션별 의미 주석 차이 (editorial-role-overrides-v1). 기본 프로필에서 그 포지션에서만 달라지는 값만 적는다.
// traits는 통째로 바꾼다. 키 포지션은 기본 프로필 roles 안에 있어야 한다. 사람 검토 전 초안이다.
export const ROLE_OVERRIDES = {
  Lux: {MID: {traits: ['waveclear', 'range', 'cc']}},
  Ashe: {SUPPORT: {traits: ['engage', 'cc', 'peel', 'range']}},
  Diana: {MID: {traits: ['engage', 'waveclear']}},
  Gragas: {TOP: {build: 'tank', traits: ['frontline', 'engage', 'cc']}},
  Hwei: {SUPPORT: {traits: ['cc', 'peel', 'range']}},
  Maokai: {JUNGLE: {build: 'tank'}},
  Poppy: {SUPPORT: {build: 'supporttank', traits: ['frontline', 'peel', 'engage', 'cc']}},
  Pantheon: {TOP: {build: 'fighter', traits: ['engage', 'cc']}, SUPPORT: {traits: ['engage', 'cc']}},
  Senna: {SUPPORT: {traits: ['range', 'sustain', 'peel']}},
  TahmKench: {TOP: {traits: ['frontline', 'sustain']}, SUPPORT: {traits: ['peel', 'frontline']}},
  Taliyah: {MID: {traits: ['waveclear', 'cc', 'range']}},
  Velkoz: {MID: {traits: ['range', 'waveclear']}, SUPPORT: {traits: ['range', 'cc']}},
  Xerath: {MID: {traits: ['range', 'waveclear']}, SUPPORT: {traits: ['range', 'cc']}},
  Galio: {SUPPORT: {build: 'supporttank', traits: ['engage', 'peel', 'cc', 'frontline']}},
  Shen: {SUPPORT: {build: 'supporttank', traits: ['peel', 'engage', 'frontline']}},
  Malphite: {MID: {build: 'mage', traits: ['engage', 'cc', 'waveclear']}},
  Shaco: {SUPPORT: {damage: 'magic', build: 'mage', traits: ['peel', 'cc']}},
};

// 기본 프로필에 없던 흔한 부 포지션. ontology.js가 roles 뒤에 붙인다.
export const EXTRA_ROLES = {
  Galio: ['SUPPORT'],
  Shen: ['SUPPORT'],
  Malphite: ['MID'],
  Smolder: ['MID'],
  Tristana: ['MID'],
  Shaco: ['SUPPORT'],
  // 2026-11-15 실제 데이터 점검(docs/real-data-report.md)에서 픽률 2% 이상으로 확인된 포지션
  Qiyana: ['JUNGLE'],
  Naafiri: ['JUNGLE'],
  Chogath: ['JUNGLE'],
  Jayce: ['JUNGLE'],
  Zed: ['JUNGLE'],
  Zyra: ['JUNGLE'],
  Vayne: ['TOP'],
  Yasuo: ['ADC'],
  Viktor: ['ADC'],
};
