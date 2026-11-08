// 아이템 페이지: 편집 템플릿 초안, OP.GG 통계 빌드와 비교, 온톨로지 빌드 후보.
import {$, app, esc, nameOf} from './app-state.js';
import {ROLES} from './ontology.js';
import {itemImage} from './catalog.js';
import {buildDraft} from './engine.js';
import {itemBuildCandidates, ontologyInfo} from './graph.js';
import {compareBuilds, renderBuildComparison} from './build-compare.js';

const EVIDENCE_LABELS = {template: '템플릿', composition: '상대 조합', personal: '개인 입력'};
const GRAPH_SLOT_NAMES = {
  start: '시작',
  boots: '신발',
  'core-1': '코어 1',
  'core-2': '코어 2',
  'core-3': '코어 3',
  'core-4': '코어 4',
  'core-5': '코어 5',
  'core-6': '코어 6',
};
const ownChampion = () => app.state.allies[ROLES.indexOf(app.state.role)];
const priceText = (item, fallback) =>
  Number.isFinite(item?.gold?.total) ? `${item.gold.total.toLocaleString()} G` : fallback;

function itemIcon(item) {
  const image = item ? itemImage(app.catalog, item.id) : null;
  return image
    ? `<img class="item-icon" src="${esc(image)}" alt="${esc(item.name)} 아이템 이미지" loading="lazy">`
    : '<span class="item-icon placeholder" aria-label="아이템 이미지 없음">◇</span>';
}

export function itemCard(item, label) {
  if (!item) return '';
  return `<article class="item-card"><span class="item-step">${label}</span><div class="item-main">${itemIcon(item)}<div><h4>${esc(item.name)}</h4><small>${priceText(item, '공식 데이터 로드 후 표시')}</small></div></div><p>${esc(item.reason)}</p></article>`;
}

function itemRow(title, subtitle, cards, empty, gridClass = '') {
  return `<section class="item-row"><div class="item-row-heading"><h3>${title}</h3><small>${subtitle}</small></div><div class="item-grid ${gridClass}">${cards || `<p class="coverage">${empty}</p>`}</div></section>`;
}

function draftSections(draft) {
  const fullSlots = draft.core.length >= 6;
  const evidence = (draft.evidence || [])
    .map(entry => `<li><b>${EVIDENCE_LABELS[entry.kind] || entry.kind}</b> ${esc(entry.text)}</li>`)
    .join('');
  const summary = `<div class="build-summary"><span>${esc(draft.label)}</span><small>초안 · 조합이 바뀌면 방어 후보와 대안이 갱신됩니다</small></div><ul class="build-evidence">${evidence}</ul>`;
  const slotNote = `<p class="build-disclaimer">${fullSlots ? '원딜 후반 풀슬롯 예시: 신발을 판매하고 코어 6개를 장착합니다.' : '후반 완성 기준 6칸: 코어 5개 + 신발 1개.'} 시작 아이템은 초반용이며 완성 빌드에서는 교체됩니다.</p>`;
  const rows = [
    itemRow(
      '첫 아이템',
      '라인 시작용 · 후반 교체',
      itemCard(draft.start, '시작 아이템'),
      '이 역할에는 첫 아이템을 제안하지 않습니다.',
    ),
    itemRow(
      '코어 아이템',
      fullSlots ? '원딜 풀슬롯 후반 후보 · 신발 판매 후 장착' : '최종 빌드 6칸 중 신발을 제외한 5개 · 구매 순서 초안',
      draft.core.map((item, index) => itemCard(item, `코어 후보 ${index + 1}`)).join(''),
      '유효한 코어 후보가 없습니다.',
    ),
    itemRow(
      '신발',
      fullSlots ? '일반 빌드의 이동 속도 아이템 · 풀슬롯에서는 교체 가능' : '최종 6칸 중 1칸 · 상대 조합에 따라 선택',
      itemCard(draft.boots, '신발 후보'),
      '유효한 신발 후보가 없습니다.',
    ),
    draft.alternatives.length
      ? itemRow(
          '상황별 대안',
          '위 기본 초안에 추가하지 않고 교체 검토 · 근거에 온톨로지 경로 표시',
          draft.alternatives.map(item => itemCard(item, '교체 후보')).join(''),
          '',
          'alternatives',
        )
      : '',
  ].join('');
  const notes = `<details class="build-notes"><summary>초안을 해석하는 방법과 데이터 한계</summary><ul>${draft.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul></details>`;
  const disclaimer =
    '<p class="build-disclaimer">아이콘과 가격은 Riot Data Dragon의 현재 로드된 패치 데이터를 사용합니다. 예제 모드에서는 가격과 이미지가 검증되지 않습니다. 챔피언별 최적 빌드가 아닌 유형별 템플릿입니다.</p>';
  return summary + slotNote + rows + notes + disclaimer;
}

