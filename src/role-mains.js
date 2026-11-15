// 역할별 주력 챔피언: 별도 저장소 없이 챔피언 풀과 개인 설정(플레이 역할·선호도)으로 표현한다.
// 주력 = 풀에 있고 플레이 역할에 그 역할이 명시된 챔피언.
import {PROFILES} from './ontology.js';

const FAVORITE = 2; // 선호도 '최선호'

export function roleMains(state, role) {
  return state.pool.filter(id => (state.personal[id]?.roles || []).includes(role));
}

// 등록: 풀에 넣고 역할을 추가하며 선호도를 최선호로 올린다.
// 해제: 그 역할만 빼고, 남은 역할이 없으면 풀에서도 뺀다.
export function toggleRoleMain(state, id, role) {
  const inPool = state.pool.includes(id),
    current = state.personal[id] || {preference: 0, mastery: null, roles: []},
    roles = current.roles || [];
  if (inPool && roles.includes(role)) {
    const rest = roles.filter(r => r !== role);
    if (!rest.length) {
      const personal = {...state.personal};
      delete personal[id];
      return {...state, pool: state.pool.filter(x => x !== id), personal};
    }
    return {...state, personal: {...state.personal, [id]: {...current, roles: rest}}};
  }
  // 역할 미지정으로 풀에 있던 챔피언은 프로필 역할을 유지한 채 새 역할을 더한다.
  const base = roles.length || !inPool ? roles : PROFILES[id]?.roles || [];
  const next = {
    ...current,
    roles: [...new Set([...base, role])],
    preference: Math.max(current.preference || 0, FAVORITE),
  };
  return {...state, pool: inPool ? state.pool : [...state.pool, id], personal: {...state.personal, [id]: next}};
}
