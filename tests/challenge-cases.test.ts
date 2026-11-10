import assert from "node:assert/strict";
import test from "node:test";
import { readChallengeCaseState, readChallengeRunPlan } from "../packages/tutor/challenge-run";
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
