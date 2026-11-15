// 상단 데이터 상태 표시줄: 공식/예제 데이터, 버전, 저장·확인 시각, 새로고침 버튼 상태.
import {$, app} from './app-state.js';
import {isStaticDemo} from './catalog.js';

const formatTime = (value, fallback) => (value ? new Date(value).toLocaleString('ko-KR') : fallback);

function dataStatusText({catalog, loading, dataError}) {
  if (loading) return '최신 공식 데이터 확인 중…';
  if (catalog.mode === 'official')
    return `공식 정적 데이터 · 챔피언 ${catalog.championVersion || catalog.version} · 아이템 ${catalog.itemVersion || catalog.version}`;
  return dataError ? '오프라인 예제 데이터 · 공식 데이터 확인 실패' : '예제 데이터 · 저장된 최신 버전 확인 중';
}

function dataDetailText({catalog, dataError}) {
  if (catalog.mode === 'official') {
    const connection = dataError
      ? `연결 실패: ${dataError}`
      : isStaticDemo()
        ? '웹 데모 · 배포 시점 스냅샷'
        : '자동 확인 사용';
    return `${catalog.champions.length}명 · 데이터 저장 ${formatTime(catalog.loadedAt, 'unknown')} · 백엔드 패치 확인 ${formatTime(catalog.checkedAt, '확인 기록 없음')} · ${connection} · 추천 규칙은 별도 검토 전`;
  }
  return dataError
    ? `${dataError} · 새로고침 버튼으로 다시 시도할 수 있습니다.`
    : '저장된 데이터가 없으면 백엔드가 최초 버전을 준비합니다.';
}

export function renderData() {
  const {catalog, loading} = app,
    official = catalog.mode === 'official';
  $('#data-status').textContent = dataStatusText(app);
  $('#data-detail').textContent = dataDetailText(app);
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
