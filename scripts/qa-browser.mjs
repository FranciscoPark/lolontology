// 로컬 서버와 headless Chrome(DevTools 프로토콜)으로 세 페이지 사용자 흐름을 검사한다.
// 사용: npm run qa  (CHROME_PATH, QA_PORT 환경 변수로 경로·포트 지정 가능)
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
  .filter(Boolean)
  .find(path => existsSync(path));
if (!chromePath) {
  console.error('Chrome을 찾지 못했습니다. CHROME_PATH 환경 변수로 경로를 지정하세요.');
  process.exit(2);
}
const port = Number(process.env.QA_PORT || 4188),
  debugPort = port + 1000,
  base = `http://127.0.0.1:${port}/`;
const sleep = ms => new Promise(done => setTimeout(done, ms));

const server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs')], {
  env: {...process.env, PORT: String(port)},
});
let serverLog = '';
server.stdout.on('data', chunk => (serverLog += chunk));
server.stderr.on('data', chunk => (serverLog += chunk));
const profile = mkdtempSync(join(tmpdir(), 'rift-draft-qa-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  'about:blank',
]);
chrome.stderr.on('data', () => {});

const results = [],
  appErrors = [];
const watchdog = setTimeout(() => {
  console.error(`QA 전체 시간 초과 · 완료: ${results.map(result => result.name).join(', ')}`);
  cleanup().finally(() => process.exit(1));
}, 180000);
let socket,
  sequence = 0;
const pending = new Map(),
  listeners = new Set();
async function cleanup() {
  socket?.close();
  server.kill();
  if (chrome.exitCode === null) {
    const exited = new Promise(done => chrome.once('exit', done));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  try {
    rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  } catch (error) {
    console.error(`임시 Chrome 프로필을 지우지 못했습니다: ${profile} (${error.code})`);
  }
}
function send(method, params = {}, timeout = 20000) {
  return new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      fail(Error(`${method} 응답 시간 초과`));
    }, timeout);
    pending.set(id, message => {
      clearTimeout(timer);
      message.error ? fail(Error(`${method}: ${message.error.message}`)) : done(message.result);
    });
    socket.send(JSON.stringify({id, method, params}));
  });
}
async function evaluate(expression) {
  const {result, exceptionDetails} = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}
async function waitFor(expression, timeout = 15000) {
  const started = Date.now();
  for (;;) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch {}
    if (Date.now() - started > timeout) throw Error(`대기 시간 초과: ${expression}`);
    await sleep(100);
  }
}
// 같은 문서에서 해시만 바뀌는 이동은 load 이벤트가 없으므로 항상 about:blank를 거쳐 새로 로드한다.
async function navigate(url) {
  const loaded = new Promise(done => {
    const listener = message => {
      if (message.method === 'Page.loadEventFired') {
        listeners.delete(listener);
        done();
      }
    };
    listeners.add(listener);
  });
  await send('Page.navigate', {url});
  await loaded;
}
async function load(url) {
  await navigate('about:blank');
  await navigate(url);
  await waitFor(`document.querySelector('#refresh-data') && !document.querySelector('#refresh-data').disabled`);
}
async function check(name, run) {
  if (process.env.QA_VERBOSE) console.error(`… ${name}`);
  try {
    const detail = await run();
    results.push({name, ok: true, detail: detail ?? ''});
  } catch (error) {
    results.push(
      error instanceof SkipError
        ? {name, ok: true, skipped: true, detail: error.message}
        : {name, ok: false, detail: error.message},
    );
  }
}
// 외부 서비스(OP.GG)가 응답하지 않는 경우처럼 앱 결함이 아닌 사유로 검사할 수 없을 때 사용한다.
class SkipError extends Error {}
const assert = (condition, message) => {
  if (!condition) throw Error(message);
};
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
const cards = () =>
  evaluate(
    `[...document.querySelectorAll('#recommendations .pick-card')].map(card => ({id: card.querySelector('[data-pick]').dataset.pick, score: Number(card.querySelector('.score').firstChild.textContent), insufficient: card.classList.contains('insufficient')}))`,
  );
