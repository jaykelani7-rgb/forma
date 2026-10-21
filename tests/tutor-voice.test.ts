import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorVoiceController } from '../apps/desktop/renderer/tutor-voice';
import { mergeTutorTurns } from '../apps/desktop/renderer/tutor-stream-view';
import type { TutorTurn, TutorTurnStatus } from '../packages/tutor/types';

test('voice cancellation invalidates late permission/transcription/playback and releases each owned resource once',()=>{
  const voice=new TutorVoiceController();const request=voice.begin();let tracks=0,audio=0,urls=0;
  const release=voice.own(request,()=>tracks++);voice.own(request,()=>audio++);voice.own(request,()=>urls++);
  release();voice.cancel();voice.cancel();assert.deepEqual([tracks,audio,urls],[1,1,1]);assert.equal(voice.current(request),false);
  let lateTracks=0;voice.own(request,()=>lateTracks++);assert.equal(lateTracks,1);
});
test('new push-to-talk generation cancels playback and a stale callback cannot remain current',()=>{
  const voice=new TutorVoiceController();const speech=voice.begin();let paused=false;voice.own(speech,()=>{paused=true;});
  const recording=voice.begin();assert.equal(paused,true);assert.equal(voice.current(speech),false);assert.equal(voice.current(recording),true);
  let deniedCleanup=0;voice.own(recording,()=>{deniedCleanup++;throw new Error('denied');});let nextCleanup=0;voice.own(recording,()=>nextCleanup++);voice.cancel();assert.equal(deniedCleanup,1);assert.equal(nextCleanup,1);
});
test('stream view: late initial snapshot cannot erase early text or revive a completed/stopped request',()=>{
  const row=(assistantText:string,status:TutorTurnStatus='streaming',requestId='request-one')=>({id:'turn-one',requestId,assistantText,status,exposed:false} as TutorTurn);
  assert.equal(mergeTutorTurns([row('First useful hint')],[row('First')])[0].assistantText,'First useful hint');
  assert.equal(mergeTutorTurns([row('Complete','completed')],[row('','queued')])[0].status,'completed');
  assert.equal(mergeTutorTurns([row('Partial','interrupted')],[row('Partial','streaming')])[0].status,'interrupted');
  const retried=mergeTutorTurns([row('Prior response','interrupted')],[row('New','streaming','request-two')])[0];assert.equal(retried.assistantText,'New');assert.equal(retried.status,'streaming');
});
