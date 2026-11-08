import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateEditorialData} from '../scripts/validate-data.mjs';
import {BUILD_TEMPLATES, SITUATIONAL_ITEMS} from '../src/templates.js';
import {PROFILES} from '../src/ontology.js';

const allIds = () => [
  ...new Set([...Object.values(BUILD_TEMPLATES).flatMap(t => [t.start, t.boots, ...t.core]), ...SITUATIONAL_ITEMS]),
];
const catalogWith = ids => ({
  champions: Object.values(PROFILES).map(p => ({id: p.id, name: p.name})),
  items: Object.fromEntries(ids.map(id => [id, {id, name: `item ${id}`, maps: {11: true}, gold: {purchasable: true}}])),
});

test('every item id literal in engine and templates is covered by templates or SITUATIONAL_ITEMS', () => {
  const source = ['../src/engine.js', '../src/templates.js', '../src/ontology.js']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8'))
    .join('\n');
  const literals = [...source.matchAll(/'(\d{4})'/g)].map(match => match[1]);
  const covered = new Set(allIds());
  assert.deepEqual(
    literals.filter(id => !covered.has(id)),
    [],
  );
});

test('validation passes for a catalog with every editorial item and reports removed or unbuyable ones', () => {
  const ok = validateEditorialData(catalogWith(allIds()));
  assert.deepEqual(ok.problems, []);
  const catalog = catalogWith(allIds().filter(id => id !== '3165'));
  catalog.items['3111'].gold.purchasable = false;
  catalog.champions = catalog.champions.filter(c => c.id !== 'Ahri');
  const {problems} = validateEditorialData(catalog);
  assert.ok(problems.some(p => p.includes('3165') && p.includes('없습니다')));
  assert.ok(problems.some(p => p.includes('3111') && p.includes('구매할 수 없습니다')));
  assert.ok(problems.some(p => p.includes('Ahri')));
});
