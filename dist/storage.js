// Browser adapter only. Domain/application logic never calls browser storage APIs.
export const DATABASE_NAME='personal-vocabulary-trainer-v1';
export const SCHEMA_VERSION=1;
export const METADATA_ID='storage-metadata';
export const STORES=['items','states','examples','sources','variants','records','events','batches','importRows','mappings','sessions','settings','daily'];
export const request=r=>r?.then?r:new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
// Legacy installations had no metadata. This migration adds metadata only.
export const migrations=new Map([[0,async stores=>{await request(stores.settings.put({id:METADATA_ID,schemaVersion:1,createdAt:new Date().toISOString(),installationId:crypto.randomUUID()}));}]]);
export function storageMessage(error){return error?.name==='QuotaExceededError'?'保存容量が不足しています。JSONバックアップを取り、端末の空き容量を確認してください。':error?.name==='VersionError'?'新しい形式の保存データがあります。データは削除していません。対応するアプリで開いてください。':`保存領域を読み書きできません。データは初期化していません。${error?.message||''}`;}
export class BrowserStorage{
 constructor(name=DATABASE_NAME){this.name=name;this.db=null;this.opening=null;this.pending=0;this.lastSaved=null;this.problem=null;this.onStatus=null;}
 notify(){this.onStatus?.({pending:this.pending,lastSaved:this.lastSaved,problem:this.problem,readOnly:this.readOnly});}
 async open(){if(this.opening)return this.opening;if(this.db)return this;
 this.opening=this.connect().catch(e=>{this.db?.close();this.db=null;this.problem=storageMessage(e);this.notify();throw e;}).finally(()=>this.opening=null);return this.opening;}
 async connect(){const r=indexedDB.open(this.name,1);r.onupgradeneeded=()=>{const db=r.result;for(const n of STORES){const s=db.createObjectStore(n,{keyPath:n==='states'?'itemId':'id'});if(['examples','sources','variants','records','events'].includes(n))s.createIndex('itemId','itemId');if(n==='items')for(const k of ['normalized','createdAt','updatedAt','nextReview','score','reviewCount','lastReviewed']){s.createIndex(k,k);s.createIndex('ordered_'+k,[k,'id']);}if(n==='records'){s.createIndex('at','at');s.createIndex('sessionId','sessionId');s.createIndex('itemAt',['itemId','at']);}if(n==='sources')s.createIndex('externalKey',['datasetId','externalId']);if(n==='events')s.createIndex('at','at');if(n==='importRows')s.createIndex('batchId','batchId');}};
 r.onblocked=()=>{this.problem='別のタブを閉じて再読み込みしてください。保存データは維持されています。';this.notify();};this.db=await request(r);this.db.onversionchange=()=>{this.db.close();this.db=null;this.problem='保存形式が更新されました。ページを再読み込みしてください。';this.notify();};
 await this.rawTx(['settings'],'readwrite',async s=>{let meta=await request(s.settings.get(METADATA_ID));this.metadata=meta;let version=meta?.schemaVersion??0;
 if(!Number.isInteger(version)||version<0||version>SCHEMA_VERSION){this.readOnly=true;this.problem='未対応のschemaVersionです。保護のため読み取り専用です。JSONバックアップは取得できます。';return;}
 while(version<SCHEMA_VERSION){const migration=migrations.get(version);if(!migration)throw Error('対応するMigrationがありません');await migration(s);version++;}
 this.metadata=await request(s.settings.get(METADATA_ID));});this.notify();return this;
 }
 async rawTx(names,mode,fn){let t;try{t=this.db.transaction(names,mode,mode==='readwrite'?{durability:'strict'}:undefined);}catch(e){if(e.name!=='TypeError')throw e;t=this.db.transaction(names,mode);}
 const done=new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onabort=()=>reject(t.error||Error('保存処理を中断しました'));t.onerror=()=>{};});done.catch(()=>{});
 try{const value=await fn(Object.fromEntries(names.map(n=>[n,t.objectStore(n)])));await done;return value;}catch(e){try{t.abort();}catch{}await done.catch(()=>{});throw e;}}
 async tx(names,mode,fn){await this.open();if(mode==='readwrite'&&this.readOnly)throw Error(this.problem);if(mode==='readwrite'){this.pending++;this.notify();}
 try{const value=await this.rawTx(names,mode,fn);if(mode==='readwrite'){this.lastSaved=new Date().toISOString();this.problem=null;}return value;}catch(e){this.problem=storageMessage(e);throw e;}finally{if(mode==='readwrite')this.pending--;this.notify();}}
 async protection(requestPermission=false){try{const storage=globalThis.navigator?.storage;if(requestPermission)await storage?.persist?.();return {persistent:await storage?.persisted?.()??false,...await storage?.estimate?.()};}catch{return {persistent:false};}}
 // Small write-ahead journal: input survives an immediate close before the IDB draft transaction completes.
 journalKey(id){return `${this.name}:draft:${id}`;}
 writeJournal(id,value){try{globalThis.localStorage?.setItem(this.journalKey(id),JSON.stringify(value));return true;}catch{return false;}}
 readJournal(id){try{const raw=globalThis.localStorage?.getItem(this.journalKey(id));return raw?JSON.parse(raw):null;}catch{this.problem='入力の復旧データが読めません。保存済みの教材は維持されています。';this.notify();return null;}}
 clearJournal(id){try{globalThis.localStorage?.removeItem(this.journalKey(id));}catch{}}
 async rawBackup(){return {app:'PersonalVocabularyTrainer',schemaVersion:this.metadata?.schemaVersion??null,recovery:true,data:await this.tx(STORES,'readonly',async s=>Object.fromEntries(await Promise.all(STORES.map(async n=>[n,await request(s[n].getAll())]))))};}
}
