// Pure learning domain: no DOM, IndexedDB, file formats or network dependencies.
export const TYPES=['Word','Chunk','Phrase','Collocation','Sentence Pattern','Grammar Pattern','Mistake','Personal Expression'];
export const MODES=['recognition','cloze-select','cloze-input','recall','production'];
export const POLICY={version:1,intervals:[1,3,7,14,30],timeZone:'Asia/Tokyo'};
export const uid=()=>crypto.randomUUID();
export const norm=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export const answerNorm=s=>norm(s).replace(/[’‘]/g,"'").replace(/[.!?。！？]+$/g,'').trim();
export const now=()=>new Date().toISOString();
export function day(date=new Date(),zone=POLICY.timeZone){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date));const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;}
export function addDays(d,n){const a=new Date(d+'T12:00:00Z');a.setUTCDate(a.getUTCDate()+n);return a.toISOString().slice(0,10);}
export function initialState(itemId,at=now()){return {itemId,status:'New',correct:0,incorrect:0,consecutive:0,reviewCount:0,stage:0,nextReview:day(at),lastReviewed:null,lastAdvancedDate:null,lastCorrectDate:null,dayStreak:0,masteredAt:null,manualWeak:false,recent:[],modeResults:{},score:null,policyVersion:1,revision:0};}
export function scores(s){const rate=m=>{const a=m.flatMap(k=>s.modeResults[k]||[]).sort((x,y)=>x.at.localeCompare(y.at)).slice(-20);return a.length?a.filter(x=>x.correct).length/a.length:null;};const recognition=rate(['recognition','cloze-select']),recall=rate(['cloze-input','recall']),production=rate(['production']);return {recognition,recall,production,mastery:recognition===null||recall===null?null:Math.round(100*(.4*recognition+.4*recall+.2*Math.min(s.consecutive/5,1)))};}
export function weakReasons(s){const a=s.recent.slice(-20),r=[];if(s.manualWeak)r.push('手動でWeak指定');if(a.length>=3&&a.filter(x=>x.correct).length/a.length<.6)r.push('直近正答率60%未満');if(a.slice(-3).length===3&&a.slice(-3).filter(x=>!x.correct).length>=2)r.push('直近3回中2回以上の誤答');if(s.score!==null&&s.score<40)r.push('参考Scoreが40未満');const p=s.modeResults.production||[];if(p.length>=3&&p.filter(x=>x.correct).length/p.length<.6)r.push('Production成功率60%未満');return r;}
export function reviewState(state,result,at=now()){
 const s=structuredClone(state),d=day(at);if(!MODES.includes(result.mode)||typeof result.correct!=='boolean')throw Error('回答結果が不正です');
 s.status=s.status==='New'?'Learning':s.status;s.reviewCount++;s[result.correct?'correct':'incorrect']++;s.consecutive=result.correct?s.consecutive+1:0;s.lastReviewed=at;
 s.recent=[...s.recent,{correct:result.correct,mode:result.mode,at}].slice(-20);
 s.modeResults[result.mode]=[...(s.modeResults[result.mode]||[]),{correct:result.correct,at}].slice(-20);
 if(result.correct){
  if(s.lastCorrectDate!==d){s.dayStreak++;s.lastCorrectDate=d;}
  if(s.status==='Learning'&&s.dayStreak>=2)s.status='Reviewing';
  if(s.status==='Mastered'){if(s.lastFailedDate!==d)s.nextReview=addDays(d,30);}
  else if(s.lastAdvancedDate!==d){s.nextReview=addDays(d,POLICY.intervals[Math.min(s.stage,4)]);s.stage=Math.min(s.stage+1,5);s.lastAdvancedDate=d;}
 }else{s.lastFailedDate=d;s.dayStreak=0;s.lastCorrectDate=null;s.stage=0;s.lastAdvancedDate=d;s.nextReview=addDays(d,1);}
 s.score=scores(s).mastery;s.revision++;return s;
}
export function setMastered(state,on,at=now()){
 const s=structuredClone(state);if(on){s.status='Mastered';s.masteredAt=at;s.nextReview=addDays(day(at),30);}else{s.status=s.recent.slice(-3).filter(r=>!r.correct).length>=2?'Learning':'Reviewing';s.masteredAt=null;s.nextReview=day(at);}s.revision++;return s;
}
export function projection(item,s){return {...item,status:s.status,nextReview:s.nextReview,score:s.score??-1,weak:weakReasons(s).length>0,reviewCount:s.reviewCount,lastReviewed:s.lastReviewed||'',masteredAt:s.masteredAt||'',correct:s.correct,incorrect:s.incorrect};}
export function mastery(items){const a=items.filter(i=>!i.archivedAt),m=a.filter(i=>i.status==='Mastered').length;return {active:a.length,mastered:m,percent:a.length?100*m/a.length:null};}
export function inferType(expression){return /[~〜]|\bA and B\b/.test(expression)?'Sentence Pattern':expression.trim().split(/\s+/).length===1?'Word':'Chunk';}
export function findCloze(expression,text){
 const base=expression.replace(/\s*[~〜]\s*$/,'').trim();if(!base||/\bA and B\b/.test(base))return null;
 const escaped=base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),rx=new RegExp('(?<![\\p{L}\\p{N}])'+escaped+'(?![\\p{L}\\p{N}])','giu'),matches=[...text.matchAll(rx)];
 if(matches.length!==1)return null;return {start:matches[0].index,end:matches[0].index+matches[0][0].length,answer:matches[0][0]};
}
export function validCloze(e){return e&&e.cloze&&Number.isInteger(e.cloze.start)&&e.cloze.start>=0&&e.cloze.end>e.cloze.start&&e.cloze.end<=e.text.length&&e.text.slice(e.cloze.start,e.cloze.end)===e.cloze.answer;}
export function grade(question,response){return question.answers.some(x=>answerNorm(x)===answerNorm(response));}
export function shuffle(a,rng=Math.random){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
export function makeQuestion(item,mode,sequence=0){
 const def=item.definitions?.[0],examples=(item.examples||[]).filter(e=>e.isActive!==false&&validCloze(e));
 const q={id:uid(),itemId:item.id,mode,revision:item.revision||1,target:item.displayText||item.expression};
 if(mode==='recognition'){
  const d=item.questionSettings?.recognitionDistractors||[];
  if(!def||!item.questionSettings?.recognitionApproved||d.length<2)return {unavailable:'Recognitionの選択肢を詳細画面で確認してください。'};
  const choices=[def,...d].filter((v,i,a)=>a.findIndex(x=>answerNorm(x)===answerNorm(v))===i);
  if(choices.length<3)return {unavailable:'異なる選択肢が3つ以上必要です。'};
  return {...q,prompt:q.target,sub:'この表現に登録された英語の定義を選んでください。',answers:[def],choices:shuffle(choices)};
 }
 if(mode==='recall')return def?{...q,prompt:def,sub:'この定義に合う表現を英語で入力してください。',answers:[item.expression.replace(/\s*[~〜]\s*$/,''),...(item.variants||[]).filter(v=>!v.questionId).map(v=>v.text)]}:{unavailable:'Definitionが必要です。'};
 if(mode==='production')return {...q,prompt:item.questionSettings?.productionPrompt||'Think of a new situation from your work, daily life, or interests. Write an original sentence using this expression.',sub:q.target,answers:[]};
 if(!examples.length)return {unavailable:'この教材はClozeの対象範囲をまだ設定していません。詳細画面で設定できます。'};
 const e=examples[sequence%examples.length],answers=[e.cloze.answer,...(e.acceptedVariants||[]),...(item.variants||[]).filter(v=>v.questionId===e.id).map(v=>v.text)],prompt=e.text.slice(0,e.cloze.start)+' ______ '+e.text.slice(e.cloze.end);
 if(mode==='cloze-input')return {...q,prompt,hint:def,sub:'空欄に入る単語・表現を入力してください。',answers,exampleId:e.id};
 if(mode==='cloze-select'){
  if(!e.clozeApproved||(e.distractors||[]).length<2)return {unavailable:'Cloze Selectの選択肢を詳細画面で確認してください。'};
  const ds=e.distractors.filter((x,n,a)=>a.findIndex(v=>answerNorm(v)===answerNorm(x))===n&&!answers.some(a=>answerNorm(a)===answerNorm(x)));
  if(ds.length<2)return {unavailable:'正解と異なる選択肢が必要です。'};
  return {...q,prompt,hint:def,sub:'空欄に入り、ヒントの意味に合う表現を選んでください。',answers,choices:shuffle([e.cloze.answer,...ds]),exampleId:e.id};
 }
 return {unavailable:'未対応の学習モードです。'};
}
export function matches(item,f={}){const cats=item.categories||[],sources=item.sourceNames||[];
 return (!f.search||norm(item.searchText).includes(norm(f.search)))&&(!f.status||item.status===f.status)&&(!f.type||item.type===f.type)&&(!f.category||cats.includes(f.category))&&(!f.source||sources.includes(f.source))&&(!f.difficulty||item.difficulty===f.difficulty)&&(!f.format||(item.fileTypes||[]).includes(f.format))&&(!f.batch||(item.batchIds||[]).includes(f.batch))&&(f.archive==='all'||(f.archive==='archived'?!!item.archivedAt:!item.archivedAt))&&(!f.weak||item.weak)&&(!f.due||(item.status!=='New'&&item.nextReview<=day()))&&(!f.new||item.status==='New');
}
