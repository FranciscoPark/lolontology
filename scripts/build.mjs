import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const root = new URL('../', import.meta.url);
const ENTRY = 'app.js';
// `import {a, b} from './x.js';` — 여러 줄로 나뉜 import도 한 번에 매칭한다.
const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.-]+\.js)['"];?[ \t]*\r?\n?/gm;

export function parseImports(source) {
  if (/^import\s+(?!\{)/m.test(source)) throw Error('번들러는 `import {..} from "./x.js"` 형식만 지원합니다');
  return [...source.matchAll(IMPORT)].map(([, names, file]) => {
    const specifiers = names.split(',').map(name => name.trim()).filter(Boolean);
    if (specifiers.some(name => /\s/.test(name))) throw Error(`import 별칭은 지원하지 않습니다: ${file}`);
    return {file, specifiers};
  });
}

// app.js에서 시작해 실제로 도달하는 src 모듈만, 의존성이 먼저 오도록 정렬한다.
export async function resolveModules(entry = ENTRY) {
  const order = [], sources = new Map(), visiting = new Set();
  async function visit(file) {
    if (sources.has(file)) return;
    if (visiting.has(file)) throw Error(`순환 import: ${file}`);
    visiting.add(file);
    const source = await readFile(new URL('src/' + file, root), 'utf8');
    for (const {file: dependency} of parseImports(source)) await visit(dependency);
    visiting.delete(file);
    sources.set(file, source);
    order.push(file);
  }
  await visit(entry);
  return order.map(file => ({file, source: sources.get(file)}));
}

export function stripModuleSyntax(source) {
  return source.replace(IMPORT, '').replace(/^export\s+/gm, '');
}

export async function buildHtml() {
  const modules = await resolveModules();
  const script = modules.map(({file, source}) => `// ---- src/${file}\n${stripModuleSyntax(source)}`).join('\n');
  const css = await readFile(new URL('src/style.css', root), 'utf8');
  const template = await readFile(new URL('index.html', root), 'utf8');
  const stylesheet = '<link rel="stylesheet" href="/src/style.css">';
  const moduleTag = '<script type="module" src="/src/app.js"></script>';
  if (!template.includes(stylesheet) || !template.includes(moduleTag)) throw Error('index.html의 stylesheet/script 태그를 찾지 못했습니다');
  const html = template
    .replace(stylesheet, () => `<style>${css}</style>`)
    .replace(moduleTag, () => `<script>\n(()=>{\n'use strict';\n${script}\n})();\n</script>`);
  return {html, modules: modules.map(module => module.file), script};
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {html, modules} = await buildHtml();
  // 1st-party 모듈만 번들한다. 결과물은 서버 없이 여는 수동 추천 데모다.
  await mkdir(new URL('dist/', root), {recursive: true});
  await writeFile(new URL('dist/index.html', root), html);
  console.log(`Built dist/index.html (${modules.join(', ')}) — standalone manual draft; official Data Dragon and MCP require npm start.`);
}
