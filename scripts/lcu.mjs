// 롤 클라이언트(LCU) 연동: 로컬 클라이언트의 밴픽 세션을 읽어 챔피언 ID·포지션만 앱 상태 형식으로 바꾼다.
// 소환사 이름·PUUID 등 개인 식별 정보는 브라우저로 넘기지 않는다. 읽기 전용이며 픽·밴을 대신 하지 않는다.
import https from 'node:https';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {PROFILES, ROLES} from '../src/ontology.js';

export const LOCKFILE_PATHS = [
  '/Applications/League of Legends.app/Contents/LoL/lockfile',
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
];
const POSITIONS = {top: 'TOP', jungle: 'JUNGLE', middle: 'MID', bottom: 'ADC', utility: 'SUPPORT'};

export class LcuUnavailable extends Error {}

// lockfile: "LeagueClient:<pid>:<port>:<password>:https"
export function parseLockfile(text) {
  const [, , port, password, protocol] = String(text).trim().split(':');
  if (!/^\d+$/.test(port || '') || !password || protocol !== 'https') throw new LcuUnavailable('lockfile 형식 오류');
  return {port: Number(port), password};
}

// 실행 중인 LeagueClientUx 인자에서 포트·토큰을 찾는다 (설치 경로가 다를 때).
export function parseProcessArgs(text) {
  const port = /--app-port=(\d+)/.exec(text)?.[1],
    password = /--remoting-auth-token=([\w-]+)/.exec(text)?.[1];
  return port && password ? {port: Number(port), password} : null;
}

function run(command, args) {
  return new Promise(done =>
    execFile(command, args, {timeout: 3000, maxBuffer: 4 * 1024 * 1024}, (error, stdout) => done(error ? '' : stdout)),
  );
}

export async function findCredentials({env = process.env, paths = LOCKFILE_PATHS, platform = process.platform} = {}) {
  for (const path of [env.LOL_LOCKFILE, ...paths].filter(Boolean)) {
    try {
      return parseLockfile(await readFile(path, 'utf8'));
    } catch {}
  }
  const output =
    platform === 'win32'
      ? await run('powershell.exe', [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process -Filter "name=\'LeagueClientUx.exe\'" | Select-Object -ExpandProperty CommandLine',
        ])
      : await run('ps', ['-A', '-o', 'args']);
  const found = parseProcessArgs(output.split('\n').find(line => line.includes('LeagueClientUx')) || '');
  if (!found) throw new LcuUnavailable('롤 클라이언트가 실행 중이 아닙니다');
  return found;
}

// 클라이언트는 127.0.0.1에서 Riot 자체 서명 인증서로 응답한다. 루프백 주소에만 연결하므로 인증서 검증을 끈다.
function lcuGet({port, password}, path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: '127.0.0.1',
        port,
        path,
        rejectUnauthorized: false,
        timeout: 3000,
        headers: {
          Authorization: `Basic ${Buffer.from(`riot:${password}`).toString('base64')}`,
          Accept: 'application/json',
        },
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (body += chunk));
        res.on('end', () => resolve({status: res.statusCode, body}));
      },
    );
    req.on('timeout', () => req.destroy(new LcuUnavailable('롤 클라이언트 응답 시간 초과')));
    req.on('error', error => reject(error instanceof LcuUnavailable ? error : new LcuUnavailable(error.message)));
  });
}

// 포지션이 숨겨진 상대는 주석의 주 역할로 5칸에 배치한다 (최대 일치 순열). 추정임을 함께 돌려준다.
export function placeByProfile(ids, fixed = Array(5).fill(null)) {
  const slots = [...fixed],
    rest = ids.filter(id => id && !slots.includes(id));
  const free = ROLES.map((_, index) => index).filter(index => !slots[index]);
  let best = null;
  const score = (id, index) => {
    const roles = PROFILES[id]?.roles || [];
    const rank = roles.indexOf(ROLES[index]);
    return rank < 0 ? 0 : 2 - Math.min(rank, 1);
  };
  const permute = (left, used, total, picks) => {
    if (!left.length) {
      if (!best || total > best.total) best = {total, picks: [...picks]};
      return;
    }
    const [id, ...others] = left;
    for (const index of free)
      if (!used.has(index)) {
        used.add(index);
        picks.push([id, index]);
        permute(others, used, total + score(id, index), picks);
        picks.pop();
        used.delete(index);
      }
  };
  permute(rest.slice(0, free.length), new Set(), 0, []);
  for (const [id, index] of best?.picks || []) slots[index] = id;
  return slots;
}

