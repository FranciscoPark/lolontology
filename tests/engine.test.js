import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, normalizeState, assign, recommendPicks, buildDraft, composition} from '../src/engine.js';
import {isPurchasable} from '../src/templates.js';
import {fallbackCatalog, normalizeCatalog} from '../src/catalog.js';
import {ROLES} from '../src/ontology.js';
const catalog = fallbackCatalog();
const score = (s, id) => recommendPicks(s, catalog).find(c => c.id === id);
test('picked opponents, allies and bans cannot be recommended', () => {
  const s = emptyState();
  s.enemies[2] = 'Ahri';
  s.allies[0] = 'Yasuo';
  s.bans[0] = 'Zed';
  const ids = recommendPicks(s, catalog).map(c => c.id);
  for (const id of ['Ahri', 'Yasuo', 'Zed']) assert(!ids.includes(id));
});
test('own selected slot remains comparable, but cannot be picked twice', () => {
  const s = assign(emptyState(), 'allies', 2, 'Ahri', catalog);
  assert(score(s, 'Ahri'));
  assert.throws(() => assign(s, 'enemies', 2, 'Ahri', catalog), /이미/);
  assert.equal(assign(s, 'allies', 2, 'Ahri', catalog).allies[2], 'Ahri');
});
test('assignment rejects invalid ids and slots, supports clearing', () => {
  assert.throws(() => assign(emptyState(), 'other', 0, 'Ahri', catalog));
  assert.throws(() => assign(emptyState(), 'bans', 10, 'Ahri', catalog));
  assert.throws(() => assign(emptyState(), 'allies', 0, 'missing', catalog));
  assert.equal(assign(emptyState(), 'allies', 0, null, catalog).allies[0], null);
});
test('empty restricted pool yields no candidates', () => {
  const s = emptyState();
  s.poolOnly = true;
  assert.deepEqual(recommendPicks(s, catalog), []);
});
test('pool restriction intersects role and availability', () => {
  const s = emptyState();
  s.pool = ['Ahri', 'Zed', 'Jinx'];
  s.poolOnly = true;
  s.bans[0] = 'Zed';
  assert.deepEqual(
    recommendPicks(s, catalog).map(c => c.id),
    ['Ahri'],
  );
});
test('mastery is independent of pool inclusion and adds a traceable contribution', () => {
  const s = emptyState();
  s.pool = ['Orianna'];
  const unknown = score(s, 'Orianna');
  assert(unknown.cautions.some(t => t.includes('숙련도 미입력')));
  s.personal.Orianna = {preference: 0, mastery: 3};
  const expert = score(s, 'Orianna');
  assert.equal(expert.score - unknown.score, 24);
  assert(expert.reasons.some(r => r.rule === 'mastery'));
});
test('novice penalty is distinct from unknown mastery', () => {
  const s = emptyState(),
    before = score(s, 'Ahri').score;
  s.personal.Ahri = {preference: 0, mastery: 0};
  assert.equal(score(s, 'Ahri').score, before - 10);
});
test('preference affects score independently of mastery', () => {
  const s = emptyState(),
    before = score(s, 'Viktor').score;
  s.personal.Viktor = {preference: 2, mastery: null};
  assert.equal(score(s, 'Viktor').score, before + 10);
});
test('physical heavy teammates produce a magic damage rationale', () => {
  const s = emptyState();
  s.allies = ['Garen', 'LeeSin', null, 'Jinx', null];
  assert(score(s, 'Ahri').reasons.some(r => r.rule === 'damage-magic'));
  assert(!score(s, 'Zed').reasons.some(r => r.rule === 'damage-magic'));
});
test('enemy engage increases protection value', () => {
  const s = emptyState(),
    before = score(s, 'Orianna').score;
  s.enemies = ['Malphite', 'Vi', null, null, null];
  assert(score(s, 'Orianna').reasons.some(r => r.rule === 'anti-engage'));
  assert.equal(score(s, 'Orianna').score, before + 9);
});
test('unknown profile is unknown, not evidence of absent effects', () => {
  assert.equal(composition(['NewChampion']).unknown, 1);
  assert.equal(composition(['NewChampion']).known, 0);
});
test('normalization repairs duplicates and malformed saved settings', () => {
  const s = normalizeState(
    {
      role: 'wrong',
      allies: ['Ahri', 'Ahri', 'MISSING'],
      enemies: ['Ahri'],
      bans: ['Zed'],
      personal: {Ahri: {preference: 100, mastery: 999}},
      filters: {patch: 77},
    },
    catalog,
  );
  assert.equal(s.role, 'MID');
  assert.deepEqual(s.allies, ['Ahri', null, null, null, null]);
  assert.equal(s.enemies[0], null);
  assert.equal(s.personal.Ahri.mastery, null);
  assert.equal(s.personal.Ahri.preference, 0);
  assert.equal(s.filters.patch, '');
});
test('build only appears after selecting own role slot', () => {
  const s = emptyState();
  s.allies[0] = 'Garen';
  assert.equal(buildDraft(s, catalog).status, 'empty');
  s.allies[2] = 'Ahri';
  assert.equal(buildDraft(s, catalog).status, 'ready');
});
test('champions without a manual profile receive a tag-and-role fallback item draft', () => {
  const c = fallbackCatalog();
  c.champions.push({id: 'UnprofiledCarry', name: '미분류 원딜', tags: ['Marksman']});
  const s = emptyState();
  s.role = 'ADC';
  s.allies[ROLES.indexOf('ADC')] = 'UnprofiledCarry';
  const build = buildDraft(s, c);
  assert.equal(build.status, 'ready');
  assert.equal(build.core.length, 6);
  assert(build.warnings.some(w => w.includes('일반 아이템 초안')));
});
test('heal profile adds contextual anti-heal alternative', () => {
  const s = emptyState();
  s.allies[2] = 'Ahri';
  assert(!buildDraft(s, catalog).alternatives.some(i => i.id === '3165'));
  s.enemies[4] = 'Soraka';
  assert(buildDraft(s, catalog).alternatives.some(i => i.id === '3165'));
});
test('enemy magic tendency changes boots', () => {
  const s = emptyState();
  s.allies[2] = 'Ahri';
  s.enemies = ['Gwen', 'Lillia', 'Viktor', null, null];
  assert.equal(buildDraft(s, catalog).boots.id, '3111');
});
test('jungle does not receive a lane starter', () => {
  const s = emptyState();
  s.role = 'JUNGLE';
  s.allies[1] = 'LeeSin';
  assert.equal(buildDraft(s, catalog).start, null);
});
test('support receives a support starter', () => {
  const s = emptyState();
  s.role = 'SUPPORT';
  s.allies[4] = 'Lux';
  assert.equal(buildDraft(s, catalog).start.id, '3865');
});
test('missing or ineligible official items are omitted', () => {
  const s = emptyState();
  s.allies[2] = 'Ahri';
  const c = {
    ...catalog,
    mode: 'official',
    items: {6655: {id: '6655', name: 'removed', maps: {11: true}, gold: {purchasable: false}}},
  };
  assert.equal(buildDraft(s, c).core.length, 0);
  assert(buildDraft(s, c).warnings.some(w => w.includes('제외')));
});
test('item validity checks map, store and champion constraints', () => {
  const i = {maps: {11: true}, gold: {purchasable: true}};
  assert(isPurchasable(i, 'Ahri'));
  assert(!isPurchasable({...i, maps: {12: true}}, 'Ahri'));
  assert(!isPurchasable({...i, requiredChampion: 'Viktor'}, 'Ahri'));
  assert(!isPurchasable({...i, requiredAlly: 'Ornn'}, 'Ahri'));
  assert(!isPurchasable({...i, inStore: false}, 'Ahri'));
});
test('all supported roles get at least five distinct core candidates and ADC gets six', () => {
  for (const role of ROLES) {
    const s = emptyState();
    s.role = role;
    const picks = recommendPicks(s, catalog);
    assert(picks.length >= 3);
    for (const p of picks) {
      s.allies[ROLES.indexOf(role)] = p.id;
      const b = buildDraft(s, catalog);
      assert.equal(b.status, 'ready');
      assert(b.core.length === 5 || b.core.length === 6);
      assert.equal(new Set(b.core.map(i => i.id)).size, b.core.length);
    }
  }
  const s = emptyState();
  s.role = 'BOTTOM';
  s.allies[ROLES.indexOf('BOTTOM')] = 'Jinx';
  assert.equal(buildDraft(s, catalog).core.length, 6);
});
test('official catalog tracks champion and item versions independently', () => {
  const c = {version: '16.20.1', data: {Ahri: {id: 'Ahri', key: '103', name: '아리'}}},
    i = {version: '16.20.2', data: {1055: {name: 'Doran'}}},
    catalog = normalizeCatalog('16.20.1', c, '16.20.2', i);
  assert.equal(catalog.championVersion, '16.20.1');
  assert.equal(catalog.itemVersion, '16.20.2');
  assert.equal(catalog.champions[0].key, '103');
  assert.equal(catalog.items['1055'].version, '16.20.2');
  assert.throws(() => normalizeCatalog('16.20.1', c, 'bad', i));
});

