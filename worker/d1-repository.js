import {mergeContent} from '../dist/import-core.js';
import {IndexedDBRepository,STORES,validateBackup} from '../dist/repository.js';
import {uid,now,norm} from '../dist/domain.js';
const DATA_SCHEMA_VERSION=1;
const conflict=()=>Object.assign(Error('保存中に別の画面で更新されました。再試行してください。'),{status:409});
const storeCheck=n=>{if(!STORES.includes(n))throw Object.assign(Error('Unknown store'),{status:400});};
const idOf=(n,v)=>n==='states'?v.itemId:v.id;
const indexPaths={itemId:['itemId'],normalized:['normalized'],createdAt:['createdAt'],updatedAt:['updatedAt'],nextReview:['nextReview'],score:['score'],reviewCount:['reviewCount'],lastReviewed:['lastReviewed'],at:['at'],sessionId:['sessionId'],itemAt:['itemId','at'],externalKey:['datasetId','externalId'],batchId:['batchId']};
function sqlPath(k){if(!/^[A-Za-z][A-Za-z0-9]*$/.test(k))throw Error('Invalid index');return k==='id'?'id':`json_extract(body,'$.${k}')`;}
class D1View{
 constructor(tx,store,paths=null){this.tx=tx;this.store=store;this.paths=paths||[store==='states'?'itemId':'id'];this.keyPath=this.paths.length===1?this.paths[0]:this.paths;}
 index(n){const paths=n.startsWith('ordered_')?[n.slice(8),'id']:indexPaths[n];if(!paths)throw Error('Unknown index');return new D1View(this.tx,this.store,paths);}
 async get(id){const cached=this.tx.changes.get(this.store+'\0'+id);if(cached)return cached.deleted?undefined:structuredClone(cached.value);if(this.tx.cleared.has(this.store))return undefined;const r=await this.tx.db.prepare('SELECT body FROM data_records WHERE dataset=? AND store=? AND id=?').bind(this.tx.generation,this.store,id).first();return r?JSON.parse(r.body):undefined;}
 put(value){if(this.store==='states')value={...value,createdAt:value.createdAt||now(),updatedAt:now()};const id=idOf(this.store,value);if(typeof id!=='string'||!id.length)throw Error('Invalid record ID');this.tx.changes.set(this.store+'\0'+id,{store:this.store,id,value:structuredClone(value)});return Promise.resolve(id);}
 delete(id){this.tx.changes.set(this.store+'\0'+id,{store:this.store,id,deleted:true});return Promise.resolve();}
 clear(){this.tx.cleared.add(this.store);for(const [key,v] of this.tx.changes)if(v.store===this.store)this.tx.changes.delete(key);return Promise.resolve();}
 async query(query=null,limit=null,direction='next',offset=0){
 let where='dataset=? AND store=?',args=[this.tx.generation,this.store];const paths=this.paths.map(sqlPath),lhs=paths.length>1?'('+paths.join(',')+')':paths[0];
 const bound=(value,op)=>{const values=Array.isArray(value)?value:[value];where+=` AND ${lhs} ${op} ${values.length>1?'('+values.map(()=>'?').join(',')+')':'?'}`;args.push(...values);};
 if(query!=null){if(typeof query==='object'&&!Array.isArray(query)&&('lower'in query||'upper'in query)){if(query.lower!==undefined)bound(query.lower,query.lowerOpen?'>':'>=');if(query.upper!==undefined)bound(query.upper,query.upperOpen?'<':'<=');}else bound(query,'=');}
 const order=paths.map(p=>p+(direction==='prev'?' DESC':' ASC')).join(',');let sql=`SELECT body FROM data_records WHERE ${where} ORDER BY ${order}`;if(limit!==null){sql+=' LIMIT ? OFFSET ?';args.push(limit,offset);}const result=await this.tx.db.prepare(sql).bind(...args).all();return result.results.map(r=>JSON.parse(r.body));
 }
 async getAll(query=null,limit=null){return this.query(query,limit);}
 async scan(fn,query=null,direction='next'){let offset=0;for(;;){const rows=await this.query(query,256,direction,offset);for(const row of rows)if(fn(row)===false)return;if(rows.length<256)return;offset+=rows.length;}}
}
export class D1Repository extends IndexedDBRepository{
 constructor(db){super('Application D1');this.backend=db;this.isRemote=true;}
 async open(){if(this.ready)return this;if(!this.backend)throw Error('Application Persistent Databaseが接続されていません。空データには切り替えません。');
 await this.backend.prepare("INSERT OR IGNORE INTO app_meta(id,schema_version,revision,generation,created_at,updated_at) VALUES('main',1,0,'main',?,?)").bind(now(),now()).run();const meta=await this.meta();this.metadata={schemaVersion:meta.schema_version,revision:meta.revision,generation:meta.generation};this.readOnly=meta.schema_version!==DATA_SCHEMA_VERSION;if(this.readOnly)this.problem='未対応のschemaVersionです。データは保護されています。';this.ready=true;return this;}
 meta(){return this.backend.prepare("SELECT * FROM app_meta WHERE id='main'").first();}
 async tx(names,mode,fn){for(const n of names)storeCheck(n);await this.open();if(mode==='readwrite'&&this.readOnly)throw Object.assign(Error(this.problem),{status:409});
 for(let attempt=0;attempt<6;attempt++){
 const base=await this.meta(),tx={db:this.backend,generation:base.generation,changes:new Map(),cleared:new Set()};const result=await fn(Object.fromEntries(names.map(n=>[n,new D1View(tx,n)])));
 if(mode==='readonly'){const after=await this.meta();if(after.revision===base.revision&&after.generation===base.generation)return result;continue;}
 const guard=uid(),commands=[this.backend.prepare("INSERT INTO write_guard(id,valid) VALUES(?,(SELECT CASE WHEN revision=? AND generation=? AND schema_version=1 THEN 1 ELSE 0 END FROM app_meta WHERE id='main'))").bind(guard,base.revision,base.generation)];
 for(const n of tx.cleared)commands.push(this.backend.prepare('DELETE FROM data_records WHERE dataset=? AND store=?').bind(base.generation,n));
 for(const c of tx.changes.values())commands.push(c.deleted?this.backend.prepare('DELETE FROM data_records WHERE dataset=? AND store=? AND id=?').bind(base.generation,c.store,c.id):this.backend.prepare('INSERT INTO data_records(dataset,store,id,body) VALUES(?,?,?,?) ON CONFLICT(dataset,store,id) DO UPDATE SET body=excluded.body').bind(base.generation,c.store,c.id,JSON.stringify(c.value)));
 commands.push(this.backend.prepare("UPDATE app_meta SET revision=revision+1,updated_at=? WHERE id='main'").bind(now()),this.backend.prepare('DELETE FROM write_guard WHERE id=?').bind(guard));
 try{await this.backend.batch(commands);return result;}catch(e){if(!String(e.message).includes('CHECK constraint failed'))throw e;}
 }throw conflict();}
 async status(){await this.open();const m=await this.meta();const counts=await this.backend.prepare('SELECT store,count(*) AS count FROM data_records WHERE dataset=? GROUP BY store').bind(m.generation).all();return {backend:'D1',schemaVersion:m.schema_version,revision:m.revision,generation:m.generation,createdAt:m.created_at,updatedAt:m.updated_at,counts:Object.fromEntries(counts.results.map(r=>[r.store,r.count])),readOnly:this.readOnly};}
 async candidatesMany(items){if(!Array.isArray(items)||items.length>2000)throw Error('候補検索は分割してください');const [all,sources]=await Promise.all([this.all('items'),this.all('sources')]);const byId=new Map(all.map(i=>[i.id,i]));const byNorm=new Map();for(const i of all){const a=byNorm.get(i.normalized)||[];a.push(i);byNorm.set(i.normalized,a);}return items.map(item=>{const found=new Map((byNorm.get(norm(item.expression))||[]).map(i=>[i.id,i]));const src=item.sources?.[0];if(src?.externalId&&src.datasetId)for(const s of sources)if(s.externalId===src.externalId&&s.datasetId===src.datasetId&&byId.has(s.itemId))found.set(s.itemId,byId.get(s.itemId));return [...found.values()];});}
 async importChunk({id,meta,rows=[],start=0,finish=false}){if(!id||!Array.isArray(rows)||rows.length>10||!Number.isInteger(start)||start<0)throw Error('Invalid import chunk');let batch=await this.get('batches',id);if(batch&&['completed','partial'].includes(batch.status))return batch;if(!batch){if(!meta)throw Error('Import metadata required');batch={...meta,id,at:now(),imported:0,updated:0,skipped:0,errors:0,status:'running'};await this.put('batches',batch);}
 for(let n=0;n<rows.length;n++){const r=rows[n],record={id:id+':'+(start+n),batchId:id,row:r.sourceRow||start+n+2,raw:r.item?.extras,errors:r.errors,action:r.action||'error'};if(!Array.isArray(r.errors)||!r.item||!['new','merge','source','example','reference','skip','error'].includes(record.action))throw Error('Invalid import row');if(await this.get('importRows',record.id))continue;
 if(r.errors.length||r.action==='skip')await this.put('importRows',record);else{let item=r.item;if(r.targetId&&r.action!=='new'){const old=await this.aggregate(r.targetId);if(!old)throw Error('統合先が見つかりません');item=mergeContent(old,item,r.action);}else item={...item,id:uid()};await this.saveContent(item,{event:'updated',batchId:id,importRecord:record});}}
 const completed=await this.tx(['importRows'],'readonly',s=>s.importRows.index('batchId').getAll(id));batch={...batch,imported:0,updated:0,skipped:0,errors:0,updatedAt:now()};for(const r of completed)batch[r.errors?.length?'errors':r.action==='skip'?'skipped':r.action==='new'?'imported':'updated']++;
 if(finish){if(completed.length!==batch.total)throw Error('Importが未完了です。再試行してください');batch.status=batch.errors?'partial':'completed';batch.finishedAt=now();await this.put('events',{id:id+':completed',type:'imported',at:now(),batchId:id});}await this.put('batches',batch);return batch;}
 async rawBackup(){const b=await this.exportData();b.schemaVersion=this.metadata.schemaVersion;return b;}
 async startTransfer({id,counts,mode='migration',expectedRevision}){await this.open();if(this.readOnly)throw Error(this.problem);if(!/^[A-Za-z0-9._:-]{1,160}$/.test(id))throw Error('Invalid transfer ID');const existing=await this.backend.prepare('SELECT body FROM transfer_jobs WHERE id=?').bind(id).first();if(existing)return JSON.parse(existing.body);
 const status=await this.status();if(mode==='migration'&&(status.counts.items||status.counts.records))return {skipped:true,reason:'server-not-empty'};
 if(mode!=='migration'&&mode!=='restore')throw Error('Invalid mode');if(mode==='restore'&&expectedRevision!==status.revision)throw conflict();
 const job={id,counts,mode,baseRevision:status.revision,baseGeneration:status.generation,generation:'transfer:'+id,status:'uploading',createdAt:now()};await this.backend.prepare('INSERT INTO transfer_jobs(id,body) VALUES(?,?) ON CONFLICT(id) DO NOTHING').bind(id,JSON.stringify(job)).run();return job;}
 async transferChunk({id,store,rows}){storeCheck(store);if(!Array.isArray(rows)||rows.length>40)throw Error('Invalid chunk');const job=await this.job(id);if(job.status==='completed')return job;if(job.status!=='uploading')throw Error('Transfer not open');for(const r of rows)if(typeof idOf(store,r)!=='string')throw Error('Invalid row');if(rows.length)await this.backend.batch(rows.map(r=>this.backend.prepare('INSERT INTO data_records(dataset,store,id,body) VALUES(?,?,?,?) ON CONFLICT(dataset,store,id) DO UPDATE SET body=excluded.body').bind(job.generation,store,idOf(store,r),JSON.stringify(r))));return {uploaded:rows.length};}
 async job(id){const r=await this.backend.prepare('SELECT body FROM transfer_jobs WHERE id=?').bind(id).first();if(!r)throw Error('Transfer not found');return JSON.parse(r.body);}
 async finishTransfer({id}){const job=await this.job(id);if(job.status==='completed')return job;const current=await this.status();if(job.mode==='migration'){if(current.counts.items||current.counts.records)return {skipped:true,reason:'server-not-empty'};job.baseRevision=current.revision;job.baseGeneration=current.generation;}const data={};for(const n of STORES){const r=await this.backend.prepare('SELECT body FROM data_records WHERE dataset=? AND store=?').bind(job.generation,n).all();data[n]=r.results.map(x=>JSON.parse(x.body));if(data[n].length!==job.counts[n])throw Error('転送が未完了です。元データを保持したまま再試行してください。');}
 validateBackup({app:'PersonalVocabularyTrainer',schemaVersion:1,data});const guard=uid();job.status='completed';job.completedAt=now();
 try{await this.backend.batch([
 this.backend.prepare("INSERT INTO write_guard(id,valid) VALUES(?,(SELECT CASE WHEN revision=? AND generation=? AND schema_version=1 THEN 1 ELSE 0 END FROM app_meta WHERE id='main'))").bind(guard,job.baseRevision,job.baseGeneration),
 this.backend.prepare("UPDATE app_meta SET generation=?,revision=revision+1,updated_at=? WHERE id='main'").bind(job.generation,now()),
 this.backend.prepare('UPDATE transfer_jobs SET body=? WHERE id=?').bind(JSON.stringify(job),id),
 this.backend.prepare('DELETE FROM write_guard WHERE id=?').bind(guard)]);}catch(e){if(String(e.message).includes('CHECK constraint failed'))throw conflict();throw e;}
 return job;}
}
