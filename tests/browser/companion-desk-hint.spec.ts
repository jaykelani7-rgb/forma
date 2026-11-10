import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { CompanionSnapshot } from "../../apps/desktop/renderer/api";
import type { CompanionCommand } from "../../packages/contracts/src";
import { applyCompanionCommand, initialCompanionState } from "../../packages/core/src/companion";
import type { ChallengeCaseState, ChallengeFeedbackLabel, ChallengeRunReceipt } from "../../packages/tutor/challenge-run";
import type { SharedCode, StatementSnapshot, TutorEvent, TutorProviderStatus, TutorSendInput, TutorTurn } from "../../packages/tutor/types";
import { emptyData } from "../../src/lib/model";

interface DeskHintFixture {
  reviews: { problemId: string }[];
  sends: TutorSendInput[];
  stops: string[];
  commands: CompanionCommand[];
  exposures: { turnId: string; requestId: string }[];
  loseNextSendAcknowledgement: boolean;
  finish(text: string): void;
  recordRun(run: ChallengeRunReceipt): void;
  switchProblem(): void;
}

declare global {
  interface Window {
    __deskHintFixture: DeskHintFixture;
  }
}

const hypothesis = "Maybe a strict upper bound skips the equal case.";
const privateCode = "int private_fixture_code = 73;";
const statementDescription = "The task is to locate a target value between two inclusive bounds.";
const hint = "Try an input where both bounds start equal.";
const sharedCodeText = "while (left < right) { check(left); ++left; }";

