import {
  fieldKind,
  matchEnum,
  supportedFilters,
  missingRequestedFilters,
  filterLabel,
  outputFieldOptions,
  suggestedOutputFields,
  defaultOutputFields,
  serializeArguments,
  resultText,
} from './opgg-ui.js';
import {PROFILES, ROLES, ROLE_NAMES, TRAITS} from './ontology.js';
import {
  fallbackCatalog,
  loadOfficial,
  loadChampionAbilities,
  mergeCachedAbilities,
  portrait,
  itemImage,
  abilityImage,
} from './catalog.js';
import {emptyState, normalizeState, assign, composition, recommendPicks, buildDraft} from './engine.js';
import {createOntology, searchOntology, itemBuildCandidates, ontologyNeighborhood, ontologyInfo} from './graph.js';
import {parseOpggItemBuild} from './opgg-build.js';
import {normalizeOpggCall, resolveProviderChampion} from './meta-estimate.js';
import {renderMetaResult} from './opgg-view.js';
const GRAPH_NODE_LIMIT = 24;
const STATE_KEY = 'rift-draft-state-v1',
  CATALOG_KEY = 'rift-draft-catalog-v1';
const $ = s => document.querySelector(s),
  esc = v =>
    String(v ?? '').replace(
      /[&<>"']/g,
      c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c],
    );
