// OP.GG 조회 결과(MetaEstimate)를 HTML 문자열로 만든다. DOM에 의존하지 않아 테스트할 수 있다.
import {NOT_REQUESTABLE, SCOPE_KEYS, UNKNOWN} from './meta-estimate.js';

export const escapeHtml = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char],
  );
const SCOPE_LABELS = {region: '서버', queue: '큐', role: '포지션', tier: '티어', patch: '패치'};
const scopeValue = value =>
  value === NOT_REQUESTABLE ? '지정 불가' : value === UNKNOWN ? '미확인' : value === 'all' ? '전체 티어' : value;
export const percent = value => (value === null ? '없음' : `${(value * 100).toFixed(1)}%`);
const number = value => (value === null ? '없음' : value.toLocaleString('ko-KR'));

export function scopeTable(estimate) {
  const rows = SCOPE_KEYS.map(key => {
    const requested = estimate.requestedScope[key],
      returned = estimate.returnedScope[key];
    const status =
      returned === UNKNOWN
        ? '<span class="scope-unknown">응답 미확인</span>'
        : requested !== NOT_REQUESTABLE && requested !== returned
          ? '<span class="scope-mismatch">요청과 다름</span>'
          : '<span class="scope-ok">응답 확인</span>';
    return `<tr><th scope="row">${SCOPE_LABELS[key]}</th><td>${escapeHtml(scopeValue(requested))}</td><td>${escapeHtml(scopeValue(returned))}</td><td>${status}</td></tr>`;
  }).join('');
  return `<table class="scope-table"><caption>통계 범위 · 요청한 값과 응답이 밝힌 값</caption><thead><tr><th scope="col">범위</th><th scope="col">요청</th><th scope="col">응답</th><th scope="col">판정</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function observationNotes(observations) {
  if (!observations?.length) return '';
  return `<p class="coverage">${observations
    .map(
      o =>
        `${escapeHtml(o.field)} = ${escapeHtml(o.value)}${o.observedAt ? ` (${escapeHtml(o.observedAt)})` : ''} · 트렌드 값의 패치 표기이며 요약·빌드 통계의 패치로 단정하지 않습니다.`,
    )
    .join('<br>')}</p>`;
}

function rankingNote(estimates) {
  const usable = estimates.filter(estimate => estimate.usableForRanking).length;
  if (usable === estimates.length)
    return '<p class="coverage">모든 범위가 응답으로 확인되어 추천 점수에 반영할 수 있습니다.</p>';
  const blockers = [...new Set(estimates.flatMap(estimate => estimate.rankingBlockers))];
  return `<p class="opgg-warning">추천 점수에 반영하지 않음 · ${escapeHtml(blockers.join(', '))}. 비교용 참고 자료로만 표시합니다.</p>`;
}

export function renderMetaResult(normalized, {nameOf = id => id, pool = [], fetchedAt, limit = 15} = {}) {
  const heading = `<p><b>OP.GG 조회 결과</b>${fetchedAt ? ` · ${escapeHtml(new Date(fetchedAt).toLocaleString('ko-KR'))}` : ''}</p>`;
  if (normalized.status !== 'ready')
    return `${heading}<p class="opgg-warning">통계를 정규화하지 못했습니다: ${escapeHtml(normalized.reason)}</p>`;
  const [first] = normalized.estimates;
  const provider = `<p class="coverage">출처: ${escapeHtml(first.source)} · ${escapeHtml(first.tool)} · 제공자 버전 ${escapeHtml(first.providerVersion)} · 표본 정의 ${escapeHtml(scopeValue(first.sampleSize))}</p>`;
  let body = '';
  if (first.kind === 'champion-position-summary') {
    const s = first.statistic;
    body = `<section class="opgg-stats"><b>${escapeHtml(first.championId ? nameOf(first.championId) : first.providerChampion)} · OP.GG 집계</b><p>승률 ${percent(s.winRate)} · 픽률 ${percent(s.pickRate)} · 밴률 ${percent(s.banRate)}</p><small>play ${number(s.play)} · OP.GG 티어 ${number(s.providerTier)} · 순위 ${number(s.providerRank)} · ${escapeHtml(s.definition)}</small></section>`;
  } else {
    const rows = normalized.estimates
      .slice(0, limit)
      .map(estimate => {
        const s = estimate.statistic,
          mine = pool.includes(estimate.championId);
        return `<tr class="${mine ? 'in-pool' : ''}"><td>${number(s.providerRank)}</td><th scope="row">${escapeHtml(nameOf(estimate.championId))}${mine ? ' <small>내 풀</small>' : ''}</th><td>${percent(s.winRate)}</td><td>${percent(s.pickRate)}</td><td>${percent(s.banRate)}</td><td>${number(s.play)}</td></tr>`;
      })
      .join('');
    body = `<table class="meta-table"><caption>${escapeHtml(first.returnedScope.role)} 라인 메타 · 상위 ${Math.min(limit, normalized.estimates.length)}/${normalized.estimates.length}명</caption><thead><tr><th scope="col">순위</th><th scope="col">챔피언</th><th scope="col">승률</th><th scope="col">픽률</th><th scope="col">밴률</th><th scope="col">play</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  const unresolved = normalized.unresolved?.length
    ? `<p class="coverage">현재 Riot 카탈로그와 연결하지 못한 OP.GG 챔피언: ${escapeHtml(normalized.unresolved.join(', '))}</p>`
    : '';
  return `${heading}${scopeTable(first)}${observationNotes(normalized.observations)}${body}${unresolved}${rankingNote(normalized.estimates)}${provider}`;
}