export function normalizeChampSelect(session, champions) {
  const byKey = new Map(champions.map(champion => [String(champion.key), champion.id]));
  const idOf = key => (key > 0 ? byKey.get(String(key)) || null : null);
  const me = (session.myTeam || []).find(member => member.cellId === session.localPlayerCellId);
  const role = POSITIONS[me?.assignedPosition] || null;
  const allies = Array(5).fill(null),
    unplacedAllies = [];
  for (const member of session.myTeam || []) {
    const id = idOf(member.championId),
      position = POSITIONS[member.assignedPosition];
    if (!id) continue;
    if (position && !allies[ROLES.indexOf(position)]) allies[ROLES.indexOf(position)] = id;
    else unplacedAllies.push(id);
  }
  const enemyFixed = Array(5).fill(null),
    unplacedEnemies = [];
  for (const member of session.theirTeam || []) {
    const id = idOf(member.championId),
      position = POSITIONS[member.assignedPosition];
    if (!id) continue;
    if (position && !enemyFixed[ROLES.indexOf(position)]) enemyFixed[ROLES.indexOf(position)] = id;
    else unplacedEnemies.push(id);
  }
  const actions = (session.actions || []).flat();
  const banned = side =>
    actions
      .filter(action => action.type === 'ban' && action.completed && action.isAllyAction === side)
      .map(action => idOf(action.championId))
      .filter(Boolean);
  const myBans = banned(true).length ? banned(true) : (session.bans?.myTeamBans || []).map(idOf).filter(Boolean);
  const theirBans = banned(false).length
    ? banned(false)
    : (session.bans?.theirTeamBans || []).map(idOf).filter(Boolean);
  const pad = (list, n) => [...list.slice(0, n), ...Array(Math.max(0, n - list.length)).fill(null)];
  const myAction = actions.find(action => action.actorCellId === session.localPlayerCellId && action.isInProgress);
  return {
    role,
    allies: placeByProfile(unplacedAllies, allies),
    enemies: placeByProfile(unplacedEnemies, enemyFixed),
    bans: [...pad(myBans, 5), ...pad(theirBans, 5)],
    enemyPositionsEstimated: unplacedEnemies.length > 0,
    myTurn: myAction ? myAction.type : null,
    phase: session.timer?.phase || null,
    hover: idOf(me?.championPickIntent),
  };
}

export class LcuClient {
  constructor({find = findCredentials, get = lcuGet} = {}) {
    this.find = find;
    this.get = get;
    this.credentials = null;
  }
  async champSelect(champions) {
    for (let attempt = 0; attempt < 2; attempt++) {
      this.credentials ||= await this.find();
      let response;
      try {
        response = await this.get(this.credentials, '/lol-champ-select/v1/session');
      } catch (error) {
        // 클라이언트를 재시작하면 포트·토큰이 바뀐다. 한 번 다시 찾는다.
        this.credentials = null;
        if (attempt) throw error;
        continue;
      }
      if (response.status === 401) {
        this.credentials = null;
        continue;
      }
      if (response.status === 404) return {status: 'idle'};
      if (response.status !== 200) throw new LcuUnavailable(`롤 클라이언트 HTTP ${response.status}`);
      return {status: 'champ-select', session: normalizeChampSelect(JSON.parse(response.body), champions)};
    }
    throw new LcuUnavailable('롤 클라이언트 인증에 실패했습니다');
  }
}
