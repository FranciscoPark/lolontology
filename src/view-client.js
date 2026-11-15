// 밴픽 페이지의 클라이언트 연동 버튼: 로컬 서버를 통해 롤 클라이언트 밴픽 세션을 2초마다 읽는다.
import {$, app, nameOf, save, toast} from './app-state.js';
import {isStaticDemo} from './catalog.js';
import {applyClientSession, clientSignature} from './client-sync.js';

const POLL_MS = 2000;
const sync = {timer: null, signature: '', busy: false};

function status(text) {
  $('#client-status').textContent = text;
}

function describe(session) {
  const turn = session.myTurn === 'pick' ? '내 픽 차례' : session.myTurn === 'ban' ? '내 밴 차례' : '대기';
  const hover = session.hover ? ` · 선택 중: ${nameOf(session.hover)}` : '';
  const estimated = session.enemyPositionsEstimated ? ' · 상대 포지션은 추정' : '';
  return `밴픽 연동 중 · ${turn}${hover}${estimated}`;
}

async function poll(onChange) {
  if (sync.busy) return;
  sync.busy = true;
  try {
    const response = await fetch('/api/lcu/champ-select', {signal: AbortSignal.timeout(5000)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
    if (data.status === 'not-running') return status(`클라이언트 대기 · ${data.reason}`);
    if (data.status === 'idle') return status('클라이언트 연결됨 · 밴픽 화면을 기다리는 중');
    status(describe(data.session));
    const signature = clientSignature(data.session);
    // 세션이 바뀔 때만 덮어쓴다. 그 사이 손으로 고친 내용은 다음 변화 전까지 유지된다.
    if (signature === sync.signature) return;
    sync.signature = signature;
    app.state = applyClientSession(app.state, data.session, app.catalog);
    save();
    onChange();
  } catch (error) {
    status(`연동 오류 · ${error.message}`);
  } finally {
    sync.busy = false;
  }
}

function stop() {
  clearInterval(sync.timer);
  sync.timer = null;
  sync.signature = '';
  $('#client-sync').setAttribute('aria-pressed', 'false');
  $('#client-sync').textContent = '클라이언트 연동';
  status('');
}

export function bindClientSync(onChange) {
  const button = $('#client-sync');
  if (isStaticDemo() || location.protocol === 'file:') {
    button.hidden = true;
    return;
  }
  button.onclick = () => {
    if (sync.timer) return stop();
    button.setAttribute('aria-pressed', 'true');
    button.textContent = '연동 끄기';
    status('롤 클라이언트를 찾는 중…');
    toast('롤 클라이언트 밴픽을 읽어 자동으로 채웁니다. 픽·밴을 대신 하지는 않습니다.');
    poll(onChange);
    sync.timer = setInterval(() => poll(onChange), POLL_MS);
  };
}
