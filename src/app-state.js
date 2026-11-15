// 화면 모듈이 함께 쓰는 가변 상태, 브라우저 저장소, DOM 헬퍼.
// ES 모듈은 import한 변수를 다시 할당할 수 없으므로 가변 값은 모두 app 객체의 속성으로 둔다.
import {fallbackCatalog} from './catalog.js';
import {emptyState, normalizeState} from './engine.js';
import {createOntology} from './graph.js';

export const STATE_KEY = 'rift-draft-state-v1',
  CATALOG_KEY = 'rift-draft-catalog-v1';

export const $ = selector => document.querySelector(selector);
export const esc = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char],
  );

export const app = {
  catalog: fallbackCatalog(),
  state: emptyState(),
  // 마지막으로 저장한 원본 상태. 카탈로그가 바뀌면 이것을 기준으로 다시 정규화한다.
  stored: null,
  ontology: null,
  pickerTarget: null,
  loading: false,
  dataError: '',
  toastTimer: null,
  opggTools: [],
  opggBusy: false,
  externalItemBuild: null,
  // `${role}:${championId}` → {stats, fetchedAt} 또는 {error}. OP.GG 상성 참고 표시용.
  counterNotes: {},
  graphRoot: null,
  graphRenderSeq: 0,
};

function readStoredCatalog() {
  try {
    const cached = JSON.parse(localStorage.getItem(CATALOG_KEY));
    if (
      cached?.mode === 'official' &&
      /^\d+\.\d+\.\d+$/.test(cached.version) &&
      Array.isArray(cached.champions) &&
      cached.champions.length &&
      cached.items &&
      typeof cached.items === 'object' &&
      Number.isFinite(Date.parse(cached.loadedAt))
    )
      return cached;
  } catch {}
  return null;
}

export function loadStoredSession() {
  app.catalog = readStoredCatalog() || app.catalog;
  try {
    app.stored = JSON.parse(localStorage.getItem(STATE_KEY));
    app.state = normalizeState(app.stored, app.catalog);
  } catch {}
  app.ontology = createOntology(app.catalog);
}

export const nameOf = id => app.catalog.champions.find(champion => champion.id === id)?.name || id;

export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

export function save() {
  app.stored = app.state;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(app.state));
  } catch {
    toast('이 브라우저에서는 입력을 저장할 수 없습니다.');
  }
}

export function setCatalog(catalog) {
  app.catalog = catalog;
  app.ontology = createOntology(catalog);
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  } catch {}
}

export function clearStoredData() {
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem(CATALOG_KEY);
  app.stored = null;
  app.state = emptyState();
  app.externalItemBuild = null;
}
