// OP.GG 상성 참고: 후보 챔피언의 전체 승률과 강한·약한 상대 상위 목록. 추천 점수에는 넣지 않는다.
import {parseOpggText} from './opgg-text.js';
import {resultText} from './opgg-ui.js';
import {escapeHtml, percent} from './opgg-view.js';

export const COUNTER_FIELDS = [
  'data.summary.average_stats.{play,win_rate,tier,rank}',
  'data.strong_counters[].{champion_id,champion_name,play,win,my_win_rate}',
  'data.weak_counters[].{champion_id,champion_name,play,win,my_win_rate}',
];

const isRate = value => Number.isFinite(value) && value >= 0 && value <= 1;

function counterRows(rows, byKey) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => Number.isInteger(row?.play) && row.play >= 0 && isRate(row.my_win_rate))
    .map(row => ({
      championId: byKey.get(String(row.champion_id)) || null,
      name: String(row.champion_name || row.champion_id),
      play: row.play,
      myWinRate: row.my_win_rate,
    }));
}

// 이름은 응답의 class 선언으로만 붙인다. 형식이 다르면 null을 돌려 표시하지 않는다.
export function parseCounterStats(result, catalog) {
  let data;
  try {
    data = parseOpggText(resultText(result))?.data;
  } catch {
    return null;
  }
  if (!data) return null;
  const byKey = new Map((catalog?.champions || []).map(champion => [String(champion.key), champion.id]));
  const stats = data.summary?.average_stats;
  const overall =
    stats && Number.isInteger(stats.play) && isRate(stats.win_rate)
      ? {play: stats.play, winRate: stats.win_rate, tier: stats.tier ?? null}
      : null;
  const strong = counterRows(data.strong_counters, byKey),
    weak = counterRows(data.weak_counters, byKey);
  if (!overall && !strong.length && !weak.length) return null;
  return {overall, strong, weak};
}

function counterList(label, rows, enemies) {
  if (!rows.length) return '';
  const items = rows
    .map(row => {
      const facing = row.championId && enemies.includes(row.championId);
      return `<li class="${facing ? 'facing' : ''}">${escapeHtml(row.name)} ${percent(row.myWinRate)} <small>${row.play.toLocaleString()}게임</small>${facing ? ' <b>상대 팀</b>' : ''}</li>`;
    })
    .join('');
  return `<div><small>${label}</small><ul>${items}</ul></div>`;
}

export function renderCounterNote(note, {enemies = []} = {}) {
  if (!note) return '';
  if (note.error) return `<div class="counter-note muted">OP.GG 상성 조회 실패 · ${escapeHtml(note.error)}</div>`;
  const {overall, strong, weak} = note.stats;
  const facing = [...strong, ...weak].filter(row => row.championId && enemies.includes(row.championId));
  const summary = overall
    ? `전체 승률 ${percent(overall.winRate)} · ${overall.play.toLocaleString()}게임${overall.tier ? ` · ${overall.tier}티어` : ''}`
    : '전체 승률 없음';
  const headline = facing.length
    ? `상대 팀의 ${facing.map(row => escapeHtml(row.name)).join('·')}이(가) 상성 목록에 있습니다.`
    : '현재 상대 팀은 상성 상위 목록에 없습니다.';
  return `<div class="counter-note"><p><b>OP.GG 참고</b> ${summary} · ${headline}</p><div class="counter-lists">${counterList('강한 상대 (내 승률)', strong, enemies)}${counterList('약한 상대 (내 승률)', weak, enemies)}</div><small>점수 미반영 · 지역·패치 범위 미확인 · 상위 3명만 제공</small></div>`;
}
