import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand, parseEvent, MAX_MESSAGE_BYTES } from "../packages/contracts/src/index";
import { emptyData, validateData, localDate, addDays } from "../src/lib/model";
import { applyCompanionCommand, applySubmissionEvidence, getCompanionView, initialCompanionState, invalidateLocalTests, pauseCompanionForLifecycle, validateCompanionState, type CompanionSnapshot } from "../packages/core/src/companion";
import type { CompanionCommand } from "../packages/contracts/src/index";
import type { SubmissionInput } from "../src/lib/codeforces-types";

const startTime = Date.parse("2026-10-19T04:30:00.000Z");
function send(snapshot: CompanionSnapshot, command: CompanionCommand, now = startTime) { return applyCompanionCommand(snapshot.data, snapshot.state, command, now); }
function attached(url = "https://codeforces.com/contest/1700/problem/A1") {
  return send({ data: emptyData(), state: initialCompanionState() }, { id: "attach-a", type: "attach", payload: { url, fileUri: "file:///practice/A.cpp" } });
}
function submission(verdict: string | null, id = 123): SubmissionInput {
  return { id, submittedAt: new Date(startTime + 60000).toISOString(), verdict, language: "C++23", problem: { key: "contest:1700:A1", code: "1700A1", url: "https://codeforces.com/contest/1700/problem/A1", title: "A", rating: null, tags: [] } };
}
test("companion contracts reject privileged, unknown, oversized and malformed input", () => {
  for (const input of [null, { id: "x", type: "exec", payload: {} }, { id: "x", type: "pause", payload: { shell: "anything" } }, { id: "x", type: "start", payload: { durationMinutes: 0 } }, { id: "x", type: "attach", payload: { url: "https://codeforces.com/contest/1/problem/A", fileUri: "file://other-host/source.cpp" } }, { id: "x", type: "thought", payload: { text: "a".repeat(MAX_MESSAGE_BYTES) } }, { id: "x", type: "defer", payload: { until: "2026-02-30" } }]) assert.throws(() => parseCommand(input));
  assert.throws(() => parseEvent({ eventVersion: 2 }));
});
test("manual attachment preserves full namespace and split index; file reuse needs a real context switch", () => {
  const a1 = attached();
  assert.equal(a1.state.identity, "contest:1700:A1");
  const gym = send(a1, { id: "gym", type: "attach", payload: { url: "https://codeforces.com/gym/1700/problem/A1", fileUri: "file:///practice/A.cpp" } });
  assert.equal(gym.data.problems.length, 2);
  assert.equal(gym.state.identity, "gym:1700:A1");
  assert.equal(gym.state.bindings.length, 1);
  assert.equal(gym.state.bindings[0].problemId, gym.state.problemId);
  const a2 = send(gym, { id: "a2", type: "attach", payload: { url: "https://codeforces.com/contest/1700/problem/A2" } });
  assert.equal(a2.data.problems.length, 3);
  assert.throws(() => send(a2, { id: "bad", type: "attach", payload: { url: "https://evil.example/1700/A1" } }));
  assert.throws(() => send(a2, { id: "old-note", type: "thought", expectedProblemKey: "contest:1700:A1", payload: { text: "old context" } }), /problem changed/);
});
test("thoughts and Codeforces acceptance do not fabricate attempts or independent learning", () => {
  let snapshot = attached();
  snapshot = send(snapshot, { id: "note", type: "thought", payload: { text: "Try sorting first" } });
  assert.equal(snapshot.data.attempts.length, 0);
  assert.equal(snapshot.data.session, null);
  assert.equal(snapshot.state.thoughts[0].text, "Try sorting first");
  assert.throws(() => send(snapshot, { id: "fake", type: "reflect", payload: { outcome: "independent" } }), /timed session/);
  snapshot = send(snapshot, { id: "handle", type: "set-handle", payload: { handle: "tourist" } });
  snapshot = send(snapshot, { id: "start", type: "start", payload: {} });
  const accepted = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "tourist", submissions: [submission("OK")], checkedAt: new Date(startTime + 61000).toISOString() });
  assert.equal(accepted.state.platform, "accepted");
  assert.equal(accepted.state.learning, "unrecorded");
  assert.equal(accepted.data.attempts.length, 0);
  const wrong = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "someone_else", submissions: [submission("OK")], checkedAt: new Date(startTime + 61000).toISOString() });
  assert.equal(wrong.state.platform, "unknown");
});
test("real session pause, suspend and reflection use the existing measured duration and review rules", () => {
  let snapshot = attached();
  snapshot = send(snapshot, { id: "start", type: "start", payload: { durationMinutes: 15 } });
  snapshot = send(snapshot, { id: "pause", type: "pause", payload: {} }, startTime + 60000);
  snapshot = send(snapshot, { id: "resume", type: "resume", payload: {} }, startTime + 600000);
  snapshot = pauseCompanionForLifecycle(snapshot.data, snapshot.state, startTime + 660000);
  snapshot = send(snapshot, { id: "finish", type: "finish", payload: {} }, startTime + 720000);
  snapshot = send(snapshot, { id: "reflect", type: "reflect", payload: { outcome: "editorial", takeaway: "Keep the invariant", mistakes: ["invariant"] } }, startTime + 780000);
  assert.equal(snapshot.data.attempts[0].elapsedMs, 120000);
  assert.equal(snapshot.data.attempts[0].id, "companion:start");
  assert.equal(snapshot.data.attempts[0].outcome, "editorial");
  assert.equal(snapshot.data.problems[0].reviewAt, "2026-10-22");
  assert.equal(snapshot.data.session, null);
  assert.equal(snapshot.state.learning, "editorial");
  assert.deepEqual(validateData(snapshot.data), snapshot.data);
  assert.deepEqual(validateCompanionState(snapshot.state, snapshot.data), snapshot.state);
});
test("rejudges update platform evidence and retain the user's reflection", () => {
  let snapshot = attached();
  snapshot = send(snapshot, { id: "handle", type: "set-handle", payload: { handle: "tourist" } });
  snapshot = send(snapshot, { id: "start", type: "start", payload: {} });
  snapshot = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "tourist", submissions: [submission("OK")], checkedAt: new Date(startTime + 61000).toISOString() });
  snapshot = send(snapshot, { id: "reflect", type: "reflect", payload: { outcome: "hint", takeaway: "Hint was useful" } }, startTime + 120000);
  snapshot = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "tourist", submissions: [submission("WRONG_ANSWER")], checkedAt: new Date(startTime + 180000).toISOString() });
  assert.equal(snapshot.state.platform, "rejected");
  assert.equal(snapshot.state.learning, "hint");
  assert.equal(snapshot.state.submissions.length, 1);
  assert.equal(snapshot.data.attempts[0].takeaway, "Hint was useful");
});
test("a stale local pass and recall remain separate from coding credit", () => {
  let snapshot = attached();
  snapshot = { ...snapshot, state: { ...snapshot.state, localTests: "passed" } };
  assert.equal(invalidateLocalTests(snapshot.state, "file:///another/B.cpp").localTests, "passed");
  assert.equal(invalidateLocalTests(snapshot.state, "file:///practice/A.cpp").localTests, "stale");
  snapshot = send(snapshot, { id: "recall", type: "recall", payload: { activity: "explain", outcome: "cue", response: "Sort and sweep", cue: "What changes at each boundary?" } });
  assert.equal(snapshot.data.attempts.length, 0);
  assert.equal(snapshot.data.revisions?.[0].nextReviewAt, "2026-10-22");
  assert.equal(getCompanionView(snapshot.data, snapshot.state, startTime + 4 * 86400000).due.length, 1);
  assert.throws(() => validateCompanionState({ ...snapshot.state, identity: "contest:1700:A2" }, snapshot.data), /identity changed/);
});

