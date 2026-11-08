import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fallbackCatalog,
  normalizeChampionAbilities,
  loadChampionAbilities,
  mergeCachedAbilities,
} from '../src/catalog.js';
import {
  createOntology,
  searchOntology,
  itemBuildCandidates,
  ontologyNeighborhood,
  ontologyInfo,
  counterItemCandidates,
} from '../src/graph.js';

test('JavaScript ontology exposes champion roles and reviewed-state traits', () => {
  const graph = createOntology(fallbackCatalog());
  const ahri = searchOntology(graph, 'champion', 'Ahri')[0];
  assert.equal(ahri.entity.id, 'Ahri');
  assert(ahri.relations.some(edge => edge.relationship === 'PLAYS_ROLE' && edge.targetId === 'MID'));
  assert(ahri.relations.some(edge => edge.relationship === 'HAS_TRAIT' && edge.reviewStatus === 'prototype'));
});

test('unknown champion annotations remain unknown while catalog search works', () => {
  const catalog = fallbackCatalog();
  catalog.champions.push({id: 'NewHero', name: '새 챔피언', tags: []});
  const result = searchOntology(createOntology(catalog), 'champion', 'NewHero')[0];
  assert.equal(result.entity.reviewStatus, 'unreviewed');
  assert.equal(result.entity.reviewStatus, 'unreviewed');
  assert(!result.relations.some(edge => edge.relationship === 'PLAYS_ROLE'));
});

test('item ontology includes recipe edges and role-specific item draft edges', () => {
  const graph = createOntology(fallbackCatalog());
  const items = searchOntology(graph, 'item', '삼위일체')[0];
  assert.equal(items.entity.id, '3078');
  const ahri = itemBuildCandidates(graph, 'Ahri', 'MID');
  assert.deepEqual(
    ahri.map(link => link.slot),
    ['start', 'boots', 'core-1', 'core-2', 'core-3', 'core-4', 'core-5'],
  );
  assert(ahri.every(link => link.patchValidated === false && link.reviewStatus === 'prototype'));
});

test('ontology does not claim a patch that is not in the loaded catalog', () => {
  const graph = createOntology({...fallbackCatalog(), version: '16.20.1', mode: 'official'});
  assert.equal(searchOntology(graph, 'item', '', '16.20.1').length > 0, true);
  assert.deepEqual(searchOntology(graph, 'item', '', '16.19.1'), []);
});

test('ontology applies champion and item patch filters to their own version IDs', () => {
  const catalog = fallbackCatalog();
  catalog.version = '16.20.1';
  catalog.championVersion = '16.20.1';
  catalog.itemVersion = '16.20.2';
  const graph = createOntology(catalog);
  assert(searchOntology(graph, 'champion', '', '16.20.1').length > 0);
  assert.deepEqual(searchOntology(graph, 'item', '', '16.20.1'), []);
  assert(searchOntology(graph, 'item', '', '16.20.2').length > 0);
  assert.deepEqual(searchOntology(graph, 'champion', '', '16.20.2'), []);
});

test('ontology search rejects unknown types and caps result counts', () => {
  const graph = createOntology(fallbackCatalog());
  assert.throws(() => searchOntology(graph, 'query', 'Ahri'), /Unsupported ontology type/);
  assert.throws(() => searchOntology(graph, 'champion', '', '', 30, {role: 'MIDLANE'}), /Unsupported ontology role/);
  assert.throws(
    () => searchOntology(graph, 'champion', '', '', 30, {relationship: 'COUNTERS'}),
    /Unsupported ontology relationship/,
  );
  assert.equal(searchOntology(graph, 'champion', '', '', 500).length, 40);
});

test('ontology can filter champions by role and relationship type', () => {
  const graph = createOntology(fallbackCatalog());
  const mid = searchOntology(graph, 'champion', '', '', 30, {role: 'MID'});
  assert(mid.some(result => result.entity.id === 'Ahri'));
  assert(!mid.some(result => result.entity.id === 'Garen'));
  const engage = searchOntology(graph, 'champion', '', '', 30, {relationship: 'HAS_TRAIT'});
  assert(engage.length > 0);
  assert(engage.every(result => result.relations.some(relation => relation.relationship === 'HAS_TRAIT')));
});