export function renderBuild() {
  const draft = buildDraft(app.state, app.catalog, app.ontology);
  $('#build-title').textContent =
    draft.status === 'ready' ? `${nameOf(draft.championId)} · 아이템 초안` : '픽에서 시작하는 아이템 초안';
  $('#build').innerHTML =
    draft.status === 'ready'
      ? draftSections(draft)
      : `<div class="empty-build"><span>◇</span><h3>${draft.status === 'empty' ? '먼저 내 픽을 골라보세요.' : '아직 지원하지 않는 빌드입니다.'}</h3><p>${esc(draft.message)}</p></div>`;
  renderExternalBuild(draft);
}

const OPGG_ROLE_TO_APP = {
  BOT: 'ADC',
  BOTTOM: 'ADC',
  ADC: 'ADC',
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MID: 'MID',
  MIDDLE: 'MID',
  SUPPORT: 'SUPPORT',
};

function externalGroup(group) {
  const percentText = rate => rate.toLocaleString('ko-KR', {style: 'percent', maximumFractionDigits: 1});
  const cards = group.choices
    .map((choice, index) =>
      choice.items
        .map((item, itemIndex) => {
          const combo = choice.items.length > 1 ? ` · 조합 ${itemIndex + 1}/${choice.items.length}` : '';
          const reason = `OP.GG 통계 그룹 ${index + 1} · ${percentText(choice.pickRate)} 선택 비율 · ${choice.play.toLocaleString()}게임 (${choice.win.toLocaleString()}승)${combo}`;
          return itemCard({...item, reason}, group.choices.length > 1 ? `통계 후보 ${index + 1}` : group.label);
        })
        .join(''),
    )
    .join('');
  return `<section class="item-row"><div class="item-row-heading"><h3>${esc(group.label)}</h3><small>응답된 조합·픽률 기준 후보</small></div><div class="item-grid external-item-grid">${cards}</div></section>`;
}

// OP.GG 통계 빌드는 현재 챔피언·역할·아이템 패치와 모두 맞을 때만 표시한다.
function externalBuildBlocker(build, champion) {
  const {catalog, state} = app;
  if (!build)
    return '<div class="external-build-empty"><strong>통계 기반 아이템 빌드</strong><p>밴픽 페이지에서 OP.GG를 연결하고 ‘챔피언 분석 · 빌드’를 조회하면, 실제 아이템 픽률과 표본 수를 여기에 표시합니다.</p></div>';
  if (build.status !== 'ready')
    return `<p class="opgg-warning">OP.GG 아이템 빌드 미표시: ${esc(build.reason || '응답을 검증하지 못했습니다.')}</p>`;
  const currentItemVersion = catalog.itemVersion || catalog.version;
  if (build.itemVersion !== currentItemVersion)
    return `<p class="opgg-warning">저장된 OP.GG 결과는 아이템 패치 ${esc(build.itemVersion)} 기준으로 검증됐습니다. 현재 패치 ${esc(currentItemVersion || 'unknown')} 데이터와 달라 다시 조회해야 합니다.</p>`;
  const queriedRole = String(build.role || '').toUpperCase();
  if (champion !== build.championId || (queriedRole && OPGG_ROLE_TO_APP[queriedRole] !== state.role))
    return `<p class="opgg-warning">저장된 통계는 ${esc(nameOf(build.championId))} · ${esc(build.role || '역할 미확인')} 조회입니다. 현재 선택(${esc(champion ? nameOf(champion) : '챔피언 없음')} · ${esc(state.role)})과 달라 표시하지 않았습니다.</p>`;
  return null;
}

