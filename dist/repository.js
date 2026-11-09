import {keyRange} from './key-range.js';
import {uid,now,day,addDays,initialState,reviewState,setMastered,projection,matches,norm,weakReasons,TYPES} from './domain.js';
import {BrowserStorage,STORES,request as req} from './storage.js';
export {STORES} from './storage.js';
const cursorScan=(source,fn,query=null,direction='next')=>new Promise((resolve,reject)=>{const r=source.openCursor(query,direction);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const c=r.result;if(!c)return resolve();try{if(fn(c.value)===false)return resolve();c.continue();}catch(e){reject(e);}};});
// Bounded reads avoid one IndexedDB event per record; only 256 records in flight.
const scan=async(source,fn,query=null,direction='next')=>{
 if(source.scan)return source.scan(fn,query,direction);
 if(direction!=='next')return cursorScan(source,fn,query,direction);
 let range=query;for(;;){const rows=await req(source.getAll(range,256));for(const row of rows)if(fn(row)===false)return;if(rows.length<256)return;
 const last=rows.at(-1),path=source.keyPath,key=Array.isArray(path)?path.map(k=>last[k]):last[path];
 range=query?.upper!==undefined?keyRange.bound(key,query.upper,true,query.upperOpen):keyRange.lowerBound(key,true);}
};
const mini=i=>i?{active:!i.archivedAt,mastered:!i.archivedAt&&i.status==='Mastered',status:i.status}:null;
function plain(item,state){const {examples=[],sources=[],variants=[],...base}=item;return projection({...base,normalized:norm(item.expression),sourceNames:[...new Set(sources.map(s=>s.name))],fileTypes:[...new Set(sources.map(s=>s.fileType))],batchIds:[...new Set([...(item.importBatchIds||[]),...sources.map(s=>s.batchId).filter(Boolean)])],searchText:norm([item.displayText,...item.definitions,...(item.meanings||[]),...(item.related||[]),...(item.tags||[]),...(item.categories||[]),item.notes,...examples.map(e=>e.text),...sources.flatMap(s=>[s.name,s.fileName,s.folder,s.path,s.batchId])].join(' '))},state);}
export class IndexedDBRepository extends BrowserStorage{
 async inspectIntegrity(){this.invalidIds=new Set();const [items,states]=await Promise.all([this.all('items'),this.all('states')]);const map=new Map(states.map(s=>[s.itemId,s]));for(const i of items){const st=map.get(i.id);if(typeof i.displayText!=='string'||!Array.isArray(i.definitions)||!Array.isArray(i.categories)||!Array.isArray(i.tags)||!Array.isArray(i.related)||!st||!['New','Learning','Reviewing','Mastered'].includes(st.status)||!Array.isArray(st.recent)||!st.modeResults||![st.correct,st.incorrect,st.consecutive,st.reviewCount,st.stage].every(Number.isFinite)||!/^\d{4}-\d{2}-\d{2}$/.test(st.nextReview))this.invalidIds.add(i.id);}return this.invalidIds.size;}
 async get(store,id){return this.tx([store],'readonly',s=>req(s[store].get(id)));}
 async put(store,value){return this.tx([store],'readwrite',s=>req(s[store].put(value)));}
 async remove(store,id){return this.tx([store],'readwrite',s=>req(s[store].delete(id)));}
 async all(store){return this.tx([store],'readonly',s=>req(s[store].getAll()));}
 async aggregate(id){if(this.invalidIds?.has(id))throw Error('この教材のデータが不正です。削除していません。Data ManagementからJSONで救出できます。');return this.tx(['items','states','examples','sources','variants'],'readonly',async s=>{const item=await req(s.items.get(id));if(!item)return null;const [state,examples,sources,variants]=await Promise.all([req(s.states.get(id)),...['examples','sources','variants'].map(n=>req(s[n].index('itemId').getAll(id)))]);return {...item,state,examples,sources,variants};});}
 async saveContent(aggregate,{event='updated',importRecord,batchId,expectedRevision}={}){
 const a=structuredClone(aggregate);delete a.state;
 if(!a.displayText?.trim()||!a.definitions?.some(d=>d.trim()))throw Error('ExpressionとEnglish Definitionは必須です');
 const at=now(),id=a.id||uid();a.id=id;
 return this.tx(['items','states','examples','sources','variants','events','importRows'],'readwrite',async s=>{
  if(importRecord){const done=await req(s.importRows.get(importRecord.id));if(done)return done.itemId;}
  const old=await req(s.items.get(id));if(expectedRevision!==undefined&&old&&old.revision!==expectedRevision)throw Error('別のタブで更新されました。再読み込みしてから編集してください。');
  if(old&&expectedRevision===undefined&&aggregate.revision!==undefined&&old.revision!==aggregate.revision)throw Error('別の画面で更新されました。最新の教材を読み直してください。');
  let state=await req(s.states.get(id));if(!state&&old)throw Error('学習状態が不正です。既存データを保護するため更新を中止しました');if(!state){state=initialState(id,at);await req(s.states.put(state));}
  if(old)a.archivedAt=old.archivedAt;
  a.createdAt=old?.createdAt||a.createdAt||at;a.updatedAt=at;if(batchId)a.importBatchIds=[...new Set([...(old?.importBatchIds||[]),batchId])];a.revision=(old?.revision||0)+1;
  for(const name of ['examples','sources','variants']){
   const prev=await req(s[name].index('itemId').getAll(id));for(const p of prev)await req(s[name].delete(p.id));
   for(const r of a[name]||[]){r.id=r.id||uid();r.itemId=id;if(name==='sources'&&batchId&&!r.batchId)r.batchId=batchId;await req(s[name].put(r));}
  }
  const p=plain(a,state);await req(s.items.put(p));await req(s.events.put({id:uid(),itemId:id,type:old?event:'created',at,before:mini(old),after:mini(p)}));
  if(importRecord)await req(s.importRows.put({...importRecord,itemId:id}));return id;
 });
 }
 async mutateState(id,fn,event){return this.tx(['items','states','events'],'readwrite',async s=>{const item=await req(s.items.get(id)),state=await req(s.states.get(id));if(!item||!state)throw Error('教材または学習状態が見つかりません');const next=fn(state);await req(s.states.put(next));const p=projection(item,next);await req(s.items.put(p));await req(s.events.put({id:uid(),itemId:id,type:event,at:now(),before:mini(item),after:mini(p)}));return next;});}
 async markMastered(id,on){return this.mutateState(id,s=>setMastered(s,on),on?'mastered':'unmastered');}
 async markWeak(id,on){return this.mutateState(id,s=>({...s,manualWeak:on,revision:s.revision+1}),'weak');}
 async learn(id){return this.mutateState(id,s=>s.status==='New'?{...s,status:'Learning',revision:s.revision+1}:s,'learn');}
 async archive(id,on){return this.tx(['items','events'],'readwrite',async s=>{const i=await req(s.items.get(id));if(!i)throw Error('教材が見つかりません');const p={...i,archivedAt:on?now():null,updatedAt:now(),revision:i.revision+1};await req(s.items.put(p));await req(s.events.put({id:uid(),itemId:id,type:on?'archived':'unarchived',at:now(),before:mini(i),after:mini(p)}));});}
 async answer(result){return this.tx(['records','states','items','events','daily'],'readwrite',async s=>{
  if(await req(s.records.get(result.id)))return {duplicate:true};
  const item=await req(s.items.get(result.itemId)),state=await req(s.states.get(result.itemId));if(!item||!state||item.archivedAt)throw Error('学習対象が変更されました。Libraryで確認してください。');
  const at=result.at||now(),next=reviewState(state,result,at),p=projection(item,next);
  const d=day(at),daily=await req(s.daily.get(d))||{id:d,correct:0,incorrect:0,production:0,productionSuccess:0};daily[result.correct?'correct':'incorrect']++;if(result.mode==='production'){daily.production++;if(result.correct)daily.productionSuccess++;}await req(s.daily.put(daily));await req(s.records.put({...result,at,policyVersion:1}));await req(s.states.put(next));await req(s.items.put(p));await req(s.events.put({id:uid(),itemId:item.id,type:'reviewed',at,before:mini(item),after:mini(p)}));return {state:next};
 });}
 async list(f={},page=1,size=25,sort='createdAt',direction='prev'){
  if(!['normalized','createdAt','updatedAt','nextReview','score','reviewCount','lastReviewed'].includes(sort))sort='createdAt';
  return this.tx(['items'],'readonly',async s=>{let total=0;const kept=[],cap=page*size;await scan(s.items.index('ordered_'+sort),i=>{if(!this.invalidIds?.has(i.id)&&matches(i,f)){total++;if(direction==='prev'){kept.push(i);if(kept.length>cap)kept.shift();}else if(total>(page-1)*size&&kept.length<size)kept.push(i);}});const items=direction==='prev'?kept.reverse().slice((page-1)*size,page*size):kept;return {items,total,page,pages:Math.max(1,Math.ceil(total/size))};});
 }
 async candidates(item){return this.tx(['items','sources'],'readonly',async s=>{
  const found=await req(s.items.index('normalized').getAll(norm(item.expression))),ids=new Set(found.map(i=>i.id));
  const src=item.sources?.[0];if(src?.externalId&&src.datasetId){const matched=await req(s.sources.index('externalKey').getAll([src.datasetId,src.externalId]));for(const x of matched)ids.add(x.itemId);}
  const out=[];for(const id of ids){const i=await req(s.items.get(id));if(i&&!this.invalidIds?.has(i.id))out.push(i);}return out;
 });}
 async records(id,limit=100){return this.tx(['records'],'readonly',async s=>{const rows=[];await scan(id?s.records.index('itemAt'):s.records.index('at'),r=>{if(typeof r.correct==='boolean'&&Number.isFinite(Date.parse(r.at)))rows.push(r);return rows.length<limit;},id?keyRange.bound([id,''],[id,'\uffff']):null,'prev');return rows;});}
 async importErrors(batchId){return this.tx(['importRows'],'readonly',async s=>(await req(s.importRows.index('batchId').getAll(batchId))).filter(r=>r.errors?.length));}
 async stats(range=30){return this.tx(['items','daily','events'],'readonly',async s=>{
 const today=day(),cutoff=range==='all'?'0000-01-01':addDays(today,1-Number(range));
 const out={active:0,archived:0,mastered:0,due:0,weak:0,new:0,status:{New:0,Learning:0,Reviewing:0,Mastered:0},categories:{},types:{},sources:{},formats:{},difficulties:{},today:{correct:0,incorrect:0},period:{correct:0,incorrect:0,production:0,productionSuccess:0,added:0,archived:0,updated:0,imports:0,exports:0},days:{},options:{categories:new Set(),sources:new Set(),types:new Set(),formats:new Set(),batches:new Set()}};
 const group=(dict,n,i)=>{dict[n]??={total:0,mastered:0};dict[n].total++;if(i.status==='Mastered')dict[n].mastered++;};
 await scan(s.items,i=>{if(this.invalidIds?.has(i.id))return;for(const [key,values] of [['categories',i.categories],['sources',i.sourceNames],['types',[i.type]],['formats',i.fileTypes],['batches',i.batchIds]])for(const v of values||[])if(v)out.options[key].add(v);if(i.archivedAt){out.archived++;return;}out.active++;out.status[i.status]++;if(i.status==='Mastered')out.mastered++;if(i.status==='New')out.new++;if(i.status!=='New'&&i.nextReview<=today)out.due++;if(i.weak)out.weak++;for(const n of i.categories||[])group(out.categories,n,i);for(const n of i.sourceNames||[])group(out.sources,n,i);for(const n of i.fileTypes||[])group(out.formats,n,i);group(out.types,i.type,i);group(out.difficulties,i.difficulty||'未設定',i);});
 await scan(s.daily,r=>{if(r.id===today){out.today.correct=r.correct;out.today.incorrect=r.incorrect;}if(r.id>=cutoff){for(const k of ['correct','incorrect','production','productionSuccess'])out.period[k]+=r[k]||0;out.days[r.id]={correct:r.correct,incorrect:r.incorrect};}});
 const changes={};await scan(s.events,e=>{if(!Number.isFinite(Date.parse(e.at)))return;const d=day(e.at);changes[d]??={active:0,mastered:0};changes[d].active+=(e.after?.active?1:0)-(e.before?.active?1:0);changes[d].mastered+=(e.after?.mastered?1:0)-(e.before?.mastered?1:0);if(d>=cutoff){const k={created:'added',archived:'archived',updated:'updated',imported:'imports',exported:'exports'}[e.type];if(k)out.period[k]++;}});
 let active=0,mastered=0;out.trend=[];for(const d of Object.keys(changes).sort()){active+=changes[d].active;mastered+=changes[d].mastered;if(d>=cutoff)out.trend.push({date:d,active,mastered,percent:active?100*mastered/active:null});}
 out.percent=out.active?100*out.mastered/out.active:null;for(const k of Object.keys(out.options))out.options[k]=[...out.options[k]].sort();return out;
 });}
 async exportData(filter=null,{history=true,references=true}={}){const data=await this.tx(STORES,'readonly',async s=>{const out={};for(const n of STORES)out[n]=await req(s[n].getAll());return out;});
 if(filter){const ids=new Set(data.items.filter(i=>matches(i,filter)).map(i=>i.id));data.items=data.items.filter(i=>ids.has(i.id));for(const n of ['states','examples','sources','variants','records','events','importRows'])data[n]=data[n].filter(r=>!r.itemId||ids.has(r.itemId));}
 if(filter){data.daily=[];const buckets={};for(const r of data.records){const d=day(r.at);buckets[d]??={id:d,correct:0,incorrect:0,production:0,productionSuccess:0};buckets[d][r.correct?'correct':'incorrect']++;if(r.mode==='production'){buckets[d].production++;if(r.correct)buckets[d].productionSuccess++;}}data.daily=Object.values(buckets);}
 if(!history){data.daily=[];data.records=[];data.events=[];data.states=data.items.map(i=>initialState(i.id));data.items=data.items.map(i=>projection(i,initialState(i.id)));data.sessions=[];}
 if(!references){data.sources=data.sources.map(s=>({id:s.id,itemId:s.itemId,type:s.type,name:s.name}));data.importRows=[];data.batches=[];}
 return {app:'PersonalVocabularyTrainer',schemaVersion:1,exportedAt:now(),scope:filter?'selection':'full',data};}
 async restore(backup){validateBackup(backup);await this.tx(STORES,'readwrite',async s=>{for(const n of STORES){await req(s[n].clear());for(const r of backup.data[n])await req(s[n].put(r));}});}
}
export function validateBackup(b){
 if(b?.app!=='PersonalVocabularyTrainer'||b.schemaVersion!==1||!b.data)throw Error('未対応のバックアップ形式・バージョンです');
 for(const n of STORES){if(!Array.isArray(b.data[n]))throw Error('バックアップの '+n+' がありません');const ids=new Set();for(const r of b.data[n]){const id=n==='states'?r.itemId:r.id;if(typeof id!=='string'||!/^[A-Za-z0-9._:-]+$/.test(id)||ids.has(id))throw Error(n+' のIDが不正または重複しています');ids.add(id);}}
 const itemIds=new Set(b.data.items.map(i=>i.id));for(const n of ['states','examples','sources','variants','records'])for(const r of b.data[n])if(!itemIds.has(r.itemId))throw Error(n+' の教材参照が不正です');
 if(b.data.states.length!==itemIds.size)throw Error('学習状態の件数が一致しません');
 for(const i of b.data.items)if(typeof i.expression!=='string'||typeof i.displayText!=='string'||!Array.isArray(i.definitions)||!i.definitions.length||!TYPES.includes(i.type)||!Array.isArray(i.categories)||!Array.isArray(i.tags)||typeof i.createdAt!=='string')throw Error('教材データが不正です');
 for(const s of b.data.states)if(!['New','Learning','Reviewing','Mastered'].includes(s.status)||!Array.isArray(s.recent)||!s.modeResults||![s.correct,s.incorrect,s.consecutive,s.stage,s.reviewCount,s.revision].every(n=>Number.isFinite(n)&&n>=0)||!/^\d{4}-\d{2}-\d{2}$/.test(s.nextReview))throw Error('学習状態の内容が不正です');
 const states=new Map(b.data.states.map(s=>[s.itemId,s]));for(const i of b.data.items){const st=states.get(i.id);if(i.status!==st.status||i.nextReview!==st.nextReview||i.correct!==st.correct||i.incorrect!==st.incorrect||!Number.isFinite(Date.parse(i.createdAt)))throw Error('教材と学習状態が一致しません');}
 for(const e of b.data.examples)if(typeof e.text!=='string')throw Error('例文データが不正です');
 for(const r of b.data.records)if(typeof r.correct!=='boolean'||typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at)))throw Error('回答履歴が不正です');
 for(const d of b.data.daily)if(!/^\d{4}-\d{2}-\d{2}$/.test(d.id)||![d.correct,d.incorrect,d.production,d.productionSuccess].every(n=>Number.isFinite(n)&&n>=0))throw Error('日別集計が不正です');
 return {items:b.data.items.length,records:b.data.records.length,exportedAt:b.exportedAt};
}
