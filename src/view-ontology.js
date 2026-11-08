// 온톨로지 페이지: 챔피언·아이템 검색 결과 카드와 직접 이웃 관계 그래프(SVG).
import {$, app, esc, setCatalog} from './app-state.js';
import {ROLE_NAMES} from './ontology.js';
import {abilityImage, loadChampionAbilities} from './catalog.js';
import {ontologyInfo, ontologyNeighborhood, searchOntology} from './graph.js';

// 타원 배치에서 노드가 겹치지 않는 최대 수. 나머지는 개수만 안내한다.
const GRAPH_NODE_LIMIT = 24;
const RELATION_LABELS = {
  AVAILABLE_IN: '패치',
  PLAYS_ROLE: '역할',
  HAS_TRAIT: '특성',
  BUILDS_FROM: '조합 재료',
  HAS_BUILD_CANDIDATE: '빌드 후보',
  HAS_ABILITY: '보유 스킬',
  APPLIES_EFFECT: '효과',
  MITIGATES: '상쇄',
};
const NODE_COLORS = {
  Champion: '#70bda2',
  Item: '#e8bd67',
  Role: '#82a9d8',
  Trait: '#c69ce2',
  Patch: '#a6b2b4',
  Ability: '#eb9ac1',
  Effect: '#e88f7a',
};
const NODE_TYPE_NAMES = {
  Champion: '챔피언',
  Item: '아이템',
  Role: '역할',
  Trait: '특성',
  Patch: '패치',
  Ability: '스킬',
  Effect: '효과',
};
const GRAPH_CENTER = {x: 480, y: 275},
  GRAPH_RADIUS = {x: 340, y: 190};

const nodeSubtitle = (type, slot) => (type === 'Ability' ? `스킬 · ${slot}` : NODE_TYPE_NAMES[type] || type);
const shortLabel = text => (text.length > 18 ? `${text.slice(0, 17)}…` : text);

function graphNodeSvg({x, y, r, type, id, label, subtitle, root = false}) {
  const interactive = root
    ? ''
    : `tabindex="0" role="button" data-graph-node="true" data-graph-type="${esc(type)}" data-graph-id="${esc(id)}"`;
  return `<g class="graph-node ${root ? 'graph-node-root' : ''}" ${interactive}><circle cx="${x}" cy="${y}" r="${r}" fill="#17262a" stroke="${NODE_COLORS[type] || '#9db4ae'}"/><text class="graph-node-type" x="${x}" y="${y - 4}">${esc(subtitle)}</text><text class="graph-node-name" x="${x}" y="${y + 14}">${esc(shortLabel(label))}</text></g>`;
}

function graphEdgeSvg(point) {
  const incoming = point.direction === 'incoming',
    {x: cx, y: cy} = GRAPH_CENTER;
  const marker = `${incoming ? 'marker-start' : 'marker-end'}="url(#graph-arrow)"`;
  const label = RELATION_LABELS[point.relationship] || point.relationship;
  return `<g><line class="graph-edge ${incoming ? 'incoming' : ''}" ${marker} x1="${cx}" y1="${cy}" x2="${point.x}" y2="${point.y}"/><text class="graph-edge-label" x="${(cx + point.x) / 2}" y="${(cy + point.y) / 2 - 6}">${esc(label)}</text></g>`;
}

function abilityDetail(entity) {
  if (entity.type !== 'Ability') return '';
  const image = abilityImage(app.catalog, entity);
  const icon = image ? `<img src="${esc(image)}" alt="${esc(entity.name)} 아이콘" loading="lazy">` : '';
  const meta = `${esc(entity.championName || '')} · ${esc(entity.slot || '')} · Data Dragon ${esc(entity.version || 'patch unknown')}`;
  return `<article class="ability-detail">${icon}<div><span>${meta}</span><h4>${esc(entity.name || entity.id)}</h4><p>${esc(entity.description || '설명 없음')}</p></div></article>`;
}

