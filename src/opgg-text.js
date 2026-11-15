// OP.GG MCP의 class-style 텍스트 응답을 실행하지 않고 일반 객체로 읽는 제한된 파서.
//
//   class Data: summary,trends
//   class Pick: version,rate,rank,created_at
//
//   LolGetChampionAnalysis(Data(Summary(...),Trends(Pick("16.22",0.11,2,"..."))))
//
// 선언된 필드 이름으로만 위치 인자에 이름을 붙인다. 선언이 없는 class나 값 개수가 다른 호출은
// 추측하지 않고 오류로 처리한다.

export class OpggTextError extends Error {}

export function parseClassDeclarations(text) {
  const schema = {};
  for (const [, name, fields] of String(text).matchAll(/^class\s+(\w+):\s*([\w,\s]*)$/gm))
    schema[name] = fields
      .split(',')
      .map(field => field.trim())
      .filter(Boolean);
  return schema;
}

const LITERALS = {null: null, None: null, true: true, True: true, false: false, False: false};
const MAX_DEPTH = 64;

export function parseOpggText(text, {maxLength = 4_000_000} = {}) {
  const source = String(text ?? '');
  if (source.length > maxLength) throw new OpggTextError('OP.GG 응답이 너무 큽니다');
  const schema = parseClassDeclarations(source);
  const body = source
    .split(/\r?\n/)
    .filter(line => !/^class\s+\w+:/.test(line))
    .join('\n')
    // 2026-11부터 값 뒤에 붙는 출처 링크 한 줄은 데이터가 아니므로 떼어낸다. 다른 꼬리 내용은 계속 거부한다.
    .replace(/\s*OP\.GG page:\s*https:\/\/(?:www\.)?op\.gg\/\S*\s*$/, '')
    .trim();
  let index = 0;
  const fail = message => {
    throw new OpggTextError(`${message} (위치 ${index})`);
  };
  const skip = () => {
    while (index < body.length && /\s/.test(body[index])) index++;
  };
  function string() {
    const quote = body[index];
    let end = index + 1,
      escaped = false;
    for (; end < body.length; end++) {
      if (escaped) escaped = false;
      else if (body[end] === '\\') escaped = true;
      else if (body[end] === quote) break;
    }
    if (end >= body.length) fail('닫히지 않은 문자열');
    const raw = body.slice(index + 1, end);
    index = end + 1;
    if (quote === '"') {
      try {
        return JSON.parse(`"${raw}"`);
      } catch {
        fail('문자열 형식 오류');
      }
    }
    return raw.replace(/\\(.)/g, '$1');
  }
  function list(depth) {
    index++;
    const values = [];
    skip();
    if (body[index] === ']') {
      index++;
      return values;
    }
    for (;;) {
      values.push(value(depth + 1));
      skip();
      if (body[index] === ',') {
        index++;
        continue;
      }
      if (body[index] === ']') {
        index++;
        return values;
      }
      fail('목록 구분자 오류');
    }
  }
  function call(name, depth) {
    index++;
    const args = [];
    skip();
    if (body[index] !== ')') {
      for (;;) {
        args.push(value(depth + 1));
        skip();
        if (body[index] === ',') {
          index++;
          continue;
        }
        if (body[index] === ')') break;
        fail('인자 구분자 오류');
      }
    }
    index++;
    const fields = schema[name];
    if (!fields) fail(`${name} 필드 선언 없음`);
    if (fields.length !== args.length) fail(`${name} 값 ${args.length}개가 선언 ${fields.length}개와 다름`);
    return Object.fromEntries(fields.map((field, position) => [field, args[position]]));
  }
  function value(depth = 0) {
    if (depth > MAX_DEPTH) fail('중첩이 너무 깊습니다');
    skip();
    const char = body[index];
    if (char === '"' || char === "'") return string();
    if (char === '[') return list(depth);
    const number = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(body.slice(index, index + 40));
    if (number) {
      index += number[0].length;
      return Number(number[0]);
    }
    const identifier = /^[A-Za-z_]\w*/.exec(body.slice(index, index + 200));
    if (!identifier) fail('알 수 없는 값');
    index += identifier[0].length;
    skip();
    if (body[index] === '(') return call(identifier[0], depth);
    if (identifier[0] in LITERALS) return LITERALS[identifier[0]];
    fail(`알 수 없는 식별자 ${identifier[0]}`);
  }
  const root = value();
  skip();
  if (index !== body.length) fail('응답 끝에 해석하지 않은 내용이 있습니다');
  return root;
}
