import {
  PROFILES,
  profileFor,
  ROLES,
  ROLE_NAMES,
  TRAITS,
  EFFECTS,
  EFFECT_RULE_SOURCE,
  THREAT_RULES,
  MITIGATIONS,
  ITEM_EFFECTS,
} from './ontology.js';
import {BUILD_TEMPLATES, buildFamily} from './templates.js';

const keyOf = node => `${node.type}:${node.id}`;
const NODE_TYPES = new Set(['Champion', 'Item', 'Role', 'Trait', 'Patch', 'Ability', 'Effect']);
const RELATIONSHIPS = new Set([
  'AVAILABLE_IN',
  'PLAYS_ROLE',
  'HAS_TRAIT',
  'BUILDS_FROM',
  'HAS_BUILD_CANDIDATE',
  'HAS_ABILITY',
  'APPLIES_EFFECT',
  'MITIGATES',
]);
export const NEIGHBORHOOD_LIMIT = 40;

function validateFilters({role = '', relationship = ''} = {}) {
  if (role && !ROLES.includes(role)) throw new Error('Unsupported ontology role');
  if (relationship && !RELATIONSHIPS.has(relationship)) throw new Error('Unsupported ontology relationship');
  return {role, relationship};
}

export function createOntology(catalog) {
  const nodes = new Map();
  const edges = [];
  // 노드 키 → 들어오고 나가는 edge 목록. 관계 조회를 전체 edge 선형 탐색 없이 처리한다.
  const adjacency = new Map();
  const championVersion = catalog.championVersion || catalog.version,
    itemVersion = catalog.itemVersion || catalog.version;
  const addNode = node => {
    nodes.set(keyOf(node), node);
    return node;
  };
  const addEdge = (from, type, to, evidence = {}) => {
    const edge = {from, type, to, ...evidence};
    edges.push(edge);
    for (const key of from === to ? [from] : [from, to]) {
      if (!adjacency.has(key)) adjacency.set(key, []);
      adjacency.get(key).push(edge);
    }
  };

  for (const role of ROLES) addNode({type: 'Role', id: role, name: ROLE_NAMES[role], source: 'application-vocabulary'});
  for (const [id, name] of Object.entries(TRAITS)) addNode({type: 'Trait', id, name, source: 'editorial-vocabulary'});
  for (const [id, name] of Object.entries(EFFECTS)) addNode({type: 'Effect', id, name, source: EFFECT_RULE_SOURCE});
  for (const [from, to] of MITIGATIONS)
    addEdge(`Effect:${from}`, 'MITIGATES', `Effect:${to}`, {source: EFFECT_RULE_SOURCE, reviewStatus: 'prototype'});
  if (championVersion)
    addNode({
      type: 'Patch',
      id: championVersion,
      name: `챔피언 ${championVersion}`,
      version: championVersion,
      source: 'Riot Data Dragon',
    });
  if (itemVersion && itemVersion !== championVersion)
    addNode({
      type: 'Patch',
      id: itemVersion,
      name: `아이템 ${itemVersion}`,
      version: itemVersion,
      source: 'Riot Data Dragon',
    });

  for (const champion of catalog.champions) {
    const profile = PROFILES[champion.id];
    const node = addNode({
      type: 'Champion',
      ...champion,
      version: championVersion,
      source: catalog.mode === 'official' ? 'Riot Data Dragon' : 'demo catalog',
      annotationSource: profile?.source || 'none',
      reviewStatus: profile?.reviewStatus || 'unreviewed',
      editorialRoles: profile?.roles || [],
      editorialDamage: profile?.damage || 'unknown',
      editorialBuild: profile?.build || '',
      editorialTraits: profile?.traits || [],
      editorialByRole: profile?.byRole || {},
    });
    if (championVersion)
      addEdge(keyOf(node), 'AVAILABLE_IN', `Patch:${championVersion}`, {
        source: 'Riot Data Dragon',
        version: championVersion,
      });
    for (const ability of catalog.abilities?.[champion.id] || champion.abilities || []) {
      const abilityNode = addNode({
        type: 'Ability',
        ...ability,
        championId: champion.id,
        championName: champion.name,
        version: catalog.abilitiesVersion || championVersion,
        source: 'Riot Data Dragon',
      });
      addEdge(keyOf(node), 'HAS_ABILITY', keyOf(abilityNode), {
        source: 'Riot Data Dragon',
        version: catalog.abilitiesVersion || championVersion,
        slot: ability.slot,
        patchValidated: true,
      });
    }
    // 포지션별 프로필이 다르면 관계에 적용 범위를 붙인다.
    // roles: 그 관계가 성립하는 프로필 포지션, base: 프로필 밖 포지션(기본값)에서도 성립하는지.
    const variants = profile ? [null, ...profile.roles].map(role => profileFor(champion.id, role)) : [];
    const scope = holds => {
      const roles = profile.roles.filter((_, index) => holds(variants[index + 1]));
      const base = holds(variants[0]);
      // partial: 일부 포지션에서만 성립한다 (화면에 범위를 표시).
      return roles.length || base ? {roles, base, partial: !base || roles.length < profile.roles.length} : null;
    };
    for (const role of profile?.roles || []) {
      const variant = profileFor(champion.id, role);
      addEdge(keyOf(node), 'PLAYS_ROLE', `Role:${role}`, {
        source: profile.source,
        reviewStatus: profile.reviewStatus,
        damage: variant.damage,
        build: variant.build,
        roleSpecific: variant.roleSpecific,
      });
    }
    for (const trait of Object.keys(TRAITS)) {
      const applies = profile && scope(variant => variant.traits.includes(trait));
      if (applies)
        addEdge(keyOf(node), 'HAS_TRAIT', `Trait:${trait}`, {
          source: profile.source,
          reviewStatus: profile.reviewStatus,
          ...applies,
        });
    }
    // 편집 프로필의 특성·피해 성향에서 상대에게 주는 효과를 만든다. 프로필이 없으면 효과를 추정하지 않는다.
    const effectWeight = (rule, variant) =>
      rule.trait ? (variant.traits.includes(rule.trait) ? 1 : 0) : rule.damage?.[variant.damage] || 0;
    for (const rule of profile ? THREAT_RULES : []) {
      // 포지션마다 가중치가 다를 수 있으므로 가중치별로 관계를 나눈다.
      for (const weight of new Set(variants.map(variant => effectWeight(rule, variant)).filter(Boolean))) {
        const applies = scope(variant => effectWeight(rule, variant) === weight);
        addEdge(keyOf(node), 'APPLIES_EFFECT', `Effect:${rule.effect}`, {
          source: profile.source,
          reviewStatus: profile.reviewStatus,
          weight,
          basis: rule.trait ? `trait:${rule.trait}` : 'damage',
          ...applies,
        });
      }
    }

    for (const role of profile?.roles?.length ? profile.roles : ROLES) {
      const family = buildFamily(profileFor(champion.id, role), champion, role);
      const template = BUILD_TEMPLATES[family];
      if (!template) continue;
      const candidates = [
        ['start', template.start],
        ['boots', template.boots],
        ...template.core.map((id, index) => [`core-${index + 1}`, id]),
      ];
      for (const [slot, itemId] of candidates) {
        if (catalog.items[itemId])
          addEdge(keyOf(node), 'HAS_BUILD_CANDIDATE', `Item:${itemId}`, {
            role,
            slot,
            family,
            source: 'editorial-item-template-v0',
            reviewStatus: 'prototype',
            patchValidated: false,
          });
      }
    }
  }

  for (const item of Object.values(catalog.items)) {
    const node = addNode({
      type: 'Item',
      ...item,
      version: itemVersion,
      source: catalog.mode === 'official' ? 'Riot Data Dragon' : 'demo catalog',
    });
    if (itemVersion)
      addEdge(keyOf(node), 'AVAILABLE_IN', `Patch:${itemVersion}`, {source: 'Riot Data Dragon', version: itemVersion});
    for (const componentId of item.from || []) {
      if (catalog.items[componentId])
        addEdge(keyOf(node), 'BUILDS_FROM', `Item:${componentId}`, {source: 'Riot Data Dragon', version: itemVersion});
    }
  }
  for (const annotation of ITEM_EFFECTS)
    if (catalog.items[annotation.item])
      addEdge(`Item:${annotation.item}`, 'APPLIES_EFFECT', `Effect:${annotation.effect}`, {
        source: 'editorial-item-effects-v0',
        reviewStatus: 'prototype',
        families: annotation.families,
        note: annotation.note || '',
        patchValidated: false,
      });

  return {
    nodes,
    edges,
    adjacency,
    version: championVersion || null,
    versions: [...new Set([championVersion, itemVersion].filter(Boolean))],
    source: catalog.mode === 'official' ? 'Riot Data Dragon' : 'demo catalog',
  };
}

