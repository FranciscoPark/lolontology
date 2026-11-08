// 편집 아이템 템플릿과 OP.GG 통계 빌드를 같은 Data Dragon 아이템 패치에서 나란히 비교한다.
// 두 출처의 근거는 합치지 않고 행마다 따로 보여준다.
import {escapeHtml, percent} from './opgg-view.js';

const STAT_GROUPS = [
  'core_items',
  'boots',
  'starter_items',
  'fourth_items',
  'fifth_items',
  'sixth_items',
  'last_items',
];

function statIndex(external) {
  const index = new Map();
  // 그룹 우선순위(코어 → 신발 → 시작 → 4·5·6번째 → 마지막)대로 처음 나온 그룹을 대표로 쓰고,
  // 같은 그룹 안에서는 선택 비율이 가장 높은 관측을 쓴다.
  const groups = [...external.groups]
    .filter(group => STAT_GROUPS.includes(group.key))
    .sort((a, b) => STAT_GROUPS.indexOf(a.key) - STAT_GROUPS.indexOf(b.key));
  for (const group of groups)
    for (const choice of group.choices)
      for (const item of choice.items) {
        const current = index.get(item.id);
        if (current && (current.groupKey !== group.key || current.pickRate >= choice.pickRate)) continue;
        index.set(item.id, {group: group.label, groupKey: group.key, pickRate: choice.pickRate, play: choice.play});
      }
  return index;
}

export function compareBuilds(draft, external) {
  if (draft?.status !== 'ready') return {status: 'unavailable', reason: '템플릿 초안이 없습니다.'};
  if (external?.status !== 'ready') return {status: 'unavailable', reason: 'OP.GG 통계 빌드가 없습니다.'};
  if (draft.championId !== external.championId)
    return {status: 'unavailable', reason: '템플릿과 통계 빌드의 챔피언이 다릅니다.'};
  if (!draft.itemVersion || draft.itemVersion !== external.itemVersion)
    return {
      status: 'unavailable',
      reason: `아이템 패치가 다릅니다 (템플릿 ${draft.itemVersion || 'unknown'}, 통계 검증 ${external.itemVersion || 'unknown'}).`,
    };
  const stats = statIndex(external);
  const templateItems = [
    ['시작', draft.start],
    ['신발', draft.boots],
    ...draft.core.map((item, index) => [`코어 ${index + 1}`, item]),
  ].filter(([, item]) => item);
  const templateIds = new Set(templateItems.map(([, item]) => item.id));
  const rows = templateItems.map(([slot, item]) => ({slot, item, stat: stats.get(item.id) || null}));
  const statOnly = [...stats.entries()]
    .filter(([id, stat]) => !templateIds.has(id) && stat.groupKey !== 'starter_items')
    .sort((a, b) => b[1].pickRate - a[1].pickRate)
    .slice(0, 6)
    .map(([id, stat]) => ({
      item: external.groups.flatMap(g => g.choices.flatMap(c => c.items)).find(i => i.id === id),
      stat,
    }));
  const coreRows = rows.filter(row => row.slot.startsWith('코어'));
  return {
    status: 'ready',
    itemVersion: draft.itemVersion,
    rows,
    statOnly,
    coreOverlap: {matched: coreRows.filter(row => row.stat).length, total: coreRows.length},
    scopeNote: external.scopeWarning,
  };
}

export function renderBuildComparison(comparison, {templateLabel = ''} = {}) {
  if (comparison.status !== 'ready')
    return `<p class="coverage">템플릿·통계 비교 미표시: ${escapeHtml(comparison.reason)}</p>`;
  const rows = comparison.rows
    .map(
      ({slot, item, stat}) =>
        `<tr><th scope="row">${escapeHtml(slot)}</th><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.reason || '')}</td><td>${stat ? `${escapeHtml(stat.group)} · 선택 ${percent(stat.pickRate)} · ${stat.play.toLocaleString('ko-KR')}게임` : '<span class="scope-unknown">통계 응답에 없음</span>'}</td></tr>`,
    )
    .join('');
  const extra = comparison.statOnly.length
    ? `<p class="coverage">통계에만 있는 아이템: ${comparison.statOnly
        .map(
          ({item, stat}) => `${escapeHtml(item?.name || '')} (${escapeHtml(stat.group)} · ${percent(stat.pickRate)})`,
        )
        .join(', ')}</p>`
    : '';
  return `<section class="build-compare"><div class="item-row-heading"><h3>템플릿 ↔ 통계 비교</h3><small>아이템 패치 ${escapeHtml(comparison.itemVersion)} · 코어 ${comparison.coreOverlap.matched}/${comparison.coreOverlap.total}개가 통계 응답에 있음</small></div><table class="meta-table"><thead><tr><th scope="col">슬롯</th><th scope="col">템플릿 아이템</th><th scope="col">템플릿 근거${templateLabel ? ` · ${escapeHtml(templateLabel)}` : ''}</th><th scope="col">OP.GG 통계 (범위 미확인)</th></tr></thead><tbody>${rows}</tbody></table>${extra}<p class="opgg-warning">${escapeHtml(comparison.scopeNote || '')} 통계 선택 비율은 인기 지표이며 승률 개선이나 최적 빌드를 뜻하지 않습니다.</p></section>`;
}
