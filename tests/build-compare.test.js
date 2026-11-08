import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildDraft, emptyState} from '../src/engine.js';
import {BUILD_TEMPLATES, SITUATIONAL_ITEMS} from '../src/templates.js';
import {parseOpggItemBuild} from '../src/opgg-build.js';
import {resultText} from '../src/opgg-ui.js';
import {compareBuilds, renderBuildComparison} from '../src/build-compare.js';
import {PROFILES} from '../src/ontology.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/opgg/champion-analysis-success.json', import.meta.url)));
const ids = new Set([
  ...[...resultText(fixture.result).matchAll(/\b\d{4,6}\b/g)].map(match => match[0]),
  ...Object.values(BUILD_TEMPLATES).flatMap(t => [t.start, t.boots, ...t.core]),
  ...SITUATIONAL_ITEMS,
]);
const catalog = {
  mode: 'official',
  version: '16.22.1',
  championVersion: '16.22.1',
  itemVersion: '16.22.1',
  champions: Object.values(PROFILES).map(p => ({id: p.id, name: p.name, tags: []})),
  items: Object.fromEntries(
    [...ids].map(id => [id, {id, name: `item-${id}`, maps: {11: true}, gold: {purchasable: true, total: 1000}}]),
  ),
};
const ahriState = () => {
  const state = emptyState();
  state.role = 'MID';
  state.allies[2] = 'Ahri';
  return state;
};
const external = () => parseOpggItemBuild(fixture.result, catalog, {championId: 'Ahri', arguments: fixture.arguments});

test('template draft reports item patch and separates template, composition and personal evidence', () => {
  const state = ahriState();
  state.personal = {Ahri: {preference: 1, mastery: 3}};
  const draft = buildDraft(state, catalog);
  assert.equal(draft.itemVersion, '16.22.1');
  assert.deepEqual(
    draft.evidence.map(e => e.kind),
    ['template', 'composition', 'personal'],
  );
  assert.match(draft.evidence[0].text, /편집 프로필\(editorial-v0, prototype\)/);
  assert.match(draft.evidence[1].text, /상대 조합 미입력/);
  assert.match(draft.evidence[2].text, /주력.*반영하지 않음/);
});

test('comparison lines up template items with OP.GG observations on the same item patch', () => {
  const draft = buildDraft(ahriState(), catalog);
  const comparison = compareBuilds(draft, external());
  assert.equal(comparison.status, 'ready');
  assert.equal(comparison.itemVersion, '16.22.1');
  const byId = Object.fromEntries(comparison.rows.map(row => [row.item.id, row]));
  // 템플릿 mage 코어의 그림자불꽃(4645)과 존야(3157)는 실제 응답에 있다.
  assert.equal(byId['4645'].stat.groupKey, 'core_items');
  assert.equal(byId['3157'].stat !== null, true);
  // 루덴의 메아리(6655)는 이 응답에 없다.
  assert.equal(byId['6655'].stat, null);
  assert.ok(comparison.coreOverlap.matched >= 2 && comparison.coreOverlap.total === 5);
  assert.ok(
    comparison.statOnly.some(entry => entry.item.id === '3118'),
    '악의(3118)는 통계에만 있다',
  );
  assert.ok(comparison.statOnly.every(entry => entry.stat.groupKey !== 'starter_items'));
});

test('comparison refuses different champions or item patches', () => {
  const draft = buildDraft(ahriState(), catalog);
  assert.match(compareBuilds(draft, {...external(), itemVersion: '16.21.1'}).reason, /아이템 패치가 다릅니다/);
  assert.match(compareBuilds(draft, {...external(), championId: 'Zed'}).reason, /챔피언이 다릅니다/);
  assert.equal(compareBuilds(draft, {status: 'unavailable'}).status, 'unavailable');
  assert.equal(compareBuilds({status: 'empty'}, external()).status, 'unavailable');
});

test('comparison view keeps sources apart and avoids optimality claims', () => {
  const html = renderBuildComparison(compareBuilds(buildDraft(ahriState(), catalog), external()), {
    templateLabel: '주문력 중심',
  });
  assert.match(html, /템플릿 근거 · 주문력 중심/);
  assert.match(html, /OP.GG 통계 \(범위 미확인\)/);
  assert.match(html, /통계 응답에 없음/);
  assert.match(html, /승률 개선이나 최적 빌드를 뜻하지 않습니다/);
  assert.match(renderBuildComparison({status: 'unavailable', reason: 'x'}), /비교 미표시: x/);
});
