import {norm,uid,now,inferType,findCloze,TYPES} from './domain.js';
export const FIELDS={externalId:'外部ID',expression:'Expression 必須',definition:'English Definition 必須',related:'Synonyms / Related',examples:'Examples',categories:'Categories',type:'Type',meaning:'Japanese Meaning',tags:'Tags',notes:'Notes',variants:'Accepted Variants',source:'Source',difficulty:'Difficulty',folder:'Folder',path:'File Path'};
const aliases={externalId:['id','external id','external record id'],expression:['expression','word','word / chunk','vocabulary','phrase','単語','表現'],definition:['definition','english definition','definition (english)','英語定義'],related:['synonyms','synonyms / related expressions','related expressions'],examples:['example','examples','example sentence','alternative examples','例文'],categories:['category','categories','カテゴリ'],type:['type','種類'],meaning:['meaning','japanese meaning','日本語訳'],tags:['tag','tags'],notes:['note','notes','personal note'],variants:['accepted variants','variants'],source:['source','source name'],difficulty:['difficulty'],folder:['folder','folder path'],path:['file path','path']};
export function autoMap(headers){const out={};for(const [k,names] of Object.entries(aliases)){const i=headers.findIndex(h=>names.includes(norm(h)));out[k]=i<0?'':String(i);}return out;}
export function parseCSV(text,delimiter=','){
 text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],v='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++;}else if(quoted)quoted=false;else if(v==='')quoted=true;else v+=c;}else if(c===delimiter&&!quoted){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(x=>x.trim()!==''))rows.push(row);row=[];v='';}else v+=c;}
 if(quoted)throw Error('CSVの引用符が閉じられていません。');row.push(v);if(row.some(x=>x.trim()!==''))rows.push(row);return rows;
}
export const split=(s,delimiter=' / ')=>String(s??'').split(delimiter).map(s=>s.trim()).filter(Boolean);
export function rowToItem(row,headers,mapping,meta={}){
 const get=k=>mapping[k]!==''&&mapping[k]!==undefined?String(row[Number(mapping[k])]??'').trim():'';
 const expression=get('expression'),definition=get('definition'),errors=[];
 if(!expression)errors.push('Expressionがありません');if(!definition)errors.push('English Definitionがありません');
 if(expression.length>1000)errors.push('Expressionが長すぎます（1,000文字まで）');
 const type=get('type')||inferType(expression);if(!TYPES.includes(type))errors.push('Typeが未対応です: '+type);
 const id=uid(),at=now(),examples=get('examples').split(/\n\s*\n|\s*\|\|\s*/).filter(Boolean).map(text=>({id:uid(),itemId:id,text,type:'Original',isActive:true,cloze:findCloze(expression,text),acceptedVariants:[],distractors:[],createdAt:at}));
 const item={id,expression:norm(expression),displayText:expression,type,definitions:definition?[definition]:[],meanings:get('meaning')?[get('meaning')]:[],related:split(get('related'),meta.delimiter||' / '),categories:split(get('categories'),meta.delimiter||' / '),tags:split(get('tags'),meta.delimiter||' / '),notes:get('notes'),difficulty:get('difficulty'),createdAt:at,updatedAt:at,archivedAt:null,revision:1,examples,variants:split(get('variants'),meta.delimiter||' / ').map(text=>({id:uid(),itemId:id,text})),sources:[{id:uid(),itemId:id,type:get('source')?'Other':'Imported File',name:get('source')||meta.fileName||'Manual',fileName:meta.fileName||'',fileType:meta.fileType||'Manual',storageLocation:meta.fileType?'Local File':'Manual',folder:get('folder'),path:get('path'),externalId:get('externalId'),datasetId:meta.datasetId||'',sheet:meta.sheet||'',importedAt:at}],questionSettings:{},extras:Object.fromEntries(headers.map((h,i)=>[h,row[i]??'']))};
 return {item,errors};
}
export function enrichQuestions(item,pool,bank){
 const exact=bank?.find(b=>norm(b.expression)===norm(item.displayText)&&b.definition===item.definitions[0]&&b.example===item.examples[0]?.text);
 if(exact){item.questionSettings={recognitionDistractors:exact.recognitionDistractors,recognitionApproved:true,productionPrompt:exact.productionPrompt||''};item.examples[0]={...item.examples[0],cloze:exact.cloze,distractors:exact.distractors,clozeApproved:true,acceptedVariants:exact.acceptedVariants||[]};return item;}
 const other=pool.filter(p=>norm(p.expression)!==norm(item.expression)&&!item.related.some(r=>norm(r)===norm(p.expression)));
 const defs=[...new Set(other.map(p=>p.definitions?.[0]).filter(d=>d&&norm(d)!==norm(item.definitions[0])))].slice(0,3);
 item.questionSettings={recognitionDistractors:defs,recognitionApproved:false};
 for(const e of item.examples){e.distractors=[...new Set(other.map(p=>p.displayText.replace(/\s*[~〜]\s*$/,'')).filter(Boolean))].slice(0,3);e.clozeApproved=false;}
 return item;
}
export function mergeContent(existing,incoming,action='merge'){
 const out=structuredClone(existing),dedup=(a,b,key)=>[...a,...b.filter(x=>!a.some(y=>key(y)===key(x)))];
 const sourceKey=s=>[s.datasetId,s.externalId,s.fileType,s.name,s.sheet].join('|');
 if(['merge','source','reference'].includes(action)){
  if(action==='reference')out.sources=out.sources.map(s=>{const n=incoming.sources.find(x=>x.datasetId===s.datasetId&&x.externalId===s.externalId);return n?{...s,...n,id:s.id,itemId:out.id}:s;});
  else out.sources=dedup(out.sources,incoming.sources,sourceKey).map(s=>({...s,itemId:out.id}));
 }
 if(['merge','example'].includes(action))out.examples=dedup(out.examples,incoming.examples,e=>norm(e.text)).map(e=>({...e,itemId:out.id}));
 if(action==='merge'){
  for(const k of ['definitions','meanings','related','categories','tags'])out[k]=[...new Set([...(out[k]||[]),...(incoming[k]||[])])];
  for(const k of ['notes','difficulty'])if(incoming[k])out[k]=incoming[k];
  // Explicit merge chooses incoming primary definition, retaining previous meanings.
  if(incoming.definitions?.length)out.definitions=[...new Set([...incoming.definitions,...out.definitions])];
  out.variants=dedup(out.variants,incoming.variants,v=>norm(v.text)).map(v=>({...v,itemId:out.id}));out.extras={...out.extras,...incoming.extras};
  if(incoming.questionSettings?.recognitionApproved)out.questionSettings=incoming.questionSettings;
 }
 out.updatedAt=now();return out;
}
