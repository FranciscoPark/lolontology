import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {resolve} from 'node:path';
import {createServer, createRateLimiter, HttpError, MAX_QUERY_BYTES} from '../scripts/serve.mjs';
import {OpggClient, ENDPOINT} from '../scripts/opgg.mjs';

const root = resolve(import.meta.dirname, '..');

function request(port, path, {method = 'GET', host = `127.0.0.1:${port}`, headers = {}, body} = {}) {
  return new Promise((done, fail) => {
    const req = http.request({host: '127.0.0.1', port, path, method, headers: {host, ...headers}}, res => {
      let text = '';
      res.on('data', chunk => (text += chunk));
      res.on('end', () => done({status: res.statusCode, headers: res.headers, text}));
    });
    req.on('error', fail);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function withServer(options, run) {
  const calls = [];
  const opgg = options.opgg || {
    list: async () => [{name: 'lol_list_lane_meta_champions'}],
    call: async (tool, args) => {
      calls.push({tool, args});
      if (tool === 'nope') throw Error('허용하지 않는 도구');
      return {tool, arguments: args};
    },
  };
  const gameData = options.gameData || {
    snapshot: {mode: 'official', championVersion: '16.22.1'},
    sync: async () => ({mode: 'official'}),
    getAbilities: async (champion, version) => ({champion, version, abilities: []}),
  };
  const server = createServer({root, gameData, opgg, limitOpgg: options.limitOpgg || (() => {})});
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    await run(server.address().port, calls);
  } finally {
    await new Promise(done => server.close(done));
  }
}

const query = (port, payload, extra = {}) =>
  request(port, '/api/opgg/query', {
    method: 'POST',
    headers: {'content-type': 'application/json', ...extra.headers},
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    ...extra,
  });

test('static files: only index and src are served, traversal and dotfiles are refused', () =>
  withServer({}, async port => {
    assert.equal((await request(port, '/')).status, 200);
    const script = await request(port, '/src/app.js');
    assert.equal(script.status, 200);
    assert.match(script.headers['content-type'], /text\/javascript/);
    assert.equal(script.headers['x-content-type-options'], 'nosniff');
    for (const path of [
      '/package.json',
      '/.cache/riot-data.json',
      '/src/../package.json',
      '/src/%2e%2e/package.json',
      '/src/.hidden.js',
      '/scripts/serve.mjs',
      '/tests/serve.test.js',
    ])
      assert.equal((await request(port, path)).status, 403, path);
    assert.equal((await request(port, '/src/app.js', {method: 'POST'})).status, 403);
    assert.equal((await request(port, '/src/missing.js')).status, 404);
    assert.equal((await request(port, '/%E0%A4%A')).status, 400);
  }));

test('API accepts 127.0.0.1 and localhost hosts, rejects others and cross-origin calls with JSON errors', () =>
  withServer({}, async port => {
    assert.equal((await request(port, '/api/game-data')).status, 200);
    assert.equal((await request(port, '/api/game-data', {host: `localhost:${port}`})).status, 200);
    for (const options of [
      {host: `evil.example:${port}`},
      {host: `127.0.0.1:${port}`, headers: {origin: 'http://evil.example'}},
      {host: `localhost:${port}`, headers: {origin: `http://127.0.0.1:${port}`}},
    ]) {
      const response = await request(port, '/api/game-data', options);
      assert.equal(response.status, 403);
      assert.match(response.headers['content-type'], /application\/json/);
      assert.match(JSON.parse(response.text).error, /로컬 앱/);
    }
    assert.equal((await request(port, '/api/unknown')).status, 404);
  }));

test('ability lookups validate champion and version', () =>
  withServer({}, async port => {
    assert.equal((await request(port, '/api/champion-abilities?champion=Ahri&version=16.22.1')).status, 200);
    assert.equal((await request(port, '/api/champion-abilities?champion=../x&version=16.22.1')).status, 400);
    assert.equal((await request(port, '/api/champion-abilities?champion=Ahri&version=latest')).status, 400);
  }));

test('OP.GG query input errors are 4xx and never reach the provider', () =>
  withServer({}, async (port, calls) => {
    assert.equal((await query(port, '{not json')).status, 400);
    assert.equal((await query(port, [1, 2])).status, 400);
    assert.equal((await query(port, {arguments: {}})).status, 400);
    const override = await query(port, {tool: 'lol_list_lane_meta_champions', arguments: {}, endpoint: 'http://evil'});
    assert.equal(override.status, 400);
    assert.match(JSON.parse(override.text).error, /endpoint/);
    assert.equal((await query(port, {tool: 'x'}, {headers: {'content-type': 'text/plain'}})).status, 415);
    assert.equal((await query(port, {tool: 'x', arguments: {pad: 'x'.repeat(MAX_QUERY_BYTES)}})).status, 413);
    assert.equal(calls.length, 0);
    const denied = await query(port, {tool: 'nope', arguments: {}});
    assert.equal(denied.status, 400);
    const ok = await query(port, {tool: 'lol_list_lane_meta_champions', arguments: {position: 'mid'}});
    assert.equal(ok.status, 200);
    assert.deepEqual(calls.at(-1), {tool: 'lol_list_lane_meta_champions', args: {position: 'mid'}});
  }));

test('the real client always posts to the fixed OP.GG endpoint and refuses non-allowlisted tools', async () => {
  const urls = [];
  const fetcher = async (url, init) => {
    urls.push(url);
    const body = JSON.parse(init.body);
    const result =
      body.method === 'initialize'
        ? {protocolVersion: '2025-06-18', serverInfo: {name: 'fake', version: '1'}}
        : body.method === 'tools/list'
          ? {
              tools: [
                {name: 'lol_get_summoner_profile', inputSchema: {properties: {}}},
                {name: 'lol_list_lane_meta_champions', inputSchema: {properties: {position: {type: 'string'}}}},
              ],
            }
          : {content: []};
    return new Response(JSON.stringify({jsonrpc: '2.0', id: body.id, result}), {
      headers: {'content-type': 'application/json'},
    });
  };
  const client = new OpggClient(fetcher);
  await withServer({opgg: client}, async port => {
    const tools = JSON.parse((await request(port, '/api/opgg/tools')).text).tools.map(tool => tool.name);
    assert.deepEqual(tools, ['lol_list_lane_meta_champions'], '소환사 프로필 도구는 노출하지 않는다');
    assert.equal((await query(port, {tool: 'lol_get_summoner_profile', arguments: {}})).status, 400);
    const ok = JSON.parse(
      (await query(port, {tool: 'lol_list_lane_meta_champions', arguments: {position: 'mid'}})).text,
    );
    assert.deepEqual(ok.provider, {name: 'fake', version: '1', protocol: '2025-06-18'});
  });
  assert.ok(urls.length > 0 && urls.every(url => url === ENDPOINT));
});

test('OP.GG proxy calls are rate limited with 429', () => {
  let now = 0;
  const limit = createRateLimiter({limit: 2, windowMs: 1000, clock: () => now});
  limit();
  limit();
  assert.throws(limit, error => error instanceof HttpError && error.status === 429 && /1초 뒤/.test(error.message));
  now = 1000;
  assert.doesNotThrow(limit);
  return withServer({limitOpgg: createRateLimiter({limit: 1})}, async port => {
    assert.equal((await request(port, '/api/opgg/tools')).status, 200);
    const limited = await request(port, '/api/opgg/tools');
    assert.equal(limited.status, 429);
    assert.match(JSON.parse(limited.text).error, /너무 잦습니다/);
  });
});

test('missing catalog is 503 and provider failures are 502 with a readable message', () =>
  withServer(
    {
      gameData: {snapshot: null, sync: async () => Promise.reject(Error('fetch failed'))},
    },
    async port => {
      assert.equal((await request(port, '/api/game-data')).status, 503);
      const failed = await request(port, '/api/game-data/refresh', {method: 'POST'});
      assert.equal(failed.status, 502);
      assert.match(JSON.parse(failed.text).error, /외부 서비스에 연결하지 못했습니다/);
    },
  ));
