import {D1Repository} from './d1-repository.js';
import {MODES} from '../dist/domain.js';
const READ_METHODS=new Set(['get','all','aggregate','list','candidates','records','importErrors','stats','exportData','rawBackup','inspectIntegrity','status','candidatesMany']);
const WRITE_METHODS=new Set(['saveContent','markMastered','markWeak','learn','archive','answer','put','remove','startTransfer','transferChunk','finishTransfer','importChunk']);
const writableStores=new Set(['settings','mappings','sessions','batches','importRows','events']);
export async function api(request,env){const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
 try{
 // Sites dispatch enforces this project's existing owner-private access boundary.
 // There is no public database binding, bearer in client code, or CORS permission.
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const origin=request.headers.get('origin'),url=new URL(request.url);
 if(origin&&origin!==url.origin&&origin!=='https://personal-vocabulary-trainer.stein621.chatgpt.site')return json({error:'Origin not allowed'},403);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('x-pvt-request')!=='1'||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Invalid application request'},403);
 if(Number(request.headers.get('content-length'))>6*1024*1024)return json({error:'Request too large'},413);
 const raw=await request.text();if(raw.length>6*1024*1024)return json({error:'Request too large'},413);
 const {method,args=[]}=JSON.parse(raw);if(!READ_METHODS.has(method)&&!WRITE_METHODS.has(method))return json({error:'Unknown operation'},400);if(!Array.isArray(args))return json({error:'Invalid arguments'},400);
 if(['put','remove'].includes(method)&&!writableStores.has(args[0]))return json({error:'Use item-level operations'},400);
 if(method==='put'&&args[0]==='settings'&&args[1]?.id==='storage-metadata')return json({error:'Schema metadata is managed by the application'},400);
 if(method==='answer'&&(!args[0]?.id||!args[0]?.itemId||typeof args[0].correct!=='boolean'||!MODES.includes(args[0].mode)))return json({error:'Invalid answer'},400);
 if(['markMastered','markWeak','archive'].includes(method)&&typeof args[1]!=='boolean')return json({error:'Invalid state change'},400);
 if(method==='saveContent'&&(!args[0]||!Array.isArray(args[0].definitions)))return json({error:'Invalid item'},400);
 const repo=new D1Repository(env.DB);const value=await repo[method](...args);return json({value:value??null});
 }catch(e){const status=e.status||(/別の|再試行|schemaVersion/.test(e.message)?409:500);return json({error:status===500?'保存データを読み書きできませんでした。空データには切り替えていません。再試行してください。':e.message,detail:status===500?String(e.message).slice(0,250):undefined},status);}
}