function edgesOf(graph, key) {
  if (graph.adjacency) return graph.adjacency.get(key) ?? [];
  return graph.edges.filter(edge => edge.from === key || edge.to === key);
}

function edgeTargets(graph, node) {
  const key = keyOf(node);
  return edgesOf(graph, key)
    .map(edge => {
      const incoming = edge.to === key;
      const target = graph.nodes.get(incoming ? edge.from : edge.to);
      return target
        ? {
            relationship: edge.type,
            direction: incoming ? 'incoming' : 'outgoing',
            targetType: target.type,
            targetId: target.id,
            targetName: target.name,
            source: edge.source,
            reviewStatus: edge.reviewStatus,
            role: edge.role,
            roles: edge.roles,
            base: edge.base,
            partial: edge.partial,
            slot: edge.slot,
            patchValidated: edge.patchValidated,
            version: edge.version ?? null,
          }
        : null;
    })
    .filter(Boolean);
}

// 화면이 그래프 내부 구조 대신 사용하는 요약 정보.
export function ontologyInfo(graph) {
  return {versions: [...graph.versions], version: graph.version, source: graph.source, nodeCount: graph.nodes.size};
}

export function ontologyNeighborhood(graph, type, id, filters = {}, limit = NEIGHBORHOOD_LIMIT) {
  if (!NODE_TYPES.has(type) || typeof id !== 'string') return null;
  const entity = graph.nodes.get(`${type}:${id}`);
  if (
    !entity ||
    (filters.patch && (!graph.versions.includes(filters.patch) || (entity.version && entity.version !== filters.patch)))
  )
    return null;
  const {role, relationship} = validateFilters(filters);
  const matched = edgeTargets(graph, entity)
    .filter(
      edge =>
        !role ||
        edge.role === role ||
        (edge.targetType === 'Role' && edge.targetId === role) ||
        (entity.type === 'Role' && entity.id === role),
    )
    .filter(edge => !relationship || edge.relationship === relationship);
  // 패치·역할 노드는 수백 개 이웃을 가진다. 화면과 SVG가 감당할 수 있는 수로 제한하고 전체 수를 함께 돌려준다.
  const cap = Math.max(1, Math.min(NEIGHBORHOOD_LIMIT, limit));
  return {entity, relations: matched.slice(0, cap), total: matched.length, truncated: matched.length > cap};
}