test("capacity rejection preserves every captured thought and binding", () => {
  const snapshot = attached();
  const thoughts = Array.from({ length: 1000 }, (_, i) => ({ id: `thought-${i}`, problemId: snapshot.state.problemId!, text: `Thought ${i}`, createdAt: new Date(startTime).toISOString() }));
  const full = { ...snapshot, state: { ...snapshot.state, thoughts } };
  assert.throws(() => send(full, { id: "overflow", type: "thought", payload: { text: "One more" } }), /1,000 thought limit/);
  assert.equal(full.state.thoughts.length, 1000);
  assert.equal(full.state.thoughts[0].text, "Thought 0");
  const bindings = Array.from({ length: 500 }, (_, i) => ({ id: `binding-${i}`, problemId: snapshot.state.problemId!, identity: snapshot.state.identity!, fileUri: `file:///practice/${i}.cpp`, confirmedAt: new Date(startTime).toISOString() }));
  const bound = { ...snapshot, state: { ...snapshot.state, bindings } };
  assert.throws(() => send(bound, { id: "overflow", type: "attach", payload: { url: snapshot.data.problems[0].url, fileUri: "file:///practice/new.cpp" } }), /binding limit/);
  assert.equal(bound.state.bindings.length, 500);
  assert.equal(send(bound, { id: "replace", type: "attach", payload: { url: snapshot.data.problems[0].url, fileUri: "file:///practice/0.cpp" } }).state.bindings.length, 500);
});

