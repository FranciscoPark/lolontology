// 앱 진입점: 저장된 세션 복원, 화면 모듈 연결, 공식 데이터 새로고침, 저장 데이터 삭제.
import {$, app, clearStoredData, loadStoredSession, save, setCatalog, toast} from './app-state.js';
import {loadOfficial, mergeCachedAbilities} from './catalog.js';
import {normalizeState} from './engine.js';
import {renderData} from './view-data.js';
import {bindOntology, renderOntology} from './view-ontology.js';
import {renderGraphBuild} from './view-items.js';
import {PAGES, bindNav, setPage} from './view-nav.js';
import {bindDraft, renderDraft, renderPicker} from './view-draft.js';
import {bindOpgg} from './view-opgg.js';

function renderAll() {
  renderDraft();
  renderOntology();
  if (!$('#page-items').hidden) renderGraphBuild();
}

// 진입 시에는 백엔드의 마지막 스냅샷만 읽는다. Riot 버전 확인은 백엔드가 주기적으로 한다.
async function refresh({automatic = false} = {}) {
  if (app.loading) return;
  app.loading = true;
  app.dataError = '';
  renderData();
  try {
    setCatalog(mergeCachedAbilities(app.catalog, await loadOfficial({refresh: !automatic})));
    app.state = normalizeState(app.stored || app.state, app.catalog);
    save();
    renderAll();
    if ($('#picker').open) renderPicker();
    if (!automatic) toast('공식 챔피언·아이템 데이터를 저장했습니다.');
  } catch (error) {
    app.dataError = error.message;
    if (!automatic) toast(`공식 데이터 연결 실패 · ${error.message}. 저장된 데이터는 유지합니다.`);
  } finally {
    app.loading = false;
    renderData();
  }
}

function clearLocalData() {
  if (!confirm('이 브라우저에 저장된 밴픽 상태, 챔피언 풀·선호도·숙련도, 조회 조건, 카탈로그 캐시를 모두 삭제할까요?'))
    return;
  try {
    // 삭제 직후 다시 저장하지 않는다. 다음 입력부터 새로 저장된다.
    clearStoredData();
  } catch {
    toast('이 브라우저의 저장소에 접근하지 못했습니다.');
    return;
  }
  $('#opgg-result').innerHTML = '';
  renderAll();
  toast('저장 데이터를 삭제했습니다. 현재 화면의 공식 카탈로그는 새로고침하면 서버에서 다시 받습니다.');
}

loadStoredSession();
bindNav();
bindOntology();
bindDraft();
bindOpgg();
$('#refresh-data').onclick = () => refresh();
$('#clear-local-data').onclick = clearLocalData;
// 이미지가 없는 패치의 아이콘은 깨진 이미지 대신 숨긴다.
document.addEventListener(
  'error',
  event => {
    if (event.target instanceof HTMLImageElement) event.target.style.display = 'none';
  },
  true,
);
renderDraft();
renderOntology();
const requestedPage = location.hash.slice(1);
if (PAGES.includes(requestedPage)) setPage(requestedPage);
refresh({automatic: true});