const withUnprofiled = () => {
  const c = fallbackCatalog();
  c.champions.push({id: 'Rell', name: '렐', tags: ['Tank', 'Support']});
  return c;
};
test('unannotated champions are candidates only when the user put them in the pool', () => {
  const c = withUnprofiled();
  const s = emptyState();
  assert(!recommendPicks(s, c).some(pick => pick.id === 'Rell'));
  s.pool = ['Rell'];
  const rell = recommendPicks(s, c).find(pick => pick.id === 'Rell');
  assert.equal(rell.dataStatus, 'insufficient');
  assert(rell.reasons.some(r => r.rule === 'role-unknown' && r.points === 0));
  assert(!rell.reasons.some(r => r.rule === 'role'));
  assert(rell.cautions.some(t => t.includes('직접 확인')));
});
test('unannotated pool champions get no composition credit, only personal evidence', () => {
  const c = withUnprofiled();
  const s = emptyState();
  s.allies = ['Garen', 'LeeSin', null, 'Jinx', null];
  s.enemies = ['Malphite', 'Sejuani', 'Ahri', null, 'Leona'];
  s.pool = ['Rell'];
  s.personal = {Rell: {preference: 2, mastery: 3}};
  const rell = recommendPicks(s, c).find(pick => pick.id === 'Rell');
  assert.deepEqual(rell.reasons.map(r => r.rule).sort(), ['mastery', 'pool', 'preference', 'role-unknown']);
  assert.equal(rell.score, 5 + 10 + 24);
  assert.equal(
    recommendPicks(s, c).find(pick => pick.id === 'Ahri'),
    undefined,
  );
  assert.equal(recommendPicks(s, c).find(pick => pick.id === 'Orianna').dataStatus, 'annotated');
});
test('default statistics tier is unspecified so tier-less OP.GG tools are usable', () => {
  assert.equal(emptyState().filters.tier, '');
});

