import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorVoiceController, recordedAudioMime, speechAudioMime, TUTOR_RECORDING_LIMITS } from '../apps/desktop/renderer/tutor-voice';
import { mergeTutorTurns, tutorNearBottom, tutorContentRevision } from '../apps/desktop/renderer/tutor-stream-view';
import { tutorExternalUrl } from '../apps/desktop/renderer/tutor-rendering-policy';
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
test('voice: choose supported browser recording formats and play documented wrapped audio, never raw PCM',()=>{
  assert.equal(recordedAudioMime(mime=>mime==='audio/mp4'),'audio/mp4');
  assert.equal(recordedAudioMime(()=>false),null);
  assert.equal(speechAudioMime('audio/wav'),'audio/wav');
  assert.equal(speechAudioMime('audio/mpeg; charset=binary'),'audio/mpeg');
  assert.equal(speechAudioMime('audio/L16;codec=pcm;rate=24000'),null);
  assert.equal(speechAudioMime('text/html'),null);
  assert.equal(TUTOR_RECORDING_LIMITS.durationMs,60_000);assert.equal(TUTOR_RECORDING_LIMITS.bytes,8*1024*1024);
});
test('conversation scroll: only follow within 64px; metadata/exposure acknowledgements do not create new content',()=>{
  assert.equal(tutorNearBottom({scrollHeight:1000,clientHeight:300,scrollTop:640}),true);
  assert.equal(tutorNearBottom({scrollHeight:1000,clientHeight:300,scrollTop:500}),false);
  const turn={id:'turn',requestId:'request',assistantText:'One observation',status:'streaming',exposed:false} as TutorTurn;
  assert.equal(tutorContentRevision([turn]),tutorContentRevision([{...turn,exposed:true}]));
  assert.notEqual(tutorContentRevision([turn]),tutorContentRevision([{...turn,assistantText:'One observation and another'}]));
  assert.notEqual(tutorContentRevision([turn]),tutorContentRevision([{...turn,requestId:'retry'}]));
});
test('Markdown URLs are explicit HTTPS host actions; credentials, local files and executable schemes cannot become buttons',()=>{
  assert.equal(tutorExternalUrl('https://codeforces.com/problemset/problem/4/A'),'https://codeforces.com/problemset/problem/4/A');
  for(const unsafe of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','http://example.com','/relative','https://user:secret@example.com/','https://example.com:3001/'])assert.equal(tutorExternalUrl(unsafe),null,unsafe);
});
