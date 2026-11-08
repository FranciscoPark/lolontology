import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {OpggClient, decodeRpc, validateArguments, ENDPOINT} from '../scripts/opgg.mjs';
import {
  fieldKind,
  matchEnum,
  supportedFilters,
  missingRequestedFilters,
  outputFieldOptions,
  suggestedOutputFields,
  OPGG_ITEM_BUILD_FIELDS,
  serializeArguments,
  resultText,
  parseChampionAnalysisStats,
} from '../src/opgg-ui.js';
import {parseOpggItemBuild} from '../src/opgg-build.js';
test('JSON and SSE RPC decoding select the matching response', () => {
  assert.deepEqual(decodeRpc('{"id":1,"result":{"ok":true}}', 1), {ok: true});
  assert.deepEqual(decodeRpc('event: message\ndata: {"id":2,"result":{"ok":true}}\n\n', 2), {ok: true});
  assert.throws(() => decodeRpc('{"id":2,"result":{}}', 1));
  assert.throws(() => decodeRpc('{"id":1,"error":{"message":"denied"}}', 1), /denied/);
});
test('query arguments follow discovered schema, rejecting unsupported tier/patch and output fields', () => {
  const s = {
    required: ['region'],
    properties: {
      region: {type: 'string', enum: ['kr', 'global']},
      desired_output_fields: {type: 'array', items: {type: 'string', enum: ['data.win_rate']}},
    },
  };
  assert.throws(() => validateArguments(s, {}), /누락/);
  assert.throws(() => validateArguments(s, {region: 'xx'}), /값/);
  assert.throws(() => validateArguments(s, {region: 'kr', patch: '16.20'}), /지원하지/);
  assert.throws(() => validateArguments(s, {region: 'kr', desired_output_fields: ['secret']}), /배열 조건 오류/);
  validateArguments(s, {region: 'kr', desired_output_fields: ['data.win_rate']});
});
test('enum matching never silently substitutes a plus bracket', () => {
  assert.equal(matchEnum('gold', ['GOLD', 'EMERALD_PLUS']), 'GOLD');
  assert.equal(matchEnum('emerald', ['EMERALD_PLUS']), undefined);
});
test('filter availability comes from tool schema and position maps to role', () => {
  assert.equal(fieldKind('target_champion_id'), 'champion');
  assert.equal(fieldKind('position'), 'role');
  const tool = {inputSchema: {properties: {region: {}, position: {}, tier: {}}}};
  const f = supportedFilters(tool);
  assert(f.has('region'));
  assert(f.has('tier'));
  assert(!f.has('patch'));
  assert(f.has('role'));
  assert.deepEqual(missingRequestedFilters(tool), ['patch']);
});
test('closed response field choices include item-build fields and retain selected arrays', () => {
  const schema = {
    type: 'array',
    items: {type: 'string', enum: ['data.win_rate', 'data.pick_rate', 'data.core_items', 'data.boots', 'data.lore']},
  };
  assert.deepEqual(outputFieldOptions(schema), [
    'data.win_rate',
    'data.pick_rate',
    'data.core_items',
    'data.boots',
    'data.lore',
  ]);
  assert.deepEqual(suggestedOutputFields(schema), ['data.win_rate', 'data.pick_rate', 'data.core_items', 'data.boots']);
  assert.deepEqual(
    serializeArguments(
      [
        ['game_mode', 'ranked'],
        ['desired_output_fields', 'data.win_rate'],
        ['desired_output_fields', 'data.pick_rate'],
      ],
      {properties: {game_mode: {type: 'string'}, desired_output_fields: schema}},
    ),
    {game_mode: 'ranked', desired_output_fields: ['data.win_rate', 'data.pick_rate']},
  );
});
test('required output field arrays without enumerated choices can be entered as comma-separated paths', () => {
  const schema = {type: 'array', items: {type: 'string', description: '필드 경로 입력'}};
  assert.deepEqual(outputFieldOptions(schema), []);
  assert.deepEqual(
    serializeArguments([['desired_output_fields', 'data.win_rate, data.pick_rate']], {
      properties: {desired_output_fields: schema},
    }),
    {desired_output_fields: ['data.win_rate', 'data.pick_rate']},
  );
});
test('observed OP.GG item build paths serialize into required output fields', () => {
  const schema = {type: 'array', items: {type: 'string'}};
  assert.deepEqual(
    serializeArguments([['desired_output_fields', OPGG_ITEM_BUILD_FIELDS.join(',')]], {
      properties: {desired_output_fields: schema},
    }).desired_output_fields,
    OPGG_ITEM_BUILD_FIELDS,
  );
});
test('response display supports structured and text content without execution', () => {
  assert.equal(resultText({content: [{type: 'text', text: '{"data":1}'}]}), '{"data":1}');
  assert(resultText({structuredContent: {data: 2}}).includes('2'));
});
test('champion analysis summary parses only the observed six-number AverageStats form', () => {
  const sample = {
    content: [{type: 'text', text: 'LolGetChampionAnalysis(Data(Summary(AverageStats(12510,0.51,0.09,0.03,3,31))))'}],
  };
  assert.deepEqual(parseChampionAnalysisStats(sample), {
    play: 12510,
    winRate: 0.51,
    pickRate: 0.09,
    banRate: 0.03,
    tier: 3,
    rank: 31,
  });
  assert.equal(parseChampionAnalysisStats({content: [{type: 'text', text: 'AverageStats(12510,0.51)'}]}), null);
});
test('OP.GG item build groups follow the declared class Data field order, not a fixed position', () => {
  const catalog = {
    mode: 'official',
    itemVersion: '16.20.1',
    items: Object.fromEntries(
      ['3118', '4645', '3157', '3020', '1056', '2003', '3089', '3041', '3135', '4629', '3102'].map(id => [
        id,
        {id, name: `Item ${id}`, maps: {11: true}, gold: {purchasable: true}},
      ]),
    ),
  };
  // 실제 응답처럼 last_items가 starter_items 바로 뒤에 선언된다.
  const text = `class Data: core_items,boots,starter_items,last_items,fourth_items,fifth_items,sixth_items
class CoreItems: ids,ids_names,play,win,pick_rate

LolGetChampionAnalysis(Data(CoreItems([3118,4645,3157],["Malignance","Shadowflame","Zhonya's Hourglass"],1171,629,0.13),CoreItems([3020],["Sorcerer's Shoes"],8848,4621,0.58),CoreItems([1056,2003,2003],["Doran's Ring","Health Potion","Health Potion"],15400,7916,0.99),[CoreItems([4629],["Cosmic Drive"],4,1,0.17)],[CoreItems([3118],["Malignance"],10083,5232,0.64)],[CoreItems([3089],["Rabadon"],1213,716,0.32)],[CoreItems([3135],["Void Staff"],224,138,0.22)]))`;
  const build = parseOpggItemBuild({content: [{type: 'text', text}]}, catalog, {
    championId: 'Ahri',
    arguments: {position: 'mid', tier: 'gold'},
  });
  assert.equal(build.status, 'ready');
  const first = key => build.groups.find(g => g.key === key).choices[0].items.map(i => i.id);
  assert.deepEqual(first('core_items'), ['3118', '4645', '3157']);
  assert.equal(build.groups[0].choices[0].play, 1171);
  assert.deepEqual(first('last_items'), ['4629']);
  assert.deepEqual(first('fourth_items'), ['3118']);
  assert.deepEqual(first('fifth_items'), ['3089']);
  assert.deepEqual(first('sixth_items'), ['3135']);
  assert.equal(build.itemVersion, '16.20.1');
  assert.equal(build.tier, 'gold');
});

