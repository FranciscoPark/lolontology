// OP.GG 패널: 로컬 프록시로 도구 목록을 받아 조회 양식을 만들고, 사용자가 제출할 때만 조회한다.
import {$, app, esc, nameOf, save, toast} from './app-state.js';
import {ROLES} from './ontology.js';
import {
  defaultOutputFields,
  fieldKind,
  filterLabel,
  matchEnum,
  missingRequestedFilters,
  outputFieldOptions,
  resultText,
  serializeArguments,
  suggestedOutputFields,
  supportedFilters,
} from './opgg-ui.js';
import {parseOpggItemBuild} from './opgg-build.js';
import {normalizeOpggCall, resolveProviderChampion} from './meta-estimate.js';
import {renderMetaResult} from './opgg-view.js';
import {renderExternalBuild} from './view-items.js';
import {isStaticDemo} from './catalog.js';

const ANALYSIS_TOOL = 'lol_get_champion_analysis';
const FIELD_LABELS = {
  tier: '통계 티어 범위',
  patch: '통계 패치',
  region: '통계 서버',
  role: '라인/포지션',
  champion: '챔피언',
  game_mode: '게임 모드',
  lang: '응답 언어',
};

export async function api(path, body) {
  const response = await fetch(path, {
    ...(body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(65000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!response.ok) {
    const reason = data?.error || (response.status === 403 ? '로컬 앱 주소(http://127.0.0.1)로 열어야 합니다' : '');
    throw Error(`${reason || '서버 오류'} (HTTP ${response.status})`);
  }
  if (data === null) throw Error('서버 응답이 JSON이 아닙니다');
  return data;
}

const selectedTool = () => app.opggTools.find(tool => tool.name === $('#opgg-tool').value);

function outputFieldsControl(tool, key, schema) {
  const choices = outputFieldOptions(schema),
    selected = suggestedOutputFields(schema),
    required = (tool.inputSchema.required || []).includes(key);
  if (choices.length) {
    const boxes = choices
      .map(
        (field, index) =>
          `<label><input type="checkbox" name="${esc(key)}" value="${esc(field)}" ${selected.includes(field) || (index === 0 && !selected.length) ? 'checked' : ''}> ${esc(field)}</label>`,
      )
      .join('');
    return `<fieldset class="output-field-picker"><legend>응답 필드 · 필요한 통계 선택</legend><details open><summary>필드 ${choices.length}개 · ${selected.length}개 기본 선택</summary><div>${boxes}</div></details></fieldset>`;
  }
  const defaults = defaultOutputFields(tool.name, app.state.role);
  const help = `요약 통계·트렌드·${tool.name === ANALYSIS_TOOL ? '아이템 빌드' : '내 역할 라인 메타'} 필드를 기본으로 요청합니다. 쉼표로 구분해 수정할 수 있습니다.`;
  const allowed = schema.description
    ? `<details><summary>OP.GG가 허용하는 필드 목록</summary><pre>${esc(schema.description)}</pre></details>`
    : '';
  return `<label class="output-fields">응답 필드 선택<input name="${esc(key)}" value="${esc(defaults.join(', '))}" placeholder="예: data.summary.average_stats.{win_rate,pick_rate}" ${required ? 'required' : ''}><small>${help}</small>${allowed}</label>`;
}

// 저장된 조회 조건 → 내 역할·챔피언 → 스키마 기본값 순서로 초기값을 정한다.
function defaultFieldValue(key, kind, schema) {
  const {state, catalog} = app;
  const champion = catalog.champions.find(entry => entry.id === state.allies[ROLES.indexOf(state.role)]);
  let value = state.filters[kind];
  if (value === undefined) {
    if (kind === 'role') value = state.role;
    else if (kind === 'champion') value = /id/i.test(key) ? champion?.key : champion?.id;
    // 앱 범위(소환사의 협곡 랭크)에 맞춘 기본값. 스키마 enum에 없으면 matchEnum이 비운다.
    else value = schema.default ?? (key === 'game_mode' ? 'ranked' : undefined);
  }
  value ??= '';
  return schema.enum ? (matchEnum(value, schema.enum) ?? '') : value;
}

function fieldControl(tool, key, schema) {
  if (key === 'desired_output_fields' && schema.type === 'array') return outputFieldsControl(tool, key, schema);
  const kind = fieldKind(key),
    label = FIELD_LABELS[key] || FIELD_LABELS[kind] || schema.title || key,
    value = defaultFieldValue(key, kind, schema),
    required = (tool.inputSchema.required || []).includes(key),
    attrs = `name="${esc(key)}" ${required ? 'required' : ''}`;
  const input = schema.enum
    ? `<select ${attrs}><option value="">선택하세요</option>${schema.enum.map(option => `<option value="${esc(option)}" ${String(option) === String(value) ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`
    : `<input ${attrs} value="${esc(value)}" type="${['integer', 'number'].includes(schema.type) ? 'number' : 'text'}">`;
  return `<label>${esc(label)}${required ? ' *' : ''}${input}<small>${esc((schema.description || '').slice(0, 180))}</small></label>`;
}

export function renderOpggFields() {
  const tool = selectedTool();
  if (!tool) return;
  const unsupported = missingRequestedFilters(tool);
  $('#opgg-status').textContent =
    `조회 도구 확인됨 · ${unsupported.length ? `입력으로 지정할 수 없는 범위: ${unsupported.map(filterLabel).join('·')}. ` : '요청한 주요 필터를 지정할 수 있습니다. '}실제 반환 범위가 확인되기 전에는 추천 점수에 합산하지 않습니다.`;
  $('#opgg-fields').innerHTML = Object.entries(tool.inputSchema.properties || {})
    .map(([key, schema]) => fieldControl(tool, key, schema))
    .join('');
}

async function connect() {
  if (isStaticDemo()) {
    toast('웹 데모에서는 OP.GG 조회를 지원하지 않습니다. 로컬에서 npm start로 실행하세요.');
    return;
  }
  if (location.protocol === 'file:') {
    toast('OP.GG 조회는 npm start로 실행한 앱에서 사용할 수 있습니다.');
    return;
  }
  if (app.opggBusy) return;
  app.opggBusy = true;
  $('#connect-opgg').disabled = true;
  $('#opgg-status').textContent = 'OP.GG가 제공하는 조회 조건을 확인하는 중…';
  try {
    app.opggTools = (await api('/api/opgg/tools')).tools || [];
    if (!app.opggTools.length) throw Error('사용 가능한 챔피언 조회 도구가 없습니다');
    $('#opgg-tool').innerHTML = app.opggTools
      .map(
        tool =>
          `<option value="${esc(tool.name)}">${tool.name === ANALYSIS_TOOL ? '챔피언 분석 · 빌드' : '라인별 메타'}</option>`,
      )
      .join('');
    $('#opgg-controls').hidden = false;
    renderOpggFields();
  } catch (error) {
    $('#opgg-status').textContent = `연결 실패: ${error.message}. 로컬 추천은 계속 사용할 수 있습니다.`;
  } finally {
    app.opggBusy = false;
    $('#connect-opgg').disabled = false;
  }
}

// 지원하지 않는 필터를 조용히 무시하지 않도록 제출 전에 막는다.
function validateSubmission(tool, form) {
  const supported = supportedFilters(tool),
    {filters} = app.state;
  if (filters.patch && !supported.has('patch'))
    throw Error('이 도구는 지정 패치를 조회할 수 없습니다. 패치를 비우거나 다른 조회를 선택하세요.');
  if (filters.tier && !supported.has('tier'))
    throw Error('이 도구는 내 티어 필터를 지원하지 않습니다. 티어를 비우거나 챔피언 분석 조회를 선택하세요.');
  const args = serializeArguments(new FormData(form), tool.inputSchema);
  for (const key of tool.inputSchema.required || [])
    if (!(key in args))
      throw Error(`필수 조회 조건을 입력하세요: ${key === 'desired_output_fields' ? '응답 필드 선택' : key}`);
  return args;
}

function showItemBuild(tool, result, args, fetchedAt) {
  if (tool.name !== ANALYSIS_TOOL) return '';
  const championId = resolveProviderChampion(args.champion, app.catalog);
  app.externalItemBuild = championId
    ? parseOpggItemBuild(result.result, app.catalog, {championId, arguments: args, fetchedAt})
    : {status: 'unavailable', reason: '조회 챔피언을 현재 Riot 카탈로그와 연결할 수 없습니다.'};
  renderExternalBuild();
  return app.externalItemBuild.status === 'ready'
    ? '<p class="coverage">아이템 빌드 통계는 아이템 페이지에서 현재 패치 구매 조건을 확인해 별도로 표시합니다.</p>'
    : '';
}

async function submit(event) {
  event.preventDefault();
  if (app.opggBusy) return;
  const tool = selectedTool();
  if (!tool) return;
  let args;
  try {
    args = validateSubmission(tool, event.target);
  } catch (error) {
    toast(error.message);
    return;
  }
  app.opggBusy = true;
  const button = event.target.querySelector('button');
  button.disabled = true;
  $('#opgg-result').innerHTML = '<p>선택한 조건으로 OP.GG 통계를 조회하는 중…</p>';
  try {
    const result = await api('/api/opgg/query', {tool: tool.name, arguments: args}),
      fetchedAt = result.fetchedAt || new Date().toISOString();
    const normalized = normalizeOpggCall(result, app.catalog);
    const itemNote = showItemBuild(tool, result, args, fetchedAt);
    const raw = esc(resultText(result.result)) || '표시할 데이터가 없습니다.';
    $('#opgg-result').innerHTML =
      `${renderMetaResult(normalized, {nameOf, pool: app.state.pool, fetchedAt})}${itemNote}<details><summary>원본 응답 보기</summary><pre>${raw}</pre></details>`;
  } catch (error) {
    if (tool.name === ANALYSIS_TOOL) {
      app.externalItemBuild = {status: 'unavailable', reason: `OP.GG 조회 실패: ${error.message}`};
      renderExternalBuild();
    }
    $('#opgg-result').innerHTML =
      `<p class="opgg-warning">조회 실패: ${esc(error.message)}. 이전 통계로 대체하지 않았습니다.</p>`;
  } finally {
    app.opggBusy = false;
    button.disabled = false;
  }
}

export function bindOpgg() {
  $('#connect-opgg').onclick = connect;
  if (isStaticDemo()) {
    $('#connect-opgg').disabled = true;
    $('#opgg-status').textContent =
      '웹 데모에서는 OP.GG 조회를 사용할 수 없습니다. 저장소를 받아 npm start로 실행하면 통계 조회까지 쓸 수 있습니다.';
  }
  $('#opgg-tool').onchange = renderOpggFields;
  $('#opgg-form').onsubmit = submit;
  for (const key of ['region', 'tier', 'patch'])
    $(`#${key}`).addEventListener('change', event => {
      app.state.filters[key] = event.target.value.trim();
      save();
      $('#opgg-result').innerHTML = '';
      if (app.opggTools.length) renderOpggFields();
    });
}
