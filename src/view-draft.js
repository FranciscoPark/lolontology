// 밴픽 페이지: 팀 보드, 밴, 아군 조합 특성, 픽 후보 카드, 챔피언 선택 대화상자와 개인 설정 편집.
import {$, app, esc, nameOf, save, toast} from './app-state.js';
import {PROFILES, ROLES, ROLE_NAMES, TRAITS} from './ontology.js';
import {isStaticDemo, portrait} from './catalog.js';
import {assign, composition, emptyState, normalizeState, recommendPicks} from './engine.js';
import {renderBuild} from './view-items.js';
import {renderData} from './view-data.js';
import {setPage} from './view-nav.js';
import {api} from './view-opgg.js';
import {opggPosition} from './opgg-ui.js';
import {COUNTER_FIELDS, parseCounterStats, renderCounterNote} from './opgg-counters.js';

const PREFERENCE_LABELS = ['보통', '선호', '최선호'],
  MASTERY_LABELS = ['연습 중', '기본 가능', '익숙함', '주력'];
const SIDE_LABELS = {allies: '아군', enemies: '상대'};

function avatar(id, small = false) {
  const url = portrait(app.catalog, id);
  const content = url ? `<img src="${esc(url)}" alt="" loading="lazy">` : `<span>${esc(nameOf(id).slice(0, 2))}</span>`;
  return `<span class="avatar ${small ? 'small' : ''}">${content}</span>`;
}

function teamSlot(side, index, role) {
  const id = app.state[side][index],
    mine = side === 'allies' && role === app.state.role;
  const label = `${SIDE_LABELS[side]} ${ROLE_NAMES[role]} ${id ? esc(nameOf(id)) : '선택'}`;
  const face = id ? avatar(id) : '<span class="empty-avatar">＋</span>';
  const text = `<span class="slot-text"><small>${ROLE_NAMES[role]} ${mine ? '<b>나</b>' : ''}</small><strong>${id ? esc(nameOf(id)) : '챔피언 선택'}</strong></span>`;
  return `<button class="slot ${id ? 'filled' : ''} ${mine ? 'mine' : ''}" data-side="${side}" data-index="${index}" aria-label="${label}">${face}${text}<span class="slot-edit">${id ? '변경' : '+'}</span></button>`;
}

function banSlot(id, index) {
  const label = `밴 ${index + 1} ${id ? esc(nameOf(id)) : '선택'}`;
  const content = id ? `${avatar(id, true)}<small>${esc(nameOf(id))}</small>` : '<span>＋</span>';
  return `<button class="ban-slot ${id ? 'filled' : ''}" data-side="bans" data-index="${index}" aria-label="${label}">${content}</button>`;
}

function compositionSummary() {
  const comp = composition(app.state.allies);
  const tags = ['frontline', 'engage', 'peel', 'waveclear']
    .map(
      trait =>
        `<span class="trait ${comp.traits[trait] ? 'present' : ''}">${comp.traits[trait] ? '✓' : '○'} ${TRAITS[trait]}</span>`,
    )
    .join('');
  return `<div class="comp-title">입력된 아군의 역할 <small>${comp.known}명 분석${comp.unknown ? ` · ${comp.unknown}명 주석 없음` : ''}</small></div><div class="trait-tags">${tags}</div>`;
}

