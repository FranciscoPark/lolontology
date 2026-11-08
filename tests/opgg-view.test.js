import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeOpggCall} from '../src/meta-estimate.js';
import {renderMetaResult, scopeTable} from '../src/opgg-view.js';
import {serializeArguments} from '../src/opgg-ui.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/opgg/${name}.json`, import.meta.url)));
const catalog = {champions: ['Ahri', 'Ekko', 'Leblanc', 'Syndra'].map(id => ({id, key: id, name: id}))};
const names = {Ahri: '아리', Ekko: '에코', Leblanc: '르블랑', Syndra: '신드라'};

test('form entries serialize to exactly the request JSON accepted by the live schema', () => {
  const tools = fixture('tools-list').tools;
  const analysis = tools.find(tool => tool.name === 'lol_get_champion_analysis');
  const success = fixture('champion-analysis-success');
  const entries = [
    ['game_mode', 'ranked'],
    ['champion', 'AHRI'],
    ['position', 'mid'],
    ['tier', ''],
    ['lang', ''],
    ['desired_output_fields', success.arguments.desired_output_fields.join(', ')],
  ];
  assert.deepEqual(serializeArguments(entries, analysis.inputSchema), success.arguments);
  const lane = tools.find(tool => tool.name === 'lol_list_lane_meta_champions');
  assert.deepEqual(
    serializeArguments(
      [
        ['position', 'mid'],
        ['desired_output_fields', fixture('lane-meta-mid').arguments.desired_output_fields[0]],
      ],
      lane.inputSchema,
    ),
    fixture('lane-meta-mid').arguments,
  );
});

test('scope table never presents an unconfirmed requested filter as applied', () => {
  const [estimate] = normalizeOpggCall(fixture('champion-analysis-trends'), catalog).estimates;
  const html = scopeTable(estimate);
  assert.match(
    html,
    /<th scope="row">티어<\/th><td>gold<\/td><td>미확인<\/td><td><span class="scope-unknown">응답 미확인/,
  );
  assert.match(html, /<th scope="row">패치<\/th><td>지정 불가<\/td><td>미확인<\/td>/);
  assert.doesNotMatch(html, /scope-ok/);
});

test('champion summary view shows statistics, trend patch caveat and the ranking exclusion', () => {
  const html = renderMetaResult(normalizeOpggCall(fixture('champion-analysis-trends'), catalog), {
    nameOf: id => names[id],
  });
  assert.match(html, /아리 · OP.GG 집계/);
  assert.match(html, /승률 51.0%/);
  assert.match(html, /data.trends.pick.version = 16.22/);
  assert.match(html, /요약·빌드 통계의 패치로 단정하지 않습니다/);
  assert.match(html, /추천 점수에 반영하지 않음/);
  assert.match(html, /OP.GG MCP/);
});

test('lane meta view lists resolved champions, marks the pool and reports unresolved names', () => {
  const html = renderMetaResult(normalizeOpggCall(fixture('lane-meta-mid'), catalog), {
    nameOf: id => names[id],
    pool: ['Syndra'],
    limit: 3,
  });
  assert.match(html, /mid 라인 메타 · 상위 3\/4명/);
  assert.match(html, /<th scope="row">아리<\/th>/);
  assert.doesNotMatch(html, /신드라/, 'limit 밖의 행은 표시하지 않는다');
  assert.match(html, /연결하지 못한 OP.GG 챔피언: .*Katarina/);
  const withPool = renderMetaResult(normalizeOpggCall(fixture('lane-meta-mid'), catalog), {
    nameOf: id => names[id],
    pool: ['Syndra'],
  });
  assert.match(withPool, /class="in-pool"><td>10<\/td><th scope="row">신드라 <small>내 풀<\/small>/);
});

test('view escapes provider text', () => {
  const call = {
    tool: 'lol_get_champion_analysis',
    arguments: {champion: '<img src=x onerror=alert(1)>', position: 'mid', game_mode: 'ranked'},
    result: {
      content: [
        {
          type: 'text',
          text: 'class R: data\nclass Data: summary\nclass Summary: average_stats\nclass AverageStats: play,win_rate\n\nR(Data(Summary(AverageStats(10,0.5))))',
        },
      ],
    },
  };
  const html = renderMetaResult(normalizeOpggCall(call, catalog));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('unavailable normalization is shown as a failure, not an empty table', () => {
  assert.match(
    renderMetaResult({status: 'unavailable', reason: '응답에 data가 없습니다.'}),
    /통계를 정규화하지 못했습니다: 응답에 data가 없습니다/,
  );
});

test('field lists keep commas inside brace groups', async () => {
  const {splitFieldList} = await import('../src/opgg-ui.js');
  assert.deepEqual(splitFieldList('data.summary.average_stats.{ban_rate,pick_rate}, data.boots, data.fourth_items[]'), [
    'data.summary.average_stats.{ban_rate,pick_rate}',
    'data.boots',
    'data.fourth_items[]',
  ]);
});

test('default output fields are accepted by the live closed field list', async () => {
  const {defaultOutputFields} = await import('../src/opgg-ui.js');
  const tools = fixture('tools-list').tools;
  for (const [name, role] of [
    ['lol_get_champion_analysis', 'MID'],
    ['lol_list_lane_meta_champions', 'SUPPORT'],
  ]) {
    const description = tools.find(tool => tool.name === name).inputSchema.properties.desired_output_fields.description;
    for (const field of defaultOutputFields(name, role)) {
      const base = field.replace(/\{([^}]*)\}$/, '').replace(/\.$/, '');
      assert.ok(description.includes(base), `${name}: ${field} not in closed list`);
      const subfields = /\{([^}]*)\}$/.exec(field)?.[1].split(',') || [];
      const line = description.split('\n').find(row => row.startsWith(`- ${base}.{`));
      for (const sub of subfields) assert.ok(line?.includes(sub), `${name}: ${base}.${sub} not documented`);
    }
  }
  assert.match(defaultOutputFields('lol_list_lane_meta_champions', 'SUPPORT')[0], /^data\.positions\.support\[\]/);
});