export function searchOntology(graph, type, query = '', patch = '', limit = 30, filters = {}) {
  if (!['champion', 'item'].includes(type)) throw new Error('Unsupported ontology type');
  const {role, relationship} = validateFilters(filters || {});
  if (patch && !graph.versions.includes(patch)) return [];
  const nodeType = type === 'champion' ? 'Champion' : 'Item';
  const needle = query.trim().toLocaleLowerCase();
  const cap = Math.max(1, Math.min(40, limit));
  const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), 'ko');
  const candidates = [...graph.nodes.values()].filter(
    node =>
      node.type === nodeType &&
      (!patch || node.version === patch) &&
      (!needle ||
        `${node.id} ${node.name || ''} ${node.title || ''} ${node.plaintext || ''}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
  const matchesFilters = relations =>
    (!role || relations.some(edge => (edge.targetType === 'Role' && edge.targetId === role) || edge.role === role)) &&
    (!relationship || relations.some(edge => edge.relationship === relationship));
  // 관계 필터가 없으면 정렬·절단 뒤 결과 수만큼만 관계를 계산한다.
  const ordered = candidates.sort(byName);
  const results = [];
  for (const entity of role || relationship ? ordered : ordered.slice(0, cap)) {
    const relations = edgeTargets(graph, entity);
    if (!matchesFilters(relations)) continue;
    results.push({
      entity,
      relations: relationship ? relations.filter(edge => edge.relationship === relationship) : relations,
    });
    if (results.length === cap) break;
  }
  return results;
}

export function itemBuildCandidates(graph, championId, role) {
  const node = graph.nodes.get(`Champion:${championId}`);
  if (!node || !ROLES.includes(role)) return [];
  const order = {start: 0, boots: 1, 'core-1': 2, 'core-2': 3, 'core-3': 4, 'core-4': 5, 'core-5': 6, 'core-6': 7};
  return edgesOf(graph, keyOf(node))
    .filter(edge => edge.from === keyOf(node) && edge.type === 'HAS_BUILD_CANDIDATE' && edge.role === role)
    .map(edge => ({...edge, item: graph.nodes.get(edge.to)}))
    .filter(edge => edge.item)
    .sort((a, b) => (order[a.slot] ?? 99) - (order[b.slot] ?? 99));
}

// 상대 챔피언 → APPLIES_EFFECT → 위협 효과 ← MITIGATES ← 대응 효과 ← APPLIES_EFFECT ← 아이템
// 경로를 따라 빌드 유형에 맞는 대응 아이템을 찾는다. 위협은 THREAT_RULES 순서, 대응은 MITIGATIONS 순서를 따른다.
export function counterItemCandidates(graph, enemyIds, family) {
  const candidates = [],
    uncovered = [];
  // enemyIds는 포지션 순서 슬롯이다. 같은 챔피언은 처음 슬롯만 센다.
  const enemies = enemyIds
    .map((id, index) => ({id, role: ROLES[index]}))
    .filter(({id}, index) => id && enemyIds.indexOf(id) === index);
  // 슬롯 포지션이 그 챔피언의 프로필 포지션이면 그 포지션 범위로, 아니면 기본값 범위로 판단한다.
  const inScope = (edge, id, role) => (PROFILES[id]?.roles.includes(role) ? edge.roles?.includes(role) : edge.base);
  for (const rule of THREAT_RULES) {
    const threatKey = `Effect:${rule.effect}`;
    const contributors = enemies.flatMap(({id, role}) =>
      edgesOf(graph, `Champion:${id}`)
        .filter(
          edge =>
            edge.type === 'APPLIES_EFFECT' &&
            edge.from === `Champion:${id}` &&
            edge.to === threatKey &&
            inScope(edge, id, role),
        )
        .map(edge => ({championId: id, name: graph.nodes.get(edge.from)?.name || id, weight: edge.weight || 1})),
    );
    const weight = contributors.reduce((sum, contributor) => sum + contributor.weight, 0);
    if (weight < rule.minWeight) continue;
    const mitigations = edgesOf(graph, threatKey).filter(edge => edge.type === 'MITIGATES' && edge.to === threatKey);
    const found = [];
    for (const mitigation of mitigations)
      for (const edge of edgesOf(graph, mitigation.from))
        if (edge.type === 'APPLIES_EFFECT' && edge.to === mitigation.from && edge.from.startsWith('Item:'))
          if (edge.families?.includes(family))
            found.push({
              itemId: edge.from.slice('Item:'.length),
              threat: rule.effect,
              mitigation: mitigation.from.slice('Effect:'.length),
              contributors,
              weight,
              note: edge.note,
              path: [...contributors.map(c => `Champion:${c.championId}`), threatKey, mitigation.from, edge.from],
              source: edge.source,
              reviewStatus: edge.reviewStatus,
            });
    if (found.length) candidates.push(...found);
    else uncovered.push({threat: rule.effect, contributors, weight});
  }
  return {candidates, uncovered};
}