function pickCard(candidate, rank) {
  const insufficient = candidate.dataStatus === 'insufficient';
  const traits = insufficient
    ? '<span class="data-badge">데이터 부족</span> 역할·조합 주석 없음'
    : PROFILES[candidate.id].traits
        .map(trait => TRAITS[trait])
        .slice(0, 3)
        .join(' · ') || '피해 중심 후보';
  const highlights =
    candidate.reasons
      .filter(reason => reason.rule !== 'role')
      .slice(0, 3)
      .map(reason => `<li>${esc(reason.text)}</li>`)
      .join('') || '<li>조합을 더 입력하면 후보를 구체적으로 비교합니다.</li>';
  const breakdown = candidate.reasons
    .map(reason => `<p>${esc(reason.text)} <b>${reason.points >= 0 ? '+' : ''}${reason.points}</b></p>`)
    .join('');
  const cautions = candidate.cautions.map(text => `<p class="muted">${esc(text)}</p>`).join('');
  const selected = app.state.allies[ROLES.indexOf(app.state.role)] === candidate.id;
  const heading = `<div class="pick-heading"><span class="rank">0${rank + 1}</span>${avatar(candidate.id)}<div class="pick-name"><h3>${esc(candidate.name)}</h3><small>${traits}</small></div><span class="score">${candidate.score}<small>적합 점수</small></span></div>`;
  const details = `<details><summary>근거와 한계</summary><p>${insufficient ? '의미 주석 없음 · 개인 입력만 반영' : PROFILES[candidate.id].reviewStatus === 'draft' ? '검토 전 초안 주석 · 사람 검토 대기' : '편집 주석'} · 규칙 ${esc(candidate.ruleVersion)}</p>${breakdown}${cautions}</details>`;
  const button = `<button class="select-pick" data-pick="${esc(candidate.id)}">${selected ? '선택됨 ✓' : '이 픽 선택 →'}</button>`;
  const counters = renderCounterNote(app.counterNotes[`${app.state.role}:${candidate.id}`], {
    enemies: app.state.enemies,
  });
  return `<article class="pick-card ${rank === 0 ? 'top' : ''} ${insufficient ? 'insufficient' : ''}">${heading}<ul>${highlights}</ul>${counters}<div class="pick-bottom">${details}${button}</div></article>`;
}

export function renderDraft() {
  const {state, catalog} = app;
  for (const key of ['region', 'tier', 'patch']) $(`#${key}`).value = state.filters[key];
  $('#role-tabs').innerHTML = ROLES.map(
    role =>
      `<button data-role="${role}" class="${state.role === role ? 'active' : ''}" aria-pressed="${state.role === role}">${ROLE_NAMES[role]}</button>`,
  ).join('');
  $('#teams').innerHTML = ROLES.map(
    (role, index) =>
      `<div class="team-row">${teamSlot('allies', index, role)}${teamSlot('enemies', index, role)}</div>`,
  ).join('');
  $('#bans').innerHTML = state.bans.map(banSlot).join('');
  $('#ban-count').textContent = state.bans.filter(Boolean).length;
  $('#composition').innerHTML = compositionSummary();
  $('#pool-count').textContent = state.pool.length;
  $('#pool-only').checked = state.poolOnly;
  const picks = recommendPicks(state, catalog);
  $('#candidate-count').textContent = `${picks.length} candidates`;
  $('#recommendations').innerHTML = picks.length
    ? picks.slice(0, 3).map(pickCard).join('')
    : '<div class="empty-state"><strong>조건에 맞는 후보가 없습니다.</strong><p>챔피언 풀을 추가하거나 풀 제한을 해제하세요.<br>픽·밴된 챔피언은 후보에서 제외됩니다.</p></div>';
  const profiled = Object.keys(PROFILES).filter(id => catalog.champions.some(champion => champion.id === id)).length;
  $('#coverage').textContent =
    `의미 프로필 ${profiled}/${catalog.champions.length}명 지원 · 프로필이 없는 챔피언은 내 챔피언 풀에 넣으면 '데이터 부족' 후보로 표시 · 패치별 전략 검증 전`;
  renderBuild();
  renderData();
}

function openPicker(target) {
  app.pickerTarget = target;
  $('#search').value = '';
  $('#picker-title').textContent =
    target.side === 'pool'
      ? '내 챔피언 풀'
      : target.side === 'bans'
        ? `밴 ${target.index + 1} 선택`
        : `${SIDE_LABELS[target.side]} ${ROLE_NAMES[ROLES[target.index]]} 선택`;
  $('#clear-slot').hidden = target.side === 'pool';
  $('#picker-help').textContent =
    target.side === 'pool'
      ? '플레이할 수 있는 챔피언을 여러 명 선택하세요.'
      : '이미 입력한 픽·밴은 선택할 수 없습니다.';
  renderPicker();
  $('#picker').showModal();
  $('#search').focus();
}

