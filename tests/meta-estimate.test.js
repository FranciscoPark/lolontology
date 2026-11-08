import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeOpggCall, rankingGate, resolveProviderChampion, UNKNOWN} from '../src/meta-estimate.js';
import {parseOpggText, OpggTextError} from '../src/opgg-text.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/opgg/${name}.json`, import.meta.url)));
// Data Dragon ID 규칙을 따른 오프라인 카탈로그. 표시명과 대소문자·기호가 다른 경우를 포함한다.
const catalog = {
  champions: [
    'Ahri',
    'Ekko',
    'Katarina',
    'Leblanc',
    'Velkoz',
    'KogMaw',
    'TwistedFate',
    'AurelionSol',
    'MonkeyKing',
    'Nunu',
  ].map(id => ({id, key: id, name: id})),
};

test('class text parser names values only through declarations and rejects guesses', () => {
  const parsed = parseOpggText('class R: data\nclass Data: a,b\n\nR(Data([1,2],"x"))');
  assert.deepEqual(parsed, {data: {a: [1, 2], b: 'x'}});
  assert.throws(() => parseOpggText('R(Data(1))'), OpggTextError);
  assert.throws(() => parseOpggText('class R: data\nclass Data: a,b\n\nR(Data(1))'), /값 1개가 선언 2개와 다름/);
  assert.throws(() => parseOpggText('class R: data\n\nR(alert(1))'), OpggTextError);
  assert.throws(() => parseOpggText('class R: data\n\nR(1) trailing'), /해석하지 않은 내용/);
});

test('provider champion names map to Data Dragon ids without guessing unknown names', () => {
  assert.equal(resolveProviderChampion('LeBlanc', catalog), 'Leblanc');
  assert.equal(resolveProviderChampion("Vel'Koz", catalog), 'Velkoz');
  assert.equal(resolveProviderChampion('Twisted Fate', catalog), 'TwistedFate');
  assert.equal(resolveProviderChampion('Wukong', catalog), 'MonkeyKing');
  assert.equal(resolveProviderChampion('Nunu & Willump', catalog), 'Nunu');
  assert.equal(resolveProviderChampion('AHRI', catalog), 'Ahri');
  assert.equal(resolveProviderChampion('Not A Champion', catalog), null);
});

test('champion analysis summary keeps requested and returned scope separate', () => {
  const normalized = normalizeOpggCall(fixture('champion-analysis-trends'), catalog);
  assert.equal(normalized.status, 'ready');
  const [estimate] = normalized.estimates;
  assert.equal(estimate.championId, 'Ahri');
  assert.deepEqual(estimate.requestedScope, {
    region: 'not-requestable',
    queue: 'ranked',
    role: 'mid',
    tier: 'gold',
    patch: 'not-requestable',
  });
  // 요청값을 반환 범위로 복사하지 않는다.
  assert.deepEqual(Object.values(estimate.returnedScope), Array(5).fill(UNKNOWN));
  assert.equal(estimate.statistic.play, 63451);
  assert.equal(estimate.statistic.winRate, 0.51);
  assert.equal(estimate.sampleSize, UNKNOWN);
  assert.deepEqual(
    normalized.observations.map(o => [o.field, o.value]),
    [['data.trends.pick.version', '16.22']],
  );
  assert.equal(estimate.usableForRanking, false);
  assert.ok(estimate.rankingBlockers.includes('patch 반환 범위 미확인'));
});

test('omitted tier is recorded as the all-tier aggregate the schema describes', () => {
  const [estimate] = normalizeOpggCall(fixture('champion-analysis-success'), catalog).estimates;
  assert.equal(estimate.requestedScope.tier, 'all');
});

test('lane meta rows become per-champion estimates with the returned position', () => {
  const normalized = normalizeOpggCall(fixture('lane-meta-mid'), catalog);
  assert.equal(normalized.status, 'ready');
  const leblanc = normalized.estimates.find(e => e.championId === 'Leblanc');
  assert.equal(leblanc.providerChampion, 'LeBlanc');
  assert.equal(leblanc.returnedScope.role, 'mid');
  assert.equal(leblanc.requestedScope.tier, 'not-requestable');
  assert.ok(normalized.unresolved.includes('Fizz'), 'catalog에 없는 챔피언은 unresolved로 남는다');
  assert.ok(normalized.estimates.every(e => !e.usableForRanking));
});

test('missing statistics stay null instead of zero', () => {
  const call = {
    tool: 'lol_list_lane_meta_champions',
    arguments: {position: 'mid'},
    result: {
      content: [
        {
          type: 'text',
          text: 'class R: data\nclass Data: positions\nclass Positions: mid\nclass Mid: champion,win_rate\n\nR(Data(Positions([Mid("Ahri",1.5)])))',
        },
      ],
    },
  };
  const [estimate] = normalizeOpggCall(call, catalog).estimates;
  assert.equal(estimate.statistic.play, null);
  assert.equal(estimate.statistic.pickRate, null);
  assert.equal(estimate.statistic.winRate, null, '범위를 벗어난 비율은 버린다');
});

test('ranking gate opens only when every scope is returned, matching and sampled', () => {
  const estimate = {
    requestedScope: {region: 'not-requestable', queue: 'ranked', role: 'mid', tier: 'gold', patch: 'not-requestable'},
    returnedScope: {region: 'kr', queue: 'ranked', role: 'mid', tier: 'gold', patch: '16.22'},
    sampleSize: 1000,
  };
  assert.deepEqual(rankingGate(estimate), {usable: true, reasons: []});
  assert.equal(
    rankingGate({...estimate, returnedScope: {...estimate.returnedScope, tier: 'emerald_plus'}}).usable,
    false,
  );
  assert.equal(rankingGate({...estimate, sampleSize: UNKNOWN}).usable, false);
});

test('unparseable or unknown tool responses are unavailable, not empty successes', () => {
  assert.equal(
    normalizeOpggCall({tool: 'lol_get_champion_analysis', result: {content: [{type: 'text', text: '???'}]}}, catalog)
      .status,
    'unavailable',
  );
  assert.equal(normalizeOpggCall({...fixture('lane-meta-mid'), tool: 'other_tool'}, catalog).status, 'unavailable');
});
