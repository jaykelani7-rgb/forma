import test from 'node:test';
import assert from 'node:assert/strict';
import { ThoughtHostVoice, TutorHostVoice, type ThoughtVoiceContext } from '../apps/desktop/main/tutor-host-voice';
import type { ThoughtTake, ThoughtTakes } from '../apps/desktop/main/thought-take-store';
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
const thoughtContext: ThoughtVoiceContext = {
  problemKey: thoughtTarget.problemKey, problemId: 'problem-4-a', title: 'Watermelon',
  sessionId: thoughtTarget.sessionId, profileKey: 'practicehandle', recoveryEpoch: 'notebook-a', contestMode: false,
};

function memoryTakes(): ThoughtTakes {
  const takes = new Map<string, ThoughtTake>();
  return {
    list: () => Array.from(takes.values(), ({ id, problemKey, title, recordedAt }) => ({ id, problemKey, title, recordedAt })),
    keep: take => { takes.set(take.id, take); },
    read: id => takes.get(id) ?? null,
    remove: id => { takes.delete(id); },
  };
}

test('spoken thoughts require a matching, unexpired recording grant and dispatch the audio only once', async () => {
  let time = 100;
  let providerCalls = 0;
  const voice = new ThoughtHostVoice({
    readContext: async () => thoughtContext,
    takes: memoryTakes(),
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
  let context = { ...thoughtContext };
  let providerCalls = 0;
  const voice = new ThoughtHostVoice({
    readContext: async () => context,
    takes: memoryTakes(),
    requireProvider() {},
    async requestMicrophone() {},
    async transcribe() {
      providerCalls++;
      context = { ...context, problemKey: 'contest:5:A', problemId: 'problem-5-a', sessionId: undefined };
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
    readContext: async () => thoughtContext,
    takes: memoryTakes(),
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

test('failed thought audio retries only from its original notebook, problem and profile and is cleared on verified success', async () => {
  let context = { ...thoughtContext };
  let result: 'failure' | 'change' | 'success' = 'failure';
  let providerCalls = 0;
  const voice = new ThoughtHostVoice({
    readContext: async () => context,
    takes: memoryTakes(),
    requireProvider() {},
    async requestMicrophone() {},
    async transcribe(bytes, mime) {
      providerCalls++;
      assert.deepEqual(bytes, thoughtAudio.bytes);
      assert.equal(mime, thoughtAudio.mime);
      if (result === 'failure') throw new Error('Connection unavailable.');
      if (result === 'change') context = { ...context, sessionId: 'session-changed-mid-retry' };
      return 'Move the pointer one position.';
    },
  });
  const retry = { takeId: thoughtId, requestId: nextThoughtId };

  await voice.start(thoughtTarget);
  await assert.rejects(voice.transcribe(thoughtAudio), /Connection unavailable.*Recording kept on this device/);
  const [saved] = voice.listTakes();
  assert.deepEqual(saved, { id: thoughtId, problemKey: 'contest:4:A', title: 'Watermelon', recordedAt: saved.recordedAt });

  context = { ...thoughtContext, profileKey: 'other-handle' };
  await assert.rejects(voice.retryTake(retry), /original problem and Codeforces profile/);
  context = { ...thoughtContext, problemId: 'same-key-different-record' };
  await assert.rejects(voice.retryTake(retry), /original problem and Codeforces profile/);
  context = { ...thoughtContext, recoveryEpoch: 'after-restore' };
  await assert.rejects(voice.retryTake(retry), /before a restore/);
  assert.equal(providerCalls, 1);

  context = { ...thoughtContext, sessionId: 'practice-2' };
  result = 'change';
  await assert.rejects(voice.retryTake(retry), /problem or session changed/);
  assert.equal(voice.listTakes().length, 1);
  result = 'success';
  assert.deepEqual(await voice.retryTake(retry), { text: 'Move the pointer one position.' });
  assert.deepEqual(voice.listTakes(), []);
  await assert.rejects(voice.retryTake(retry), /no longer available/);
  assert.equal(providerCalls, 3);
});

test('cancelled first attempts keep no take, cancelled retries preserve existing audio and discard works out of context', async () => {
  const takes = memoryTakes();
  let context = { ...thoughtContext };
  const voice = new ThoughtHostVoice({
    readContext: async () => context,
    takes,
    requireProvider() {},
    async requestMicrophone() {},
    async transcribe(_bytes, _mime, signal) {
      voice.cancelRequest({ requestId: takes.list().length ? nextThoughtId : thoughtId });
      assert.equal(signal.aborted, true);
      throw new Error('Provider was stopped.');
    },
  });

  await voice.start(thoughtTarget);
  await assert.rejects(voice.transcribe(thoughtAudio), /stopped/);
  assert.deepEqual(voice.listTakes(), []);
  takes.keep({ id: thoughtId, problemKey: 'contest:4:A', title: 'Watermelon', recordedAt: new Date().toISOString(), problemId: 'problem-4-a', profileKey: 'practicehandle', recoveryEpoch: 'notebook-a', bytes: thoughtAudio.bytes, mime: thoughtAudio.mime });
  await assert.rejects(voice.retryTake({ takeId: thoughtId, requestId: nextThoughtId }), /Provider was stopped/);
  assert.equal(voice.listTakes().length, 1);
  context = { ...thoughtContext, recoveryEpoch: 'after-restore' };
  voice.discardTake({ takeId: thoughtId });
  assert.deepEqual(voice.listTakes(), []);
});

test('a first thought transcription works without protected storage and reports when failure cannot retain the recording', async () => {
  let fail = false;
  let storageChecks = 0;
  const voice = new ThoughtHostVoice({
    readContext: async () => thoughtContext,
    takes: { ...memoryTakes(), keep() { storageChecks++; throw new Error('Protected recording storage is unavailable.'); } },
    requireProvider() {},
    async requestMicrophone() {},
    async transcribe() {
      if (fail) throw new Error('Connection unavailable.');
      return 'Successful transcription';
    },
  });

  await voice.start(thoughtTarget);
  assert.deepEqual(await voice.transcribe(thoughtAudio), { text: 'Successful transcription' });
  assert.equal(storageChecks, 0);
  fail = true;
  await voice.start(thoughtTarget);
  await assert.rejects(voice.transcribe(thoughtAudio), /Connection unavailable.*Recording was not kept.*Protected recording storage is unavailable/);
  assert.deepEqual(voice.listTakes(), []);
  assert.equal(storageChecks, 1);
});

test('tutor links: public HTTPS only, without renderer navigation or credential-bearing URLs',()=>{
  assert.equal(tutorExternalUrl('https://codeforces.com/contest/4/problem/A'),'https://codeforces.com/contest/4/problem/A');
  assert.equal(tutorExternalUrl('https://ai.google.dev/gemini-api/docs'),'https://ai.google.dev/gemini-api/docs');
  for(const link of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','http://example.com','https://user:secret@example.com','https://example.com:9443','https://127.0.0.1/admin','https://[::1]/','https://localhost/','https://printer.local/','https://example.com\n/path','https://example.com./'])assert.throws(()=>tutorExternalUrl(link),/HTTPS/);
});