async function openDesk(page: Page, options: { contestMode?: boolean; timed?: boolean } = {}) {
  const renderer = resolve(".companion-build/renderer");
  const prefix = "/__desk_hint__/";
  await page.route(`**${prefix}**`, async route => {
    const path = resolve(renderer, decodeURIComponent(new URL(route.request().url()).pathname.slice(prefix.length)));
    if (!path.startsWith(renderer + sep)) return route.abort();
    const contentType = path.endsWith(".html") ? "text/html"
      : path.endsWith(".js") ? "text/javascript"
      : path.endsWith(".css") ? "text/css"
      : "application/octet-stream";
    await route.fulfill({ body: await readFile(path), contentType });
  });

  const stamp = "2026-11-08T08:00:00.000Z";
  const data = emptyData();
  data.problems = [
    { id: "hint-first", title: "Boundary practice", platform: "Codeforces", url: "https://codeforces.com/problemset/problem/4/A", problemCode: "4A", tags: [], rating: 800, createdAt: stamp, reviewAt: null, reviewCount: 0 },
    { id: "hint-second", title: "Another desk", platform: "Codeforces", url: "https://codeforces.com/problemset/problem/5/A", problemCode: "5A", tags: [], rating: 800, createdAt: stamp, reviewAt: null, reviewCount: 0 },
  ];
  const snapshot: CompanionSnapshot = {
    data,
    state: {
      ...initialCompanionState(),
      identity: "contest:4:A",
      problemId: "hint-first",
      desk: [
        { id: "desk-hypothesis", problemId: "hint-first", createdAt: stamp, kind: "hypothesis", text: hypothesis },
        { id: "desk-code", problemId: "hint-first", createdAt: stamp, kind: "code", text: privateCode },
      ],
    },
    revision: 1,
    savedAt: stamp,
    preferences: { theme: "ink", reducedMotion: true, snoozedUntil: null },
    integration: { connected: true, paired: true, status: "Fixture connected" },
    codeforces: { checking: false, checkedAt: null, error: null },
    presentation: { expanded: true },
  };
  if (options.timed) {
    Object.assign(snapshot, applyCompanionCommand(snapshot.data, snapshot.state, {
      type: "start", id: "fixture-session", payload: {},
    }, Date.parse(stamp)));
  }
  const statement: StatementSnapshot = {
    id: "fixture-statement", identity: "contest:4:A", url: data.problems[0].url, title: data.problems[0].title,
    revision: "fixture-revision", capturedAt: stamp, source: "manual", complete: true,
    description: statementDescription, input: "Two integers and a target.", output: "Print a matching position.",
    constraints: "The bounds can be equal.", samples: [{ input: "1 1 1", output: "1" }], explanation: "",
  };
  const sharedCode: SharedCode = {
    id: "fixture-idea-code", identity: "contest:4:A", workspaceId: "fixture-workspace",
    clientId: "fixture-client", fileUri: "file:///fixture/search.cpp", filename: "search.cpp",
    language: "cpp", startLine: 4, endLine: 4, text: sharedCodeText, revision: "fixture-code-revision", capturedAt: stamp,
  };
  const provider: TutorProviderStatus = {
    provider: "gemini", name: "Gemini", configured: true, model: "fixture",
    capabilities: { text: true, transcription: true, speech: false },
    transcriptionModel: "fixture-transcription", speechModel: "", message: "Fixture provider.",
  };

  await page.addInitScript(({ snapshot, statement, sharedCode, provider, options }) => {
    const notebookListeners = new Set<(value: CompanionSnapshot) => void>();
    const tutorListeners = new Set<(event: TutorEvent) => void>();
    const turns: TutorTurn[] = [];
    const currentProblem = () => snapshot.data.problems.find(problem => problem.id === snapshot.state.problemId)!;
    const currentTarget = () => ({
      problemId: currentProblem().id, sessionId: snapshot.data.session?.id ?? null, recoveryEpoch: "fixture-epoch",
      provider: provider.provider, model: provider.model,
    });
    const currentStatement = () => snapshot.state.problemId === "hint-first" ? statement : null;
    const notify = (turn: TutorTurn) => {
      for (const listener of tutorListeners) listener({
        kind: "updated", conversationId: turn.conversationId, turnId: turn.id, requestId: turn.requestId,
      });
    };
    function caseState(turn: TutorTurn): ChallengeCaseState {
      const response = JSON.parse(turn.assistantText);
      const hasCase = Array.isArray(response.cases) ? response.cases.length > 0 : typeof response.exampleInput === "string";
      return structuredClone({
        caseId: turn.challengeCaseId ?? (hasCase ? "case-1" : null),
        runs: turn.challengeRuns ?? [],
        feedback: turn.challengeFeedback ?? [],
      });
    }
    const controls: DeskHintFixture = {
      reviews: [],
      sends: [],
      stops: [],
      commands: [],
      exposures: [],
      loseNextSendAcknowledgement: false,
      finish(text) {
        const turn = turns.at(-1);
        if (!turn) throw new Error("A fixture Tutor request has not started.");
        turn.assistantText = text;
        turn.status = "completed";
        turn.completedAt = snapshot.savedAt;
        notify(turn);
      },
      recordRun(run) {
        const turn = turns.findLast(row => row.action === "challenge-assumption" && row.status === "completed");
        if (!turn) throw new Error("A challenge must be completed before recording a run.");
        turn.challengeRuns = [...(turn.challengeRuns ?? []), run];
        notify(turn);
      },
      switchProblem() {
        snapshot.state.problemId = "hint-second";
        snapshot.state.identity = "contest:5:A";
        snapshot.revision++;
        for (const listener of notebookListeners) listener(structuredClone(snapshot));
      },
    };
    window.__deskHintFixture = controls;
    window.forma = {
      getSnapshot: async () => structuredClone(snapshot),
      subscribe(listener) {
        notebookListeners.add(listener);
        return () => notebookListeners.delete(listener);
      },
      subscribeTutor(listener) {
        tutorListeners.add(listener);
        return () => tutorListeners.delete(listener);
      },
      async command(command) {
        controls.commands.push(structuredClone(command));
        if (command.type !== "desk-add" || !["thread", "counterexample"].includes(command.payload.kind) || command.payload.problemId !== snapshot.state.problemId) {
          throw new Error("The fixture accepts threads and cases for the attached problem.");
        }
        snapshot.state.desk!.push({
          id: command.id, problemId: currentProblem().id, createdAt: snapshot.savedAt, kind: command.payload.kind, text: command.payload.text,
        });
        snapshot.revision++;
        return structuredClone(snapshot);
      },
      async ui(action, payload) {
        switch (action) {
          case "desk-hint-review": {
            const input = payload as { problemId: string };
            controls.reviews.push(structuredClone(input));
            const selected = currentStatement();
            return {
              provider, contestMode: !!options.contestMode, activeRequestId: null,
              statement: selected, conversationId: selected && !options.contestMode ? "fixture-conversation" : null,
              target: currentTarget(),
            };
          }
          case "desk-idea-review": {
            const { problemId } = payload as { problemId: string };
            if (problemId !== currentProblem().id) throw new Error("The active problem changed.");
            return {
              provider, contestMode: !!options.contestMode, activeRequestId: null,
              statement: options.contestMode ? null : currentStatement(),
              code: !options.contestMode && currentStatement() ? sharedCode : null,
              conversationId: options.contestMode ? null : "fixture-conversation",
              target: currentTarget(),
            };
          }
          case "tutor-send": {
            const input = payload as TutorSendInput;
            controls.sends.push(structuredClone(input));
            if (options.contestMode || (input.action !== "outline-idea" && !currentStatement())) {
              throw new Error("Tutor cannot send this request.");
            }
            const turn: TutorTurn = {
              id: input.turnId, requestId: input.requestId, conversationId: input.conversationId, action: input.action,
              userText: input.text, assistantText: "", status: "queued", createdAt: snapshot.savedAt, completedAt: null,
              error: null, hintLevel: input.action === "outline-idea" ? 0 : 1, exposed: false,
              usage: null, model: provider.model, provider: provider.provider, standalone: true,
              context: {
                version: 1, identity: snapshot.state.identity!, problemId: currentProblem().id, title: currentProblem().title,
                url: currentProblem().url, workspaceId: "fixture-workspace", conversationId: input.conversationId,
                sessionId: currentTarget().sessionId, statement: input.statementId ? currentStatement() : null,
                code: input.codeId === sharedCode.id ? sharedCode : null, notes: [],
                evidence: { platform: "unknown", checkedAt: null, localTests: "unknown", submissions: [] }, frozenAt: snapshot.savedAt,
              },
            };
            turns.push(turn);
            if (controls.loseNextSendAcknowledgement) {
              controls.loseNextSendAcknowledgement = false;
              throw new Error("The fixture lost its send acknowledgement.");
            }
            return { turnId: input.turnId, requestId: input.requestId };
          }
          case "tutor-turns":
            return structuredClone(turns.filter(turn => turn.conversationId === payload));
          case "desk-challenge-runs": {
            const { turnId, requestId } = payload as { turnId: string; requestId: string };
            const turn = turns.find(row => row.id === turnId && row.requestId === requestId && row.context.problemId === currentProblem().id);
            return structuredClone(turn?.challengeRuns ?? []);
          }
          case "desk-challenge-state":
          case "desk-challenge-select":
          case "desk-challenge-feedback": {
            const { turnId, requestId, caseId, label } = payload as {
              turnId: string; requestId: string; caseId?: string; label?: ChallengeFeedbackLabel | null;
            };
            const turn = turns.find(row => row.id === turnId && row.requestId === requestId && row.context.problemId === currentProblem().id);
            if (!turn || turn.action !== "challenge-assumption" || turn.status !== "completed") {
              throw new Error("The fixture challenge is unavailable.");
            }
            if (action === "desk-challenge-select" && caseId) {
              turn.challengeCaseId = caseId;
              notify(turn);
            }
            if (action === "desk-challenge-feedback" && caseId && label !== undefined) {
              turn.challengeFeedback = (turn.challengeFeedback ?? []).filter(entry => entry.caseId !== caseId);
              if (label !== null) turn.challengeFeedback.push({ caseId, label, recordedAt: snapshot.savedAt });
              notify(turn);
            }
            return caseState(turn);
          }
          case "tutor-stop": {
            controls.stops.push(String(payload));
            const turn = turns.find(turn => turn.requestId === payload);
            if (turn && turn.status === "queued") {
              turn.status = "interrupted";
              notify(turn);
            }
            return null;
          }
          case "tutor-exposed": {
            const input = payload as DeskHintFixture["exposures"][number];
            controls.exposures.push(structuredClone(input));
            const turn = turns.find(turn => turn.id === input.turnId && turn.requestId === input.requestId);
            if (turn) turn.exposed = true;
            return structuredClone(turn ?? null);
          }
          case "thought-takes":
            return [];
          default:
            return null;
        }
      },
    };
  }, { snapshot, statement, sharedCode, provider, options });

  await page.goto(`${prefix}index.html`);
  await page.getByRole("button", { name: "Open problem desk", exact: true }).click();
}

