import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startTransport, sameCredential } from '../apps/desktop/main/transport';
test('paired socket rejects unauthenticated input and acknowledges only after durable application',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'forma-sock-'));const endpoint=join(directory,'companion.sock');
  const secret=randomBytes(32).toString('base64url');let durable=false;let calls=0;
  const server=await startTransport({endpoint,credential:()=>secret,command:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));durable=true;return {revision:7};},action:async()=>7,context:async()=>({identity:'contest:4:A',sessionId:'s'}),connected:()=>{}});
  async function request(credential:string,id:string){
    return new Promise<Record<string,unknown>>((resolve,reject)=>{
      const socket=connect(endpoint);socket.on('error',reject);socket.setTimeout(2000,()=>{socket.destroy();reject(new Error('timeout'));});
      socket.on('connect',()=>socket.write(JSON.stringify({version:1,id,credential,command:{id,type:'pause',payload:{}}})+'\n'));
      socket.on('data',chunk=>{const result=JSON.parse(chunk.toString());socket.end();resolve(result);});
    });
  }
  try{
    if(process.platform!=='win32')assert.equal(statSync(endpoint).mode&0o777,0o600);
    assert.equal((await request(randomBytes(32).toString('base64url'),'bad')).ok,false);assert.equal(calls,0);
    const result=await request(secret,'good');assert.equal(result.ok,true);assert.equal(durable,true);assert.equal(result.revision,7);assert.equal(result.identity,'contest:4:A');
    assert.equal(sameCredential(null,secret),false);assert.equal(sameCredential(secret,secret),true);
  }finally{server.close();rmSync(directory,{recursive:true,force:true});}
});
