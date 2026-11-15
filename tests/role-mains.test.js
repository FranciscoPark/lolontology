import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, recommendPicks} from '../src/engine.js';
import {fallbackCatalog} from '../src/catalog.js';
import {roleMains, toggleRoleMain} from '../src/role-mains.js';

const catalog = fallbackCatalog();

test('registering a role main adds it to the pool with that role and top preference', () => {
  let s = toggleRoleMain(emptyState(), 'Ahri', 'MID');
  assert.deepEqual(s.pool, ['Ahri']);
  assert.deepEqual(s.personal.Ahri.roles, ['MID']);
  assert.equal(s.personal.Ahri.preference, 2);
  assert.deepEqual(roleMains(s, 'MID'), ['Ahri']);
  assert.deepEqual(roleMains(s, 'TOP'), []);
  s = {...s, role: 'MID'};
  const ahri = recommendPicks(s, catalog).find(pick => pick.id === 'Ahri');
  assert.ok(ahri.reasons.some(reason => reason.rule === 'preference'));
});

test('unregistering removes the role, and the champion leaves the pool when no role is left', () => {
  let s = toggleRoleMain(toggleRoleMain(emptyState(), 'Galio', 'MID'), 'Galio', 'SUPPORT');
  s = toggleRoleMain(s, 'Galio', 'MID');
  assert.deepEqual(s.personal.Galio.roles, ['SUPPORT']);
  assert.ok(s.pool.includes('Galio'));
  s = toggleRoleMain(s, 'Galio', 'SUPPORT');
  assert.deepEqual(s.pool, []);
  assert.equal(s.personal.Galio, undefined);
});

test('a pool champion without explicit roles keeps its profile roles when registered', () => {
  const s = toggleRoleMain(
    {...emptyState(), pool: ['Galio'], personal: {Galio: {preference: 1, mastery: 3, roles: []}}},
    'Galio',
    'SUPPORT',
  );
  assert.ok(s.personal.Galio.roles.includes('MID'), '기존 프로필 역할 유지');
  assert.ok(s.personal.Galio.roles.includes('SUPPORT'));
  assert.equal(s.personal.Galio.mastery, 3, '숙련도는 건드리지 않음');
});