// 공식 데이터의 챔피언을 처음 열면 해당 패치의 스킬을 백엔드에서 받아 그래프에 추가한다.
async function ensureAbilities(type, id, sequence) {
  const {catalog} = app;
  if (type !== 'Champion' || catalog.mode !== 'official' || catalog.abilities?.[id]?.length) return '';
  $('#ontology-graph').innerHTML = '<p class="muted">현재 패치의 패시브와 QWER 스킬을 불러오는 중…</p>';
  try {
    const abilities = await loadChampionAbilities(catalog, id);
    if (sequence === app.graphRenderSeq && app.catalog === catalog)
      setCatalog({...catalog, abilities: {...(catalog.abilities || {}), [id]: abilities}});
    return '';
  } catch (error) {
    return `스킬 정보를 불러오지 못했습니다: ${error.message}`;
  }
}

export async function renderOntologyGraph(type, id, filters = {}) {
  const host = $('#ontology-graph'),
    sequence = ++app.graphRenderSeq;
  const warning = await ensureAbilities(type, id, sequence);
  if (sequence !== app.graphRenderSeq) return;
  const data = ontologyNeighborhood(app.ontology, type, id, filters, GRAPH_NODE_LIMIT);
  if (!data) {
    host.innerHTML = '<p class="muted">표시할 그래프가 없습니다. 패치와 필터를 확인하세요.</p>';
    return;
  }
  app.graphRoot = {type, id};
  const {entity, relations} = data,
    count = relations.length;
  if (!count) {
    host.innerHTML = `<p class="muted">${esc(entity.name || entity.id)}에 연결된 관계가 없습니다.</p>`;
    return;
  }
  const points = relations.map((edge, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return {
      ...edge,
      x: GRAPH_CENTER.x + Math.cos(angle) * GRAPH_RADIUS.x,
      y: GRAPH_CENTER.y + Math.sin(angle) * GRAPH_RADIUS.y,
    };
  });
  const edges = points.map(graphEdgeSvg).join('');
  const nodes = points
    .map(point =>
      graphNodeSvg({
        x: point.x,
        y: point.y,
        r: 28,
        type: point.targetType,
        id: point.targetId,
        label: point.targetName || point.targetId,
        subtitle: nodeSubtitle(point.targetType, point.slot),
      }),
    )
    .join('');
  const root = graphNodeSvg({
    ...GRAPH_CENTER,
    r: 42,
    type: entity.type,
    id: entity.id,
    label: entity.name || entity.id,
    subtitle: nodeSubtitle(entity.type, entity.slot),
    root: true,
  });
  const arrow =
    '<defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#648278"/></marker></defs>';
  const summary = data.truncated
    ? `직접 연결 ${data.total}개 중 ${count}개 표시 · 관계·역할 필터로 좁혀 보세요`
    : `직접 연결 ${count}개`;
  host.innerHTML = `${warning ? `<p class="graph-warning">${esc(warning)}</p>` : ''}<div class="ontology-svg-scroll"><svg class="ontology-svg" viewBox="0 0 960 550" role="img" aria-label="${esc(entity.name || entity.id)} 관계 그래프">${arrow}${edges}${nodes}${root}</svg></div><p class="graph-caption">선의 방향은 관계의 방향입니다. ${summary} · 노드를 선택하면 해당 항목 중심으로 이동합니다.</p>${abilityDetail(entity)}`;
}

// 패치 필터는 현재 로드된 Data Dragon 버전만 고를 수 있다. 카탈로그가 바뀌면 사라진 버전 선택은 해제한다.
function syncPatchOptions() {
  const select = $('#ontology-patch'),
    selected = select.value,
    versions = ontologyInfo(app.ontology).versions;
  select.innerHTML = `<option value="">전체 로드 패치</option>${versions.map(version => `<option value="${esc(version)}">${esc(version)}</option>`).join('')}`;
  select.value = versions.includes(selected) ? selected : '';
}

const REVIEW_LABELS = {reviewed: '검토됨', prototype: '초안 주석'};

function relationChip(relation) {
  const arrow = relation.direction === 'incoming' ? '← ' : '';
  return `<span class="relation-chip"><b>${esc(relation.relationship)}</b> ${arrow}${esc(relation.targetName || relation.targetId || '')}</span>`;
}

function championDetail(entity) {
  const roles = entity.editorialRoles?.length
    ? entity.editorialRoles.map(role => esc(ROLE_NAMES[role] || role)).join(' · ')
    : '역할 미검토';
  const damage =
    entity.editorialDamage && entity.editorialDamage !== 'unknown' ? esc(entity.editorialDamage) : '피해 유형 미검토';
  return `${entity.title ? `${esc(entity.title)} · ` : ''}${roles} · ${damage}`;
}

