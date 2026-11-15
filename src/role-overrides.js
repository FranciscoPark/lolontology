// 포지션별 의미 주석 차이 (editorial-role-overrides-v1). 기본 프로필에서 그 포지션에서만 달라지는 값만 적는다.
// traits는 통째로 바꾼다. 키 포지션은 기본 프로필 roles 안에 있어야 한다. 사람 검토 전 초안이다.
export const ROLE_OVERRIDES = {
  Annie: {SUPPORT: {traits: ['engage', 'cc', 'peel']}},
  Lux: {MID: {traits: ['waveclear', 'range', 'cc']}},
  Ashe: {SUPPORT: {traits: ['engage', 'cc', 'peel', 'range']}},
  Diana: {MID: {traits: ['engage', 'waveclear']}},
  Gragas: {TOP: {build: 'tank', traits: ['frontline', 'engage', 'cc']}},
  Heimerdinger: {SUPPORT: {traits: ['cc', 'peel', 'range']}},
  Hwei: {SUPPORT: {traits: ['cc', 'peel', 'range']}},
  Maokai: {JUNGLE: {build: 'tank'}},
  Poppy: {JUNGLE: {traits: ['frontline', 'engage', 'cc']}},
  Pantheon: {TOP: {build: 'fighter', traits: ['engage', 'cc']}, SUPPORT: {traits: ['engage', 'cc']}},
  Senna: {SUPPORT: {traits: ['range', 'sustain', 'peel']}},
  Seraphine: {
    MID: {build: 'mage', traits: ['waveclear', 'cc', 'range']},
    ADC: {build: 'mage', traits: ['waveclear', 'range', 'cc']},
  },
  TahmKench: {TOP: {traits: ['frontline', 'sustain']}, SUPPORT: {traits: ['peel', 'frontline']}},
  Taliyah: {MID: {traits: ['waveclear', 'cc', 'range']}},
  Velkoz: {MID: {traits: ['range', 'waveclear']}, SUPPORT: {traits: ['range', 'cc']}},
  Xerath: {MID: {traits: ['range', 'waveclear']}, SUPPORT: {traits: ['range', 'cc']}},
  Galio: {SUPPORT: {build: 'supporttank', traits: ['engage', 'peel', 'cc', 'frontline']}},
  Sett: {SUPPORT: {build: 'supporttank', traits: ['engage', 'frontline', 'cc']}},
  Karma: {MID: {build: 'mage', traits: ['waveclear', 'range', 'peel']}},
  Shen: {SUPPORT: {build: 'supporttank', traits: ['peel', 'engage', 'frontline']}},
  Malphite: {
    SUPPORT: {build: 'supporttank'},
    MID: {build: 'mage', traits: ['engage', 'cc', 'waveclear']},
  },
  Rell: {JUNGLE: {build: 'tank'}},
  Shaco: {SUPPORT: {damage: 'magic', build: 'mage', traits: ['peel', 'cc']}},
};

// 기본 프로필에 없던 흔한 부 포지션. ontology.js가 roles 뒤에 붙인다.
export const EXTRA_ROLES = {
  Galio: ['SUPPORT'],
  Sett: ['SUPPORT'],
  Karma: ['MID'],
  Shen: ['SUPPORT'],
  Malphite: ['SUPPORT', 'MID'],
  Rell: ['JUNGLE'],
  Smolder: ['MID'],
  TwistedFate: ['ADC'],
  Tristana: ['MID'],
  Seraphine: ['MID', 'ADC'],
  Shaco: ['SUPPORT'],
};