export function renderExternalBuild(draft = buildDraft(app.state, app.catalog, app.ontology)) {
  const host = $('#external-build'),
    build = app.externalItemBuild;
  if (!host) return;
  const blocker = externalBuildBlocker(build, ownChampion());
  if (blocker) {
    host.innerHTML = blocker;
    return;
  }
  const heading = `<div class="external-build-heading"><div><span class="eyebrow">STATISTICAL BUILD · ${esc(build.source)}</span><h3>OP.GG 통계 기반 아이템</h3></div><small>${esc(build.itemVersion)} 아이템 검증 · ${esc(new Date(build.fetchedAt).toLocaleString('ko-KR'))}</small></div>`;
  const tier = build.tier ? `조회 티어: ${esc(build.tier)}.` : '티어 범위는 제공 데이터 기본값입니다.';
  const scope = `<p class="opgg-warning">${esc(build.scopeWarning)} ${tier} 지역·패치 통계 범위는 응답에서 확인되지 않았습니다.</p>`;
  const omitted = build.omitted.length
    ? `<p class="coverage">현재 패치에서 구매 검증을 통과하지 않아 제외한 아이템 ID: ${esc(build.omitted.join(', '))}</p>`
    : '';
  const comparison = renderBuildComparison(compareBuilds(draft, build), {templateLabel: draft.label});
  host.innerHTML = heading + scope + build.groups.map(externalGroup).join('') + omitted + comparison;
}

export function renderGraphBuild() {
  const host = $('#graph-build'),
    champion = ownChampion();
  if (!champion) {
    host.innerHTML = '<p class="coverage">밴픽 페이지에서 내 역할 챔피언을 선택하면 그래프 후보를 조회합니다.</p>';
    return;
  }
  const rows = itemBuildCandidates(app.ontology, champion, app.state.role);
  if (!rows.length) {
    host.innerHTML =
      '<p class="coverage">현재 온톨로지에 이 챔피언의 역할별 빌드 후보가 없습니다. 로컬 아이템 초안을 표시합니다.</p>';
    return;
  }
  const itemVersion = app.catalog.itemVersion || ontologyInfo(app.ontology).version || 'patch unknown';
  const cards = rows
    .map(({item, slot, reviewStatus, source}) => {
      const icon =
        item && itemImage(app.catalog, item.id) ? itemIcon(item) : '<span class="item-icon placeholder">◇</span>';
      return `<article class="graph-build-item"><small>${esc(GRAPH_SLOT_NAMES[slot] || slot)}</small>${icon}<b>${esc(item?.name || item?.id || '')}</b><small>${priceText(item, '공식 데이터 로드 후 가격 표시')}</small><small>${esc(reviewStatus || 'unknown')} · ${esc(source || 'source unknown')}</small></article>`;
    })
    .join('');
  host.innerHTML = `<div class="graph-build-heading"><strong>온톨로지 연결 후보</strong><span>${esc(itemVersion)} · prototype</span></div><div class="graph-build-items">${cards}</div><p class="coverage">아이콘과 가격: Riot Data Dragon ${esc(app.catalog.itemVersion || '현재 로드된 아이템 패치')}. 그래프 관계는 편집 템플릿에서 생성했으며 패치별 최적 빌드로 검증되지 않았습니다.</p>`;
}
