import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {normalizeCatalog, normalizeChampionAbilities} from '../src/catalog.js';

const VERSION=/^\d+\.\d+\.\d+$/;

export class DataDragonStore {
 constructor({file,fetchImpl=fetch,clock=()=>new Date(),minChampions=100,minItems=100}={}) {
  if(!file)throw Error('Data Dragon cache 경로가 필요합니다');
  this.file=file;this.fetchImpl=fetchImpl;this.clock=clock;this.minChampions=minChampions;this.minItems=minItems;this.snapshot=null;this.syncPromise=null;this.savePromise=Promise.resolve();this.abilityCommitPromise=Promise.resolve();this.abilityPromises=new Map();
 }
 async load(){
  try{
   const saved=JSON.parse(await readFile(this.file,'utf8'));
   const championVersion=saved.championVersion||saved.version,itemVersion=saved.itemVersion||saved.version;
   if(saved.schemaVersion===1&&saved.mode==='official'&&VERSION.test(championVersion||'')&&VERSION.test(itemVersion||'')&&Array.isArray(saved.champions)&&saved.champions.length>=this.minChampions&&saved.items&&typeof saved.items==='object'&&Object.keys(saved.items).length>=this.minItems){
    this.snapshot={...saved,version:championVersion,championVersion,itemVersion,abilitiesVersion:saved.abilitiesVersion||championVersion,abilities:saved.abilities||{}};
   }
  }catch(error){if(error.code!=='ENOENT')console.warn(`Data Dragon 캐시를 읽지 못했습니다: ${error.message}`);}
  return this.snapshot;
 }
 async sync({force=false}={}){
  if(this.syncPromise)return this.syncPromise;
  this.syncPromise=this.#sync({force}).finally(()=>{this.syncPromise=null;});
  return this.syncPromise;
 }
 async #sync({force}){
  const started=Date.now(),realm=await this.#json('https://ddragon.leagueoflegends.com/realms/kr.json');
  const championVersion=realm?.n?.champion,itemVersion=realm?.n?.item;
  if(!VERSION.test(championVersion||'')||!VERSION.test(itemVersion||''))throw Error('KR realm에서 올바른 챔피언/아이템 버전을 찾지 못했습니다');
  const current=this.snapshot,championChanged=force||current?.championVersion!==championVersion,itemChanged=force||current?.itemVersion!==itemVersion;
  let next=current;
  if(championChanged||itemChanged||!current){
   const championUrl=`https://ddragon.leagueoflegends.com/cdn/${championVersion}/data/ko_KR/champion.json`;
   const itemUrl=`https://ddragon.leagueoflegends.com/cdn/${itemVersion}/data/ko_KR/item.json`;
   const [champions,items]=await Promise.all([championChanged||!current?this.#json(championUrl):null,itemChanged||!current?this.#json(itemUrl):null]);
   if(champions&&items)next=normalizeCatalog(championVersion,champions,itemVersion,items);
   else if(champions){
    const oldItems={version:itemVersion,data:current.items};
    next=normalizeCatalog(championVersion,champions,itemVersion,oldItems);
   } else if(items){
    const oldChampions={version:championVersion,data:Object.fromEntries(current.champions.map(champion=>[champion.id,{...champion,image:champion.image?{full:champion.image}:undefined}]))};
    next=normalizeCatalog(championVersion,oldChampions,itemVersion,items);
   }
   if(next.champions.length<this.minChampions||Object.keys(next.items).length<this.minItems)throw Error(`불완전한 Data Dragon 카탈로그입니다 (${next.champions.length} champions, ${Object.keys(next.items).length} items)`);
   next={...next,abilities:championVersion===current?.championVersion?(current.abilities||{}):{},catalogUpdatedAt:this.clock().toISOString()};
  }
  if(!next)throw Error('정상 Data Dragon 카탈로그를 만들 수 없습니다');
  next={...next,schemaVersion:1,mode:'official',version:championVersion,championVersion,itemVersion,abilitiesVersion:championVersion,checkedAt:this.clock().toISOString()};
  if(championVersion!==current?.championVersion)next.abilities={};
  else next.abilities={...(next.abilities||{}),...(this.snapshot?.abilities||{})};
  await this.#save(next);
  this.snapshot=next;
  console.info(`Data Dragon 확인 완료: champion ${championVersion}, item ${itemVersion} · ${next.champions.length} champions · ${Object.keys(next.items).length} items · ${Date.now()-started}ms`);
  return this.snapshot;
 }
 async getAbilities(championId,requestedVersion){
  const snapshot=this.snapshot;
  if(!snapshot)throw Error('Data Dragon 카탈로그가 아직 준비되지 않았습니다');
  if(requestedVersion!==snapshot.abilitiesVersion)throw Error(`스킬 패치가 변경되었습니다 · 현재 ${snapshot.abilitiesVersion}`);
  if(!snapshot.champions.some(champion=>champion.id===championId))throw Error('카탈로그에 없는 챔피언입니다');
  const saved=snapshot.abilities?.[championId];if(Array.isArray(saved)&&saved.length)return {version:snapshot.abilitiesVersion,abilities:saved,cached:true};
  if(this.abilityPromises.has(championId))return this.abilityPromises.get(championId);
  const promise=(async()=>{
   const detail=await this.#json(`https://ddragon.leagueoflegends.com/cdn/${snapshot.abilitiesVersion}/data/ko_KR/champion/${encodeURIComponent(championId)}.json`);
   const abilities=normalizeChampionAbilities(snapshot.abilitiesVersion,championId,detail);
   await this.#cacheAbility(championId,requestedVersion,abilities);
   console.info(`Data Dragon 스킬 캐시 저장: ${championId} · ${requestedVersion} · ${abilities.length} abilities`);
   return {version:requestedVersion,abilities,cached:false};
  })().finally(()=>this.abilityPromises.delete(championId));
  this.abilityPromises.set(championId,promise);return promise;
 }
 async #cacheAbility(championId,version,abilities){
  const base=this.abilityCommitPromise.catch(()=>{});
  const commit=base.then(async()=>{
   const latest=this.snapshot;if(latest.abilitiesVersion!==version)throw Error('스킬 패치가 갱신되어 요청을 취소했습니다');
   const updated={...latest,abilities:{...(latest.abilities||{}),[championId]:abilities},abilitiesUpdatedAt:this.clock().toISOString()};
   await this.#save(updated);this.snapshot=updated;
  });
  this.abilityCommitPromise=commit;await commit;
 }
 async #json(url){
  const response=await this.fetchImpl(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Data Dragon HTTP ${response.status}`);
  const body=await response.text();if(body.length>20_000_000)throw Error('Data Dragon 응답 크기 초과');
  try{return JSON.parse(body);}catch{throw Error('Data Dragon JSON 형식 오류');}
 }
 async #save(snapshot=this.snapshot){
  const serialized=JSON.stringify(snapshot),base=this.savePromise.catch(()=>{});
  this.savePromise=base.then(async()=>{
   await mkdir(dirname(this.file),{recursive:true});
   const temporary=`${this.file}.tmp`;
   await writeFile(temporary,serialized,'utf8');
   await rename(temporary,this.file);
  });
  await this.savePromise;
 }
}