let catalog = fallbackCatalog(),
  state = emptyState(),
  target = null,
  loading = false,
  dataError = '',
  timer,
  opggTools = [],
  opggBusy = false,
  externalItemBuild = null,
  ontology,
  graphRoot = null,
  graphRenderSeq = 0;
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
    catalog = cached;
} catch {}
let stored = null;
try {
  stored = JSON.parse(localStorage.getItem(STATE_KEY));
  state = normalizeState(stored, catalog);
} catch {}
ontology = createOntology(catalog);
const name = id => catalog.champions.find(c => c.id === id)?.name || id;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => $('#toast').classList.remove('show'), 3000);
}
function setPage(page) {
  for (const name of ['ontology', 'banpick', 'items']) $('#page-' + name).hidden = name !== page;
  document.querySelectorAll('[data-page]').forEach(button => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current', 'page');
  });
  history.replaceState(null, '', `#${page}`);
  if (page === 'ontology') renderOntology();
  if (page === 'items') renderGraphBuild();
}
const relationLabel = {
  AVAILABLE_IN: '패치',
  PLAYS_ROLE: '역할',
  HAS_TRAIT: '특성',
  BUILDS_FROM: '조합 재료',
  HAS_BUILD_CANDIDATE: '빌드 후보',
  HAS_ABILITY: '보유 스킬',
};
async function renderOntologyGraph(type, id, filters = {}) {
  const host = $('#ontology-graph'),
    sequence = ++graphRenderSeq;
  let warning = '';
  if (type === 'Champion' && catalog.mode === 'official' && !catalog.abilities?.[id]?.length) {
    host.innerHTML = '<p class="muted">현재 패치의 패시브와 QWER 스킬을 불러오는 중…</p>';
    const snapshot = catalog;
    try {
      const abilities = await loadChampionAbilities(snapshot, id);
      if (sequence !== graphRenderSeq || catalog !== snapshot) return;
      catalog = {...catalog, abilities: {...(catalog.abilities || {}), [id]: abilities}};
      ontology = createOntology(catalog);
      try {
        localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
      } catch {}
    } catch (error) {
      if (sequence !== graphRenderSeq) return;
      warning = `스킬 정보를 불러오지 못했습니다: ${error.message}`;
    }
  }
  if (sequence !== graphRenderSeq) return;
  // 타원 배치에서 노드가 겹치지 않는 최대 수. 나머지는 개수만 안내한다.
  const data = ontologyNeighborhood(ontology, type, id, filters, GRAPH_NODE_LIMIT);
  if (!data) {
    host.innerHTML = '<p class="muted">표시할 그래프가 없습니다. 패치와 필터를 확인하세요.</p>';
    return;
  }
  graphRoot = {type, id};
  const {entity, relations} = data,
    center = {x: 480, y: 275},
    rx = 340,
    ry = 190,
    n = relations.length;
  if (!n) {
    host.innerHTML = `<p class="muted">${esc(entity.name || entity.id)}에 연결된 관계가 없습니다.</p>`;
    return;
  }
  const points = relations.map((edge, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return {...edge, x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry};
  });
  const colors = {
    Champion: '#70bda2',
    Item: '#e8bd67',
    Role: '#82a9d8',
    Trait: '#c69ce2',
    Patch: '#a6b2b4',
    Ability: '#eb9ac1',
  };
  const node = (x, y, r, t, id, nameText, sub, root = false) =>
    `<g class="graph-node ${root ? 'graph-node-root' : ''}" ${root ? '' : 'tabindex="0" role="button"'} ${root ? '' : 'data-graph-node="true" data-graph-type="' + esc(t) + '" data-graph-id="' + esc(id) + '"'}><circle cx="${x}" cy="${y}" r="${r}" fill="#17262a" stroke="${colors[t] || '#9db4ae'}"/><text class="graph-node-type" x="${x}" y="${y - 4}">${esc(sub)}</text><text class="graph-node-name" x="${x}" y="${y + 14}">${esc(nameText.length > 18 ? nameText.slice(0, 17) + '…' : nameText)}</text></g>`;
  const lines = points
    .map(
      p =>
        `<g><line class="graph-edge ${p.direction === 'incoming' ? 'incoming' : ''}" ${p.direction === 'incoming' ? 'marker-start' : 'marker-end'}="url(#graph-arrow)" x1="${center.x}" y1="${center.y}" x2="${p.x}" y2="${p.y}"/><text class="graph-edge-label" x="${(center.x + p.x) / 2}" y="${(center.y + p.y) / 2 - 6}">${esc(relationLabel[p.relationship] || p.relationship)}</text></g>`,
    )
    .join('');
  const typeName = t =>
    ({Champion: '챔피언', Item: '아이템', Role: '역할', Trait: '특성', Patch: '패치', Ability: '스킬'})[t] || t;
  const nodes = points
    .map(p => {
      const label = p.targetName || p.targetId,
        sub = p.targetType === 'Ability' ? `스킬 · ${p.slot}` : typeName(p.targetType);
      return node(p.x, p.y, 28, p.targetType, p.targetId, label, sub);
    })
    .join('');
  const image = entity.type === 'Ability' ? abilityImage(catalog, entity) : null,
    details =
      entity.type === 'Ability'
        ? `<article class="ability-detail">${image ? `<img src="${esc(image)}" alt="${esc(entity.name)} 아이콘" loading="lazy">` : ''}<div><span>${esc(entity.championName || '')} · ${esc(entity.slot || '')} · Data Dragon ${esc(entity.version || 'patch unknown')}</span><h4>${esc(entity.name || entity.id)}</h4><p>${esc(entity.description || '설명 없음')}</p></div></article>`
        : '';
  host.innerHTML = `${warning ? `<p class="graph-warning">${esc(warning)}</p>` : ''}<div class="ontology-svg-scroll"><svg class="ontology-svg" viewBox="0 0 960 550" role="img" aria-label="${esc(entity.name || entity.id)} 관계 그래프"><defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#648278"/></marker></defs>${lines}${nodes}${node(center.x, center.y, 42, entity.type, entity.id, entity.name || entity.id, entity.type === 'Ability' ? `스킬 · ${entity.slot}` : typeName(entity.type), true)}</svg></div><p class="graph-caption">선의 방향은 관계의 방향입니다. ${data.truncated ? `직접 연결 ${data.total}개 중 ${n}개 표시 · 관계·역할 필터로 좁혀 보세요` : `직접 연결 ${n}개`} · 노드를 선택하면 해당 항목 중심으로 이동합니다.</p>${details}`;
}
function renderOntology() {
  const type = $('#ontology-type').value,
    q = $('#ontology-query').value.trim(),
    patch = $('#ontology-patch').value.trim(),
    role = $('#ontology-role').value,
    relationship = $('#ontology-relationship').value,
    root = $('#ontology-results');
  $('#graph-status').textContent = ontologyInfo(ontology).versions.length
    ? `JavaScript 온톨로지 · 챔피언 ${catalog.championVersion || catalog.version} · 아이템 ${catalog.itemVersion || catalog.version}`
    : 'JavaScript 온톨로지 · 예제 데이터';
  const results = searchOntology(ontology, type, q, patch, 30, {role, relationship});
  if (!results.length) {
    root.innerHTML = `<div class="empty-state"><strong>조회 결과가 없습니다.</strong><p>${patch && !ontologyInfo(ontology).versions.includes(patch) ? '현재 카탈로그와 요청 패치가 다릅니다.' : patch ? '선택한 데이터 버전과 이 유형의 노드가 일치하지 않습니다.' : '검색어와 필터를 바꾸거나 Data Dragon을 불러오세요.'}</p></div>`;
    $('#ontology-graph').innerHTML = '<p class="muted">검색 결과가 있으면 관계 그래프를 표시합니다.</p>';
    return;
  }
  const selected =
    (graphRoot && results.find(x => x.entity.type === graphRoot.type && x.entity.id === graphRoot.id)) || results[0];
  renderOntologyGraph(selected.entity.type, selected.entity.id, {role, relationship, patch});
  root.innerHTML = results
    .map(({entity: e, relations = []}) => {
      const links = relations
        .map(
          r =>
            `<span class="relation-chip"><b>${esc(r.relationship)}</b> ${r.direction === 'incoming' ? '← ' : ''}${esc(r.targetName || r.targetId || '')}</span>`,
        )
        .join('');
      const status =
        e.reviewStatus === 'reviewed' ? '검토됨' : e.reviewStatus === 'prototype' ? '초안 주석' : '의미 주석 없음';
      const detail =
        type === 'champion'
          ? `${e.title ? `${esc(e.title)} · ` : ''}${e.editorialRoles?.length ? e.editorialRoles.map(r => esc(ROLE_NAMES[r] || r)).join(' · ') : '역할 미검토'} · ${e.editorialDamage && e.editorialDamage !== 'unknown' ? esc(e.editorialDamage) : '피해 유형 미검토'}`
          : `${e.plaintext ? esc(e.plaintext) : e.description ? esc(e.description.replace(/<[^>]*>/g, ' ').slice(0, 160)) : '아이템 설명 없음'} · ${e.goldTotal ? `${Number(e.goldTotal).toLocaleString()} G` : e.gold?.total ? `${Number(e.gold.total).toLocaleString()} G` : '가격 정보 없음'}`;
      return `<article class="ontology-card"><div class="ontology-card-head"><div><span class="eyebrow">${type === 'champion' ? 'CHAMPION' : 'ITEM'} · ${esc(e.id)}</span><h3>${esc(e.name || e.id)}</h3></div><button class="graph-focus" data-focus-type="${e.type}" data-focus-id="${esc(e.id)}">그래프로 보기</button><span class="review-badge">${status}</span></div><p>${detail}</p><div class="relation-list">${links || '<span class="muted">직접 관계 없음 · 아직 입력된 관계가 없습니다.</span>'}</div><small class="ontology-source">출처: ${esc(e.source || e.annotationSource || 'Riot Data Dragon / editorial prototype')} · ${esc(e.version || catalog.version || 'patch unknown')}</small></article>`;
    })
    .join('');
}
function save() {
  stored = state;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    toast('이 브라우저에서는 입력을 저장할 수 없습니다.');
  }
}
function avatar(id, small = false) {
  const url = portrait(catalog, id);
  return `<span class="avatar ${small ? 'small' : ''}">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : `<span>${esc(name(id).slice(0, 2))}</span>`}</span>`;
}
function render() {
  for (const key of ['region', 'tier', 'patch']) $('#' + key).value = state.filters[key];
  $('#role-tabs').innerHTML = ROLES.map(
    r =>
      `<button data-role="${r}" class="${state.role === r ? 'active' : ''}" aria-pressed="${state.role === r}">${ROLE_NAMES[r]}</button>`,
  ).join('');
  $('#teams').innerHTML = ROLES.map(
    (r, i) =>
      `<div class="team-row">${['allies', 'enemies']
        .map(side => {
          const id = state[side][i],
            mine = side === 'allies' && r === state.role;
          return `<button class="slot ${id ? 'filled' : ''} ${mine ? 'mine' : ''}" data-side="${side}" data-index="${i}" aria-label="${side === 'allies' ? '아군' : '상대'} ${ROLE_NAMES[r]} ${id ? esc(name(id)) : '선택'}">${id ? avatar(id) : '<span class="empty-avatar">＋</span>'}<span class="slot-text"><small>${ROLE_NAMES[r]} ${mine ? '<b>나</b>' : ''}</small><strong>${id ? esc(name(id)) : '챔피언 선택'}</strong></span><span class="slot-edit">${id ? '변경' : '+'}</span></button>`;
        })
        .join('')}</div>`,
  ).join('');
  $('#bans').innerHTML = state.bans
    .map(
      (id, i) =>
        `<button class="ban-slot ${id ? 'filled' : ''}" data-side="bans" data-index="${i}" aria-label="밴 ${i + 1} ${id ? esc(name(id)) : '선택'}">${id ? avatar(id, true) : '<span>＋</span>'}${id ? `<small>${esc(name(id))}</small>` : ''}</button>`,
    )
    .join('');
  $('#ban-count').textContent = state.bans.filter(Boolean).length;
  const comp = composition(state.allies);
  $('#composition').innerHTML =
    `<div class="comp-title">입력된 아군의 역할 <small>${comp.known}명 분석${comp.unknown ? ` · ${comp.unknown}명 주석 없음` : ''}</small></div><div class="trait-tags">${['frontline', 'engage', 'peel', 'waveclear'].map(t => `<span class="trait ${comp.traits[t] ? 'present' : ''}">${comp.traits[t] ? '✓' : '○'} ${TRAITS[t]}</span>`).join('')}</div>`;
  $('#pool-count').textContent = state.pool.length;
  $('#pool-only').checked = state.poolOnly;
  const picks = recommendPicks(state, catalog);
  $('#candidate-count').textContent = `${picks.length} candidates`;
  $('#recommendations').innerHTML = picks.length
    ? picks
        .slice(0, 3)
        .map(
          (c, i) =>
            `<article class="pick-card ${i === 0 ? 'top' : ''} ${c.dataStatus === 'insufficient' ? 'insufficient' : ''}"><div class="pick-heading"><span class="rank">0${i + 1}</span>${avatar(c.id)}<div class="pick-name"><h3>${esc(c.name)}</h3><small>${
              c.dataStatus === 'insufficient'
                ? '<span class="data-badge">데이터 부족</span> 역할·조합 주석 없음'
                : PROFILES[c.id].traits
                    .map(t => TRAITS[t])
                    .slice(0, 3)
                    .join(' · ') || '피해 중심 후보'
            }</small></div><span class="score">${c.score}<small>적합 점수</small></span></div><ul>${
              c.reasons
                .filter(r => r.rule !== 'role')
                .slice(0, 3)
                .map(r => `<li>${esc(r.text)}</li>`)
                .join('') || '<li>조합을 더 입력하면 후보를 구체적으로 비교합니다.</li>'
            }</ul><div class="pick-bottom"><details><summary>근거와 한계</summary><p>${c.dataStatus === 'insufficient' ? '의미 주석 없음 · 개인 입력만 반영' : '편집 주석'} · 규칙 ${esc(c.ruleVersion)}</p>${c.reasons.map(r => `<p>${esc(r.text)} <b>${r.points >= 0 ? '+' : ''}${r.points}</b></p>`).join('')}${c.cautions.map(t => `<p class="muted">${esc(t)}</p>`).join('')}</details><button class="select-pick" data-pick="${esc(c.id)}">${state.allies[ROLES.indexOf(state.role)] === c.id ? '선택됨 ✓' : '이 픽 선택 →'}</button></div></article>`,
        )
        .join('')
    : '<div class="empty-state"><strong>조건에 맞는 후보가 없습니다.</strong><p>챔피언 풀을 추가하거나 풀 제한을 해제하세요.<br>픽·밴된 챔피언은 후보에서 제외됩니다.</p></div>';
  $('#coverage').textContent =
    `의미 프로필 ${Object.keys(PROFILES).filter(id => catalog.champions.some(c => c.id === id)).length}/${catalog.champions.length}명 지원 · 프로필이 없는 챔피언은 내 챔피언 풀에 넣으면 '데이터 부족' 후보로 표시 · 패치별 전략 검증 전`;
  renderBuild();
  renderData();
}
function itemCard(item, label) {
  if (!item) return '';
  const image = itemImage(catalog, item.id),
    price = Number.isFinite(item.gold?.total) ? `${item.gold.total.toLocaleString()} G` : '공식 데이터 로드 후 표시';
  return `<article class="item-card"><span class="item-step">${label}</span><div class="item-main">${image ? `<img class="item-icon" src="${esc(image)}" alt="${esc(item.name)} 아이템 이미지" loading="lazy">` : '<span class="item-icon placeholder" aria-label="아이템 이미지 없음">◇</span>'}<div><h4>${esc(item.name)}</h4><small>${price}</small></div></div><p>${esc(item.reason)}</p></article>`;
}
function renderBuild() {
  const b = buildDraft(state, catalog);
  $('#build-title').textContent =
    b.status === 'ready' ? `${name(b.championId)} · 아이템 초안` : '픽에서 시작하는 아이템 초안';
  if (b.status !== 'ready') {
    $('#build').innerHTML =
      `<div class="empty-build"><span>◇</span><h3>${b.status === 'empty' ? '먼저 내 픽을 골라보세요.' : '아직 지원하지 않는 빌드입니다.'}</h3><p>${esc(b.message)}</p></div>`;
    renderExternalBuild();
    return;
  }
  $('#build').innerHTML =
    `<div class="build-summary"><span>${esc(b.label)}</span><small>초안 · 조합이 바뀌면 방어 후보와 대안이 갱신됩니다</small></div><p class="build-disclaimer">${b.core.length >= 6 ? '원딜 후반 풀슬롯 예시: 신발을 판매하고 코어 6개를 장착합니다.' : '후반 완성 기준 6칸: 코어 5개 + 신발 1개.'} 시작 아이템은 초반용이며 완성 빌드에서는 교체됩니다.</p><section class="item-row"><div class="item-row-heading"><h3>첫 아이템</h3><small>라인 시작용 · 후반 교체</small></div><div class="item-grid">${itemCard(b.start, '시작 아이템') || '<p class="coverage">이 역할에는 첫 아이템을 제안하지 않습니다.</p>'}</div></section><section class="item-row"><div class="item-row-heading"><h3>코어 아이템</h3><small>${b.core.length >= 6 ? '원딜 풀슬롯 후반 후보 · 신발 판매 후 장착' : '최종 빌드 6칸 중 신발을 제외한 5개 · 구매 순서 초안'}</small></div><div class="item-grid">${b.core.map((i, n) => itemCard(i, `코어 후보 ${n + 1}`)).join('') || '<p class="coverage">유효한 코어 후보가 없습니다.</p>'}</div></section><section class="item-row"><div class="item-row-heading"><h3>신발</h3><small>${b.core.length >= 6 ? '일반 빌드의 이동 속도 아이템 · 풀슬롯에서는 교체 가능' : '최종 6칸 중 1칸 · 상대 조합에 따라 선택'}</small></div><div class="item-grid">${itemCard(b.boots, '신발 후보') || '<p class="coverage">유효한 신발 후보가 없습니다.</p>'}</div></section>${b.alternatives.length ? `<section class="item-row"><div class="item-row-heading"><h3>상황별 대안</h3><small>위 기본 초안에 추가하지 않고 교체 검토</small></div><div class="item-grid alternatives">${b.alternatives.map(i => itemCard(i, '교체 후보')).join('')}</div></section>` : ''}<details class="build-notes"><summary>초안을 해석하는 방법과 데이터 한계</summary><ul>${b.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details><p class="build-disclaimer">아이콘과 가격은 Riot Data Dragon의 현재 로드된 패치 데이터를 사용합니다. 예제 모드에서는 가격과 이미지가 검증되지 않습니다. 챔피언별 최적 빌드가 아닌 유형별 템플릿입니다.</p>`;
  renderExternalBuild();
}
function renderExternalBuild() {
  const host = $('#external-build');
  if (!host) return;
  const champion = state.allies[ROLES.indexOf(state.role)];
  if (!externalItemBuild) {
    host.innerHTML =
      '<div class="external-build-empty"><strong>통계 기반 아이템 빌드</strong><p>밴픽 페이지에서 OP.GG를 연결하고 ‘챔피언 분석 · 빌드’를 조회하면, 실제 아이템 픽률과 표본 수를 여기에 표시합니다.</p></div>';
    return;
  }
  if (externalItemBuild.status !== 'ready') {
    host.innerHTML = `<p class="opgg-warning">OP.GG 아이템 빌드 미표시: ${esc(externalItemBuild.reason || '응답을 검증하지 못했습니다.')}</p>`;
    return;
  }
  if (externalItemBuild.itemVersion !== (catalog.itemVersion || catalog.version)) {
    host.innerHTML = `<p class="opgg-warning">저장된 OP.GG 결과는 아이템 패치 ${esc(externalItemBuild.itemVersion)} 기준으로 검증됐습니다. 현재 패치 ${esc(catalog.itemVersion || catalog.version || 'unknown')} 데이터와 달라 다시 조회해야 합니다.</p>`;
    return;
  }
  const queriedRole = String(externalItemBuild.role || '').toUpperCase(),
    roleMap = {
      BOT: 'ADC',
      BOTTOM: 'ADC',
      ADC: 'ADC',
      TOP: 'TOP',
      JUNGLE: 'JUNGLE',
      MID: 'MID',
      MIDDLE: 'MID',
      SUPPORT: 'SUPPORT',
    };
  if (champion !== externalItemBuild.championId || (queriedRole && roleMap[queriedRole] !== state.role)) {
    host.innerHTML = `<p class="opgg-warning">저장된 통계는 ${esc(name(externalItemBuild.championId))} · ${esc(externalItemBuild.role || '역할 미확인')} 조회입니다. 현재 선택(${esc(champion ? name(champion) : '챔피언 없음')} · ${esc(state.role)})과 달라 표시하지 않았습니다.</p>`;
    return;
  }
  host.innerHTML = `<div class="external-build-heading"><div><span class="eyebrow">STATISTICAL BUILD · ${esc(externalItemBuild.source)}</span><h3>OP.GG 통계 기반 아이템</h3></div><small>${esc(externalItemBuild.itemVersion)} 아이템 검증 · ${esc(new Date(externalItemBuild.fetchedAt).toLocaleString('ko-KR'))}</small></div><p class="opgg-warning">${esc(externalItemBuild.scopeWarning)} ${externalItemBuild.tier ? `조회 티어: ${esc(externalItemBuild.tier)}.` : '티어 범위는 제공 데이터 기본값입니다.'} 지역·패치 통계 범위는 응답에서 확인되지 않았습니다.</p>${externalItemBuild.groups.map(group => `<section class="item-row"><div class="item-row-heading"><h3>${esc(group.label)}</h3><small>응답된 조합·픽률 기준 후보</small></div><div class="item-grid external-item-grid">${group.choices.map((choice, index) => choice.items.map((item, itemIndex) => itemCard({...item, reason: `OP.GG 통계 그룹 ${index + 1} · ${choice.pickRate.toLocaleString('ko-KR', {style: 'percent', maximumFractionDigits: 1})} 선택 비율 · ${choice.play.toLocaleString()}게임 (${choice.win.toLocaleString()}승)${choice.items.length > 1 ? ` · 조합 ${itemIndex + 1}/${choice.items.length}` : ''}`}, group.choices.length > 1 ? `통계 후보 ${index + 1}` : group.label)).join('')).join('')}</div></section>`).join('')}${externalItemBuild.omitted.length ? `<p class="coverage">현재 패치에서 구매 검증을 통과하지 않아 제외한 아이템 ID: ${esc(externalItemBuild.omitted.join(', '))}</p>` : ''}`;
}
function renderGraphBuild() {
  const targetEl = $('#graph-build'),
    champion = state.allies[ROLES.indexOf(state.role)];
  if (!champion) {
    targetEl.innerHTML = '<p class="coverage">밴픽 페이지에서 내 역할 챔피언을 선택하면 그래프 후보를 조회합니다.</p>';
    return;
  }
  const rows = itemBuildCandidates(ontology, champion, state.role);
  if (!rows.length) {
    targetEl.innerHTML =
      '<p class="coverage">현재 온톨로지에 이 챔피언의 역할별 빌드 후보가 없습니다. 로컬 아이템 초안을 표시합니다.</p>';
    return;
  }
  const slotNames = {
    start: '시작',
    boots: '신발',
    'core-1': '코어 1',
    'core-2': '코어 2',
    'core-3': '코어 3',
    'core-4': '코어 4',
    'core-5': '코어 5',
    'core-6': '코어 6',
  };
  targetEl.innerHTML = `<div class="graph-build-heading"><strong>온톨로지 연결 후보</strong><span>${esc(catalog.itemVersion || ontologyInfo(ontology).version || 'patch unknown')} · prototype</span></div><div class="graph-build-items">${rows
    .map(row => {
      const item = row.item,
        image = item ? itemImage(catalog, item.id) : null;
      return `<article class="graph-build-item"><small>${esc(slotNames[row.slot] || row.slot)}</small>${item && image ? `<img class="item-icon" src="${esc(image)}" alt="${esc(item.name)} 아이템 이미지" loading="lazy">` : '<span class="item-icon placeholder">◇</span>'}<b>${esc(item?.name || item?.id || '')}</b><small>${Number.isFinite(item?.gold?.total) ? `${item.gold.total.toLocaleString()} G` : '공식 데이터 로드 후 가격 표시'}</small><small>${esc(row.reviewStatus || 'unknown')} · ${esc(row.source || 'source unknown')}</small></article>`;
    })
    .join(
      '',
    )}</div><p class="coverage">아이콘과 가격: Riot Data Dragon ${esc(catalog.itemVersion || '현재 로드된 아이템 패치')}. 그래프 관계는 편집 템플릿에서 생성했으며 패치별 최적 빌드로 검증되지 않았습니다.</p>`;
}
function renderData() {
  const official = catalog.mode === 'official';
  $('#data-status').textContent = loading
    ? '최신 공식 데이터 확인 중…'
    : official
      ? `공식 정적 데이터 · 챔피언 ${catalog.championVersion || catalog.version} · 아이템 ${catalog.itemVersion || catalog.version}`
      : dataError
        ? '오프라인 예제 데이터 · 공식 데이터 확인 실패'
        : '예제 데이터 · 저장된 최신 버전 확인 중';
  const savedAt = catalog.loadedAt ? new Date(catalog.loadedAt).toLocaleString('ko-KR') : 'unknown',
    checkedAt = catalog.checkedAt ? new Date(catalog.checkedAt).toLocaleString('ko-KR') : '확인 기록 없음';
  $('#data-detail').textContent = official
    ? `${catalog.champions.length}명 · 데이터 저장 ${savedAt} · 백엔드 패치 확인 ${checkedAt} · ${dataError ? `연결 실패: ${dataError}` : '자동 확인 사용'} · 추천 규칙은 별도 검토 전`
    : dataError
      ? `${dataError} · 새로고침 버튼으로 다시 시도할 수 있습니다.`
      : '저장된 데이터가 없으면 백엔드가 최초 버전을 준비합니다.';
  $('#refresh-data').disabled = loading;
  $('#refresh-label').textContent = loading
    ? '데이터 확인 중…'
    : official
      ? '최신 데이터 새로고침'
      : '공식 데이터 다시 불러오기';
  $('#refresh-data').setAttribute(
    'aria-label',
    official
      ? `최신 Data Dragon 확인 · 챔피언 ${catalog.championVersion || catalog.version} · 아이템 ${catalog.itemVersion || catalog.version}`
      : '공식 Data Dragon 데이터 불러오기',
  );
}
function openPicker(next) {
  target = next;
  $('#search').value = '';
  $('#picker-title').textContent =
    target.side === 'pool'
      ? '내 챔피언 풀'
      : target.side === 'bans'
        ? `밴 ${target.index + 1} 선택`
        : `${target.side === 'allies' ? '아군' : '상대'} ${ROLE_NAMES[ROLES[target.index]]} 선택`;
  $('#clear-slot').hidden = target.side === 'pool';
  $('#picker-help').textContent =
    target.side === 'pool'
      ? '플레이할 수 있는 챔피언을 여러 명 선택하세요.'
      : '이미 입력한 픽·밴은 선택할 수 없습니다.';
  renderPicker();
  $('#picker').showModal();
  $('#search').focus();
}
function renderPicker() {
  renderPersonal();
  const q = $('#search').value.trim().toLocaleLowerCase(),
    current = target.side === 'pool' ? null : state[target.side][target.index],
    used = new Set([...state.allies, ...state.enemies, ...state.bans].filter(id => id !== current));
  const list = catalog.champions
    .filter(c => [c.name, c.id].some(t => t.toLocaleLowerCase().replaceAll(' ', '').includes(q.replaceAll(' ', ''))))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  $('#champion-grid').innerHTML =
    list
      .map(c => {
        const disabled = target.side !== 'pool' && used.has(c.id),
          selected = target.side === 'pool' ? state.pool.includes(c.id) : current === c.id;
        return `<button data-champion="${esc(c.id)}" class="champion-choice ${selected ? 'chosen' : ''}" ${disabled ? 'disabled' : ''} aria-pressed="${selected}">${avatar(c.id)}<strong>${esc(c.name)}</strong><small>${disabled ? '픽 / 밴됨' : selected ? '선택됨 ✓' : PROFILES[c.id]?.roles.map(r => ROLE_NAMES[r]).join(' · ') || '프로필 준비 중'}</small></button>`;
      })
      .join('') || '<p class="no-results">검색 결과가 없습니다.</p>';
}
function renderPersonal() {
  const el = $('#personal-editor');
  el.hidden = target.side !== 'pool';
  if (el.hidden) return;
  el.innerHTML =
    state.pool
      .map(id => {
        const p = state.personal[id] || {preference: 0, mastery: null};
        return `<div class="personal-row"><strong>${esc(name(id))}</strong><label>선호도<select data-personal="preference" data-id="${esc(id)}">${['보통', '선호', '최선호'].map((t, v) => `<option value="${v}" ${p.preference === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>숙련도 · 자가평가<select data-personal="mastery" data-id="${esc(id)}"><option value="" ${p.mastery === null ? 'selected' : ''}>미입력</option>${['연습 중', '기본 가능', '익숙함', '주력'].map((t, v) => `<option value="${v}" ${p.mastery === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>`;
      })
      .join('') || '<p class="microcopy">아래에서 챔피언을 추가한 뒤 선호도와 숙련도를 설정하세요.</p>';
}
$('#personal-editor').addEventListener('change', e => {
  const {personal: key, id} = e.target.dataset;
  if (!key || !id) return;
  state.personal[id] = {
    ...(state.personal[id] || {preference: 0, mastery: null}),
    [key]: e.target.value === '' ? null : Number(e.target.value),
  };
  save();
  render();
});
document
  .querySelectorAll('[data-page]')
  .forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
$('#ontology-search').addEventListener('submit', e => {
  e.preventDefault();
  renderOntology();
});
$('#ontology-results').addEventListener('click', e => {
  const el = e.target.closest('[data-focus-id]');
  if (el)
    renderOntologyGraph(el.dataset.focusType, el.dataset.focusId, {
      role: $('#ontology-role').value,
      relationship: $('#ontology-relationship').value,
      patch: $('#ontology-patch').value.trim(),
    });
});
$('#ontology-graph').addEventListener('click', e => {
  const el = e.target.closest('[data-graph-node]');
  if (el)
    renderOntologyGraph(el.dataset.graphType, el.dataset.graphId, {
      role: $('#ontology-role').value,
      relationship: $('#ontology-relationship').value,
      patch: $('#ontology-patch').value.trim(),
    });
});
$('#ontology-graph').addEventListener('keydown', e => {
  const el = e.target.closest('[data-graph-node]');
  if (el && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    renderOntologyGraph(el.dataset.graphType, el.dataset.graphId, {
      role: $('#ontology-role').value,
      relationship: $('#ontology-relationship').value,
      patch: $('#ontology-patch').value.trim(),
    });
  }
});
$('#ontology-type').addEventListener('change', renderOntology);
$('#ontology-role').addEventListener('change', renderOntology);
$('#ontology-relationship').addEventListener('change', renderOntology);
$('#back-to-draft').onclick = () => setPage('banpick');
for (const key of ['region', 'tier', 'patch'])
  $('#' + key).addEventListener('change', e => {
    state.filters[key] = e.target.value.trim();
    save();
    $('#opgg-result').innerHTML = '';
    if (opggTools.length) renderOpggFields();
  });
async function api(path, body) {
  const r = await fetch(path, {
    ...(body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(65000),
  });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!r.ok) {
    const reason = data?.error || (r.status === 403 ? '로컬 앱 주소(http://127.0.0.1)로 열어야 합니다' : '');
    throw Error(`${reason || '서버 오류'} (HTTP ${r.status})`);
  }
  if (data === null) throw Error('서버 응답이 JSON이 아닙니다');
  return data;
}
$('#connect-opgg').onclick = async () => {
  if (location.protocol === 'file:') {
    toast('OP.GG 조회는 npm start로 실행한 앱에서 사용할 수 있습니다.');
    return;
  }
  if (opggBusy) return;
  opggBusy = true;
  $('#connect-opgg').disabled = true;
  $('#opgg-status').textContent = 'OP.GG가 제공하는 조회 조건을 확인하는 중…';
  try {
    const response = await api('/api/opgg/tools');
    opggTools = response.tools || [];
    if (!opggTools.length) throw Error('사용 가능한 챔피언 조회 도구가 없습니다');
    $('#opgg-tool').innerHTML = opggTools
      .map(
        t =>
          `<option value="${esc(t.name)}">${t.name === 'lol_get_champion_analysis' ? '챔피언 분석 · 빌드' : '라인별 메타'}</option>`,
      )
      .join('');
    $('#opgg-controls').hidden = false;
    renderOpggFields();
  } catch (e) {
    $('#opgg-status').textContent = `연결 실패: ${e.message}. 로컬 추천은 계속 사용할 수 있습니다.`;
  } finally {
    opggBusy = false;
    $('#connect-opgg').disabled = false;
  }
};
$('#opgg-tool').onchange = renderOpggFields;
function renderOpggFields() {
  const tool = opggTools.find(t => t.name === $('#opgg-tool').value);
  if (!tool) return;
  const unsupported = missingRequestedFilters(tool);
  $('#opgg-status').textContent =
    `조회 도구 확인됨 · ${unsupported.length ? `입력으로 지정할 수 없는 범위: ${unsupported.map(filterLabel).join('·')}. ` : '요청한 주요 필터를 지정할 수 있습니다. '}실제 반환 범위가 확인되기 전에는 추천 점수에 합산하지 않습니다.`;
  $('#opgg-fields').innerHTML = Object.entries(tool.inputSchema.properties || {})
    .map(([key, schema]) => {
      if (key === 'desired_output_fields' && schema.type === 'array') {
        const choices = outputFieldOptions(schema),
          selected = suggestedOutputFields(schema);
        if (!choices.length) {
          const defaults = defaultOutputFields(tool.name, state.role);
          return `<label class="output-fields">응답 필드 선택<input name="${esc(key)}" value="${esc(defaults.join(', '))}" placeholder="예: data.summary.average_stats.{win_rate,pick_rate}" ${(tool.inputSchema.required || []).includes(key) ? 'required' : ''}><small>요약 통계·트렌드·${tool.name === 'lol_get_champion_analysis' ? '아이템 빌드' : '내 역할 라인 메타'} 필드를 기본으로 요청합니다. 쉼표로 구분해 수정할 수 있습니다.</small>${schema.description ? `<details><summary>OP.GG가 허용하는 필드 목록</summary><pre>${esc(schema.description)}</pre></details>` : ''}</label>`;
        }
        return `<fieldset class="output-field-picker"><legend>응답 필드 · 필요한 통계 선택</legend><details open><summary>필드 ${choices.length}개 · ${selected.length}개 기본 선택</summary><div>${choices.map((field, index) => `<label><input type="checkbox" name="${esc(key)}" value="${esc(field)}" ${selected.includes(field) ? 'checked' : index === 0 && !selected.length ? 'checked' : ''}> ${esc(field)}</label>`).join('')}</div></details></fieldset>`;
      }
      const kind = fieldKind(key),
        labels = {
          tier: '통계 티어 범위',
          patch: '통계 패치',
          region: '통계 서버',
          role: '라인/포지션',
          champion: '챔피언',
          game_mode: '게임 모드',
          lang: '응답 언어',
        },
        label = labels[key] || labels[kind] || schema.title || key;
      const champion = catalog.champions.find(c => c.id === state.allies[ROLES.indexOf(state.role)]);
      let value =
        state.filters[kind] ??
        (kind === 'role'
          ? state.role
          : kind === 'champion'
            ? /id/i.test(key)
              ? champion?.key
              : champion?.id
            : // 앱 범위(소환사의 협곡 랭크)에 맞춘 기본값. 스키마 enum에 없으면 matchEnum이 비운다.
              (schema.default ?? (key === 'game_mode' ? 'ranked' : undefined))) ??
        '';
      if (schema.enum) value = matchEnum(value, schema.enum) ?? '';
      const required = (tool.inputSchema.required || []).includes(key),
        attrs = `name="${esc(key)}" ${required ? 'required' : ''}`;
      return `<label>${esc(label)}${required ? ' *' : ''}${schema.enum ? `<select ${attrs}><option value="">선택하세요</option>${schema.enum.map(v => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : `<input ${attrs} value="${esc(value)}" type="${['integer', 'number'].includes(schema.type) ? 'number' : 'text'}">`}<small>${esc((schema.description || '').slice(0, 180))}</small></label>`;
    })
    .join('');
}
$('#opgg-form').onsubmit = async e => {
  e.preventDefault();
  if (opggBusy) return;
  const tool = opggTools.find(t => t.name === $('#opgg-tool').value);
  if (!tool) return;
  const supported = supportedFilters(tool);
  if (state.filters.patch && !supported.has('patch')) {
    toast('이 도구는 지정 패치를 조회할 수 없습니다. 패치를 비우거나 다른 조회를 선택하세요.');
    return;
  }
  if (state.filters.tier && !supported.has('tier')) {
    toast('이 도구는 내 티어 필터를 지원하지 않습니다. 티어를 비우거나 챔피언 분석 조회를 선택하세요.');
    return;
  }
  let args;
  try {
    args = serializeArguments(new FormData(e.target), tool.inputSchema);
  } catch (err) {
    toast(err.message);
    return;
  }
  for (const key of tool.inputSchema.required || [])
    if (!(key in args)) {
      toast(`필수 조회 조건을 입력하세요: ${key === 'desired_output_fields' ? '응답 필드 선택' : key}`);
      return;
    }
  opggBusy = true;
  const button = e.target.querySelector('button');
  button.disabled = true;
  $('#opgg-result').innerHTML = '<p>선택한 조건으로 OP.GG 통계를 조회하는 중…</p>';
  try {
    const result = await api('/api/opgg/query', {tool: tool.name, arguments: args}),
      fetchedAt = result.fetchedAt || new Date().toISOString();
    const normalized = normalizeOpggCall(result, catalog);
    if (tool.name === 'lol_get_champion_analysis') {
      const championId = resolveProviderChampion(args.champion, catalog);
      externalItemBuild = championId
        ? parseOpggItemBuild(result.result, catalog, {championId, arguments: args, fetchedAt})
        : {status: 'unavailable', reason: '조회 챔피언을 현재 Riot 카탈로그와 연결할 수 없습니다.'};
      renderExternalBuild();
    }
    const itemNote =
      tool.name === 'lol_get_champion_analysis' && externalItemBuild?.status === 'ready'
        ? '<p class="coverage">아이템 빌드 통계는 아이템 페이지에서 현재 패치 구매 조건을 확인해 별도로 표시합니다.</p>'
        : '';
    $('#opgg-result').innerHTML =
      `${renderMetaResult(normalized, {nameOf: name, pool: state.pool, fetchedAt})}${itemNote}<details><summary>원본 응답 보기</summary><pre>${esc(resultText(result.result)) || '표시할 데이터가 없습니다.'}</pre></details>`;
  } catch (err) {
    if (tool.name === 'lol_get_champion_analysis') {
      externalItemBuild = {status: 'unavailable', reason: `OP.GG 조회 실패: ${err.message}`};
      renderExternalBuild();
    }
    $('#opgg-result').innerHTML =
      `<p class="opgg-warning">조회 실패: ${esc(err.message)}. 이전 통계로 대체하지 않았습니다.</p>`;
  } finally {
    opggBusy = false;
    button.disabled = false;
  }
};
async function refresh({automatic = false} = {}) {
  if (loading) return;
  loading = true;
  dataError = '';
  renderData();
  try {
    catalog = mergeCachedAbilities(catalog, await loadOfficial({refresh: !automatic}));
    ontology = createOntology(catalog);
    try {
      localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
    } catch {}
    state = normalizeState(stored || state, catalog);
    save();
    render();
    renderOntology();
    if (!$('#page-items').hidden) renderGraphBuild();
    if ($('#picker').open) renderPicker();
    if (!automatic) toast('공식 챔피언·아이템 데이터를 저장했습니다.');
  } catch (e) {
    dataError = e.message;
    if (!automatic) toast(`공식 데이터 연결 실패 · ${e.message}. 저장된 데이터는 유지합니다.`);
  } finally {
    loading = false;
    renderData();
  }
}
$('#role-tabs').addEventListener('click', e => {
  const role = e.target.closest('[data-role]')?.dataset.role;
  if (role) {
    state.role = role;
    save();
    render();
  }
});
$('.draft-panel').addEventListener('click', e => {
  const el = e.target.closest('[data-side]');
  if (el) openPicker({side: el.dataset.side, index: Number(el.dataset.index)});
});
$('#recommendations').addEventListener('click', e => {
  const id = e.target.closest('[data-pick]')?.dataset.pick;
  if (id) {
    try {
      state = assign(state, 'allies', ROLES.indexOf(state.role), id, catalog);
      save();
      render();
      setPage('items');
      toast(`${name(id)} 선택 · 아이템 초안을 만들었습니다.`);
    } catch (err) {
      toast(err.message);
    }
  }
});
$('#champion-grid').addEventListener('click', e => {
  const el = e.target.closest('[data-champion]');
  if (!el || el.disabled) return;
  const id = el.dataset.champion;
  if (target.side === 'pool') {
    state.pool = state.pool.includes(id) ? state.pool.filter(x => x !== id) : [...state.pool, id];
    save();
    render();
    renderPicker();
  } else {
    try {
      state = assign(state, target.side, target.index, id, catalog);
      save();
      render();
      $('#picker').close();
    } catch (err) {
      toast(err.message);
    }
  }
});
$('#clear-slot').onclick = () => {
  state = assign(state, target.side, target.index, null, catalog);
  save();
  render();
  $('#picker').close();
};
$('#edit-pool').onclick = () => openPicker({side: 'pool'});
$('#close-picker').onclick = () => $('#picker').close();
$('#search').oninput = renderPicker;
$('#pool-only').onchange = e => {
  state.poolOnly = e.target.checked;
  save();
  render();
};
$('#refresh-data').onclick = () => refresh();
$('#reset').onclick = () => {
  const {pool, personal, filters, poolOnly} = state;
  state = {...emptyState(), pool, personal, filters, poolOnly};
  save();
  render();
  toast('밴·픽을 초기화했습니다. 개인 설정은 유지합니다.');
};
$('#example').onclick = () => {
  state = normalizeState(
    {
      ...emptyState(),
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
      filters: state.filters,
    },
    catalog,
  );
  save();
  render();
  toast('물리 피해가 많은 아군 조합 예시를 불러왔습니다.');
};
document.addEventListener(
  'error',
  e => {
    if (e.target instanceof HTMLImageElement) {
      e.target.style.display = 'none';
    }
  },
  true,
);
render();
renderOntology();
const requestedPage = location.hash.slice(1);
if (['ontology', 'banpick', 'items'].includes(requestedPage)) setPage(requestedPage);
// Fetch only the local backend snapshot on entry; Riot polling runs on the backend.
refresh({automatic: true});
$('#clear-local-data').onclick = () => {
  if (!confirm('이 브라우저에 저장된 밴픽 상태, 챔피언 풀·선호도·숙련도, 조회 조건, 카탈로그 캐시를 모두 삭제할까요?'))
    return;
  try {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem(CATALOG_KEY);
  } catch {
    toast('이 브라우저의 저장소에 접근하지 못했습니다.');
    return;
  }
  // 삭제 직후 다시 저장하지 않는다. 다음 입력부터 새로 저장된다.
  stored = null;
  state = emptyState();
  externalItemBuild = null;
  $('#opgg-result').innerHTML = '';
  render();
  renderOntology();
  if (!$('#page-items').hidden) renderGraphBuild();
  toast('저장 데이터를 삭제했습니다. 현재 화면의 공식 카탈로그는 새로고침하면 서버에서 다시 받습니다.');
};
