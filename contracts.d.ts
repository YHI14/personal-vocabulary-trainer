/** Stable application boundary for replacement persistence adapters. */
export type LearningStatus = 'New'|'Learning'|'Reviewing'|'Mastered';
export type StudyMode = 'recognition'|'cloze-select'|'cloze-input'|'recall'|'production';
export interface Query { search?:string; status?:LearningStatus; type?:string; category?:string; source?:string; format?:string; batch?:string; archive?:'active'|'archived'|'all'; weak?:boolean; due?:boolean; new?:boolean; }
export interface Answer { id:string; itemId:string; sessionId:string; mode:StudyMode; correct:boolean; response:string; at?:string; grading?:'self'|'exact-normalized'; question?:unknown; }
export interface Repository {
 open():Promise<Repository>;
 get(store:string,id:string):Promise<any>;
 put(store:string,value:unknown):Promise<unknown>;
 remove(store:string,id:string):Promise<unknown>;
 all(store:string):Promise<any[]>;
 // Durable local recovery support; a remote adapter supplies its own offline implementation.
 writeJournal(id:string,value:unknown):boolean;
 readJournal(id:string):any;
 clearJournal(id:string):void;
 inspectIntegrity():Promise<number>;
 rawBackup():Promise<unknown>;
 protection(requestPermission?:boolean):Promise<{persistent:boolean;usage?:number;quota?:number}>;
 aggregate(id:string):Promise<unknown>;
 saveContent(item:unknown,options?:{event?:string;importRecord?:unknown;batchId?:string;expectedRevision?:number}):Promise<string>;
 answer(answer:Answer):Promise<unknown>;
 list(query?:Query,page?:number,size?:number,sort?:string,direction?:'next'|'prev'):Promise<{items:unknown[];total:number;page:number;pages:number}>;
 candidates(item:unknown):Promise<unknown[]>;
 markMastered(id:string,on:boolean):Promise<unknown>;
 markWeak(id:string,on:boolean):Promise<unknown>;
 archive(id:string,on:boolean):Promise<unknown>;
 records(itemId?:string,limit?:number):Promise<unknown[]>;
 stats(range?:number|'all'):Promise<unknown>;
 exportData(filter?:Query|null,options?:{history?:boolean;references?:boolean}):Promise<unknown>;
 restore(backup:unknown):Promise<void>;
}
