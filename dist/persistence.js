// Application lifecycle; uses repository capabilities, never browser storage directly.
export class DraftController{
 constructor(repo){this.repo=repo;this.tail=Promise.resolve();this.timer=null;this.onSaved=null;this.onError=null;this.validate=null;this.latest=null;}
 capture(item){const draft={id:'editor-draft',at:new Date().toISOString(),item:structuredClone(item)};this.latest=draft;
 this.repo.writeJournal('editor',draft);
 this.tail=this.tail.catch(()=>{}).then(()=>this.repo.put('settings',draft));this.tail.catch(e=>this.onError?.(e));
 clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush().catch(e=>this.onError?.(e)),350);return this.tail;}
 async flush(){clearTimeout(this.timer);await this.tail;const draft=this.latest;if(!draft||draft.committed)return;
 // Invalid/incomplete inputs remain durable drafts; never overwrite a valid item with them.
 const reason=this.validate?.(draft.item);if(reason){this.onSaved?.(draft.item,'入力を保存済み · '+reason);return;}
 const i=draft.item;if(!i.existing&&(await this.repo.candidates(i)).length){this.onSaved?.(i,'入力を保存済み · 重複候補を「確認して閉じる」で選択');return;}
 const work=async()=>{const current=this.latest;if(current!==draft||draft.committed)return;const id=await this.repo.saveContent(i,{expectedRevision:i.existing?i.revision:undefined});const saved=await this.repo.get('items',id);
 // A newer draft may have arrived while this transaction committed. Rebase only its revision.
 if(this.latest?.item.id===id){if(this.latest===draft)this.latest.committed=true;this.latest.item.revision=saved.revision;this.latest.item.existing=true;await this.repo.put('settings',this.latest);this.repo.writeJournal('editor',this.latest);this.onSaved?.(this.latest.item,'自動保存済み');}
 };
 this.tail=this.tail.catch(()=>{}).then(work);return this.tail;
 }
 async restore(){const stored=await this.repo.get('settings','editor-draft'),journal=this.repo.readJournal('editor');const d=journal?.item&&(!stored||journal.at>stored.at)?journal:stored;
 if(d?.item?.id){this.latest=d;await this.repo.put('settings',d);return d.item;}return null;}
 async clear(){clearTimeout(this.timer);await this.tail;this.latest=null;await this.repo.remove('settings','editor-draft');this.repo.clearJournal('editor');}
}
export async function restoreSession(repo){const journal=repo.readJournal('session');if(journal?.id&&Array.isArray(journal.queue)){const stored=await repo.get('sessions',journal.id);if(!stored||journal.updatedAt>stored.updatedAt)await repo.put('sessions',journal);}const saved=(await repo.all('sessions')).filter(s=>s.status==='running'&&Array.isArray(s.queue)).sort((a,b)=>(b.updatedAt||b.at).localeCompare(a.updatedAt||a.at))[0];if(!saved)return null;
 const entry=saved.queue[saved.index];if(entry){const record=await repo.get('records',entry.question.id);if(record){const state=await repo.get('states',record.itemId);saved.currentResult={...record,status:state.status,nextReview:state.nextReview,score:state.score};if(!saved.answers.some(r=>r.id===record.id))saved.answers.push(saved.currentResult);}}
 return saved;
}