test("an old accepted submission cannot accept a later session and its provenance cannot be reassigned", () => {
  let snapshot = attached();
  snapshot = send(snapshot, { id: "handle", type: "set-handle", payload: { handle: "tourist" } });
  snapshot = send(snapshot, { id: "first", type: "start", payload: {} });
  snapshot = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "tourist", submissions: [submission("OK")], checkedAt: new Date(startTime + 61000).toISOString() });
  snapshot = send(snapshot, { id: "reflect", type: "reflect", payload: { outcome: "independent" } }, startTime + 120000);
  snapshot = send(snapshot, { id: "second", type: "start", payload: {} }, startTime + 300000);
  const moved = { ...submission("OK"), submittedAt: new Date(startTime + 360000).toISOString() };
  snapshot = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "tourist", submissions: [moved], checkedAt: new Date(startTime + 361000).toISOString() });
  assert.equal(snapshot.state.platform, "unknown");
  assert.equal(snapshot.state.submissions[0].submittedAt, submission("OK").submittedAt);
  const fresh = { ...submission("WRONG_ANSWER", 124), submittedAt: new Date(startTime + 360000).toISOString() };
  snapshot = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "tourist", submissions: [fresh], checkedAt: new Date(startTime + 362000).toISOString() });
  assert.equal(snapshot.state.platform, "rejected");
  const stale = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "tourist", submissions: [{ ...fresh, verdict: "OK" }], checkedAt: new Date(startTime + 361000).toISOString() });
  assert.equal(stale.state.platform, "rejected");
  assert.equal(stale.data.attempts.length, 1);
});

test("backward clocks and recovery at the last durable timestamp never add downtime", () => {
  let snapshot = send(attached(), { id: "start", type: "start", payload: {} });
  const backwards = pauseCompanionForLifecycle(snapshot.data, snapshot.state, startTime - 10000);
  assert.equal(backwards.data.session?.elapsedMs, 0);
  // A host recovering at a much later wall time supplies the last durable time.
  snapshot = pauseCompanionForLifecycle(snapshot.data, snapshot.state, startTime + 30000);
  assert.equal(getCompanionView(snapshot.data, snapshot.state, startTime + 86400000).session?.elapsedMs, 30000);
  assert.throws(() => send(snapshot, { id: "stale-session", type: "finish", expectedSessionId: "another-session", payload: {} }), /session changed/);
});

test("observation contracts reject forged local result sources and malformed submission payloads", () => {
  const envelope = { eventId: "event-1", eventVersion: 1, deviceId: "device", workspaceKey: "personal", producer: "vscode", producerVersion: "1.0", occurredAt: new Date(startTime).toISOString(), receivedAt: new Date(startTime).toISOString(), correlationId: "context" };
  assert.throws(() => parseEvent({ ...envelope, eventType: "LocalTestsObserved", payload: { fileUri: "file:///practice/A.cpp", sourceRevision: "hash", status: "passed", source: "file-save" } }), /real supported result/);
  assert.throws(() => parseEvent({ ...envelope, eventType: "SubmissionObserved", payload: { id: 1, handle: "tourist", identity: "contest:1:A", verdict: "OK", submittedAt: "not a date" } }), /submission observation/);
  assert.equal(parseEvent({ ...envelope, eventType: "SourceChanged", payload: { fileUri: "file:///practice/A.cpp", revision: "hash" } }).eventType, "SourceChanged");
});