test('ontology role filter includes item build candidates and filters shown relations', () => {
  const catalog = fallbackCatalog();
  catalog.items['3078'].from = ['1055'];
  const graph = createOntology(catalog);
  const midItems = searchOntology(graph, 'item', '', '', 40, {role: 'MID'});
  assert(midItems.some(result => result.entity.id === '6655'));
  assert(midItems.every(result => result.relations.some(relation => relation.role === 'MID')));
  const recipe = searchOntology(graph, 'item', '', '', 40, {relationship: 'BUILDS_FROM'});
  assert(recipe.length > 0);
  assert(recipe.every(result => result.relations.some(relation => relation.relationship === 'BUILDS_FROM')));
});

test('ontology neighborhood supports graph exploration from champions and related nodes', () => {
  const graph = createOntology(fallbackCatalog());
  const ahri = ontologyNeighborhood(graph, 'Champion', 'Ahri');
  assert.equal(ahri.entity.name, '아리');
  assert(ahri.relations.some(edge => edge.relationship === 'PLAYS_ROLE' && edge.targetId === 'MID'));
  const mid = ontologyNeighborhood(graph, 'Role', 'MID');
  assert(mid.relations.some(edge => edge.direction === 'incoming' && edge.targetId === 'Ahri'));
  assert.equal(ontologyNeighborhood(graph, 'Champion', 'Ahri', {patch: '16.19.1'}), null);
  assert.equal(ontologyNeighborhood(graph, 'Unknown', 'Ahri'), null);
});

test('champion ability data becomes patch-scoped ontology nodes and relations', () => {
  const catalog = fallbackCatalog();
  catalog.mode = 'official';
  catalog.version = '16.20.1';
  catalog.champions[0].abilities = [
    {
      id: `${catalog.champions[0].id}:PASSIVE`,
      slot: 'PASSIVE',
      name: '예시 패시브',
      description: '설명',
      image: {group: 'passive', full: 'Example_P.png'},
      source: 'Riot Data Dragon',
    },
  ];
  const graph = createOntology(catalog),
    champion = catalog.champions[0];
  const relation = ontologyNeighborhood(graph, 'Champion', champion.id).relations.find(
    edge => edge.relationship === 'HAS_ABILITY',
  );
  assert.equal(relation.targetType, 'Ability');
  assert.equal(relation.slot, 'PASSIVE');
  const ability = ontologyNeighborhood(graph, 'Ability', `${champion.id}:PASSIVE`);
  assert.equal(ability.entity.description, '설명');
  assert.equal(ability.relations[0].direction, 'incoming');
});

test('cached ability dictionary is materialized in the ontology graph', () => {
  const catalog = fallbackCatalog();
  catalog.mode = 'official';
  catalog.version = '16.20.1';
  catalog.championVersion = '16.20.1';
  catalog.abilitiesVersion = '16.20.1';
  catalog.abilities = {
    Ahri: [
      {
        id: 'Ahri:Q',
        slot: 'Q',
        name: '현혹의 구슬',
        description: '스킬 설명',
        image: {group: 'spell', full: 'AhriQ.png'},
      },
    ],
  };
  const graph = createOntology(catalog),
    near = ontologyNeighborhood(graph, 'Champion', 'Ahri');
  assert(near.relations.some(edge => edge.relationship === 'HAS_ABILITY' && edge.targetId === 'Ahri:Q'));
  assert.equal(ontologyNeighborhood(graph, 'Ability', 'Ahri:Q').entity.name, '현혹의 구슬');
});

test('unprofiled champions receive role fallback item candidate edges', () => {
  const catalog = fallbackCatalog();
  catalog.champions.push({id: 'UnprofiledCarry', name: '미분류 원딜', tags: ['Marksman']});
  const rows = itemBuildCandidates(createOntology(catalog), 'UnprofiledCarry', 'ADC');
  assert(rows.some(row => row.slot === 'core-6'));
  assert(rows.every(row => row.reviewStatus === 'prototype' && row.patchValidated === false));
});

