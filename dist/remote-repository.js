import {IndexedDBRepository,validateBackup,STORES} from './repository.js';
import {uid} from './domain.js';
export class RemoteRepository{
 constructor(fetcher=(...args)=>fetch(...args)){this.fetcher=fetcher;this.name='Application Persistent Data Store (D1)';this.isRemote=true;this.pending=0;this.problem=null;this.lastSaved=null;this.readOnly=false;this.invalidIds=new Set();this.onStatus=null;this.writeTail=Promise.resolve();this.migrationMessage='';}
 notify(){this.onStatus?.(this);}
 async call(method,args=[],write=false){const run=async()=>{if(write)this.pending++;this.notify();try{const response=await this.fetcher('./api/repository',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-pvt-request':'1'},body:JSON.stringify({method,args})});if(!response.headers.get('content-type')?.includes('application/json'))throw Error('アプリへの接続を確認できません。固定Site URLを開き直してください。');const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'保存データを読み込めませんでした'),{status:response.status});if(write)this.lastSaved=new Date().toISOString();this.problem=null;return result.value;}catch(e){this.problem=e.message||'サーバーに接続できません。再試行してください。';throw e;}finally{if(write)this.pending--;this.notify();}};
 if(!write)return run();const task=this.writeTail.catch(()=>{}).then(run);this.writeTail=task;return task;}
 async open(){const s=await this.call('status');this.metadata=s;this.readOnly=s.readOnly;if(this.readOnly)this.problem='未対応のschemaVersionです。既存データを保護しています。';return this;}
 get(s,id){return this.call('get',[s,id]);}all(s){return this.call('all',[s]);}put(s,v){return this.call('put',[s,v],true);}remove(s,id){return this.call('remove',[s,id],true);}
 aggregate(id){return this.call('aggregate',[id]);}saveContent(i,o={}){return this.call('saveContent',[i,o],true);}answer(r){return this.call('answer',[r],true);}
 markMastered(id,on){return this.call('markMastered',[id,on],true);}markWeak(id,on){return this.call('markWeak',[id,on],true);}learn(id){return this.call('learn',[id],true);}archive(id,on){return this.call('archive',[id,on],true);}
 list(...args){return this.call('list',args);}stats(...args){return this.call('stats',args);}records(...args){return this.call('records',args);}candidates(i){return this.call('candidates',[i]);}importErrors(id){return this.call('importErrors',[id]);}
 exportData(...args){return this.call('exportData',args);}rawBackup(){return this.call('rawBackup');}async inspectIntegrity(){const n=await this.call('inspectIntegrity');this.invalidIds=new Set(Array.from({length:n},(_,i)=>i));return n;}
 async candidatesMany(items){const results=[];for(let n=0;n<items.length;n+=1000)results.push(...await this.call('candidatesMany',[items.slice(n,n+1000)]));return results;}
 async commitBatch(rows,meta,onProgress=()=>{}){const id=meta.id||uid();let batch;for(let n=0;n<rows.length;n+=10){batch=await this.call('importChunk',[{id,meta:{...meta,total:rows.length},rows:rows.slice(n,n+10),start:n}],true);onProgress(Math.min(n+10,rows.length),rows.length);}return this.call('importChunk',[{id,meta:{...meta,total:rows.length},finish:true}],true);}
 async protection(){return {persistent:true,backend:'D1'};}
 // Browser copies are recovery aids only; they never overwrite the server at boot.
 writeJournal(id,value){try{localStorage.setItem('pvt-remote-pending:'+id,JSON.stringify(value));return true;}catch{return false;}}
 readJournal(){return null;}clearJournal(id){try{localStorage.removeItem('pvt-remote-pending:'+id);}catch{}}
 async transfer(backup,{id,mode='migration'}={}){validateBackup(backup);const status=await this.call('status'),counts=Object.fromEntries(STORES.map(s=>[s,backup.data[s].length]));const job=await this.call('startTransfer',[{id:id||uid(),mode,counts,expectedRevision:status.revision}],true);if(job.skipped||job.status==='completed')return job;
 for(const store of STORES)for(let n=0;n<backup.data[store].length;n+=40){await this.call('transferChunk',[{id:job.id,store,rows:backup.data[store].slice(n,n+40)}],true);this.migrationMessage=`旧データを転送中：${store} ${Math.min(n+40,backup.data[store].length)} / ${backup.data[store].length}`;this.notify();}
 const result=await this.call('finishTransfer',[{id:job.id}],true);await this.open();return result;}
 async restore(backup){return this.transfer(backup,{mode:'restore'});}
 async migrateLegacy(){const status=await this.call('status');if(status.readOnly)return;if(status.counts.items||status.counts.records){this.migrationMessage='共通ストレージの保存済みデータを使用しています。旧ブラウザデータは自動置換しません。';return;}let legacy;try{legacy=new IndexedDBRepository();await legacy.open();const items=await legacy.all('items');if(!items.length)return;
 if(status.counts.items||status.counts.records){this.migrationMessage='サーバーの保存済みデータを使用しています。旧ブラウザデータもこの端末に残しています。';return;}
 this.migrationMessage='このブラウザの旧データをアプリ共通ストレージへ移行しています…';this.notify();const backup=await legacy.exportData();const id='legacy-'+legacy.metadata.installationId;const migrated=await this.transfer(backup,{id});this.migrationMessage=migrated.skipped?'共通データが追加されたため旧データの移行を保留しました。元データは保持しています。':'旧ブラウザデータを共通ストレージへ移行しました。元データも保持しています。';
 }catch(e){this.migrationMessage='旧データの移行は完了していません。元データは維持されています。'+e.message;throw e;}finally{legacy?.db?.close();this.notify();}}
}
