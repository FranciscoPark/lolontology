import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  LcuClient,
  LcuUnavailable,
  findCredentials,
  normalizeChampSelect,
  parseLockfile,
  parseProcessArgs,
  placeByProfile,
} from '../scripts/lcu.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse);
const catalog = await fixture('ddragon/catalog-16.22.1.json');

test('lockfile and process arguments yield the local port and token', () => {
  assert.deepEqual(parseLockfile('LeagueClient:1234:54321:abcDEF-1:https\n'), {port: 54321, password: 'abcDEF-1'});
  assert.throws(() => parseLockfile('garbage'), LcuUnavailable);
  assert.deepEqual(parseProcessArgs('LeagueClientUx --remoting-auth-token=tok_1 --app-port=60000 --x'), {
    port: 60000,
    password: 'tok_1',
  });
  assert.equal(parseProcessArgs('other process'), null);
});

test('LOL_LOCKFILE overrides the default install paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lcu-'));
  try {
    await writeFile(join(dir, 'lockfile'), 'LeagueClient:1:4321:pw:https');
    const found = await findCredentials({env: {LOL_LOCKFILE: join(dir, 'lockfile')}, paths: []});
    assert.deepEqual(found, {port: 4321, password: 'pw'});
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('champ select maps champion keys and positions without personal identifiers', async () => {
  const session = normalizeChampSelect(await fixture('lcu/champ-select.json'), catalog.champions);
  assert.equal(session.role, 'MID');
  assert.deepEqual(session.allies, ['Garen', 'LeeSin', null, 'Jinx', null]);
  assert.equal(session.hover, 'Orianna');
  assert.equal(session.myTurn, 'pick');
  assert.deepEqual(session.bans, ['Zed', null, null, null, null, 'Yasuo', null, null, null, null]);
  // 상대 포지션은 숨겨져 있어 주석 주 역할로 추정 배치한다.
  assert.equal(session.enemyPositionsEstimated, true);
  assert.equal(session.enemies[0], 'Aatrox');
  assert.equal(session.enemies[1], 'Vi');
  assert.equal(session.enemies[2], 'Ahri');
  assert.equal(session.enemies[4], 'Thresh');
  assert.doesNotMatch(JSON.stringify(session), /should-not-leak|secret/);
});

test('profile placement keeps fixed slots and never duplicates champions', () => {
  const slots = placeByProfile(['Jinx', 'Leona'], ['Garen', null, null, null, null]);
  assert.deepEqual(slots, ['Garen', null, null, 'Jinx', 'Leona']);
  assert.equal(new Set(slots.filter(Boolean)).size, 3);
});

test('client reports idle outside champ select and re-discovers credentials after a restart', async () => {
  let finds = 0;
  const responses = [new LcuUnavailable('ECONNREFUSED'), {status: 404, body: ''}];
  const client = new LcuClient({
    find: async () => ({port: 1000 + finds++, password: 'x'}),
    get: async () => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  assert.deepEqual(await client.champSelect(catalog.champions), {status: 'idle'});
  assert.equal(finds, 2);
  await assert.rejects(
    new LcuClient({
      find: async () => {
        throw new LcuUnavailable('롤 클라이언트가 실행 중이 아닙니다');
      },
    }).champSelect([]),
    /실행 중이 아닙니다/,
  );
});