test("overlapping offline timed attempts keep platform submissions unassigned", () => {
  let snapshot = attached();
  snapshot = send(snapshot, { id: "handle", type: "set-handle", payload: { handle: "tourist" } });
  snapshot = send(snapshot, { id: "active", type: "start", payload: {} });
  snapshot = { ...snapshot, data: { ...snapshot.data, attempts: [{ id: "offline-other-device", problemId: snapshot.state.problemId!, startedAt: new Date(startTime - 60000).toISOString(), completedAt: new Date(startTime + 120000).toISOString(), elapsedMs: 180000, outcome: "hint", difficulty: null, takeaway: "Imported offline session", notes: "" }] } };
  const result = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "tourist", submissions: [submission("OK")], checkedAt: new Date(startTime + 61000).toISOString() });
  assert.equal(result.state.platform, "unknown");
  assert.equal(result.state.submissions.length, 0);
  assert.equal(result.data.attempts[0].takeaway, "Imported offline session");
});

test("switching handles detaches a foreign profile problem and cannot alter its learning", () => {
  let snapshot = send(attached(), { id: "alice", type: "set-handle", payload: { handle: "alice" } });
  snapshot = { ...snapshot, data: { ...snapshot.data, problems: snapshot.data.problems.map((p) => ({ ...p, cfHandle: "alice", cfKey: snapshot.state.identity! })) } };
  const aliceState = snapshot.state;
  snapshot = send(snapshot, { id: "bob", type: "set-handle", payload: { handle: "bobby" } });
  assert.equal(snapshot.state.problemId, null);
  assert.equal(snapshot.state.identity, null);
  assert.throws(() => send(snapshot, { id: "start-bob", type: "start", payload: {} }), /Attach/);
  const inconsistent = { ...snapshot, state: { ...aliceState, handle: "bobby" } };
  assert.throws(() => send(inconsistent, { id: "recall-bob", type: "recall", payload: { activity: "explain", outcome: "independent", response: "Idea", cue: "" } }), /another Codeforces profile/);
  assert.equal(snapshot.data.problems[0].cfHandle, "alice");
  assert.equal(snapshot.data.attempts.length, 0);
  assert.equal(snapshot.data.revisions?.length, 0);
});

test("reattaching an imported problem keeps its open session even when a manual duplicate exists", () => {
  let snapshot = send(attached(), { id: "alice", type: "set-handle", payload: { handle: "alice" } });
  const scoped = { ...snapshot.data.problems[0], cfHandle: "alice", cfKey: snapshot.state.identity! };
  snapshot = { ...snapshot, data: { ...snapshot.data, problems: [scoped, { ...snapshot.data.problems[0], id: "manual-duplicate" }] } };
  snapshot = send(snapshot, { id: "scoped-session", type: "start", payload: {} });
  snapshot = send(snapshot, { id: "reattach", type: "attach", payload: { url: scoped.url, fileUri: "file:///practice/imported.cpp" } });
  assert.equal(snapshot.state.problemId, scoped.id);
  assert.equal(snapshot.data.session?.problemId, scoped.id);
  snapshot = send(snapshot, { id: "finish-scoped", type: "finish", payload: {} }, startTime + 60000);
  assert.equal(snapshot.data.session?.phase, "reflection");
});

test("a restored notebook cannot reuse a completed session ID and overwrite its reflection", () => {
  let snapshot = send(attached(), { id: "stable-start", type: "start", payload: {} });
  snapshot = send(snapshot, { id: "first-reflection", type: "reflect", payload: { outcome: "editorial", notes: "Keep this original learning" } }, startTime + 60000);
  const preserved = structuredClone(snapshot.data.attempts[0]);
  assert.throws(() => send(snapshot, { id: "stable-start", type: "start", payload: {} }, startTime + 120000), /already belongs to a saved attempt/);
  assert.deepEqual(snapshot.data.attempts[0], preserved);
});

