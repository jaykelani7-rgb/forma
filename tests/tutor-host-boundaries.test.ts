import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorHostVoice } from '../apps/desktop/main/tutor-host-voice';
import { tutorExternalUrl } from '../packages/tutor/links';

test('host voice: cancellation during asynchronous setup rejects the late result and preserves a newer lease',async()=>{
  const voice=new TutorHostVoice(),old=voice.begin();
  let release:()=>void=()=>{};
  const pending=(async()=>{await new Promise<void>(resolve=>{release=resolve;});old.assertCurrent();return 'must not transcribe';})();
  voice.cancel();const next=voice.begin();old.finish();release();
  await assert.rejects(pending,/stopped/);assert.equal(old.signal.aborted,true);next.assertCurrent();
  voice.cancel();assert.equal(next.signal.aborted,true);assert.throws(next.assertCurrent,/stopped/);
});

test('host voice: starting another request cancels playback/transcription ownership',()=>{
  const voice=new TutorHostVoice(),first=voice.begin(),second=voice.begin();
  assert.equal(first.signal.aborted,true);assert.throws(first.assertCurrent,/stopped/);second.assertCurrent();second.finish();
  assert.throws(second.assertCurrent,/stopped/);
});

test('tutor links: public HTTPS only, without renderer navigation or credential-bearing URLs',()=>{
  assert.equal(tutorExternalUrl('https://codeforces.com/contest/4/problem/A'),'https://codeforces.com/contest/4/problem/A');
  assert.equal(tutorExternalUrl('https://ai.google.dev/gemini-api/docs'),'https://ai.google.dev/gemini-api/docs');
  for(const link of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','http://example.com','https://user:secret@example.com','https://example.com:9443','https://127.0.0.1/admin','https://[::1]/','https://localhost/','https://printer.local/','https://example.com\n/path','https://example.com./'])assert.throws(()=>tutorExternalUrl(link),/HTTPS/);
});
