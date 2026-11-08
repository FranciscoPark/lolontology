// Minimal read-only Streamable HTTP client. Tool schemas are discovered, never invented.
export const ENDPOINT = 'https://mcp-api.op.gg/mcp';
export const ALLOWED_TOOLS = ['lol_list_lane_meta_champions', 'lol_get_champion_analysis'];
export function decodeRpc(text, id) {
  const candidates = [];
  try {
    candidates.push(JSON.parse(text));
  } catch {}
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trimStart())
      .join('\n');
    try {
      if (data) candidates.push(JSON.parse(data));
    } catch {}
  }
  const message = candidates.find(m => m.id === id);
  if (!message) throw Error('OP.GG 응답을 해석하지 못했습니다');
  if (message.error) throw Error(message.error.message || 'MCP 오류');
  return message.result;
}
export function validateArguments(schema, args) {
  if (!args || Array.isArray(args) || typeof args !== 'object') throw Error('잘못된 조회 조건');
  for (const key of schema.required || []) if (!(key in args)) throw Error(`필수 조회 조건 누락: ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const field = schema.properties?.[key];
    if (!field) throw Error(`지원하지 않는 조회 조건: ${key}`);
    if (field.enum && !field.enum.includes(value)) throw Error(`지원하지 않는 값: ${key}`);
    const type = field.type;
    if (type === 'string' && (typeof value !== 'string' || value.length > 500)) throw Error(`문자열 조건 오류: ${key}`);
    if (
      (type === 'number' || type === 'integer') &&
      (!Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value)))
    )
      throw Error(`숫자 조건 오류: ${key}`);
    const allowedItems = [
      ...(field.items?.enum || []),
      ...(field.items?.oneOf || []),
      ...(field.items?.anyOf || []),
    ].flatMap(option => (typeof option === 'string' ? [option] : option.const ? [option.const] : option.enum || []));
    if (
      type === 'array' &&
      (!Array.isArray(value) ||
        value.length > 30 ||
        value.some(v => typeof v !== 'string' || v.length > 200 || (allowedItems.length && !allowedItems.includes(v))))
    )
      throw Error(`배열 조건 오류: ${key}`);
    if (type === 'object') throw Error('중첩 조건은 아직 지원하지 않습니다');
  }
}
export class OpggClient {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
    this.session = null;
    this.counter = 0;
    this.tools = null;
    this.ready = null;
    this.protocol = '2025-03-26';
  }
  async rpc(method, params, notification = false) {
    const id = ++this.counter,
      headers = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'};
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    if (method !== 'initialize') headers['MCP-Protocol-Version'] = this.protocol;
    const response = await this.fetcher(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({jsonrpc: '2.0', ...(notification ? {} : {id}), method, params}),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw Error('OP.GG 인증 또는 접근 권한이 필요합니다');
      if (response.status === 404) {
        this.ready = null;
        this.tools = null;
        this.session = null;
      }
      throw Error(`OP.GG HTTP ${response.status}`);
    }
    const session = response.headers.get('mcp-session-id');
    if (session) this.session = session;
    if (notification) {
      await response.body?.cancel();
      return;
    }
    // Consume SSE until the matching JSON-RPC result, without waiting for stream closure.
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const {value, done} = await reader.read();
          if (value) buffer += decoder.decode(value, {stream: true});
          if (buffer.length > 4_000_000) throw Error('OP.GG 응답 크기 초과');
          try {
            return decodeRpc(buffer, id);
          } catch (e) {
            if (!e.message.includes('해석하지')) throw e;
          }
          if (done) throw Error('OP.GG 결과 없이 스트림이 종료되었습니다');
        }
      } finally {
        await reader.cancel();
      }
    }
    const text = await response.text();
    if (text.length > 4_000_000) throw Error('OP.GG 응답 크기 초과');
    return decodeRpc(text, id);
  }
  async initialize() {
    if (!this.ready)
      this.ready = (async () => {
        const result = await this.rpc('initialize', {
          protocolVersion: this.protocol,
          capabilities: {},
          clientInfo: {name: 'rift-draft', version: '0.1.0'},
        });
        this.protocol = result.protocolVersion || this.protocol;
        this.serverInfo =
          result.serverInfo && typeof result.serverInfo === 'object'
            ? {name: String(result.serverInfo.name || ''), version: String(result.serverInfo.version || '')}
            : null;
        await this.rpc('notifications/initialized', {}, true);
      })().catch(e => {
        this.ready = null;
        throw e;
      });
    return this.ready;
  }
  async list() {
    await this.initialize();
    if (!this.tools) {
      const all = [];
      let cursor;
      for (let page = 0; page < 20; page++) {
        const r = await this.rpc('tools/list', cursor ? {cursor} : {});
        all.push(...(r.tools || []));
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      this.tools = all.filter(t => ALLOWED_TOOLS.includes(t.name));
    }
    return this.tools;
  }
  async call(name, args) {
    if (!ALLOWED_TOOLS.includes(name)) throw Error('허용하지 않는 도구');
    const tool = (await this.list()).find(t => t.name === name);
    if (!tool) throw Error('현재 서버에서 제공하지 않는 도구');
    validateArguments(tool.inputSchema, args);
    const result = await this.rpc('tools/call', {name, arguments: args});
    if (result.isError)
      throw Error(
        (result.content || [])
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n')
          .slice(0, 500) || 'OP.GG 조회 실패',
      );
    return {
      source: ENDPOINT,
      provider: {...(this.serverInfo || {name: '', version: ''}), protocol: this.protocol},
      tool: name,
      arguments: args,
      fetchedAt: new Date().toISOString(),
      result,
    };
  }
}
