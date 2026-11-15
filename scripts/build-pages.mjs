// GitHub Pages용 웹 데모: 단일 HTML + 빌드 시점 Data Dragon 카탈로그(game-data.json)를 site/에 만든다.
// OP.GG 조회는 서버 프록시가 필요하므로 데모에서는 꺼진다.
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildHtml} from './build.mjs';
import {DataDragonStore} from './data-dragon-store.mjs';

const out = new URL('../site/', import.meta.url);
const STATIC_META = '<meta name="rift-deploy" content="static">';

const {html} = await buildHtml();
if (!html.includes('</head>')) throw Error('index.html에 </head>가 없습니다');
const page = html.replace('</head>', () => `${STATIC_META}\n</head>`);

const scratch = await mkdtemp(join(tmpdir(), 'rift-pages-'));
try {
  const store = new DataDragonStore({file: join(scratch, 'riot-data.json')});
  const snapshot = await store.sync({force: true});
  // 스킬은 브라우저가 Data Dragon에서 직접 받으므로 비워 둔다.
  const gameData = {...snapshot, abilities: {}};
  await mkdir(out, {recursive: true});
  await writeFile(new URL('index.html', out), page);
  await writeFile(new URL('game-data.json', out), JSON.stringify(gameData));
  await writeFile(new URL('.nojekyll', out), '');
  console.log(
    `Built site/ · 챔피언 ${gameData.championVersion} (${gameData.champions.length}명) · 아이템 ${gameData.itemVersion}`,
  );
} finally {
  await rm(scratch, {recursive: true, force: true});
}
