import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DataDragonStore} from '../scripts/data-dragon-store.mjs';

const response=value=>({ok:true,status:200,text:async()=>JSON.stringify(value)});
function fakeFetch(versions,calls){
 return async url=>{
  calls.push(String(url));
  if(String(url).endsWith('/realms/kr.json'))return response({n:{champion:versions.champion,item:versions.item}});
  const match=String(url).match(/\/cdn\/([^/]+)\/data\/ko_KR\/(champion|item)(?:\/([^/.]+))?\.json$/);
  if(!match)throw Error(`Unexpected URL ${url}`);
  const [,version,type,id]=match;
  if(type==='champion'&&!id)return response({version,data:{Ahri:{id:'Ahri',key:'103',name:'아리',image:{full:'Ahri.png'}}}});
  if(type==='item')return response({version,data:{'1055':{name:'도란의 검',gold:{total:450},image:{full:'1055.png'}}}});
  if(type==='champion'&&id==='Ahri')return response({version,data:{Ahri:{passive:{name:'정기 흡수',description:'패시브 설명',image:{full:'Ahri_P.png'}},spells:[{name:'현혹의 구슬',description:'Q 스킬',image:{full:'AhriQ.png'}},{name:'여우불',description:'W 스킬'},{name:'매혹',description:'E 스킬'},{name:'혼령 질주',description:'R 스킬'}]}}});
  throw Error(`Unexpected data request ${url}`);
 };
}

test('backend stores separate champion and item versions and caches requested abilities',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'rift-draft-cache-')),file=join(directory,'riot-data.json'),calls=[],versions={champion:'16.20.1',item:'16.20.2'};
 try{
  const store=new DataDragonStore({file,fetchImpl:fakeFetch(versions,calls),minChampions:1,minItems:1});
  await store.sync();
  assert.equal(store.snapshot.championVersion,'16.20.1');assert.equal(store.snapshot.itemVersion,'16.20.2');
  const first=await store.getAbilities('Ahri','16.20.1');assert.equal(first.abilities.length,5);assert.equal(first.cached,false);
  const count=calls.length,second=await store.getAbilities('Ahri','16.20.1');assert.equal(second.cached,true);assert.equal(calls.length,count);
  const restored=new DataDragonStore({file,fetchImpl:async()=>{throw Error('must use cache');},minChampions:1,minItems:1});await restored.load();
  assert.equal(restored.snapshot.itemVersion,'16.20.2');assert.equal(restored.snapshot.abilities.Ahri[0].slot,'PASSIVE');
  versions.item='16.20.3';await store.sync();assert.equal(store.snapshot.itemVersion,'16.20.3');assert.equal(store.snapshot.abilities.Ahri[0].slot,'PASSIVE');
  const before=await readFile(file,'utf8');versions.champion='16.21.1';versions.item='16.21.1';
  await store.sync();assert.equal(store.snapshot.championVersion,'16.21.1');assert.deepEqual(store.snapshot.abilities,{});
  assert.notEqual(await readFile(file,'utf8'),before);
  await assert.rejects(()=>store.getAbilities('Ahri','16.20.1'),/스킬 패치가 변경/);
 } finally {await rm(directory,{recursive:true,force:true});}
});

test('backend keeps its last valid snapshot when an automatic patch download fails',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'rift-draft-cache-')),file=join(directory,'riot-data.json'),calls=[],versions={champion:'16.20.1',item:'16.20.2'};
 try{
  const store=new DataDragonStore({file,fetchImpl:fakeFetch(versions,calls),minChampions:1,minItems:1});await store.sync();
  versions.champion='16.21.1';
  store.fetchImpl=async url=>String(url).endsWith('/realms/kr.json')?response({n:{champion:versions.champion,item:versions.item}}):({ok:false,status:503,text:async()=>''});
  await assert.rejects(()=>store.sync(),/HTTP 503/);
  assert.equal(store.snapshot.championVersion,'16.20.1');
 } finally {await rm(directory,{recursive:true,force:true});}
});
