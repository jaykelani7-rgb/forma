import assert from "node:assert/strict";
import test from "node:test";
import { parseChallengeRunRequest, readChallengeCaseState, readChallengeRunPlan, readChallengeRunReceipt } from "../packages/tutor/challenge-run";
import { readIdeaChallenge } from "../packages/tutor/idea";

const challenge = { observation: "Check the boundary.", question: "Does the loop see the last element?" };

test("a saved single-case challenge keeps its exact input and becomes the first case", () => {
  assert.deepEqual(readIdeaChallenge(JSON.stringify({ ...challenge, exampleInput: "1\r\n7\r\n", expectedOutput: "7\r\n" })), {
    ...challenge,
    cases: [{ id: "case-1", input: "1\r\n7\r\n", expectedOutput: "7\r\n", reason: challenge.observation }],
  });
  assert.deepEqual(readIdeaChallenge(JSON.stringify({ ...challenge, exampleInput: null, expectedOutput: null })).cases, []);
});

test("alternatives preserve order and collapse equivalent inputs before assigning IDs", () => {
  const first = { input: "1\r\n7\r\n", expectedOutput: "7", reason: "The only element is the boundary." };
  const duplicate = { input: "1\n7", expectedOutput: null, reason: "A redundant test." };
  const next = { input: "2\n5 7", expectedOutput: null, reason: "The target appears only at the boundary." };
  const response = JSON.stringify({ ...challenge, cases: [first, duplicate, next] });
  assert.deepEqual(readIdeaChallenge(response).cases, [{ id: "case-1", ...first }, { id: "case-2", ...next }]);
  assert.throws(() => readIdeaChallenge(JSON.stringify({ ...challenge, cases: [first, duplicate, next, first] })), /invalid list/);
  assert.throws(() => readIdeaChallenge(JSON.stringify({ ...challenge, cases: [{ ...first, input: null }] })), /without an input/);
});

test("challenge feedback stays distinct from output receipts and old plans default to the first case", () => {
  const plan = {
    turnId: "turn-1", requestId: "request-1", problemTitle: "Boundary practice", assumption: "The loop examines all indices.",
    input: "1\n7", sampleOutput: null, recoveryEpoch: "epoch-1", sessionId: null,
  };
  assert.equal(readChallengeRunPlan(plan).caseId, "case-1");
  assert.equal(readChallengeRunPlan({ ...plan, caseId: "case-2" }).caseId, "case-2");
  assert.throws(() => readChallengeRunPlan({ ...plan, caseId: "case-4" }), /invalid fields/);

  const feedback = { caseId: "case-2", label: "invalid-input", recordedAt: "2026-11-10T08:00:00.000Z" };
  const state = { caseId: "case-2", runs: [], feedback: [feedback] };
  assert.deepEqual(readChallengeCaseState(state), state);
  assert.throws(() => readChallengeCaseState({ ...state, feedback: [feedback, feedback] }), /invalid fields/);
  assert.throws(() => readChallengeCaseState({ ...state, feedback: [{ ...feedback, label: "mismatch" }] }), /invalid fields/);
});

test("reference expectations require a source hash and basename at both run boundaries", () => {
  const target = { fileUri: "file:///practice/main.cpp", workspaceId: "workspace", clientId: "client" };
  const reference = { fileName: "reference.cpp", sourceHash: "b".repeat(64) };
  const run = {
    id: "run-1", turnId: "turn-1", requestId: "request-1", recoveryEpoch: "epoch-1",
    sourceHash: "a".repeat(64), output: "7\n", outcome: "exited", diagnostic: "",
    expectedOutput: "7", expectedSource: "reference",
  };
  const submission = { operation: "record", target, run: { ...run, reference } };
  assert.deepEqual(parseChallengeRunRequest(submission), submission);
  assert.throws(() => parseChallengeRunRequest({ ...submission, run }), /invalid fields/);
  assert.throws(() => parseChallengeRunRequest({ ...submission, run: { ...run, expectedSource: "user", reference } }), /invalid fields/);
  assert.throws(() => parseChallengeRunRequest({ ...submission, run: {
    ...run, reference: { ...reference, fileName: "../reference.cpp" },
  } }), /invalid fields/);

  const receipt = {
    id: run.id, input: "1\n7", expectedOutput: run.expectedOutput, expectedSource: "reference",
    sourceHash: run.sourceHash, fileName: "main.cpp", output: run.output, outcome: "match", diagnostic: "",
    ranAt: "2026-11-10T08:00:00.000Z", reference,
  };
  assert.deepEqual(readChallengeRunReceipt(receipt), receipt);
  assert.throws(() => readChallengeRunReceipt({ ...receipt, reference: { ...reference, sourceHash: "bad-hash" } }), /invalid fields/);
  assert.throws(() => readChallengeRunReceipt({ ...receipt, reference: { ...reference, source: "int main() {}" } }), /invalid fields/);
});

test("only a review request can check whether the host supports reference runs", () => {
  const target = { fileUri: "file:///practice/main.cpp", workspaceId: "workspace", clientId: "client" };
  const review = { operation: "review", target, withReference: true };
  assert.deepEqual(parseChallengeRunRequest(review), review);
  assert.throws(() => parseChallengeRunRequest({ ...review, withReference: false }), /invalid fields/);
  assert.throws(() => parseChallengeRunRequest({ ...review, withReference: undefined }), /invalid fields/);
  assert.throws(() => parseChallengeRunRequest({ ...review, operation: "record", run: {} }), /invalid fields/);
});