function championChoice(champion, {disabled, selected}) {
  const subtitle = disabled
    ? '픽 / 밴됨'
    : selected
      ? '선택됨 ✓'
      : PROFILES[champion.id]?.roles.map(role => ROLE_NAMES[role]).join(' · ') || '프로필 준비 중';
  return `<button data-champion="${esc(champion.id)}" class="champion-choice ${selected ? 'chosen' : ''}" ${disabled ? 'disabled' : ''} aria-pressed="${selected}">${avatar(champion.id)}<strong>${esc(champion.name)}</strong><small>${subtitle}</small></button>`;
}

export function renderPicker() {
  const {state, catalog, pickerTarget: target} = app;
  renderPersonal();
  const query = $('#search').value.trim().toLocaleLowerCase().replaceAll(' ', ''),
    current = target.side === 'pool' ? null : state[target.side][target.index],
    used = new Set([...state.allies, ...state.enemies, ...state.bans].filter(id => id !== current));
  const list = catalog.champions
    .filter(champion =>
      [champion.name, champion.id].some(text => text.toLocaleLowerCase().replaceAll(' ', '').includes(query)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  $('#champion-grid').innerHTML =
    list
      .map(champion =>
        championChoice(champion, {
          disabled: target.side !== 'pool' && used.has(champion.id),
          selected: target.side === 'pool' ? state.pool.includes(champion.id) : current === champion.id,
        }),
      )
      .join('') || '<p class="no-results">검색 결과가 없습니다.</p>';
}

const options = (labels, selected) =>
  labels
    .map((text, value) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${text}</option>`)
    .join('');

function personalRow(id) {
  const settings = app.state.personal[id] || {preference: 0, mastery: null, roles: []};
  const roles = ROLES.map(
    role =>
      `<label><input type="checkbox" data-personal="roles" data-id="${esc(id)}" value="${role}" ${(settings.roles || []).includes(role) ? 'checked' : ''}> ${ROLE_NAMES[role]}</label>`,
  ).join('');
  const preference = `<label>선호도<select data-personal="preference" data-id="${esc(id)}">${options(PREFERENCE_LABELS, settings.preference)}</select></label>`;
  const mastery = `<label>숙련도 · 자가평가<select data-personal="mastery" data-id="${esc(id)}"><option value="" ${settings.mastery === null ? 'selected' : ''}>미입력</option>${options(MASTERY_LABELS, settings.mastery)}</select></label>`;
  const badge = PROFILES[id] ? '' : ' <small class="data-badge">주석 없음</small>';
  return `<div class="personal-row"><strong>${esc(nameOf(id))}${badge}</strong>${preference}${mastery}<fieldset class="personal-roles"><legend>플레이 역할 · 미지정이면 프로필 기준</legend>${roles}</fieldset></div>`;
}

function renderPersonal() {
  const el = $('#personal-editor');
  el.hidden = app.pickerTarget.side !== 'pool';
  if (el.hidden) return;
  el.innerHTML =
    app.state.pool.map(personalRow).join('') ||
    '<p class="microcopy">아래에서 챔피언을 추가한 뒤 선호도와 숙련도를 설정하세요.</p>';
}

const EXAMPLE_DRAFT = {
  allies: ['Garen', 'LeeSin', null, 'Jinx', 'Lulu'],
  enemies: ['Aatrox', 'Vi', 'Ahri', null, 'Soraka'],
  bans: ['Yasuo', 'Zed', null, null, null, null, null, null, null, null],
  pool: ['Orianna', 'Syndra', 'Galio', 'Viktor'],
  personal: {
    Orianna: {preference: 2, mastery: 3},
    Syndra: {preference: 1, mastery: 2},
    Galio: {preference: 0, mastery: 1},
    Viktor: {preference: 0, mastery: 0},
  },
};

// 화면에 보이는 상위 후보 3명의 OP.GG 상성을 차례로 조회한다. 결과는 참고 표시만 하고 점수에 넣지 않는다.
async function loadCounters() {
  const button = $('#opgg-counters'),
    role = app.state.role;
  const top = recommendPicks(app.state, app.catalog).slice(0, 3);
  if (!top.length) return toast('상성을 조회할 후보가 없습니다.');
  button.disabled = true;
  try {
    for (const [index, candidate] of top.entries()) {
      button.textContent = `OP.GG 상성 조회 중… ${index + 1}/${top.length}`;
      const key = `${role}:${candidate.id}`;
      try {
        const result = await api('/api/opgg/query', {
          tool: 'lol_get_champion_analysis',
          arguments: {
            champion: candidate.id,
            position: opggPosition(role),
            game_mode: 'ranked',
            desired_output_fields: COUNTER_FIELDS,
          },
        });
        const stats = parseCounterStats(result.result, app.catalog);
        app.counterNotes[key] = stats
          ? {stats, fetchedAt: result.fetchedAt || new Date().toISOString()}
          : {error: '응답 형식을 해석하지 못했습니다'};
      } catch (error) {
        app.counterNotes[key] = {error: error.message};
      }
      renderDraft();
    }
  } finally {
    button.disabled = false;
    button.textContent = 'OP.GG 상성 다시 보기';
  }
}

function updateState(next) {
  app.state = next;
  save();
  renderDraft();
}

export function bindDraft() {
  $('#personal-editor').addEventListener('change', event => {
    const {personal: key, id} = event.target.dataset;
    if (!key || !id) return;
    const current = app.state.personal[id] || {preference: 0, mastery: null, roles: []};
    if (key === 'roles') {
      const roles = new Set(current.roles || []);
      if (event.target.checked) roles.add(event.target.value);
      else roles.delete(event.target.value);
      app.state.personal[id] = {...current, roles: ROLES.filter(role => roles.has(role))};
    } else app.state.personal[id] = {...current, [key]: event.target.value === '' ? null : Number(event.target.value)};
    updateState(app.state);
  });
  if (isStaticDemo() || location.protocol === 'file:') $('#opgg-counters').hidden = true;
  else $('#opgg-counters').onclick = loadCounters;
  $('#role-tabs').addEventListener('click', event => {
    const role = event.target.closest('[data-role]')?.dataset.role;
    if (role) updateState({...app.state, role});
  });
  $('.draft-panel').addEventListener('click', event => {
    const el = event.target.closest('[data-side]');
    if (el) openPicker({side: el.dataset.side, index: Number(el.dataset.index)});
  });
  $('#recommendations').addEventListener('click', event => {
    const id = event.target.closest('[data-pick]')?.dataset.pick;
    if (!id) return;
    try {
      updateState(assign(app.state, 'allies', ROLES.indexOf(app.state.role), id, app.catalog));
      setPage('items');
      toast(`${nameOf(id)} 선택 · 아이템 초안을 만들었습니다.`);
    } catch (error) {
      toast(error.message);
    }
  });
  $('#champion-grid').addEventListener('click', event => {
    const el = event.target.closest('[data-champion]');
    if (!el || el.disabled) return;
    const id = el.dataset.champion,
      target = app.pickerTarget;
    if (target.side === 'pool') {
      const pool = app.state.pool.includes(id) ? app.state.pool.filter(x => x !== id) : [...app.state.pool, id];
      updateState({...app.state, pool});
      renderPicker();
      return;
    }
    try {
      updateState(assign(app.state, target.side, target.index, id, app.catalog));
      $('#picker').close();
    } catch (error) {
      toast(error.message);
    }
  });
  $('#clear-slot').onclick = () => {
    updateState(assign(app.state, app.pickerTarget.side, app.pickerTarget.index, null, app.catalog));
    $('#picker').close();
  };
  $('#edit-pool').onclick = () => openPicker({side: 'pool'});
  $('#close-picker').onclick = () => $('#picker').close();
  $('#search').oninput = renderPicker;
  $('#pool-only').onchange = event => updateState({...app.state, poolOnly: event.target.checked});
  $('#reset').onclick = () => {
    const {pool, personal, filters, poolOnly} = app.state;
    updateState({...emptyState(), pool, personal, filters, poolOnly});
    toast('밴·픽을 초기화했습니다. 개인 설정은 유지합니다.');
  };
  $('#example').onclick = () => {
    updateState(normalizeState({...emptyState(), ...EXAMPLE_DRAFT, filters: app.state.filters}, app.catalog));
    toast('물리 피해가 많은 아군 조합 예시를 불러왔습니다.');
  };
}