const openHint = (page: Page) => page.getByRole("button", { name: /^I[’']m stuck$/i }).click();
const sendHint = (page: Page) => page.getByRole("button", { name: "Send hint request", exact: true }).click();

test("a Desk hint reviews selected context and becomes an editable thread only when kept", async ({ page }) => {
  await openDesk(page, { timed: true });
  const priorDraft = "Check the loop invariant once more.";
  const draft = page.getByLabel("What would you try next?", { exact: true });
  await page.getByRole("button", { name: "Leave a thread", exact: true }).click();
  await draft.fill(priorDraft);
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();

  await openHint(page);
  const card = page.getByRole("region", { name: "Desk hint", exact: true });
  const include = card.getByRole("checkbox", { name: "Include my latest hypothesis", exact: true });
  await expect(include).not.toBeChecked();
  await card.getByText("Review problem statement", { exact: true }).click();
  await expect(card.getByText(statementDescription, { exact: true })).toBeVisible();
  await include.check();
  expect(await page.evaluate(() => window.__deskHintFixture.sends)).toEqual([]);
  await page.evaluate(() => { window.__deskHintFixture.loseNextSendAcknowledgement = true; });

  await sendHint(page);
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.sends.length)).toBe(1);
  const [request] = await page.evaluate(() => window.__deskHintFixture.sends);
  expect(request).toMatchObject({
    action: "small-hint", statementId: "fixture-statement", conversationId: "fixture-conversation",
    codeId: null, noteIds: [], deskHint: {
      problemId: "hint-first", sessionId: "companion:fixture-session", recoveryEpoch: "fixture-epoch",
      provider: "gemini", model: "fixture",
    },
  });
  expect(request.text).toContain(hypothesis);
  expect(request.text).not.toContain(privateCode);
  await expect(card.getByRole("button", { name: "Keep as next step", exact: true })).toHaveCount(0);

  await page.evaluate(text => window.__deskHintFixture.finish(text), hint);
  const reply = card.getByText(hint, { exact: true });
  await expect(reply).toBeVisible();
  await expect(card.getByRole("alert")).toHaveCount(0);
  await reply.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.exposures)).toContainEqual({
    turnId: request.turnId, requestId: request.requestId,
  });
  await card.getByRole("button", { name: "Keep as next step", exact: true }).click();
  await expect(draft).toHaveValue(`${priorDraft}\n\n${hint}`);
  expect(await page.evaluate(() => window.__deskHintFixture.commands)).toEqual([]);

  const edited = "First I’ll try the single-element boundary case.";
  await draft.fill(edited);
  await page.getByRole("button", { name: "Save thread", exact: true }).click();
  await expect(page.getByText(edited, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__deskHintFixture.commands)).toMatchObject([
    { type: "desk-add", expectedProblemKey: "contest:4:A", payload: { kind: "thread", problemId: "hint-first", text: edited } },
  ]);
  const session = await page.evaluate(async () => (await window.forma!.getSnapshot()).data.session);
  expect(session).toMatchObject({ id: "companion:fixture-session", runningSince: Date.parse("2026-11-08T08:00:00.000Z") });
});

