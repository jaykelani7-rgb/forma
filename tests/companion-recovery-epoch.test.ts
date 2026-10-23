import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureRecoveryEpoch, requireCaptureRecoveryEpoch } from '../packages/integrations/queue';
import { parseTransportRequest } from '../packages/integrations/protocol';
import { startTransport } from '../apps/desktop/main/transport';

test('queued capture recovery epochs survive ordinary restart and require explicit review after replacement',()=>{
  assert.equal(requireCaptureRecoveryEpoch('persistent-epoch','persistent-epoch'),'persistent-epoch');
  for(const saved of [null,undefined,'legacy-unknown','before-restore'])assert.throws(()=>requireCaptureRecoveryEpoch(saved,'after-restore'),/Review the saved capture/);
  for(const current of [null,undefined,42,'bad/epoch'])assert.throws(()=>requireCaptureRecoveryEpoch('before-restore',current),/Update Forma Companion/);
  assert.equal(captureRecoveryEpoch('valid:epoch-123'),'valid:epoch-123');assert.equal(captureRecoveryEpoch('x'.repeat(121)),null);
});

test('the strict integration envelope accepts recovery epochs only on command requests',()=>{
  const envelope={version:1,id:'capture',credential:'x'.repeat(64),command:{id:'capture',type:'thought',payload:{text:'Saved question'}}};
  assert.equal(parseTransportRequest(JSON.stringify({...envelope,expectedRecoveryEpoch:'current-epoch'})).expectedRecoveryEpoch,'current-epoch');
  for(const expectedRecoveryEpoch of [42,'','bad/epoch'])assert.throws(()=>parseTransportRequest(JSON.stringify({...envelope,expectedRecoveryEpoch})),/recovery epoch/);
  assert.throws(()=>parseTransportRequest(JSON.stringify({version:1,id:'ping',credential:envelope.credential,action:'ping',expectedRecoveryEpoch:'current-epoch'})),/recovery epoch/);
});

test('a fresh command socket cannot deliver an old queued capture after the ping epoch changed',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'forma-capture-epoch-')),endpoint=join(directory,'companion.sock');
  const credential='x'.repeat(64);let epoch='before-restore',calls=0,received:string|undefined;
  const server=await startTransport({endpoint,credential:()=>credential,recoveryEpoch:()=>epoch,command:async(_command,expected)=>{calls++;received=expected;return {revision:2};},action:async()=>1,context:async()=>({identity:null,sessionId:null,recoveryEpoch:epoch}),connected:()=>{}});
  const request=(value:Record<string,unknown>)=>new Promise<Record<string,unknown>>((resolve,reject)=>{
    const socket=connect(endpoint);socket.on('error',reject);socket.setTimeout(2000,()=>{socket.destroy();reject(new Error('timeout'));});socket.on('connect',()=>socket.write(JSON.stringify({version:1,id:'capture',credential,...value})+'\n'));socket.on('data',chunk=>{socket.end();resolve(JSON.parse(chunk.toString()));});
  });
  try{
    const ping=await request({action:'ping'});assert.equal(ping.recoveryEpoch,'before-restore');epoch='after-restore';
    const command={id:'stable-capture',type:'thought',payload:{text:'Original saved text'}};
    const stale=await request({command,expectedRecoveryEpoch:ping.recoveryEpoch});assert.equal(stale.ok,false);assert.match(String(stale.error),/notebook was restored/);assert.equal(calls,0);
    const reviewed=await request({command,expectedRecoveryEpoch:epoch});assert.equal(reviewed.ok,true);assert.equal(calls,1);assert.equal(received,'after-restore');assert.equal(command.id,'stable-capture');
  }finally{server.close();rmSync(directory,{recursive:true,force:true});}
});
