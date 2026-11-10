import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TUTOR_MODEL_DEFAULTS } from "../../apps/desktop/main/tutor-config";
import { ConfiguredTutorProvider, tutorProviderError } from "../../apps/desktop/main/tutor-provider";
import { challengeOutputEqual } from "../../packages/tutor/challenge-run";
import { challengeRankingFeatures, readChallengeRankingDataset, type ChallengeRankingCase } from "../../packages/tutor/challenge-ranking";
import { readIdeaChallenge } from "../../packages/tutor/idea";
import { hintLevelForAction, policyInstructions } from "../../packages/tutor/policy";
import type { IdeaChallengeCase, TutorProviderId, TutorTurn } from "../../packages/tutor/types";
import { challengeFixtures, challengeRankingFixtureDataset, type ChallengeFixture, type ChallengeSplit } from "./challenge-fixtures";

function scoreCase(fixture: ChallengeFixture, candidate: IdeaChallengeCase) {
  const { id: caseId, input, expectedOutput: modelExpectedOutput, reason } = candidate;
  const proposed = { caseId, input, modelExpectedOutput, reason };
  const judged = fixture.judge(input);
  if (!judged) return { status: "invalid-input" as const, ...proposed };
  return {
    status: "valid-input" as const,
    ...proposed,
    referenceOutput: judged.correct,
    buggyOutput: judged.buggy,
    mismatch: !challengeOutputEqual(judged.correct, judged.buggy),
    probesAssumption: judged.probesAssumption,
    modelOutputMatches: modelExpectedOutput === null ? null : challengeOutputEqual(modelExpectedOutput, judged.correct),
  };
}

function score(fixture: ChallengeFixture, response: string) {
  let challenge;
  try {
    challenge = readIdeaChallenge(response);
  } catch {
    return { status: "invalid-response" as const };
  }
  const [first, ...alternatives] = challenge.cases.map(candidate => scoreCase(fixture, candidate));
  if (!first) return { status: "no-input" as const };
  return { ...first, alternatives };
}

function targetedMismatch(result: ReturnType<typeof scoreCase>) {
  return result.status === "valid-input" && result.mismatch && result.probesAssumption;
}

function rankingCase(result: ReturnType<typeof scoreCase>): ChallengeRankingCase {
  return {
    id: result.caseId,
    ...challengeRankingFeatures({ input: result.input, reason: result.reason, expectedOutput: result.modelExpectedOutput }),
    runs: [],
    feedback: null,
    targetedMismatch: targetedMismatch(result),
  };
}