test("saved submission attribution cannot point at an unrelated or later timed session", () => {
  let snapshot = send(attached(), { id: "handle", type: "set-handle", payload: { handle: "tourist" } });
  snapshot = send(snapshot, { id: "first", type: "start", payload: {} });
  snapshot = applySubmissionEvidence(snapshot.data, snapshot.state, { handle: "tourist", submissions: [submission("OK")], checkedAt: new Date(startTime + 61000).toISOString() });
  snapshot = send(snapshot, { id: "reflect", type: "reflect", payload: { outcome: "hint" } }, startTime + 120000);
  snapshot = send(snapshot, { id: "later", type: "start", payload: {} }, startTime + 300000);
  assert.throws(() => validateCompanionState({ ...snapshot.state, submissions: snapshot.state.submissions.map((s) => ({ ...s, sessionId: "missing" })) }, snapshot.data), /recorded session/);
  assert.throws(() => validateCompanionState({ ...snapshot.state, submissions: snapshot.state.submissions.map((s) => ({ ...s, sessionId: snapshot.data.session!.id })) }, snapshot.data), /recorded session/);
});

test("versioned batch observations validate projected submission provenance before journaling", () => {
  const envelope = { eventId: "batch-1", eventVersion: 1, eventType: "SubmissionBatchObserved", deviceId: "device", workspaceKey: "personal", producer: "codeforces", producerVersion: "public-api-v1", occurredAt: new Date(startTime + 61000).toISOString(), receivedAt: new Date(startTime + 61000).toISOString(), correlationId: "check-1" };
  const observed = { id: 123, handle: "tourist", identity: "contest:1700:A1", verdict: "OK", submittedAt: new Date(startTime + 60000).toISOString(), observedAt: new Date(startTime + 61000).toISOString(), sessionId: "companion:start" };
  const payload = { handle: "tourist", checkedAt: envelope.receivedAt, submissions: [observed] };
  assert.equal(parseEvent({ ...envelope, payload }).eventType, "SubmissionBatchObserved");
  assert.throws(() => parseEvent({ ...envelope, payload: { ...payload, submissions: [observed, observed] } }), /submission observation/);
  assert.throws(() => parseEvent({ ...envelope, payload: { ...payload, submissions: [{ ...observed, handle: "wrong-handle" }] } }), /submission observation/);
});
test("pet suggestions obey shared due dates, skips, deferrals and independent recall schedules",()=>{
  let snapshot=send(attached(),{id:'start-schedule',type:'start',payload:{}});
  snapshot=send(snapshot,{id:'reflect-schedule',type:'reflect',payload:{outcome:'hint'}},startTime+60000);
  assert.equal(getCompanionView(snapshot.data,snapshot.state,startTime+120000).due.length,0);
  const later=addDays(new Date(startTime),6).getTime();
  assert.equal(getCompanionView(snapshot.data,snapshot.state,later).due.length,1);
  const changed=(patch:object)=>({...snapshot.data,problems:snapshot.data.problems.map(p=>({...p,...patch}))});
  assert.equal(getCompanionView(changed({deferredUntil:localDate(addDays(new Date(later),1))}),snapshot.state,later).due.length,0);
  assert.equal(getCompanionView(changed({skippedOn:localDate(new Date(later))}),snapshot.state,later).due.length,0);
  assert.equal(getCompanionView(changed({archived:true}),snapshot.state,later).due.length,0);
  snapshot=send(snapshot,{id:'recall-schedule',type:'recall',payload:{activity:'explain',outcome:'unrecalled',response:'Need another look',cue:''}},startTime+120000);
  // Tomorrow's written recall remains available while coding is still days away.
  assert.equal(getCompanionView(snapshot.data,snapshot.state,addDays(new Date(startTime),2).getTime()).due.length,1);
});
