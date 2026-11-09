import {uid,now,norm,day,makeQuestion,shuffle} from './domain.js';
import {mergeContent,enrichQuestions} from './import-core.js';
export async function previewImport(repo,rows,bank){
 const many=repo.candidatesMany?await repo.candidatesMany(rows.map(r=>r.item)):null;
 const pool=rows.filter(r=>!r.errors.length).map(r=>r.item),seen=new Map();
 for(let n=0;n<rows.length;n++){const r=rows[n];if(r.errors.length)continue;enrichQuestions(r.item,pool,bank);r.candidates=many?many[n]:await repo.candidates(r.item);r.action=r.candidates.length?'merge':'new';r.targetId=r.candidates[0]?.id||'';const k=norm(r.item.expression);if(seen.has(k)){r.inBatch=seen.get(k);r.action='skip';}else seen.set(k,n);}
 return rows;
}
export async function commitImport(repo,rows,meta,onProgress=()=>{}){
 if(repo.commitBatch)return repo.commitBatch(rows,meta,onProgress);
 const id=meta.id||uid(),previous=await repo.get('batches',id);
 if(previous&&['completed','partial'].includes(previous.status))return previous;
 const batch={...meta,id,at:previous?.at||now(),total:rows.length,imported:0,updated:0,skipped:0,errors:0,status:'running'};
 // Stable row IDs and atomic content+row writes make an interrupted batch resumable.
 const completed=new Map((await repo.all('importRows')).filter(r=>r.batchId===id).map(r=>[r.id,r]));
 const count=r=>batch[r.errors?.length?'errors':r.action==='skip'?'skipped':r.action==='new'?'imported':'updated']++;
 for(const r of completed.values())count(r);await repo.put('batches',batch);
 try{for(let n=0;n<rows.length;n++){
  const r=rows[n],record={id:id+':'+n,batchId:id,row:r.sourceRow||n+2,raw:r.item.extras,errors:r.errors,action:r.action||'error'};
  if(completed.has(record.id))continue;
  if(r.errors.length||r.action==='skip')await repo.put('importRows',record);
  else{let item=r.item;if(r.targetId&&r.action!=='new'){const old=await repo.aggregate(r.targetId);if(!old)throw Error('統合先の教材が見つかりません');item=mergeContent(old,item,r.action);}else item={...item,id:uid()};
   await repo.saveContent(item,{event:'updated',batchId:id,importRecord:record});
  }
  count(record);
  if(n%20===0||n===rows.length-1){await repo.put('batches',batch);onProgress(n+1,rows.length);await new Promise(r=>setTimeout(r,0));}
 }batch.status=batch.errors?'partial':'completed';}catch(e){batch.status='failed';batch.failure=e.message;throw e;}finally{batch.finishedAt=now();await repo.put('batches',batch);}
 await repo.put('events',{id:id+':completed',type:'imported',at:now(),batchId:id});return batch;
}
export async function prepareSession(repo,{kind='review',mode='mixed',itemId,limit=20}={}){
 const f=kind==='new'?{new:true}:kind==='weak'?{weak:true}:kind==='all'?{}:{due:true};
 const queue=[],unavailable=[];let page=1,more=true;
 while(more&&queue.length<limit){
 const list=itemId?{items:[await repo.get('items',itemId)],pages:1}:await repo.list(f,page,100,'nextReview','next');
 const ordered=list.items.filter(Boolean).sort((a,b)=>Number(b.weak)-Number(a.weak)||a.nextReview.localeCompare(b.nextReview));
 for(const i of ordered){if(queue.length>=limit)break;const item=await repo.aggregate(i.id);if(item.archivedAt)continue;
 const progression=item.state.reviewCount<2?['recognition','cloze-select','cloze-input','recall']:item.state.reviewCount<4?['cloze-select','cloze-input','recognition','recall']:['cloze-input','recall','recognition'];
 if(item.state.status==='Mastered')progression.unshift('cloze-input');
 const modes=mode==='mixed'?progression:[mode];let question;for(const m of modes){const q=makeQuestion(item,m,item.state.reviewCount);if(!q.unavailable){question=q;break;}}
 if(question)queue.push({item,question});else unavailable.push({id:item.id,expression:item.displayText,reason:makeQuestion(item,modes[0]).unavailable});
 }more=!itemId&&page<list.pages;page++;
 }
 return {id:uid(),at:now(),kind,mode,queue,unavailable,index:0,answers:[],skipped:0,initialMastery:(await repo.stats()).percent};
}