function verifyFixtures() {
  assert.equal(new Set(challengeFixtures.map(fixture => fixture.id)).size, challengeFixtures.length);
  for (const split of ["development", "holdout"]) {
    assert.ok(challengeFixtures.filter(fixture => fixture.split === split).length >= 6);
  }
  const response = (input: string | null, expectedOutput: string | null) =>
    JSON.stringify({ observation: "Synthetic benchmark fixture.", question: "What happens for this input?", exampleInput: input, expectedOutput });

  for (const fixture of challengeFixtures) {
    const { trigger, control } = fixture;
    assert.deepEqual(score(fixture, response(trigger.input, trigger.buggy)), {
      status: "valid-input",
      caseId: "case-1",
      reason: "Synthetic benchmark fixture.",
      input: trigger.input,
      modelExpectedOutput: trigger.buggy,
      referenceOutput: trigger.correct,
      buggyOutput: trigger.buggy,
      mismatch: true,
      probesAssumption: true,
      modelOutputMatches: false,
      alternatives: [],
    }, fixture.id);
    assert.deepEqual(score(fixture, response(control.input, control.output)), {
      status: "valid-input",
      caseId: "case-1",
      reason: "Synthetic benchmark fixture.",
      input: control.input,
      modelExpectedOutput: control.output,
      referenceOutput: control.output,
      buggyOutput: control.output,
      mismatch: false,
      probesAssumption: false,
      modelOutputMatches: true,
      alternatives: [],
    }, fixture.id);
    const ordered = score(fixture, JSON.stringify({
      observation: "The inputs are in display order.",
      question: "Which case exposes the boundary?",
      cases: [
        { input: control.input, expectedOutput: control.output, reason: "A routine case checks the comparison path." },
        { input: trigger.input, expectedOutput: trigger.correct, reason: "This case targets the assumption." },
      ],
    }));
    assert.ok(ordered.status === "valid-input", fixture.id);
    assert.equal(ordered.input, control.input, fixture.id);
    assert.equal(targetedMismatch(ordered), false, fixture.id);
    assert.equal(ordered.alternatives.length, 1, fixture.id);
    assert.equal(ordered.alternatives[0].caseId, "case-2", fixture.id);
    assert.equal(ordered.alternatives[0].input, trigger.input, fixture.id);
    assert.equal(ordered.alternatives.some(targetedMismatch), true, fixture.id);
    assert.equal(score(fixture, response(`${trigger.input}\n1`, null)).status, "invalid-input", fixture.id);
    assert.equal(score(fixture, response(null, null)).status, "no-input", fixture.id);
  }
  assert.equal(score(challengeFixtures[0], "{}").status, "invalid-response");
  const ranking = readChallengeRankingDataset(challengeRankingFixtureDataset());
  for (const group of ranking.groups) {
    assert.equal(group.cases.length, 2, group.id);
    assert.equal(group.cases.filter(candidate => candidate.targetedMismatch).length, 1, group.id);
  }
  process.stdout.write(`Verified ${challengeFixtures.length} challenge fixtures across development and holdout. No model requests were made.\n`);
}

function buildTurn(fixture: ChallengeFixture, provider: TutorProviderId, model: string): TutorTurn {
  const stamp = new Date().toISOString();
  const identity = `benchmark:${fixture.id}`;
  const conversationId = `${identity}:conversation`;
  const url = "about:blank";
  return {
    id: `${identity}:turn`,
    requestId: `${identity}:request`,
    conversationId,
    action: "challenge-assumption",
    userText: JSON.stringify({ approach: fixture.approach, assumption: fixture.assumption, uncertainty: "" }),
    assistantText: "",
    context: {
      version: 1,
      identity,
      problemId: identity,
      title: fixture.title,
      url,
      workspaceId: "challenge-benchmark",
      conversationId,
      sessionId: null,
      statement: {
        id: `${identity}:statement`,
        identity,
        url,
        title: fixture.title,
        description: fixture.description,
        input: fixture.input,
        output: fixture.output,
        constraints: fixture.constraints,
        samples: [fixture.control],
        explanation: "",
        complete: true,
        source: "manual",
        revision: "fixture-v1",
        capturedAt: stamp,
      },
      code: {
        id: `${identity}:code`,
        identity,
        workspaceId: "challenge-benchmark",
        clientId: "challenge-benchmark",
        fileUri: "file:///benchmark.cpp",
        filename: "benchmark.cpp",
        language: "cpp",
        startLine: 1,
        endLine: fixture.code.split("\n").length,
        text: fixture.code,
        revision: "fixture-v1",
        capturedAt: stamp,
      },
      notes: [],
      evidence: { platform: "unknown", checkedAt: null, localTests: "unknown", submissions: [] },
      frozenAt: stamp,
    },
    standalone: true,
    status: "queued",
    createdAt: stamp,
    completedAt: null,
    error: null,
    hintLevel: hintLevelForAction("challenge-assumption", []),
    exposed: false,
    usage: null,
    provider,
    model,
  };
}

