import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const modules=['ontology.js','catalog.js','engine.js','opgg-ui.js','app.js'];
const parts=await Promise.all(modules.map(async name=>{
 const source=await readFile(new URL('src/'+name,root),'utf8');
 return source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
}));
const css=await readFile(new URL('src/style.css',root),'utf8');
let html=await readFile(new URL('index.html',root),'utf8');
html=html.replace('<link rel="stylesheet" href="/src/style.css">',()=>`<style>${css}</style>`).replace('<script type="module" src="/src/app.js"></script>',()=>`<script>\n(()=>{\n${parts.join('\n')}\n})();\n</script>`);
// Only bundle first-party modules. This artifact makes the manual demo file-openable.
await mkdir(new URL('dist/',root),{recursive:true});
await writeFile(new URL('dist/index.html',root),html);
console.log('Built dist/index.html — standalone manual draft; official Data Dragon and MCP require npm start.');