test('individual champion data normalizes passive and QWER abilities and rejects mismatched patches', () => {
  const abilities = normalizeChampionAbilities('16.20.1', 'Ahri', {
    version: '16.20.1',
    data: {
      Ahri: {
        passive: {name: '정기 흡수', description: '패시브 설명', image: {full: 'AhriP.png'}},
        spells: [
          {name: '현혹의 구슬', description: 'Q 설명', image: {full: 'AhriQ.png'}},
          {name: '여우불', description: 'W 설명'},
          {name: '매혹', description: 'E 설명'},
          {name: '혼령 질주', description: 'R 설명'},
        ],
      },
    },
  });
  assert.deepEqual(
    abilities.map(ability => ability.slot),
    ['PASSIVE', 'Q', 'W', 'E', 'R'],
  );
  assert.equal(abilities[0].image.group, 'passive');
  assert.equal(abilities[1].image.group, 'spell');
  assert.throws(() => normalizeChampionAbilities('16.20.1', 'Ahri', {version: '16.19.1', data: {}}), /패치 불일치/);
});

test('saved champion abilities are reused offline and only discarded when the patch changes', async () => {
  const cached = {version: '16.20.1', abilities: {Ahri: [{id: 'Ahri:Q', slot: 'Q'}]}};
  const loaded = {version: '16.20.1', champions: [], items: {}, abilities: {}};
  assert.deepEqual(mergeCachedAbilities(cached, loaded).abilities, cached.abilities);
  assert.deepEqual(mergeCachedAbilities(cached, {...loaded, version: '16.21.1'}).abilities, {});
  assert.deepEqual(
    await loadChampionAbilities({mode: 'official', version: '16.20.1', abilities: cached.abilities}, 'Ahri'),
    cached.abilities.Ahri,
  );
});

test('adjacency index returns the same relations as a full edge scan', () => {
  const graph = createOntology(fallbackCatalog());
  const {adjacency, ...withoutIndex} = graph;
  assert.ok(adjacency instanceof Map);
  for (const [type, query] of [
    ['champion', ''],
    ['item', ''],
    ['champion', 'Ahri'],
  ]) {
    assert.deepEqual(searchOntology(graph, type, query), searchOntology(withoutIndex, type, query));
  }
  for (const role of ['', 'MID'])
    assert.deepEqual(
      searchOntology(graph, 'champion', '', '', 30, {role}),
      searchOntology(withoutIndex, 'champion', '', '', 30, {role}),
    );
  assert.deepEqual(itemBuildCandidates(graph, 'Ahri', 'MID'), itemBuildCandidates(withoutIndex, 'Ahri', 'MID'));
});

test('neighborhood is capped for hub nodes and reports the full total', () => {
  const graph = createOntology(fallbackCatalog());
  const mid = ontologyNeighborhood(graph, 'Role', 'MID', {}, 5);
  assert.equal(mid.relations.length, 5);
  assert.ok(mid.total > 5);
  assert.equal(mid.truncated, true);
  const ahri = ontologyNeighborhood(graph, 'Champion', 'Ahri', {relationship: 'PLAYS_ROLE'});
  assert.equal(ahri.truncated, false);
  assert.equal(ahri.total, ahri.relations.length);
  assert.ok(ontologyNeighborhood(graph, 'Role', 'MID', {}, 999).relations.length <= 40);
});

test('public results carry patch, evidence, review status and limits without exposing graph internals', () => {
  const catalog = {
    ...fallbackCatalog(),
    mode: 'official',
    version: '16.22.1',
    championVersion: '16.22.1',
    itemVersion: '16.22.1',
  };
  const graph = createOntology(catalog);
  const info = ontologyInfo(graph);
  assert.deepEqual(info.versions, ['16.22.1']);
  info.versions.push('mutated');
  assert.deepEqual(ontologyInfo(graph).versions, ['16.22.1']);
  const ahri = searchOntology(graph, 'champion', 'Ahri')[0];
  const patch = ahri.relations.find(edge => edge.relationship === 'AVAILABLE_IN');
  assert.equal(patch.version, '16.22.1');
  assert.equal(patch.source, 'Riot Data Dragon');
  const role = ahri.relations.find(edge => edge.relationship === 'PLAYS_ROLE');
  assert.equal(role.reviewStatus, 'prototype');
  const build = ahri.relations.find(edge => edge.relationship === 'HAS_BUILD_CANDIDATE');
  assert.equal(build.patchValidated, false);
  assert.equal(typeof ontologyNeighborhood(graph, 'Champion', 'Ahri').truncated, 'boolean');
});

