import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CompanionStore } from '../../apps/desktop/main/store';
import { emptyData } from '../../src/lib/model';
import { encodeBackup } from '../../src/lib/concurrency';
const folder=mkdtempSync(join(tmpdir(),'forma-benchmark-'));
const store=new CompanionStore(join(folder,'notebook.sqlite'));
try{
  const data=emptyData();
  const stamp='2026-10-01T10:00:00.000Z';
  data.problems=Array.from({length:1000},(_,i)=>({id:`benchmark:${i}`,title:`Representative problem ${i}`,platform:'Codeforces',url:`https://codeforces.com/contest/${1000+i}/problem/A`,problemCode:`${1000+i}A`,tags:[],rating:null,createdAt:stamp,reviewAt:null,reviewCount:0}));
  data.attempts=Array.from({length:3000},(_,i)=>({id:`benchmark-attempt:${i}`,problemId:data.problems[i%1000].id,startedAt:stamp,completedAt:'2026-10-01T10:15:00.000Z',elapsedMs:900000,outcome:'hint' as const,difficulty:'approach' as const,takeaway:'A retained learning observation. '.repeat(8),notes:'A private practice note. '.repeat(20)}));
  const notebook=encodeBackup(data);
  store.importNotebook(notebook);
  store.command({id:'benchmark-attach',type:'attach',payload:{url:data.problems[0].url}});
  const samples:number[]=[];
  for(let i=0;i<30;i++){const before=performance.now();store.command({id:`benchmark-note:${i}`,type:'thought',payload:{text:'A measured durable thought.'}});samples.push(performance.now()-before);}
  samples.sort((a,b)=>a-b);
  console.log(JSON.stringify({problems:1000,attempts:3000,notebookBytes:Buffer.byteLength(notebook),durableSaveP95Ms:samples[Math.ceil(samples.length*.95)-1],samples:30},null,2));
}finally{store.close();rmSync(folder,{recursive:true,force:true});}