async function evaluateLive(split: ChallengeSplit) {
  if (process.env.FORMA_TUTOR_LIVE_EVAL !== "1") throw new Error("Set FORMA_TUTOR_LIVE_EVAL=1 to authorize provider requests.");
  const provider = process.env.FORMA_TUTOR_PROVIDER === "openai" ? "openai" : "gemini";
  const keyName = provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY";
  const apiKey = process.env[keyName]?.trim();
  if (!apiKey) throw new Error(`Set ${keyName} in the environment for a live benchmark.`);
  const prefix = provider === "openai" ? "FORMA_OPENAI_" : "FORMA_GEMINI_";
  const defaults = TUTOR_MODEL_DEFAULTS[provider];
  const model = process.env[`${prefix}MODEL`] ?? (provider === "openai" ? process.env.FORMA_TUTOR_MODEL : undefined) ?? defaults.model;
  const client = new ConfiguredTutorProvider(() => ({
    provider, apiKey, model, transcriptionModel: defaults.transcriptionModel, speechModel: defaults.speechModel,
  }));
  const scores = [];
  for (const fixture of challengeFixtures.filter(fixture => fixture.split === split)) {
    const turn = buildTurn(fixture, provider, model);
    const base = { id: fixture.id, assumption: fixture.assumption };
    try {
      const result = await client.stream({ turn, history: [] }, AbortSignal.timeout(120_000), text => {
        turn.assistantText += text;
      });
      const assessment = score(fixture, turn.assistantText);
      scores.push({ ...base, responseModel: result.model, usage: result.usage, response: turn.assistantText, ...assessment });
      process.stdout.write(`${fixture.id}: first case ${assessment.status}${assessment.status === "valid-input"
        ? `, mismatch=${assessment.mismatch}, probes assumption=${assessment.probesAssumption}` : ""}\n`);
    } catch (error) {
      scores.push({ ...base, status: "provider-failure" as const, error: tutorProviderError(error) });
      process.stdout.write(`${fixture.id}: provider failure\n`);
    }
  }
  const scored = scores.filter(result => result.status === "valid-input" || result.status === "invalid-input");
  const valid = scored.filter(result => result.status === "valid-input");
  const counts = {
    cases: scores.length,
    providerFailures: scores.filter(result => result.status === "provider-failure").length,
    invalidResponses: scores.filter(result => result.status === "invalid-response").length,
    noInput: scores.filter(result => result.status === "no-input").length,
    proposedInputs: scored.length,
    validInputs: valid.length,
    mismatches: valid.filter(result => result.mismatch).length,
    probesAssumption: valid.filter(result => result.probesAssumption).length,
    targetedMismatches: valid.filter(targetedMismatch).length,
    casesWithAnyTargetedMismatch: scored.filter(result =>
      targetedMismatch(result) || result.alternatives.some(targetedMismatch)).length,
    modelOutputsProvided: valid.filter(result => result.modelOutputMatches !== null).length,
    correctModelOutputs: valid.filter(result => result.modelOutputMatches === true).length,
  };
  const at = new Date().toISOString();
  const policyHash = createHash("sha256").update(policyInstructions("challenge-assumption", 1)).digest("hex");
  const runId = randomUUID();
  const ranking = readChallengeRankingDataset({
    format: "forma-challenge-ranking",
    version: 1,
    source: "benchmark",
    groups: scores.map(result => ({
      id: `${runId}:${result.id}`,
      problemKey: result.id,
      split,
      cases: result.status === "valid-input" || result.status === "invalid-input"
        ? [result, ...result.alternatives].map(rankingCase)
        : [],
    })),
  });
  const directory = resolve("dist/tutor-evaluation");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = resolve(directory, `challenge-${split}-${at.replace(/[:.]/g, "-")}.json`);
  await writeFile(report, JSON.stringify({
    benchmarkVersion: 3, at, split, provider, model, policyHash, counts, scores, ranking,
  }, null, 2), { flag: "wx", mode: 0o600 });
  process.stdout.write(`${counts.targetedMismatches}/${counts.cases} first cases exposed the intended bug. ${counts.casesWithAnyTargetedMismatch}/${counts.cases} problems had a targeted mismatch anywhere in their case list. Saved ${report}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--fixtures")) {
    verifyFixtures();
    return;
  }
  const [live, splitFlag, split] = args;
  if (args.length !== 3 || live !== "--live" || splitFlag !== "--split" || (split !== "development" && split !== "holdout")) {
    throw new Error("Use --fixtures or --live --split development|holdout.");
  }
  await evaluateLive(split);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Challenge evaluation could not complete."}\n`);
  process.exitCode = 1;
});