test('live OP.GG fixture with a leading summary field keeps every item group labelled correctly', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/opgg/champion-analysis-success.json', import.meta.url)));
  const ids = [...resultText(fixture.result).matchAll(/\d{4,6}/g)].map(match => match[0]);
  const catalog = {
    mode: 'official',
    itemVersion: 'fixture',
    items: Object.fromEntries(ids.map(id => [id, {id, name: id, maps: {11: true}, gold: {purchasable: true}}])),
  };
  const build = parseOpggItemBuild(fixture.result, catalog, {championId: 'Ahri', arguments: fixture.arguments});
  assert.equal(build.status, 'ready');
  const first = key => build.groups.find(g => g.key === key)?.choices[0].items.map(i => i.id);
  assert.deepEqual(first('core_items'), ['3118', '4645', '3157']);
  assert.deepEqual(first('boots'), ['3020']);
  assert.deepEqual(first('starter_items'), ['1056', '2003', '2003']);
  assert.deepEqual(first('last_items'), ['3118']);
  assert.deepEqual(first('fourth_items'), ['3089']);
  const stats = parseChampionAnalysisStats(fixture.result);
  assert.ok(stats.play > 0 && stats.winRate > 0 && stats.winRate < 1);
});

test('item build without a class Data declaration is not guessed', () => {
  const catalog = {
    mode: 'official',
    itemVersion: 'x',
    items: {3020: {id: '3020', maps: {11: true}, gold: {purchasable: true}}},
  };
  const text =
    'LolGetChampionAnalysis(Data(CoreItems([3020],["Shoes"],10,5,0.5),CoreItems([3020],["Shoes"],10,5,0.5)))';
  const build = parseOpggItemBuild({content: [{type: 'text', text}]}, catalog, {championId: 'Ahri'});
  assert.equal(build.status, 'unavailable');
  assert.match(build.reason, /class Data/);
});