async function pick(slotSelector, championId) {
  await click(slotSelector);
  await waitFor(`document.querySelector('#picker').open`);
  await click(`[data-champion="${championId}"]`);
  await waitFor(`!document.querySelector('#picker').open`);
}

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(
        entry => entry.type === 'page',
      );
    } catch {}
    if (!target) await sleep(250);
  }
  assert(target, 'Chrome DevTools에 연결하지 못했습니다');
  for (let i = 0; i < 60 && !serverLog.includes('Rift Draft:'); i++) await sleep(250);
  assert(serverLog.includes('Rift Draft:'), `서버가 시작되지 않았습니다: ${serverLog}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = fail;
  });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === 'Runtime.exceptionThrown')
      appErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
      appErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    if (message.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', {accept: true});
    for (const listener of listeners) listener(message);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  await load(base + '#banpick');
  await evaluate('localStorage.clear()');
  await load(base + '#banpick');

  await check('공식 데이터 로드와 상태 표시', async () => {
    const status = await waitFor(
      `document.querySelector('#data-status').textContent.includes('공식') && document.querySelector('#data-status').textContent`,
      30000,
    );
    return status;
  });
  await check('역할 변경', async () => {
    await click('[data-role="TOP"]');
    assert(
      await evaluate(`document.querySelector('[data-role="TOP"]').classList.contains('active')`),
      '탭이 활성화되지 않음',
    );
    assert(
      await evaluate(`document.querySelectorAll('#teams .slot.mine')[0]?.dataset.index === '0'`),
      '내 슬롯이 탑이 아님',
    );
    await click('[data-role="MID"]');
    return '탑→미드 전환';
  });
  await check('밴·픽 입력', async () => {
    await pick('[data-side="allies"][data-index="1"]', 'LeeSin');
    await pick('[data-side="bans"][data-index="0"]', 'Ahri');
    assert((await text('[data-side="allies"][data-index="1"]')).includes('리 신'), '아군 정글 슬롯 미반영');
    assert((await text('#ban-count')) === '1', '밴 수 미반영');
    return '아군 정글 리 신, 밴 아리';
  });
  await check('중복 선택 방지', async () => {
    await click('[data-side="enemies"][data-index="0"]');
    await waitFor(`document.querySelector('#picker').open`);
    const disabled = await evaluate(
      `document.querySelector('[data-champion="LeeSin"]').disabled && document.querySelector('[data-champion="Ahri"]').disabled`,
    );
    await click('#close-picker');
    assert(disabled, '이미 픽·밴한 챔피언이 선택 가능함');
    return '리 신·아리 비활성';
  });
  await check('픽·밴 챔피언 추천 제외', async () => {
    const ids = (await cards()).map(card => card.id);
    assert(ids.length > 0, '추천 후보 없음');
    assert(!ids.includes('Ahri') && !ids.includes('LeeSin'), `제외 실패: ${ids}`);
    return `후보 ${ids.join(', ')}`;
  });
  await check('개인화: 숙련도 변경이 점수에 반영', async () => {
    await click('#edit-pool');
    await waitFor(`document.querySelector('#picker').open`);
    await click('[data-champion="Orianna"]');
    await waitFor(`document.querySelector('select[data-personal="mastery"][data-id="Orianna"]')`);
    const before = (await cards()).find(card => card.id === 'Orianna')?.score;
    await evaluate(
      `(() => { const select = document.querySelector('select[data-personal="mastery"][data-id="Orianna"]'); select.value = '3'; select.dispatchEvent(new Event('change', {bubbles: true})); })()`,
    );
    await click('#close-picker');
    const after = (await cards()).find(card => card.id === 'Orianna')?.score;
    assert(before !== undefined && after === before + 24, `점수 변화 ${before} → ${after}`);
    return `오리아나 ${before} → ${after}`;
  });
  await check('후보 선택 후 아이템 초안 이동', async () => {
    await click('[data-pick="Orianna"]');
    await waitFor(`location.hash === '#items'`);
    const items = await evaluate(`document.querySelectorAll('#build .item-card').length`);
    assert(items >= 6, `아이템 카드 ${items}개`);
    return `${await text('#build-title')} · 카드 ${items}개`;
  });
  await check('새로고침 후 상태 복원', async () => {
    await load(base + '#banpick');
    assert((await text('[data-side="allies"][data-index="2"]')).includes('오리아나'), '내 픽 미복원');
    assert((await text('#pool-count')) === '1', '챔피언 풀 미복원');
    return '픽·밴·풀 복원';
  });
  await check('초기화는 밴·픽만 지움', async () => {
    await click('#reset');
    assert((await text('#ban-count')) === '0', '밴 미초기화');
    assert(!(await text('[data-side="allies"][data-index="1"]')).includes('리 신'), '픽 미초기화');
    assert((await text('#pool-count')) === '1', '챔피언 풀까지 지워짐');
    return '풀 유지';
  });
  await check('OP.GG 연결 실패 표시', async () => {
    await send('Network.setBlockedURLs', {urls: ['*/api/opgg/*']});
    await click('#connect-opgg');
    const status = await waitFor(
      `document.querySelector('#opgg-status').textContent.includes('연결 실패') && document.querySelector('#opgg-status').textContent`,
    );
    await send('Network.setBlockedURLs', {urls: []});
    return status;
  });
  await check('OP.GG 라인 메타 실조회와 범위 표', async () => {
    await send('Network.setBlockedURLs', {urls: []});
    await click('#connect-opgg');
    const ready = await waitFor(
      `(() => { const status = document.querySelector('#opgg-status').textContent; return status.includes('조회 도구 확인됨') ? 'ready' : status.includes('연결 실패') ? 'failed' : ''; })()`,
      30000,
    );
    if (ready === 'failed') throw new SkipError(`OP.GG 연결 불가: ${await text('#opgg-status')}`);
    await evaluate(
      `(() => { const select = document.querySelector('#opgg-tool'); select.value = 'lol_list_lane_meta_champions'; select.dispatchEvent(new Event('change')); })()`,
    );
    await evaluate(`document.querySelector('#opgg-form').requestSubmit()`);
    await waitFor(`document.querySelector('#opgg-result .meta-table, #opgg-result .opgg-warning')`, 40000);
    const html = await evaluate(`document.querySelector('#opgg-result').innerHTML`);
    assert(html.includes('scope-table'), '범위 표 없음');
    assert(html.includes('mid 라인 메타'), `라인 메타 표 없음: ${(await text('#opgg-result')).slice(0, 200)}`);
    assert(html.includes('추천 점수에 반영하지 않음'), '추천 미반영 안내 없음');
    return `${await evaluate(`document.querySelectorAll('#opgg-result .meta-table tbody tr').length`)}행 · 범위 표 표시`;
  });
  await check('OP.GG 챔피언 분석 실조회와 아이템 페이지 통계 빌드', async () => {
    if (!(await evaluate(`!!document.querySelector('#opgg-tool option')`))) throw new SkipError('OP.GG 미연결');
    await pick('[data-side="allies"][data-index="2"]', 'Ahri');
    await evaluate(
      `(() => { const select = document.querySelector('#opgg-tool'); select.value = 'lol_get_champion_analysis'; select.dispatchEvent(new Event('change')); })()`,
    );
    await evaluate(`document.querySelector('#opgg-result').innerHTML = ''`);
    await evaluate(`document.querySelector('#opgg-form').requestSubmit()`);
    await waitFor(`document.querySelector('#opgg-result .opgg-stats, #opgg-result .opgg-warning')`, 40000).catch(
      async () => {
        throw Error(`결과 없음 · 토스트: ${await text('#toast')}`);
      },
    );
    assert(
      await evaluate(`!!document.querySelector('#opgg-result .opgg-stats')`),
      (await text('#opgg-result')).slice(0, 300),
    );
    await click('[data-page="items"]');
    const groups = await evaluate(
      `[...document.querySelectorAll('#external-build .item-row-heading h3')].map(h => h.textContent).join(', ')`,
    );
    assert(groups.includes('코어 조합') && groups.includes('신발'), `통계 빌드 그룹: ${groups || '없음'}`);
    const compare = await text('#external-build .build-compare .item-row-heading small');
    assert(compare.includes('통계 응답에 있음'), `템플릿·통계 비교 없음: ${await text('#external-build')}`);
    assert((await text('#build .build-evidence')).includes('템플릿'), '템플릿 근거 목록 없음');
    await click('[data-page="banpick"]');
    await pick('[data-side="allies"][data-index="2"]', 'Ahri');
    return `${groups} · ${compare}`;
  });
  await check('백엔드 연결 실패 시 마지막 저장 카탈로그 유지', async () => {
    await send('Network.setBlockedURLs', {urls: ['*/api/game-data*']});
    await load(base + '#banpick');
    const detail = await waitFor(
      `document.querySelector('#data-detail').textContent.includes('연결 실패') && document.querySelector('#data-status').textContent`,
    );
    assert(detail.includes('공식'), `상태: ${detail}`);
    return detail;
  });
  await check('저장 데이터 전체 삭제', async () => {
    await click('#clear-local-data');
    await waitFor(`document.querySelector('#pool-count').textContent === '0'`);
    const keys = await evaluate(`Object.keys(localStorage).filter(key => key.startsWith('rift-draft'))`);
    assert(keys.length === 0, `남은 키: ${keys}`);
    await load(base + '#banpick');
    assert((await text('#pool-count')) === '0', 'reload 후 챔피언 풀이 복구됨');
    const status = await waitFor(
      `document.querySelector('#data-status').textContent.includes('예제') && document.querySelector('#data-status').textContent`,
    );
    await send('Network.setBlockedURLs', {urls: []});
    return `삭제 후 백엔드 차단 상태: ${status}`;
  });
  await check('온톨로지 빈 결과·미주석·패치 선택 상태 구분', async () => {
    await load(base + '#ontology');
    await waitFor(`document.querySelector('#data-status').textContent.includes('공식')`, 30000);
    const setQuery = (query, patch = '') =>
      evaluate(
        `(() => { document.querySelector('#ontology-type').value = 'champion'; document.querySelector('#ontology-query').value = ${JSON.stringify(query)}; document.querySelector('#ontology-patch').value = ${JSON.stringify(patch)}; document.querySelector('#ontology-search').requestSubmit(); })()`,
      );
    await setQuery('zzzz-없는-챔피언');
    assert((await text('#ontology-results')).includes('조회 결과가 없습니다'), '빈 결과 상태 없음');
    await setQuery('Rell');
    assert((await text('#ontology-results .review-badge')).includes('의미 주석 없음'), '미주석 배지 없음');
    const patches = await evaluate(`[...document.querySelectorAll('#ontology-patch option')].map(o => o.value)`);
    assert(patches[0] === '' && patches.slice(1).every(v => /^\d+\.\d+\.\d+$/.test(v)), `패치 선택지: ${patches}`);
    await setQuery('Ahri', '1.0.0');
    assert((await evaluate(`document.querySelector('#ontology-patch').value`)) === '', '로드되지 않은 패치가 선택됨');
    await setQuery('Ahri', patches[1]);
    assert((await text('#ontology-results .ontology-card h3')) === '아리', '로드된 패치 필터 결과 없음');
    await setQuery('Ahri');
    await waitFor(`document.querySelectorAll('#ontology-graph [data-graph-node]').length > 0`);
    return `빈 결과 / 의미 주석 없음 / 패치 선택지 ${patches.slice(1).join(', ')} / 그래프`;
  });
  await check('앱 런타임 오류 없음', async () => {
    assert(appErrors.length === 0, appErrors.join(' | '));
    return '없음';
  });
} catch (error) {
  results.push({name: 'QA 실행', ok: false, detail: error.message});
} finally {
  clearTimeout(watchdog);
  await cleanup();
}

for (const {name, ok, skipped, detail} of results)
  console.log(`${skipped ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` · ${detail}` : ''}`);
const failed = results.filter(result => !result.ok).length;
const skipped = results.filter(result => result.skipped).length;
console.log(
  `\n${results.length - failed}/${results.length} 통과${skipped ? ` (SKIP ${skipped})` : ''} · ${new Date().toISOString()}`,
);
process.exit(failed ? 1 : 0);
