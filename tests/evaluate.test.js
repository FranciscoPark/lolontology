import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate, itemViolations, loadCatalog, pickViolations, renderReport} from '../scripts/evaluate.mjs';
import {buildDraft, emptyState, recommendPicks} from '../src/engine.js';
import {createOntology} from '../src/graph.js';

test('fixed and generated scenarios have zero constraint violations on two separate patches', () => {
  const report = evaluate();
  assert.deepEqual(
    report.patches.map(p => p.version),
    ['16.20.1', '16.22.1'],
  );
  for (const patch of report.patches) assert.deepEqual(patch.violations, [], patch.version);
  assert.ok(report.scenarioCount >= 200);
  assert.deepEqual(
    report.notComputed.map(item => item.metric),
    ['Recall@K · NDCG', 'OP.GG 메타 기여 ablation', '승률 개선'],
  );
  assert.match(renderReport(report), /\| 16\.22\.1 \| 0건 \|/);
});

test('the evaluation detects deliberately broken picks', () => {
  const catalog = loadCatalog('16.22.1');
  const state = {...emptyState(), bans: ['Ahri', ...Array(9).fill(null)]};
  const picks = recommendPicks(emptyState(), catalog);
  const ahri = picks.find(pick => pick.id === 'Ahri');
  assert.ok(pickViolations(state, [ahri], catalog).some(problem => problem.includes('이미 픽·밴된 Ahri')));
  assert.ok(pickViolations(state, [{...ahri, id: 'Zed', score: 999}], catalog).some(p => p.includes('근거 합 불일치')));
  assert.ok(pickViolations(state, [{...ahri, id: 'Jinx'}], catalog).some(p => p.includes('역할 밖 Jinx')));
});

test('the evaluation detects items from another patch, unbuyable items and pathless alternatives', () => {
  const oldCatalog = loadCatalog('16.20.1'),
    catalog = loadCatalog('16.22.1');
  const removed = Object.keys(oldCatalog.items).filter(id => !catalog.items[id]);
  assert.ok(removed.length > 0, '두 패치 사이에 삭제된 아이템이 있어야 분리 검증이 의미가 있다');
  const state = {...emptyState(), role: 'MID', allies: [null, null, 'Ahri', null, null]};
  const graph = createOntology(catalog);
  const draft = buildDraft(state, catalog, graph);
  assert.deepEqual(itemViolations(draft, catalog, graph), []);
  const broken = {
    ...draft,
    core: [...draft.core, {...oldCatalog.items[removed[0]], version: '16.20.1'}],
    alternatives: [{...catalog.items['3165'], path: []}],
  };
  const problems = itemViolations(broken, catalog, graph);
  assert.ok(problems.some(p => p.includes(`패치 16.22.1에 없는 아이템 ${removed[0]}`)));
  assert.ok(problems.some(p => p.includes('다른 패치 아이템')));
  assert.ok(problems.some(p => p.includes('경로 없는 대안 3165')));
});