test('average stats follow the declared field order when kda is also requested', () => {
  const text =
    'class AverageStats: ban_rate,kda,pick_rate,play,rank,tier,win_rate\n\nX(Data(Summary(AverageStats(0.03,2.9,0.12,80342,2,1,0.51))))';
  assert.deepEqual(parseChampionAnalysisStats({content: [{type: 'text', text}]}), {
    play: 80342,
    winRate: 0.51,
    pickRate: 0.12,
    banRate: 0.03,
    tier: 1,
    rank: 2,
  });
});
test('OP.GG item stats reject non-purchasable or unknown current-patch ids', () => {
  const catalog = {
    mode: 'official',
    itemVersion: '16.20.1',
    items: {1001: {id: '1001', name: 'Boots', maps: {11: true}, gold: {purchasable: false}}},
  };
  const build = parseOpggItemBuild(
    {
      content: [
        {
          type: 'text',
          text: 'class Data: core_items,boots,starter_items,last_items,fourth_items,fifth_items,sixth_items\nclass CoreItems: ids,ids_names,play,win,pick_rate\n\nLolGetChampionAnalysis(Data(CoreItems([1001,9999],["Boots","Unknown"],50,20,0.2),CoreItems([],[],50,20,0.2),CoreItems([],[],50,20,0.2),[],[],[],[]))',
        },
      ],
    },
    catalog,
    {championId: 'Ahri'},
  );
  assert.equal(build.status, 'unavailable');
  assert.deepEqual(build.omitted, ['1001', '9999']);
});
test('MCP client initializes, discovers and performs only allowed read calls', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    assert.equal(url, ENDPOINT);
    const body = JSON.parse(options.body);
    calls.push(body);
    let result = {};
    if (body.method === 'initialize') result = {protocolVersion: '2025-03-26'};
    if (body.method === 'tools/list')
      result = {
        tools: [
          {
            name: 'lol_get_champion_analysis',
            inputSchema: {properties: {region: {type: 'string'}}, required: ['region']},
          },
          {name: 'unsafe_write', inputSchema: {}},
        ],
      };
    if (body.method === 'tools/call') result = {content: [{type: 'text', text: '{"data":{}}'}]};
    return new Response(JSON.stringify({jsonrpc: '2.0', id: body.id, result}), {
      headers: {'content-type': 'application/json', 'mcp-session-id': 'test-session'},
    });
  };
  const client = new OpggClient(fetcher);
  assert.equal((await client.list()).length, 1);
  const result = await client.call('lol_get_champion_analysis', {region: 'kr'});
  assert.equal(result.source, ENDPOINT);
  assert.equal(calls.filter(c => c.method === 'initialize').length, 1);
  assert(calls.some(c => c.method === 'notifications/initialized'));
  await assert.rejects(() => client.call('unsafe_write', {}));
  await assert.rejects(() => client.call('lol_get_champion_analysis', {tier: 'gold'}));
});
test('authentication failure is visible, not replaced with demo statistics', async () => {
  const client = new OpggClient(async () => new Response('', {status: 401}));
  await assert.rejects(() => client.list(), /인증/);
  assert.equal(client.ready, null);
});
test('MCP tool error is not a successful query', async () => {
  const client = new OpggClient();
  client.tools = [{name: 'lol_get_champion_analysis', inputSchema: {properties: {}}}];
  client.ready = Promise.resolve();
  client.rpc = async () => ({isError: true, content: [{type: 'text', text: 'unsupported patch'}]});
  await assert.rejects(() => client.call('lol_get_champion_analysis', {}), /unsupported patch/);
});