test('effect relations connect enemy traits, mitigations and items', () => {
  const graph = createOntology(fallbackCatalog());
  const soraka = ontologyNeighborhood(graph, 'Champion', 'Soraka', {relationship: 'APPLIES_EFFECT'});
  assert.deepEqual(
    soraka.relations.map(edge => edge.targetId),
    ['healing', 'magic-damage'],
  );
  const healing = ontologyNeighborhood(graph, 'Effect', 'healing', {relationship: 'MITIGATES'});
  assert.deepEqual(
    healing.relations.map(edge => [edge.direction, edge.targetId]),
    [['incoming', 'healing-reduction']],
  );
  const morello = ontologyNeighborhood(graph, 'Item', '3165', {relationship: 'APPLIES_EFFECT'});
  assert.equal(morello.relations[0].targetId, 'healing-reduction');
  assert.equal(morello.relations[0].reviewStatus, 'prototype');
});

test('counter item traversal follows enemy effect, mitigation and item paths with thresholds', () => {
  const graph = createOntology(fallbackCatalog());
  const heal = counterItemCandidates(graph, ['Soraka', null], 'mage');
  assert.deepEqual(
    heal.candidates.map(c => c.itemId),
    ['3165'],
  );
  assert.deepEqual(heal.candidates[0].path, [
    'Champion:Soraka',
    'Effect:healing',
    'Effect:healing-reduction',
    'Item:3165',
  ]);
  // 마법 피해 위협은 가중치 2 이상부터다. 혼합 피해는 0.5로 센다.
  assert.deepEqual(counterItemCandidates(graph, ['Ahri'], 'mage').candidates, []);
  assert.deepEqual(counterItemCandidates(graph, ['Ahri', 'Ornn'], 'mage').candidates, []);
  assert.deepEqual(
    counterItemCandidates(graph, ['Ahri', 'Ornn', 'Shen'], 'mage').candidates.map(c => c.itemId),
    ['3102', '3135'],
  );
  assert.deepEqual(
    counterItemCandidates(graph, ['Malphite', 'Sejuani'], 'marksman').candidates.map(c => [c.itemId, c.mitigation]),
    [['3036', 'armor-penetration']],
  );
  // 프로필이 없는 상대는 효과를 추정하지 않는다.
  assert.deepEqual(counterItemCandidates(graph, ['NewHero', 'Other'], 'mage'), {candidates: [], uncovered: []});
  const tank = counterItemCandidates(graph, ['Soraka'], 'tank');
  assert.deepEqual(tank.candidates, []);
  assert.deepEqual(
    tank.uncovered.map(gap => gap.threat),
    ['healing'],
  );
});

test('every relationship and role option offered by the ontology page is accepted by the graph', async () => {
  const {readFileSync} = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const options = id =>
    [
      ...html
        .slice(html.indexOf(`id="${id}"`))
        .split('</select>')[0]
        .matchAll(/value="([^"]*)"/g),
    ].map(m => m[1]);
  const graph = createOntology(fallbackCatalog());
  const relationships = options('ontology-relationship');
  assert.ok(relationships.includes('APPLIES_EFFECT') && relationships.includes('MITIGATES'));
  for (const relationship of relationships)
    for (const role of options('ontology-role'))
      assert.doesNotThrow(() => searchOntology(graph, 'champion', '', '', 5, {role, relationship}), relationship);
});

test('recipe components missing from the loaded catalog create no dangling BUILDS_FROM edges', () => {
  const catalog = fallbackCatalog();
  catalog.items['3078'] = {...catalog.items['3078'], from: ['3057', '1055', '9999999']};
  const graph = createOntology(catalog);
  const trinity = ontologyNeighborhood(graph, 'Item', '3078', {relationship: 'BUILDS_FROM'});
  assert.deepEqual(
    trinity.relations.map(edge => edge.targetId),
    ['1055'],
  );
  assert.ok(
    graph.edges.every(edge => graph.nodes.has(edge.from) && graph.nodes.has(edge.to)),
    'dangling edge',
  );
});
