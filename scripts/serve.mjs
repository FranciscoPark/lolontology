import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {OpggClient} from './opgg.mjs';
import {DataDragonStore} from './data-dragon-store.mjs';
const opgg = new OpggClient();
const root = resolve(import.meta.dirname, '..');
const gameData = new DataDragonStore({file: resolve(root, '.cache', 'riot-data.json')});
await gameData.load();
const startupSync = gameData.sync().catch(error => {
  console.warn(`Data Dragon 자동 확인 실패: ${error.message}${gameData.snapshot ? ' · 마지막 정상 캐시 유지' : ''}`);
  return gameData.snapshot;
});
const updateTimer = setInterval(
  () =>
    gameData
      .sync()
      .catch(error =>
        console.warn(
          `Data Dragon 정기 확인 실패: ${error.message}${gameData.snapshot ? ' · 마지막 정상 캐시 유지' : ''}`,
        ),
      ),
  6 * 60 * 60 * 1000,
);
updateTimer.unref();
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      const expected = `http://${req.headers.host}`;
      if (
        !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') ||
        (req.headers.origin && req.headers.origin !== expected)
      ) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      try {
        if (pathname === '/api/game-data' && req.method === 'GET') {
          await startupSync;
          if (!gameData.snapshot) {
            res.writeHead(503);
            res.end(
              JSON.stringify({error: 'Data Dragon 데이터가 준비되지 않았습니다. 연결을 확인한 뒤 새로고침하세요.'}),
            );
            return;
          }
          res.end(JSON.stringify(gameData.snapshot));
          return;
        }
        if (pathname === '/api/game-data/refresh' && req.method === 'POST') {
          const snapshot = await gameData.sync({force: true});
          res.end(JSON.stringify(snapshot));
          return;
        }
        if (pathname === '/api/champion-abilities' && req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost'),
            champion = url.searchParams.get('champion') || '',
            version = url.searchParams.get('version') || '';
          if (!/^[A-Za-z0-9_]+$/.test(champion) || !/^\d+\.\d+\.\d+$/.test(version)) {
            res.writeHead(400);
            res.end(JSON.stringify({error: '챔피언 또는 버전 조건이 올바르지 않습니다'}));
            return;
          }
          const result = await gameData.getAbilities(champion, version);
          res.end(JSON.stringify(result));
          return;
        }
        if (pathname === '/api/opgg/tools' && req.method === 'GET') {
          res.end(JSON.stringify({tools: await opgg.list()}));
          return;
        }
        if (pathname === '/api/opgg/query' && req.method === 'POST') {
          if (!req.headers['content-type']?.startsWith('application/json')) throw Error('JSON 입력 필요');
          let body = '';
          for await (const part of req) {
            body += part;
            if (body.length > 32000) throw Error('조회 조건 크기 초과');
          }
          const input = JSON.parse(body);
          res.end(JSON.stringify(await opgg.call(input.tool, input.arguments)));
          return;
        }
        res.writeHead(404);
        res.end(JSON.stringify({error: 'Unknown API'}));
        return;
      } catch (e) {
        res.writeHead(502);
        res.end(
          JSON.stringify({
            error:
              e.message === 'fetch failed'
                ? 'OP.GG에 연결하지 못했습니다. 인터넷 연결과 서버 접근 권한을 확인하세요.'
                : e.message,
          }),
        );
        return;
      }
    }
    if (
      req.method !== 'GET' ||
      !(
        pathname === '/' ||
        pathname === '/index.html' ||
        pathname.startsWith('/src/') ||
        pathname.startsWith('/data/')
      ) ||
      pathname.split('/').some(p => p.startsWith('.'))
    ) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !['.html', '.js', '.css', '.json', '.svg'].includes(extname(file))) {
      res.writeHead(403);
      res.end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': (types[extname(file)] || 'text/plain') + '; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.on('error', e => {
  console.error(`서버를 시작할 수 없습니다 (${e.code}). 일반 터미널에서 npm start를 실행하세요.`);
  process.exitCode = 1;
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () =>
  console.log('Rift Draft: http://127.0.0.1:' + server.address().port),
);
