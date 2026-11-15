import {PROFILES, ROLES, ROLE_NAMES, RULE_VERSION, EFFECTS, profileFor} from './ontology.js';
import {BUILD_TEMPLATES, DEFENSIVE_BOOTS, SUPPORT_START, buildFamily, isPurchasable} from './templates.js';
import {createOntology, counterItemCandidates} from './graph.js';
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
// ids는 포지션 순서(ROLES) 슬롯 배열이다. 각 챔피언은 그 슬롯 포지션의 프로필로 평가한다.
export function composition(ids) {
  const profiles = ids.map((id, index) => profileFor(id, ROLES[index])).filter(Boolean);
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
// 평가용 근거 그룹. recommendPicks(state, catalog, {exclude: ['personal']})처럼 그룹을 빼고 순위를 비교한다.
export const RULE_GROUPS = {
  personal: ['pool', 'preference', 'mastery'],
  composition: [
    'frontline',
    'engage',
    'peel',
    'waveclear',
    'damage-magic',
    'damage-physical',
    'anti-engage',
    'sustained',
  ],
  matchup: ['lane-matchup'],
};

// 맞라인 상성 성향. 2026-11-15 실제 데이터 점검에서 OP.GG 유리·불리 상대 357쌍의 방향을 67% 맞힌 규칙이다
// (docs/real-data-report.md). A가 B에 유리하면 B는 A에 불리하도록 대칭으로 계산한다.
export function laneMatchup(mine, theirs) {
  if (!mine || !theirs) return null;
  const factors = [];
  const side = (profile, trait) => (profile.traits.includes(trait) ? 1 : 0);
  for (const [trait, label, sign] of [
    ['frontline', '전방 유지', 1],
    ['engage', '교전 시작', 1],
    ['range', '사거리 견제', -1],
  ]) {
    const diff = (side(mine, trait) - side(theirs, trait)) * sign;
    if (diff) factors.push({diff, text: diff * sign > 0 ? `내 ${label}` : `상대 ${label}`});
  }
  if (mine.damage === 'magic' && theirs.damage === 'physical') factors.push({diff: 1, text: '마법 피해 대 물리 피해'});
  if (mine.damage === 'physical' && theirs.damage === 'magic') factors.push({diff: -1, text: '물리 피해 대 마법 피해'});
  const total = factors.reduce((sum, factor) => sum + factor.diff, 0);
  return total ? {score: Math.max(-2, Math.min(2, total)), factors} : null;
}
export function recommendPicks(state, catalog, {exclude = []} = {}) {
  const excluded = new Set(exclude.flatMap(group => RULE_GROUPS[group] || []));
  const own = ROLES.indexOf(state.role),
    other = state.allies.filter((_, i) => i !== own),
    ally = composition(state.allies.map((id, i) => (i === own ? null : id))),
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
      const p = profileFor(c.id, state.role),
        annotated = Boolean(p),
        userRole = (state.personal?.[c.id]?.roles || []).includes(state.role),
        reasons = [
          annotated
            ? {
                rule: 'role',
                text: `${ROLE_NAMES[state.role]} 역할 프로필이 있는 후보${p.roleSpecific ? ' · 포지션별 주석 적용' : ''}`,
                points: 30,
              }
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
      const laneEnemy = state.enemies[own],
        matchup = annotated && laneEnemy ? laneMatchup(p, profileFor(laneEnemy, state.role)) : null;
      if (matchup) {
        const list = sign =>
          matchup.factors
            .filter(f => Math.sign(f.diff) === sign)
            .map(f => f.text)
            .join(', ');
        const detail = [list(1) && `유리: ${list(1)}`, list(-1) && `불리: ${list(-1)}`].filter(Boolean).join(' · ');
        const enemyName = catalog.champions.find(champion => champion.id === laneEnemy)?.name || laneEnemy;
        add(
          'lane-matchup',
          `맞라인 ${enemyName} 상대 ${matchup.score > 0 ? '유리' : '불리'} 성향 (${detail})`,
          matchup.score * 4,
        );
      }
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
      const kept = reasons.filter(reason => !excluded.has(reason.rule));
      return {
        ...c,
        score: kept.reduce((s, r) => s + r.points, 0),
        dataStatus: annotated ? 'annotated' : 'insufficient',
        reasons: kept,
        cautions,
        ruleVersion: RULE_VERSION,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
export function buildDraft(state, catalog, graph = createOntology(catalog)) {
  const id = state.allies[ROLES.indexOf(state.role)],
    p = profileFor(id, state.role),
    champion = catalog.champions.find(entry => entry.id === id);
  if (!id) return {status: 'empty', message: '내 역할의 챔피언을 선택하면 빌드 초안을 만듭니다.'};
  if (!champion) return {status: 'unsupported', message: '챔피언 카탈로그에 이 챔피언이 없습니다.'};
  const family = buildFamily(p, champion, state.role);
  const base = BUILD_TEMPLATES[family],
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
    boots = DEFENSIVE_BOOTS.magic;
    bootReason = '입력된 상대의 마법 피해 성향을 고려한 방어 후보';
  } else if (enemy.known >= 3 && enemy.damage.physical / enemy.known >= 0.7) {
    boots = DEFENSIVE_BOOTS.physical;
    bootReason = '입력된 상대의 물리 피해 성향을 고려한 방어 후보';
  }
  let start = base.start;
  if (state.role === 'SUPPORT') start = SUPPORT_START;
  // Jungle starters have pet-specific choices. Do not silently suggest lane starters.
  if (state.role === 'JUNGLE') {
    start = null;
    warnings.push('정글 시작 아이템은 이 초안에서 생략했습니다. 선호 정글 동료를 직접 선택하세요.');
  }
  const core = base.core
    .map((itemId, i) => take(itemId, `${base.label} 템플릿 · ${i + 1}번째 검토 후보`))
    .filter(Boolean);
  const alternatives = [];
  const add = (itemId, reason, path) => {
    const item = take(itemId, reason);
    if (item && !core.some(i => i.id === item.id) && !alternatives.some(i => i.id === item.id))
      alternatives.push({...item, path});
  };
  // 상황별 대안은 온톨로지 경로(상대 효과 → 대응 효과 → 아이템)를 따라 고른다.
  const counters = counterItemCandidates(graph, state.enemies, family);
  for (const candidate of counters.candidates) {
    const who = candidate.contributors.map(c => c.name).join('·');
    add(
      candidate.itemId,
      `${who}의 ${EFFECTS[candidate.threat]} → ${EFFECTS[candidate.mitigation]} 대응 경로 · 편집 효과 주석(${candidate.reviewStatus})${candidate.note ? ` · ${candidate.note}` : ''}`,
      candidate.path,
    );
  }
  for (const gap of counters.uncovered)
    if (gap.threat === 'healing')
      warnings.push('상대 회복 성향이 있습니다. 회복 감소 담당을 팀 조합에 맞춰 검토하세요.');
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
        ? `빌드 유형 '${base.label}' · 편집 프로필(${p.source}, ${p.reviewStatus})${p.roleSpecific ? ` · ${ROLE_NAMES[state.role]} 포지션별 주석` : ''}`
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
