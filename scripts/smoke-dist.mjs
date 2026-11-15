// dist/index.html을 headless Chrome으로 열어 런타임 오류와 첫 화면 렌더링을 확인한다.
// 사용: npm run build && npm run smoke  (CHROME_PATH로 브라우저 경로 지정 가능)
// --site: npm run build:pages 결과(site/)를 정적 HTTP로 열어 웹 데모 모드를 확인한다.
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = candidates.find(path => existsSync(path));
if (!chrome) {
  console.error('Chrome을 찾지 못했습니다. CHROME_PATH 환경 변수로 경로를 지정하세요.');
  process.exit(2);
}
const siteMode = process.argv.includes('--site');
const page = resolve(import.meta.dirname, '..', siteMode ? 'site' : 'dist', 'index.html');
if (!existsSync(page)) {
  console.error(
    siteMode
      ? 'site/index.html이 없습니다. 먼저 npm run build:pages를 실행하세요.'
      : 'dist/index.html이 없습니다. 먼저 npm run build를 실행하세요.',
  );
  process.exit(2);
}
let server = null,
  target = pathToFileURL(page).href;
if (siteMode) {
  const files = {'/': ['index.html', 'text/html'], '/game-data.json': ['game-data.json', 'application/json']};
  server = http.createServer((req, res) => {
    const file = files[new URL(req.url, 'http://localhost').pathname];
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, {'Content-Type': `${file[1]}; charset=utf-8`});
    res.end(readFileSync(resolve(page, '..', file[0])));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  target = `http://127.0.0.1:${server.address().port}/`;
}
const profile = mkdtempSync(join(tmpdir(), 'rift-draft-smoke-'));
const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--user-data-dir=${profile}`,
  '--enable-logging=stderr',
  '--v=0',
  '--virtual-time-budget=3000',
  '--dump-dom',
  target,
];
const child = spawn(chrome, args);
let dom = '',
  log = '';
child.stdout.on('data', chunk => (dom += chunk));
child.stderr.on('data', chunk => (log += chunk));
const code = await new Promise(done => child.on('close', done));
rmSync(profile, {recursive: true, force: true});
server?.close();

// 인라인 스크립트 원문에도 같은 마크업 문자열이 있으므로 <script> 블록을 제외하고 센다.
const rendered = dom.replace(/<script[\s\S]*?<\/script>/g, '');
const failures = [];
const errors = log.split('\n').filter(line => /Uncaught|CONSOLE.*Error/.test(line));
if (code !== 0) failures.push(`Chrome 종료 코드 ${code}`);
if (errors.length) failures.push(...errors.map(line => `런타임 오류: ${line.trim()}`));
const cards = (rendered.match(/<article class="ontology-card"/g) || []).length;
if (cards < 1) failures.push('온톨로지 검색 결과 카드가 렌더링되지 않았습니다');
if (!/<svg class="ontology-svg"/.test(rendered)) failures.push('관계 그래프 SVG가 렌더링되지 않았습니다');
if (!/data-role="MID"/.test(rendered)) failures.push('밴픽 역할 탭이 렌더링되지 않았습니다');
if (siteMode) {
  if (!/id="data-status"[^>]*>공식 정적 데이터/.test(rendered))
    failures.push('웹 데모가 game-data.json을 불러오지 못했습니다');
  for (const id of ['client-sync', 'opgg-counters'])
    if (!new RegExp(`id="${id}"[^>]*hidden`).test(rendered))
      failures.push(`웹 데모에서 ${id} 버튼이 숨겨지지 않았습니다`);
  if (!/id="connect-opgg"[^>]*disabled/.test(rendered))
    failures.push('웹 데모에서 OP.GG 연결 버튼이 꺼지지 않았습니다');
}
if (failures.length) {
  console.error(`${siteMode ? 'site' : 'dist'} smoke 실패\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `${siteMode ? 'site' : 'dist'} smoke 통과 · 온톨로지 카드 ${cards}개 · 그래프·역할 탭 렌더링 · 콘솔 오류 없음`,
);
