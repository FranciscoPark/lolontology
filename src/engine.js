import {PROFILES, ROLES, ROLE_NAMES, RULE_VERSION} from './ontology.js';
export function emptyState() {
  return {
    role: 'MID',
    allies: Array(5).fill(null),
    enemies: Array(5).fill(null),
    bans: Array(10).fill(null),
    pool: [],
    poolOnly: false,
    personal: {},
    filters: {region: 'kr', tier: '', patch: ''},
  };
}
export function normalizeState(raw, catalog) {
  const state = emptyState(),
    valid = new Set(catalog.champions.map(c => c.id)),
    used = new Set();
  if (!raw || typeof raw !== 'object') return state;
  state.role = ROLES.includes(raw.role) ? raw.role : 'MID';
  for (const [key, n] of [
    ['allies', 5],
    ['enemies', 5],
    ['bans', 10],
  ])
    for (let i = 0; i < n; i++) {
      const id = raw[key]?.[i];
      if (valid.has(id) && !used.has(id)) {
        state[key][i] = id;
        used.add(id);
      }
    }
  state.pool = Array.isArray(raw.pool) ? [...new Set(raw.pool.filter(id => valid.has(id)))] : [];
  state.poolOnly = raw.poolOnly === true;
  for (const id of valid) {
    const p = raw.personal?.[id];
    if (p && typeof p === 'object')
      state.personal[id] = {
        preference: [0, 1, 2].includes(p.preference) ? p.preference : 0,
        mastery: [0, 1, 2, 3].includes(p.mastery) ? p.mastery : null,
        // 사용자가 이 챔피언을 플레이하는 역할. 비어 있으면 미지정이다.
        roles: Array.isArray(p.roles) ? ROLES.filter(role => p.roles.includes(role)) : [],
      };
  }
  for (const k of ['region', 'tier', 'patch'])
    if (typeof raw.filters?.[k] === 'string' && raw.filters[k].length < 50) state.filters[k] = raw.filters[k];
  return state;
}
export function assign(state, side, index, id, catalog) {
  if (
    !['allies', 'enemies', 'bans'].includes(side) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= state[side].length
  )
    throw Error('잘못된 슬롯');
  if (id !== null && !catalog.champions.some(c => c.id === id)) throw Error('목록에 없는 챔피언');
  if (
    id !== null &&
    ['allies', 'enemies', 'bans'].some(k => state[k].some((v, i) => v === id && !(k === side && i === index)))
  )
    throw Error('이미 픽 또는 밴한 챔피언입니다');
  const next = structuredClone(state);
  next[side][index] = id;
  return next;
}
export function composition(ids) {
  const profiles = ids.map(id => PROFILES[id]).filter(Boolean);
  const traits = Object.fromEntries(
    ['engage', 'peel', 'frontline', 'waveclear', 'sustain', 'range', 'cc'].map(t => [
      t,
      profiles.filter(p => p.traits.includes(t)).length,
    ]),
  );
  // Damage is an editorial tendency, not observed damage, and is not weighted by gold.
  const damage = {physical: 0, magic: 0};
  for (const p of profiles) {
    if (p.damage === 'mixed') {
      damage.physical += 0.5;
      damage.magic += 0.5;
    } else damage[p.damage]++;
  }
  return {
    traits,
    damage,
    known: profiles.length,
    unknown: ids.filter(id => id && !PROFILES[id]).length,
    total: ids.filter(Boolean).length,
  };
}
export function recommendPicks(state, catalog) {
  const own = ROLES.indexOf(state.role),
    other = state.allies.filter((_, i) => i !== own),
    ally = composition(other),
    enemy = composition(state.enemies);
  const unavailable = new Set([...other, ...state.enemies, ...state.bans]);
  return catalog.champions
    .filter(c => {
      if (unavailable.has(c.id) || (state.poolOnly && !state.pool.includes(c.id))) return false;
      // 사용자가 플레이 역할을 지정했다면 그 역할에서만 후보로 둔다.
      const userRoles = state.pool.includes(c.id) ? state.personal?.[c.id]?.roles || [] : [];
      if (userRoles.length && !userRoles.includes(state.role)) return false;
      // 의미 주석이 있으면 역할 프로필로, 없으면 사용자가 직접 챔피언 풀에 넣은 경우에만 후보로 둔다.
      return PROFILES[c.id] ? PROFILES[c.id].roles.includes(state.role) : state.pool.includes(c.id);
    })
    .map(c => {
      const p = PROFILES[c.id],
        annotated = Boolean(p),
        userRole = (state.personal?.[c.id]?.roles || []).includes(state.role),
        reasons = [
          annotated
            ? {rule: 'role', text: `${ROLE_NAMES[state.role]} 역할 프로필이 있는 후보`, points: 30}
            : userRole
              ? {
                  rule: 'role-user',
                  text: `내가 지정한 플레이 역할(${ROLE_NAMES[state.role]}) · 역할 주석 없음 (역할 가산점 없음)`,
                  points: 0,
                }
              : {rule: 'role-unknown', text: '역할 주석 없음 · 내 챔피언 풀 기준 후보 (역할 가산점 없음)', points: 0},
        ],
        cautions = [];
      const add = (rule, text, points) => reasons.push({rule, text, points});
      if (state.pool.includes(c.id)) add('pool', '내 챔피언 풀에 포함', 5);
      const personal = state.personal?.[c.id];
      if (personal?.preference > 0)
        add('preference', personal.preference === 2 ? '가장 선호하는 픽' : '선호하는 픽', personal.preference * 5);
      if (personal?.mastery !== null && personal?.mastery !== undefined)
        add(
          'mastery',
          `자가평가 숙련도: ${['연습 중', '기본 가능', '익숙함', '주력'][personal.mastery]}`,
          [-10, 0, 12, 24][personal.mastery],
        );
      for (const [t, label, points] of [
        ['frontline', '전방 유지', 12],
        ['engage', '교전 시작 수단', 10],
        ['peel', '아군 보호', 7],
        ['waveclear', '웨이브 정리', 6],
      ])
        if (annotated && ally.total > 0 && !ally.traits[t] && p.traits.includes(t))
          add(t, `현재 입력한 아군의 ${label} 보완`, points);
      if (ally.known >= 2 && ally.damage.physical >= 2 && ally.damage.magic < 1 && p?.damage === 'magic')
        add('damage-magic', '물리 피해 위주 아군에 마법 피해 성향 보완', 12);
      if (ally.known >= 2 && ally.damage.magic >= 2 && ally.damage.physical < 1 && p?.damage === 'physical')
        add('damage-physical', '마법 피해 위주 아군에 물리 피해 성향 보완', 12);
      if (enemy.traits.engage >= 2 && p?.traits.includes('peel'))
        add('anti-engage', '상대 진입에 대응할 아군 보호 수단', 9);
      if (enemy.traits.frontline >= 2 && ['marksman', 'onhit', 'apfighter'].includes(p?.build))
        add('sustained', '상대 전방을 상대할 지속 피해 후보', 8);
      if (!annotated)
        cautions.push(
          userRole
            ? '의미 주석이 없어 조합 적합도를 평가하지 않았습니다. 역할은 내가 지정한 값입니다.'
            : '의미 주석이 없어 역할·조합 적합도를 평가하지 않았습니다. 이 역할에서 플레이하는 챔피언인지 직접 확인하세요. 챔피언 풀 편집에서 플레이 역할을 지정할 수 있습니다.',
        );
      if (ally.total < 4) cautions.push('미입력 아군에 따라 순위가 바뀔 수 있습니다');
      if (enemy.total < 5) cautions.push('상대 조합이 아직 완성되지 않았습니다');
      if (ally.unknown + enemy.unknown) cautions.push('의미 주석이 없는 챔피언은 조합 평가에서 제외됩니다');
      if (personal?.mastery === null || personal?.mastery === undefined)
        cautions.push('숙련도 미입력: 챔피언 풀 포함 여부를 숙련도로 간주하지 않습니다');
      return {
        ...c,
        score: reasons.reduce((s, r) => s + r.points, 0),
        dataStatus: annotated ? 'annotated' : 'insufficient',
        reasons,
        cautions,
        ruleVersion: RULE_VERSION,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
const BUILDS = {
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
export const BUILD_TEMPLATES = BUILDS;
// buildDraft가 상대 조합에 따라 직접 고르는 아이템. scripts/validate-data.mjs가 패치마다 검사한다.
export const SITUATIONAL_ITEMS = ['3111', '3047', '3865', '3165', '3033', '3102', '3156', '3135', '3036'];
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
export function buildDraft(state, catalog) {
  const id = state.allies[ROLES.indexOf(state.role)],
    p = PROFILES[id],
    champion = catalog.champions.find(entry => entry.id === id);
  if (!id) return {status: 'empty', message: '내 역할의 챔피언을 선택하면 빌드 초안을 만듭니다.'};
  if (!champion) return {status: 'unsupported', message: '챔피언 카탈로그에 이 챔피언이 없습니다.'};
  const family =
    state.role === 'SUPPORT' && p?.build === 'tank'
      ? 'supporttank'
      : p?.build || fallbackBuildFamily(champion, state.role);
  const base = BUILDS[family],
    enemy = composition(state.enemies),
    warnings = [],
    omitted = [];
  if (!p) warnings.push('챔피언별 프로필이 없어 Data Dragon 태그와 선택한 포지션을 이용한 일반 아이템 초안입니다.');
  const take = (itemId, reason) => {
    const item = catalog.items[itemId];
    if (!isPurchasable(item, id)) {
      omitted.push(item?.name || itemId);
      return null;
    }
    return {...item, reason};
  };
  let boots = base.boots,
    bootReason = '기본 빌드 유형에 따른 신발 후보';
  if (enemy.known >= 3 && enemy.damage.magic / enemy.known >= 0.7) {
    boots = '3111';
    bootReason = '입력된 상대의 마법 피해 성향을 고려한 방어 후보';
  } else if (enemy.known >= 3 && enemy.damage.physical / enemy.known >= 0.7) {
    boots = '3047';
    bootReason = '입력된 상대의 물리 피해 성향을 고려한 방어 후보';
  }
  let start = base.start;
  if (state.role === 'SUPPORT') start = '3865';
  // Jungle starters have pet-specific choices. Do not silently suggest lane starters.
  if (state.role === 'JUNGLE') {
    start = null;
    warnings.push('정글 시작 아이템은 이 초안에서 생략했습니다. 선호 정글 동료를 직접 선택하세요.');
  }
  const core = base.core
    .map((itemId, i) => take(itemId, `${base.label} 템플릿 · ${i + 1}번째 검토 후보`))
    .filter(Boolean);
  const alternatives = [];
  const add = (itemId, reason) => {
    const item = take(itemId, reason);
    if (item && !core.some(i => i.id === item.id)) alternatives.push(item);
  };
  if (enemy.traits.sustain >= 1) {
    if (['mage', 'apfighter', 'apassassin'].includes(family))
      add('3165', '상대 회복 성향 대응 후보. 효과 적용과 팀 내 중복을 확인하세요.');
    else if (['marksman', 'onhit', 'spellmarksman', 'critfighter'].includes(family))
      add('3033', '상대 회복 성향 대응 후보. 기본 경로와 교체 비교하세요.');
    else warnings.push('상대 회복 성향이 있습니다. 회복 감소 담당을 팀 조합에 맞춰 검토하세요.');
  }
  if (enemy.damage.magic >= 2) {
    if (['mage', 'apfighter', 'apassassin'].includes(family)) add('3102', '상대 마법 피해 성향에 대한 방어 대안');
    else if (['fighter', 'assassin', 'marksman', 'onhit', 'spellmarksman'].includes(family))
      add('3156', '상대 마법 피해 성향에 대한 방어 대안');
  }
  if (enemy.traits.frontline >= 2) {
    if (['mage', 'apfighter', 'apassassin'].includes(family))
      add('3135', '상대가 마법 저항력을 쌓을 경우 검토할 관통 대안');
    else if (['marksman', 'onhit'].includes(family)) add('3036', '상대가 방어력을 쌓을 경우 검토할 관통 대안');
  }
  warnings.push('역할·피해 유형별 예제 템플릿입니다. 챔피언별 최적 빌드나 고정 구매 순서가 아닙니다.');
  warnings.push('상대의 실제 아이템·성장·피해 비중은 반영하지 않습니다.');
  if (enemy.unknown) warnings.push('일부 상대 챔피언은 의미 주석이 없어 평가에서 제외했습니다.');
  if (catalog.mode === 'demo') warnings.push('예제 데이터: 현재 패치의 아이템 효과와 구매 가능 여부 미검증.');
  else warnings.push('아이템 목록·가격은 공식 데이터이며, 빌드·효과 해석 규칙은 패치별 전문가 검토 전입니다.');
  if (omitted.length)
    warnings.push(`현재 데이터에서 구매 조건을 확인할 수 없어 제외: ${[...new Set(omitted)].join(', ')}`);
  const personal = state.personal?.[id];
  // 근거는 출처별로 분리한다. 편집 템플릿·상대 조합·개인 입력은 서로 다른 근거다.
  const evidence = [
    {
      kind: 'template',
      text: p
        ? `빌드 유형 '${base.label}' · 편집 프로필(${p.source}, ${p.reviewStatus})`
        : `빌드 유형 '${base.label}' · Data Dragon 태그(${(champion.tags || []).join(', ') || '없음'})와 포지션으로 추정`,
    },
    {
      kind: 'composition',
      text: enemy.total
        ? `입력된 상대 ${enemy.total}명 중 주석 ${enemy.known}명 · 물리 성향 ${enemy.damage.physical} · 마법 성향 ${enemy.damage.magic} · 회복 ${enemy.traits.sustain} · 전방 ${enemy.traits.frontline}`
        : '상대 조합 미입력 · 기본 템플릿만 사용',
    },
    {
      kind: 'personal',
      text:
        personal?.mastery !== null && personal?.mastery !== undefined
          ? `자가평가 숙련도 '${['연습 중', '기본 가능', '익숙함', '주력'][personal.mastery]}' · 아이템 선택에는 반영하지 않음`
          : '숙련도 미입력 · 아이템 선택에는 반영하지 않음',
    },
  ];
  return {
    status: 'ready',
    championId: id,
    itemVersion: catalog.itemVersion || catalog.version || null,
    family,
    evidence,
    label: base.label,
    start: start ? take(start, '시작 아이템 후보') : null,
    boots: take(boots, bootReason),
    core,
    alternatives,
    warnings,
    ruleVersion: RULE_VERSION,
  };
}
