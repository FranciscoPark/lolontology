// 롤 클라이언트 밴픽 세션을 앱 상태에 반영한다. 챔피언 풀·개인 설정·필터는 건드리지 않는다.
import {normalizeState} from './engine.js';

export function clientSignature(session) {
  return JSON.stringify([session.role, session.allies, session.enemies, session.bans]);
}

export function applyClientSession(state, session, catalog) {
  return normalizeState(
    {
      ...state,
      role: session.role || state.role,
      allies: session.allies,
      enemies: session.enemies,
      bans: session.bans,
    },
    catalog,
  );
}
