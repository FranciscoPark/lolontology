// dist/index.html을 headless Chrome으로 열어 런타임 오류와 첫 화면 렌더링을 확인한다.
// 사용: npm run build && npm run smoke  (CHROME_PATH로 브라우저 경로 지정 가능)
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
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
const page = resolve(import.meta.dirname, '..', 'dist', 'index.html');
if (!existsSync(page)) {
  console.error('dist/index.html이 없습니다. 먼저 npm run build를 실행하세요.');
  process.exit(2);
}
const profile = mkdtempSync(join(tmpdir(), 'rift-draft-smoke-'));
const args = ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--enable-logging=stderr', '--v=0', '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(page).href];
const child = spawn(chrome, args);
let dom = '', log = '';
child.stdout.on('data', chunk => (dom += chunk));
child.stderr.on('data', chunk => (log += chunk));
const code = await new Promise(done => child.on('close', done));
rmSync(profile, {recursive: true, force: true});

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
if (failures.length) {
  console.error(`dist smoke 실패\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`dist smoke 통과 · 온톨로지 카드 ${cards}개 · 그래프·역할 탭 렌더링 · 콘솔 오류 없음`);