function itemDetail(entity) {
  const description = entity.plaintext
    ? esc(entity.plaintext)
    : entity.description
      ? esc(entity.description.replace(/<[^>]*>/g, ' ').slice(0, 160))
      : '아이템 설명 없음';
  const gold = entity.goldTotal || entity.gold?.total;
  return `${description} · ${gold ? `${Number(gold).toLocaleString()} G` : '가격 정보 없음'}`;
}

function ontologyCard(type, {entity, relations = []}) {
  const links =
    relations.map(relationChip).join('') || '<span class="muted">직접 관계 없음 · 아직 입력된 관계가 없습니다.</span>';
  const status = REVIEW_LABELS[entity.reviewStatus] || '의미 주석 없음';
  const detail = type === 'champion' ? championDetail(entity) : itemDetail(entity);
  const source = `출처: ${esc(entity.source || entity.annotationSource || 'Riot Data Dragon / editorial prototype')} · ${esc(entity.version || app.catalog.version || 'patch unknown')}`;
  const heading = `<div><span class="eyebrow">${type === 'champion' ? 'CHAMPION' : 'ITEM'} · ${esc(entity.id)}</span><h3>${esc(entity.name || entity.id)}</h3></div>`;
  const focus = `<button class="graph-focus" data-focus-type="${esc(entity.type)}" data-focus-id="${esc(entity.id)}">그래프로 보기</button>`;
  return `<article class="ontology-card"><div class="ontology-card-head">${heading}${focus}<span class="review-badge">${status}</span></div><p>${detail}</p><div class="relation-list">${links}</div><small class="ontology-source">${source}</small></article>`;
}

const currentFilters = () => ({
  role: $('#ontology-role').value,
  relationship: $('#ontology-relationship').value,
  patch: $('#ontology-patch').value,
});

export function renderOntology() {
  syncPatchOptions();
  const {catalog, ontology} = app,
    type = $('#ontology-type').value,
    query = $('#ontology-query').value.trim(),
    filters = currentFilters(),
    root = $('#ontology-results');
  $('#graph-status').textContent = ontologyInfo(ontology).versions.length
    ? `JavaScript 온톨로지 · 챔피언 ${catalog.championVersion || catalog.version} · 아이템 ${catalog.itemVersion || catalog.version}`
    : 'JavaScript 온톨로지 · 예제 데이터';
  const results = searchOntology(ontology, type, query, filters.patch, 30, filters);
  if (!results.length) {
    const hint = filters.patch
      ? '선택한 데이터 버전과 이 유형의 노드가 일치하지 않습니다.'
      : '검색어와 필터를 바꾸거나 Data Dragon을 불러오세요.';
    root.innerHTML = `<div class="empty-state"><strong>조회 결과가 없습니다.</strong><p>${hint}</p></div>`;
    $('#ontology-graph').innerHTML = '<p class="muted">검색 결과가 있으면 관계 그래프를 표시합니다.</p>';
    return;
  }
  const {graphRoot} = app;
  const selected =
    (graphRoot && results.find(x => x.entity.type === graphRoot.type && x.entity.id === graphRoot.id)) || results[0];
  renderOntologyGraph(selected.entity.type, selected.entity.id, filters);
  root.innerHTML = results.map(result => ontologyCard(type, result)).join('');
}

export function bindOntology() {
  $('#ontology-search').addEventListener('submit', event => {
    event.preventDefault();
    renderOntology();
  });
  const focus = el =>
    renderOntologyGraph(
      el.dataset.focusType || el.dataset.graphType,
      el.dataset.focusId || el.dataset.graphId,
      currentFilters(),
    );
  $('#ontology-results').addEventListener('click', event => {
    const el = event.target.closest('[data-focus-id]');
    if (el) focus(el);
  });
  $('#ontology-graph').addEventListener('click', event => {
    const el = event.target.closest('[data-graph-node]');
    if (el) focus(el);
  });
  $('#ontology-graph').addEventListener('keydown', event => {
    const el = event.target.closest('[data-graph-node]');
    if (el && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      focus(el);
    }
  });
  for (const id of ['#ontology-type', '#ontology-role', '#ontology-patch', '#ontology-relationship'])
    $(id).addEventListener('change', renderOntology);
}
