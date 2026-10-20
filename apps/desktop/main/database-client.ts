import { Worker } from "node:worker_threads";
import { join } from "node:path";
export class DatabaseClient {
  private worker: Worker;
  private nextId=0;
  private pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void}>();
  private failure: Error | null=null;
  constructor(path:string) {
    this.worker=new Worker(join(__dirname,'database-worker.cjs'),{workerData:{path}});
    this.worker.on('message',(reply:{id:number;value:unknown;error?:string})=>{
      const pending=this.pending.get(reply.id); this.pending.delete(reply.id);
      if (reply.error) pending?.reject(new Error(reply.error)); else pending?.resolve(reply.value);
    });
    const fail=(error:Error)=>{this.failure=error; for (const p of this.pending.values())p.reject(error);this.pending.clear();};
    this.worker.on('error',fail);
    this.worker.on('exit',()=>fail(new Error('Local storage stopped. Restart Forma Companion to recover your saved records.')));
  }
  call<T>(method:string,...args:unknown[]):Promise<T> {
    if(this.failure)return Promise.reject(this.failure);
    if(this.pending.size>=64)return Promise.reject(new Error('The local notebook is busy. Try again shortly.'));
    return new Promise((resolve,reject)=>{
      const id=++this.nextId;this.pending.set(id,{resolve:resolve as (v:unknown)=>void,reject});this.worker.postMessage({id,method,args});
    });
  }
  async close(){await this.worker.terminate();}
}