test("contest mode offers a private thread without requesting Tutor assistance", async ({ page }) => {
  await openDesk(page, { contestMode: true });
  await openHint(page);
  await expect(page.getByRole("button", { name: "Send hint request", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Leave a private thread", exact: true }).click();
  await expect(page.getByLabel("What would you try next?", { exact: true })).toBeEditable();
  expect(await page.evaluate(() => ({
    sends: window.__deskHintFixture.sends, commands: window.__deskHintFixture.commands,
  }))).toEqual({ sends: [], commands: [] });
});

test("a late hint from another problem cannot appear on the current desk", async ({ page }) => {
  await openDesk(page);
  await openHint(page);
  await sendHint(page);
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.sends.length)).toBe(1);
  const [request] = await page.evaluate(() => window.__deskHintFixture.sends);
  expect(request.text).not.toContain(hypothesis);
  await page.evaluate(() => window.__deskHintFixture.switchProblem());
  await expect(page.getByRole("heading", { name: "Another desk", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.stops)).toContain(request.requestId);
  await page.evaluate(text => window.__deskHintFixture.finish(text), hint);

  await openHint(page);
  await expect(page.getByRole("button", { name: "Open Tutor", exact: true })).toBeVisible();
  await expect(page.getByText(hint, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Keep as next step", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__deskHintFixture.commands)).toEqual([]);
});

test("an outlined idea can challenge one edited assumption and save a reviewed next step", async ({ page }) => {
  await openDesk(page, { timed: true });
  await page.getByRole("button", { name: "Explain my idea", exact: true }).click();
  const card = page.getByRole("region", { name: "Explain my idea", exact: true });
  const explanation = "I walk the interval from the left until I find the target.";
  await card.getByRole("textbox", { name: "Your explanation", exact: true }).fill(explanation);
  expect(await page.evaluate(() => window.__deskHintFixture.sends)).toEqual([]);

  await card.getByRole("button", { name: "Outline my idea", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.sends.length)).toBe(1);
  const [outlineRequest] = await page.evaluate(() => window.__deskHintFixture.sends);
  const target = {
    problemId: "hint-first", sessionId: "companion:fixture-session", recoveryEpoch: "fixture-epoch",
    provider: "gemini", model: "fixture",
  };
  expect(outlineRequest).toMatchObject({
    action: "outline-idea", statementId: null, codeId: null, noteIds: [], deskIdea: target,
  });
  expect(outlineRequest.text).toContain(explanation);
  expect(outlineRequest.text).not.toContain(privateCode);

  await page.evaluate(() => window.__deskHintFixture.finish(JSON.stringify({
    approach: "Scan the interval from its left endpoint.",
    assumptions: ["The bounds always differ.", "Every inspected item can be checked."],
    uncertainty: "What happens when the bounds meet?",
  })));
  await expect(card.getByRole("heading", { name: "Your working idea", exact: true })).toBeVisible();
  const selectedAssumption = "The right endpoint is included even when both bounds are equal.";
  await card.getByRole("textbox", { name: "Assumption 1", exact: true }).fill(selectedAssumption);
  await card.getByRole("radio", { name: "Challenge assumption 1", exact: true }).check();
  await page.getByRole("button", { name: "Explain my idea", exact: true }).click();
  await page.getByRole("button", { name: "Explain my idea", exact: true }).click();
  await expect(card.getByRole("textbox", { name: "Assumption 1", exact: true })).toHaveValue(selectedAssumption);
  await expect(card.getByRole("radio", { name: "Challenge assumption 1", exact: true })).toBeChecked();
  const includeCode = card.getByRole("checkbox", { name: "Include selected code", exact: true });
  await expect(includeCode).not.toBeChecked();
  await includeCode.check();
  await card.getByText("Review selected code", { exact: true }).click();
  await expect(card.getByText(sharedCodeText, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__deskHintFixture.sends.length)).toBe(1);

  await card.getByRole("button", { name: "Challenge this assumption", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.sends.length)).toBe(2);
  const [, challengeRequest] = await page.evaluate(() => window.__deskHintFixture.sends);
  expect(challengeRequest).toMatchObject({
    action: "challenge-assumption", statementId: "fixture-statement", codeId: "fixture-idea-code",
    noteIds: [], deskIdea: target,
  });
  expect(challengeRequest.text).toContain(selectedAssumption);
  expect(challengeRequest.text).not.toContain("Every inspected item can be checked.");
  expect(challengeRequest.text).not.toContain(privateCode);

  const challenge = {
    observation: "The loop skips the only element if both bounds are equal.",
    question: "What will the loop inspect on a one-element interval?",
    exampleInput: "1 1 1", expectedOutput: "1",
  };
  await page.evaluate(challenge => window.__deskHintFixture.finish(JSON.stringify(challenge)), challenge);
  await expect(card.getByRole("heading", { name: "One assumption to test", exact: true })).toBeVisible();
  await expect(card.getByText(challenge.question, { exact: true })).toBeVisible();
  await expect(card.getByText(challenge.observation, { exact: true })).toBeVisible();
  await expect(card.getByText(/unverified|not run/i)).toBeVisible();
  const verifier = card.getByRole("region", { name: "Verify in VS Code", exact: true });
  await expect(verifier.getByText("Forma: Run Challenge Case", { exact: true })).toBeVisible();
  const failedRun: ChallengeRunReceipt = {
    id: "first-run", input: challenge.exampleInput, expectedOutput: challenge.expectedOutput,
    expectedSource: "statement-sample", output: "0\n", outcome: "mismatch", diagnostic: "",
    sourceHash: "a".repeat(64), fileName: "search.cpp", ranAt: "2026-11-08T08:10:00.000Z",
  };
  await page.evaluate(run => window.__deskHintFixture.recordRun(run), failedRun);
  await expect(verifier.getByText("Output differed", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__deskHintFixture.commands)).toEqual([]);
  await page.getByRole("button", { name: "Explain my idea", exact: true }).click();
  await page.getByRole("button", { name: "Explain my idea", exact: true }).click();
  await expect(verifier.getByText("Output differed", { exact: true })).toBeVisible();
  await page.evaluate(run => window.__deskHintFixture.recordRun(run), {
    ...failedRun, id: "second-run", outcome: "match", output: "1\n", sourceHash: "b".repeat(64), ranAt: "2026-11-08T08:13:00.000Z",
  } satisfies ChallengeRunReceipt);
  await expect(verifier.getByText("Output matched", { exact: true })).toBeVisible();
  await verifier.getByText("Earlier runs (1)", { exact: true }).click();
  await verifier.getByRole("button", { name: "Save failing case to Desk", exact: true }).click();
  await expect(verifier.getByRole("button", { name: "Failing case saved", exact: true })).toBeDisabled();
  await card.getByRole("button", { name: "Keep as next step", exact: true }).click();

  const draft = page.getByRole("textbox", { name: "What would you try next?", exact: true });
  await expect(draft).toHaveValue(/What will the loop inspect on a one-element interval\?/);
  expect(await page.evaluate(() => window.__deskHintFixture.commands)).toMatchObject([
    { type: "desk-add", payload: { kind: "counterexample", problemId: "hint-first" } },
  ]);
  const nextStep = "Trace the loop on equal boundaries before changing it.";
  await draft.fill(nextStep);
  await page.getByRole("button", { name: "Save thread", exact: true }).click();
  await expect(page.getByText(nextStep, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__deskHintFixture.commands)).toMatchObject([
    { type: "desk-add", payload: { kind: "counterexample", problemId: "hint-first" } },
    { type: "desk-add", expectedProblemKey: "contest:4:A", payload: { kind: "thread", problemId: "hint-first", text: nextStep } },
  ]);
});

test("switching problems stops an idea request and keeps its result off the new desk", async ({ page }) => {
  await openDesk(page);
  const openIdea = () => page.getByRole("button", { name: "Explain my idea", exact: true }).click();
  const card = page.getByRole("region", { name: "Explain my idea", exact: true });
  await openIdea();
  await card.getByRole("textbox", { name: "Your explanation", exact: true }).fill("I scan from the left boundary.");
  await card.getByRole("button", { name: "Outline my idea", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.sends.length)).toBe(1);
  const [request] = await page.evaluate(() => window.__deskHintFixture.sends);

  await page.evaluate(() => window.__deskHintFixture.switchProblem());
  await expect(page.getByRole("heading", { name: "Another desk", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.stops)).toContain(request.requestId);
  await page.evaluate(() => window.__deskHintFixture.finish(JSON.stringify({
    approach: "Scan the original interval.", assumptions: ["There is one match."], uncertainty: "",
  })));

  await openIdea();
  await expect(card.getByRole("textbox", { name: "Your explanation", exact: true })).toHaveValue("");
  await expect(card.getByRole("heading", { name: "Your working idea", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__deskHintFixture.commands)).toEqual([]);
});

test("another challenge case keeps its own runs and feedback when the Desk reopens", async ({ page }) => {
  await openDesk(page, { timed: true });
  const openIdea = () => page.getByRole("button", { name: "Explain my idea", exact: true }).click();
  const card = page.getByRole("region", { name: "Explain my idea", exact: true });
  await openIdea();
  await card.getByRole("textbox", { name: "Your explanation", exact: true }).fill("I check the items between both boundaries.");
  await card.getByRole("button", { name: "Outline my idea", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.sends.length)).toBe(1);
  await page.evaluate(() => window.__deskHintFixture.finish(JSON.stringify({
    approach: "Scan the interval.", assumptions: ["The final item is included."], uncertainty: "",
  })));
  await card.getByRole("radio", { name: "Challenge assumption 1", exact: true }).check();
  await card.getByRole("button", { name: "Challenge this assumption", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__deskHintFixture.sends.length)).toBe(2);
  const first = { input: "1 1 1", expectedOutput: "1", reason: "The boundaries meet at the target." };
  const second = { input: "1 2 2", expectedOutput: "2", reason: "Only the right endpoint contains the target." };
  await page.evaluate(cases => window.__deskHintFixture.finish(JSON.stringify({
    observation: "The endpoint comparison controls whether the last item is checked.",
    question: "Which endpoint gets inspected?", cases,
  })), [first, second]);
  const verifier = card.getByRole("region", { name: "Verify in VS Code", exact: true });
  const feedback = card.getByRole("combobox", { name: "How useful was this case?", exact: true });
  await expect(card.getByText(first.reason, { exact: true })).toBeVisible();
  await expect(card.getByText(second.reason, { exact: true })).toHaveCount(0);
  const receipt: ChallengeRunReceipt = {
    id: "first-case-run", caseId: "case-1", input: first.input, expectedOutput: first.expectedOutput,
    expectedSource: "statement-sample", output: "1\n", outcome: "match", diagnostic: "",
    sourceHash: "a".repeat(64), fileName: "search.cpp", ranAt: "2026-11-08T08:10:00.000Z",
  };
  await page.evaluate(run => window.__deskHintFixture.recordRun(run), receipt);
  await expect(verifier.getByText("Output matched", { exact: true })).toBeVisible();
  await feedback.selectOption({ label: "Missed my assumption" });
  await expect(feedback).toHaveValue("wrong-assumption");

  await card.getByRole("button", { name: "Try another case", exact: true }).click();
  await expect(card.getByText(second.reason, { exact: true })).toBeVisible();
  await expect(card.getByText(first.reason, { exact: true })).toHaveCount(0);
  await expect(verifier.getByText("Output matched", { exact: true })).toHaveCount(0);
  await expect(feedback).toHaveValue("");
  await page.evaluate(run => window.__deskHintFixture.recordRun(run), {
    ...receipt, id: "second-case-run", caseId: "case-2", input: second.input, expectedOutput: second.expectedOutput,
    expectedSource: "user", output: "-1\n", outcome: "mismatch", ranAt: "2026-11-08T08:11:00.000Z",
  } satisfies ChallengeRunReceipt);
  await expect(verifier.getByText("Output differed", { exact: true })).toBeVisible();
  await feedback.selectOption({ label: "Helped me find the bug" });
  await expect(feedback).toHaveValue("helpful");

  await openIdea();
  await openIdea();
  await expect(card.getByText(second.reason, { exact: true })).toBeVisible();
  await expect(verifier.getByText("Output differed", { exact: true })).toBeVisible();
  await expect(feedback).toHaveValue("helpful");
  await card.getByRole("button", { name: "Previous case", exact: true }).click();
  await expect(card.getByText(first.reason, { exact: true })).toBeVisible();
  await expect(verifier.getByText("Output matched", { exact: true })).toBeVisible();
  await expect(verifier.getByText("Output differed", { exact: true })).toHaveCount(0);
  await expect(feedback).toHaveValue("wrong-assumption");
  await feedback.selectOption({ label: "No feedback" });
  await expect(feedback).toHaveValue("");
  await expect(verifier.getByText("Output matched", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__deskHintFixture.sends.length)).toBe(2);
  expect(await page.evaluate(() => window.__deskHintFixture.commands)).toEqual([]);
});
