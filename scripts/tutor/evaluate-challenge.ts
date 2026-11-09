import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TUTOR_MODEL_DEFAULTS } from "../../apps/desktop/main/tutor-config";
import { ConfiguredTutorProvider, tutorProviderError } from "../../apps/desktop/main/tutor-provider";
import { challengeOutputEqual } from "../../packages/tutor/challenge-run";
import { readIdeaChallenge } from "../../packages/tutor/idea";
import { hintLevelForAction, policyInstructions } from "../../packages/tutor/policy";
import type { TutorProviderId, TutorTurn } from "../../packages/tutor/types";
import { challengeFixtures, type ChallengeFixture, type ChallengeSplit } from "./challenge-fixtures";

function score(fixture: ChallengeFixture, response: string) {
  let candidate;
  try {
    candidate = readIdeaChallenge(response);
  } catch {
    return { status: "invalid-response" as const };
  }
  if (candidate.exampleInput === null) return { status: "no-input" as const };
  const input = candidate.exampleInput;
  const modelExpectedOutput = candidate.expectedOutput;
  const judged = fixture.judge(input);
  if (!judged) return { status: "invalid-input" as const, input, modelExpectedOutput };
  return {
    status: "valid-input" as const,
    input,
    modelExpectedOutput,
    referenceOutput: judged.correct,
    buggyOutput: judged.buggy,
    mismatch: !challengeOutputEqual(judged.correct, judged.buggy),
    probesAssumption: judged.probesAssumption,
    modelOutputMatches: modelExpectedOutput === null ? null : challengeOutputEqual(modelExpectedOutput, judged.correct),
  };
}

function verifyFixtures() {
  assert.equal(new Set(challengeFixtures.map(fixture => fixture.id)).size, challengeFixtures.length);
  for (const split of ["development", "holdout"]) {
    assert.ok(challengeFixtures.filter(fixture => fixture.split === split).length >= 3);
  }
  const response = (input: string | null, expectedOutput: string | null) =>
    JSON.stringify({ observation: "Synthetic benchmark fixture.", question: "What happens for this input?", exampleInput: input, expectedOutput });

  for (const fixture of challengeFixtures) {
    const { trigger, control } = fixture;
    assert.deepEqual(score(fixture, response(trigger.input, control.output)), {
      status: "valid-input",
      input: trigger.input,
      modelExpectedOutput: control.output,
      referenceOutput: trigger.correct,
      buggyOutput: trigger.buggy,
      mismatch: true,
      probesAssumption: true,
      modelOutputMatches: false,
    }, fixture.id);
    assert.deepEqual(score(fixture, response(control.input, control.output)), {
      status: "valid-input",
      input: control.input,
      modelExpectedOutput: control.output,
      referenceOutput: control.output,
      buggyOutput: control.output,
      mismatch: false,
      probesAssumption: false,
      modelOutputMatches: true,
    }, fixture.id);
    assert.equal(score(fixture, response(`${trigger.input}\n1`, null)).status, "invalid-input", fixture.id);
    assert.equal(score(fixture, response(null, null)).status, "no-input", fixture.id);
  }
  assert.equal(score(challengeFixtures[0], "{}").status, "invalid-response");
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
      process.stdout.write(`${fixture.id}: ${assessment.status}${assessment.status === "valid-input"
        ? `, mismatch=${assessment.mismatch}, probes assumption=${assessment.probesAssumption}` : ""}\n`);
    } catch (error) {
      scores.push({ ...base, status: "provider-failure" as const, error: tutorProviderError(error) });
      process.stdout.write(`${fixture.id}: provider failure\n`);
    }
  }
  const valid = scores.filter(result => result.status === "valid-input");
  const counts = {
    cases: scores.length,
    providerFailures: scores.filter(result => result.status === "provider-failure").length,
    invalidResponses: scores.filter(result => result.status === "invalid-response").length,
    noInput: scores.filter(result => result.status === "no-input").length,
    proposedInputs: scores.filter(result => result.status === "invalid-input" || result.status === "valid-input").length,
    validInputs: valid.length,
    mismatches: valid.filter(result => result.mismatch).length,
    probesAssumption: valid.filter(result => result.probesAssumption).length,
    targetedMismatches: valid.filter(result => result.mismatch && result.probesAssumption).length,
    modelOutputsProvided: valid.filter(result => result.modelOutputMatches !== null).length,
    correctModelOutputs: valid.filter(result => result.modelOutputMatches === true).length,
  };
  const at = new Date().toISOString();
  const policyHash = createHash("sha256").update(policyInstructions("challenge-assumption", 1)).digest("hex");
  const directory = resolve("dist/tutor-evaluation");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = resolve(directory, `challenge-${split}-${at.replace(/[:.]/g, "-")}.json`);
  await writeFile(report, JSON.stringify({
    benchmarkVersion: 1, at, split, provider, model, policyHash, counts, scores,
  }, null, 2), { flag: "wx", mode: 0o600 });
  process.stdout.write(`${counts.targetedMismatches}/${counts.cases} cases exposed the intended bug. Saved ${report}\n`);
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
