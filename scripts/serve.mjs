import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {OpggClient} from './opgg.mjs';
import {DataDragonStore} from './data-dragon-store.mjs';
import {LcuClient, LcuUnavailable} from './lcu.mjs';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
export const MAX_QUERY_BYTES = 32_000;
// OP.GG MCP README(2026-11-08)에는 호출 제한·약관이 명시돼 있지 않다. 공개 서비스에 부담을 주지 않도록 보수적으로 제한한다.
export const OPGG_CALLS_PER_MINUTE = 20;
const ALLOWED_HOST = /^(127\.0\.0\.1|localhost):\d+$/;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 최근 1분 동안의 호출 시각만 보관하는 고정 창 제한기.
export function createRateLimiter({limit = OPGG_CALLS_PER_MINUTE, windowMs = 60_000, clock = Date.now} = {}) {
  const calls = [];
  return () => {
    const now = clock();
    while (calls.length && now - calls[0] >= windowMs) calls.shift();
    if (calls.length >= limit) {
      const retryAfter = Math.ceil((windowMs - (now - calls[0])) / 1000);
      throw new HttpError(429, `OP.GG 조회가 너무 잦습니다. ${retryAfter}초 뒤에 다시 시도하세요.`);
    }
    calls.push(now);
  };
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'JSON 입력이 필요합니다');
  let body = '';
  for await (const part of req) {
    body += part;
    if (Buffer.byteLength(body) > MAX_QUERY_BYTES) throw new HttpError(413, '조회 조건 크기 초과');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, '조회 조건 JSON 형식 오류');
  }
}

// 사용자 입력 검증 오류는 400, 외부 서비스 오류는 502로 구분한다.
const INPUT_ERRORS =
  /^(지원하지 않는|필수 조회 조건|잘못된 조회 조건|문자열 조건|숫자 조건|배열 조건|중첩 조건|허용하지 않는 도구)/;

export function createServer({
  root,
  gameData,
  opgg,
  lcu = new LcuClient(),
  startupSync = Promise.resolve(),
  limitOpgg = createRateLimiter(),
}) {
  const sendJson = (res, status, payload) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify(payload));
  };
  async function api(req, res, pathname) {
    const host = req.headers.host || '';
    if (!ALLOWED_HOST.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`))
      throw new HttpError(403, '로컬 앱에서만 API를 사용할 수 있습니다. http://127.0.0.1 주소로 여세요.');
    if (pathname === '/api/game-data' && req.method === 'GET') {
      await startupSync;
      if (!gameData.snapshot)
        throw new HttpError(503, 'Data Dragon 데이터가 준비되지 않았습니다. 연결을 확인한 뒤 새로고침하세요.');
      return sendJson(res, 200, gameData.snapshot);
    }
    if (pathname === '/api/game-data/refresh' && req.method === 'POST')
      return sendJson(res, 200, await gameData.sync({force: true}));
    if (pathname === '/api/champion-abilities' && req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost'),
        champion = url.searchParams.get('champion') || '',
        version = url.searchParams.get('version') || '';
      if (!/^[A-Za-z0-9_]+$/.test(champion) || !/^\d+\.\d+\.\d+$/.test(version))
        throw new HttpError(400, '챔피언 또는 버전 조건이 올바르지 않습니다');
      return sendJson(res, 200, await gameData.getAbilities(champion, version));
    }
    if (pathname === '/api/lcu/champ-select' && req.method === 'GET') {
      if (!gameData.snapshot) throw new HttpError(503, 'Data Dragon 데이터가 준비되지 않았습니다');
      try {
        return sendJson(res, 200, await lcu.champSelect(gameData.snapshot.champions));
      } catch (error) {
        // 클라이언트가 꺼져 있는 것은 정상 상태다. 폴링이 오류로 쌓이지 않게 상태로 돌려준다.
        if (error instanceof LcuUnavailable) return sendJson(res, 200, {status: 'not-running', reason: error.message});
        throw error;
      }
    }
    if (pathname === '/api/opgg/tools' && req.method === 'GET') {
      limitOpgg();
      return sendJson(res, 200, {tools: await opgg.list()});
    }
    if (pathname === '/api/opgg/query' && req.method === 'POST') {
      const input = await readJson(req);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '조회 조건 형식 오류');
      const extra = Object.keys(input).filter(key => key !== 'tool' && key !== 'arguments');
      // 엔드포인트·헤더 등은 서버에 고정돼 있다. 덮어쓰려는 입력은 무시하지 않고 거부한다.
      if (extra.length) throw new HttpError(400, `허용하지 않는 요청 항목: ${extra.join(', ')}`);
      if (typeof input.tool !== 'string') throw new HttpError(400, '조회 도구가 필요합니다');
      limitOpgg();
      try {
        return sendJson(res, 200, await opgg.call(input.tool, input.arguments));
      } catch (error) {
        if (INPUT_ERRORS.test(error.message)) throw new HttpError(400, error.message);
        throw error;
      }
    }
    throw new HttpError(404, 'Unknown API');
  }

  return http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    if (pathname.startsWith('/api/')) {
      try {
        await api(req, res, pathname);
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 502;
        const message =
          error.message === 'fetch failed'
            ? '외부 서비스에 연결하지 못했습니다. 인터넷 연결과 서버 접근 권한을 확인하세요.'
            : error.message;
        sendJson(res, status, {error: message});
      }
      return;
    }
    try {
      if (
        req.method !== 'GET' ||
        !(pathname === '/' || pathname === '/index.html' || pathname.startsWith('/src/')) ||
        pathname.split('/').some(part => part.startsWith('.'))
      ) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + sep) || !(extname(file) in TYPES)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': `${TYPES[extname(file)]}; charset=utf-8`,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..');
  const gameData = new DataDragonStore({file: resolve(root, '.cache', 'riot-data.json')});
  await gameData.load();
  const warn = label => error =>
    console.warn(`Data Dragon ${label} 실패: ${error.message}${gameData.snapshot ? ' · 마지막 정상 캐시 유지' : ''}`);
  const startupSync = gameData.sync().catch(error => {
    warn('자동 확인')(error);
    return gameData.snapshot;
  });
  setInterval(() => gameData.sync().catch(warn('정기 확인')), 6 * 60 * 60 * 1000).unref();
  const server = createServer({root, gameData, opgg: new OpggClient(), startupSync});
  server.on('error', error => {
    console.error(`서버를 시작할 수 없습니다 (${error.code}). 일반 터미널에서 npm start를 실행하세요.`);
    process.exitCode = 1;
  });
  server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () =>
    console.log('Rift Draft: http://127.0.0.1:' + server.address().port),
  );
}
