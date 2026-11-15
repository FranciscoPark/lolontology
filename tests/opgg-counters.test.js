import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COUNTER_FIELDS, parseCounterStats, renderCounterNote} from '../src/opgg-counters.js';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse);
const catalog = await fixture('ddragon/catalog-16.22.1.json');

test('counter fields are a subset of the documented analysis output fields', async () => {
  const tools = await fixture('opgg/tools-list.json');
  const list = (tools.tools || tools.result?.tools || tools)[0];
  const description = list.inputSchema.properties.desired_output_fields.description;
  for (const field of COUNTER_FIELDS) {
    const [path, subset] = field.split('.{');
    const documented = description.split('\n').find(line => line.startsWith(`- ${path}.{`));
    assert.ok(documented, `문서에 없는 경로: ${path}`);
    for (const name of subset.replace('}', '').split(',')) assert.ok(documented.includes(name), `${path}.${name}`);
  }
});

test('live counter response maps champion keys and keeps only valid rows', async () => {
  const stats = parseCounterStats((await fixture('opgg/counters-orianna.json')).result, catalog);
  assert.equal(stats.overall.play > 0, true);
  assert.equal(stats.strong.length, 3);
  assert.equal(stats.weak.length, 3);
  assert.ok([...stats.strong, ...stats.weak].every(row => row.championId && row.myWinRate >= 0 && row.myWinRate <= 1));
  assert.equal(parseCounterStats({content: [{type: 'text', text: 'not class text'}]}, catalog), null);
});

test('note highlights enemies found in the counter lists and states it is not scored', async () => {
  const stats = parseCounterStats((await fixture('opgg/counters-orianna.json')).result, catalog);
  const enemy = stats.weak[0].championId;
  const html = renderCounterNote({stats}, {enemies: [null, null, enemy, null, null]});
  assert.match(html, /class="facing"/);
  assert.match(html, /상성 목록에 있습니다/);
  assert.match(html, /점수 미반영/);
  assert.match(renderCounterNote({stats}, {enemies: []}), /상위 목록에 없습니다/);
  assert.match(renderCounterNote({error: '<x>'}), /&lt;x&gt;/);
  assert.equal(renderCounterNote(undefined), '');
});