test('user-assigned play roles restrict pool champions to those roles', () => {
  const c = withUnprofiled();
  const s = emptyState();
  s.pool = ['Rell', 'Orianna'];
  s.personal = {
    Rell: {preference: 0, mastery: 2, roles: ['SUPPORT']},
    Orianna: {preference: 0, mastery: null, roles: ['TOP']},
  };
  s.role = 'MID';
  assert(!recommendPicks(s, c).some(pick => pick.id === 'Rell'), '지정 역할이 아니면 미주석 챔피언은 제외');
  assert(!recommendPicks(s, c).some(pick => pick.id === 'Orianna'), '지정 역할이 아니면 프로필 챔피언도 제외');
  s.role = 'SUPPORT';
  const rell = recommendPicks(s, c).find(pick => pick.id === 'Rell');
  assert.equal(rell.reasons[0].rule, 'role-user');
  assert(rell.cautions.some(t => t.includes('내가 지정한 값')));
  assert(!rell.cautions.some(t => t.includes('직접 확인')));
  // 풀 밖 챔피언의 저장된 역할은 후보 제한에 쓰지 않는다.
  s.pool = ['Rell'];
  s.role = 'MID';
  assert(recommendPicks(s, c).some(pick => pick.id === 'Orianna'));
});
test('saved play roles are normalized to known roles', () => {
  const state = normalizeState({personal: {Ahri: {preference: 1, roles: ['MID', 'BOGUS', 'TOP', 'MID']}}}, catalog);
  assert.deepEqual(state.personal.Ahri.roles, ['TOP', 'MID']);
  assert.deepEqual(normalizeState({personal: {Ahri: {preference: 1}}}, catalog).personal.Ahri.roles, []);
});

test('situational alternatives carry the ontology path used as their rationale', () => {
  const s = emptyState();
  s.role = 'MID';
  s.allies[2] = 'Orianna';
  s.enemies = ['Aatrox', null, null, null, 'Soraka'];
  const alternative = buildDraft(s, catalog).alternatives.find(item => item.id === '3165');
  assert.deepEqual(alternative.path, [
    'Champion:Aatrox',
    'Champion:Soraka',
    'Effect:healing',
    'Effect:healing-reduction',
    'Item:3165',
  ]);
  assert.match(alternative.reason, /아트록스·소라카의 회복 → 회복 감소 대응 경로/);
});
