import test from 'node:test';
import assert from 'node:assert/strict';
import { ThoughtHostVoice, TutorHostVoice, type ThoughtVoiceContext } from '../apps/desktop/main/tutor-host-voice';
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

const thoughtId = '02015ae8-5b25-47bb-bc05-00093eb3c915';
const nextThoughtId = 'd2af5286-7481-4000-9213-9d3db1527653';
const thoughtTarget = { requestId: thoughtId, problemKey: 'contest:4:A', sessionId: 'practice-1' };
const thoughtAudio = { requestId: thoughtId, mime: 'audio/webm;codecs=opus', bytes: new Uint8Array([1, 2, 3]) };

test('spoken thoughts require a matching, unexpired recording grant and dispatch the audio only once', async () => {
  let time = 100;
  let providerCalls = 0;
  const voice = new ThoughtHostVoice({
    readContext: async () => ({ problemKey: 'contest:4:A', sessionId: 'practice-1', contestMode: false }),
    requireProvider() {},
    async requestMicrophone() {},
    async transcribe(bytes, mime) {
      providerCalls++;
      assert.deepEqual(bytes, thoughtAudio.bytes);
      assert.equal(mime, thoughtAudio.mime);
      return 'Try keeping the two cases separate.';
    },
  }, () => time);

  await assert.rejects(voice.transcribe(thoughtAudio), /Start a new recording/);
  assert.deepEqual(await voice.start(thoughtTarget), { allowed: true });
  assert.equal(voice.microphoneAllowed, true);
  await assert.rejects(voice.transcribe({ ...thoughtAudio, requestId: nextThoughtId }), /Start a new recording/);
  await assert.rejects(voice.transcribe({ ...thoughtAudio, mime: 'video/webm' }), /supported, nonempty recording/);
  time += 110_000;
  assert.equal(voice.microphoneAllowed, false);
  assert.deepEqual(await voice.transcribe(thoughtAudio), { text: 'Try keeping the two cases separate.' });
  await assert.rejects(voice.transcribe(thoughtAudio), /Start a new recording/);
  await voice.start(thoughtTarget);
  time += 135_000;
  await assert.rejects(voice.transcribe(thoughtAudio), /expired/);
  assert.equal(providerCalls, 1);
});

test('spoken thoughts check the captured problem and session before sending and after the provider returns', async () => {
  let context: ThoughtVoiceContext = { problemKey: 'contest:4:A', sessionId: 'practice-1', contestMode: false };
  let providerCalls = 0;
  const voice = new ThoughtHostVoice({
    readContext: async () => context,
    requireProvider() {},
    async requestMicrophone() {},
    async transcribe() {
      providerCalls++;
      context = { problemKey: 'contest:5:A', contestMode: false };
      return 'Belongs to the previous problem.';
    },
  });

  await voice.start(thoughtTarget);
  context = { ...context, sessionId: 'practice-2' };
  await assert.rejects(voice.transcribe(thoughtAudio), /problem or session changed/);
  assert.equal(providerCalls, 0);
  context = { ...context, sessionId: 'practice-1' };
  await voice.start(thoughtTarget);
  await assert.rejects(voice.transcribe(thoughtAudio), /problem or session changed/);
  assert.equal(providerCalls, 1);
  assert.equal(voice.microphoneAllowed, false);
});

test('spoken thoughts ignore late permission results and stale cancellation for a previous recording', async () => {
  let release = () => {};
  let microphoneRequested = () => {};
  const permissionRequested = new Promise<void>(resolve => { microphoneRequested = resolve; });
  const pendingPermission = new Promise<void>(resolve => { release = resolve; });
  let permissionRequests = 0;
  const voice = new ThoughtHostVoice({
    readContext: async () => ({ problemKey: 'contest:4:A', sessionId: 'practice-1', contestMode: false }),
    requireProvider() {},
    async requestMicrophone() {
      if (++permissionRequests === 1) {
        microphoneRequested();
        await pendingPermission;
      }
    },
    async transcribe() { return 'Second recording'; },
  });

  const first = voice.start(thoughtTarget);
  await permissionRequested;
  voice.cancelRequest({ requestId: thoughtId });
  await voice.start({ ...thoughtTarget, requestId: nextThoughtId });
  const rejected = assert.rejects(first, /stopped/);
  release();
  await rejected;
  voice.cancelRequest({ requestId: thoughtId });
  assert.equal(voice.microphoneAllowed, true);
  assert.deepEqual(await voice.transcribe({ ...thoughtAudio, requestId: nextThoughtId }), { text: 'Second recording' });
});

test('tutor links: public HTTPS only, without renderer navigation or credential-bearing URLs',()=>{
  assert.equal(tutorExternalUrl('https://codeforces.com/contest/4/problem/A'),'https://codeforces.com/contest/4/problem/A');
  assert.equal(tutorExternalUrl('https://ai.google.dev/gemini-api/docs'),'https://ai.google.dev/gemini-api/docs');
  for(const link of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','http://example.com','https://user:secret@example.com','https://example.com:9443','https://127.0.0.1/admin','https://[::1]/','https://localhost/','https://printer.local/','https://example.com\n/path','https://example.com./'])assert.throws(()=>tutorExternalUrl(link),/HTTPS/);
});
