import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PROFILES, ROLES, TRAITS, profileFor} from '../src/ontology.js';
import {ROLE_OVERRIDES, EXTRA_ROLES} from '../src/role-overrides.js';
import {BUILD_TEMPLATES} from '../src/templates.js';
import {buildDraft, composition, emptyState, recommendPicks} from '../src/engine.js';
import {createOntology, ontologyNeighborhood} from '../src/graph.js';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/ddragon/catalog-16.22.1.json', import.meta.url)));
const slot = (role, id) => ROLES.map(r => (r === role ? id : null));

test('every role override targets a profile role and uses valid vocabulary', () => {
  for (const [id, byRole] of Object.entries(ROLE_OVERRIDES)) {
    assert.ok(PROFILES[id], `프로필 없음: ${id}`);
    for (const [role, override] of Object.entries(byRole)) {
      assert.ok(PROFILES[id].roles.includes(role), `${id}: ${role}은 프로필 포지션이 아님`);
      assert.ok(Object.keys(override).length, `${id}.${role}: 빈 override`);
      assert.ok(
        Object.keys(override).every(key => ['damage', 'build', 'traits'].includes(key)),
        `${id}.${role}`,
      );
      if (override.build) assert.ok(BUILD_TEMPLATES[override.build], `${id}.${role}: ${override.build}`);
      if (override.damage) assert.ok(['physical', 'magic', 'mixed'].includes(override.damage));
      for (const trait of override.traits || []) assert.ok(TRAITS[trait], `${id}.${role}: ${trait}`);
    }
  }
  for (const [id, roles] of Object.entries(EXTRA_ROLES))
    for (const role of roles) assert.ok(PROFILES[id].roles.includes(role), `${id}: ${role} 미반영`);
});

test('profileFor resolves the slot position and falls back to the base profile outside it', () => {
  assert.equal(profileFor('Galio', 'MID').build, 'mage');
  assert.equal(profileFor('Galio', 'SUPPORT').build, 'supporttank');
  assert.equal(profileFor('Galio', 'SUPPORT').roleSpecific, true);
  assert.equal(profileFor('Galio', 'MID').roleSpecific, false);
  // 프로필 밖 포지션(탑 갈리오)은 기본값이다.
  assert.equal(profileFor('Galio', 'TOP').build, 'mage');
  assert.equal(profileFor('Shaco', 'SUPPORT').damage, 'magic');
  assert.equal(profileFor('Shaco', 'JUNGLE').damage, 'physical');
  assert.equal(profileFor('NoSuchChampion', 'MID'), null);
});

test('composition evaluates each champion with its slot position', () => {
  assert.equal(composition(slot('JUNGLE', 'Shaco')).damage.physical, 1);
  assert.equal(composition(slot('SUPPORT', 'Shaco')).damage.magic, 1);
  assert.equal(composition(slot('TOP', 'Pantheon')).traits.cc, 1);
  assert.equal(composition(slot('MID', 'Pantheon')).traits.cc, 0, '프로필 밖 포지션은 기본 특성');
});

test('item draft and pick reasons use the position-specific profile', () => {
  const draft = role => buildDraft({...emptyState(), role, allies: slot(role, 'Malphite')}, catalog);
  assert.equal(draft('TOP').family, 'tank');
  assert.equal(draft('SUPPORT').family, 'supporttank');
  assert.equal(draft('MID').family, 'mage');
  assert.match(draft('MID').evidence.find(entry => entry.kind === 'template').text, /미드 포지션별 주석/);
  const support = recommendPicks({...emptyState(), role: 'SUPPORT'}, catalog).find(pick => pick.id === 'Galio');
  assert.ok(support, '서포터 갈리오 후보 없음');
  assert.match(support.reasons.find(reason => reason.rule === 'role').text, /포지션별 주석/);
});

test('graph relations carry the positions where they hold', () => {
  const graph = createOntology(catalog);
  const shaco = ontologyNeighborhood(graph, 'Champion', 'Shaco', {}, 80).relations;
  const magic = shaco.find(
    relation => relation.relationship === 'APPLIES_EFFECT' && relation.targetId === 'magic-damage',
  );
  assert.deepEqual([magic.roles, magic.base, magic.partial], [['SUPPORT'], false, true]);
  const roles = shaco.filter(relation => relation.relationship === 'PLAYS_ROLE').map(relation => relation.targetId);
  assert.deepEqual(roles.sort(), ['JUNGLE', 'SUPPORT']);
  const ahri = ontologyNeighborhood(graph, 'Champion', 'Ahri', {}, 80).relations;
  assert.ok(ahri.filter(relation => relation.relationship === 'HAS_TRAIT').every(relation => !relation.partial));
});
