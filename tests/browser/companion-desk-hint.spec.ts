import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { CompanionSnapshot } from "../../apps/desktop/renderer/api";
import type { CompanionCommand } from "../../packages/contracts/src";
import { applyCompanionCommand, initialCompanionState } from "../../packages/core/src/companion";
import type { StatementSnapshot, TutorEvent, TutorProviderStatus, TutorSendInput, TutorTurn } from "../../packages/tutor/types";
import { emptyData } from "../../src/lib/model";

interface DeskHintFixture {
  reviews: { problemId: string }[];
  sends: TutorSendInput[];
  stops: string[];
  commands: CompanionCommand[];
  exposures: { turnId: string; requestId: string }[];
  loseNextSendAcknowledgement: boolean;
  finish(text: string): void;
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
  const provider: TutorProviderStatus = {
    provider: "gemini", name: "Gemini", configured: true, model: "fixture",
    capabilities: { text: true, transcription: true, speech: false },
    transcriptionModel: "fixture-transcription", speechModel: "", message: "Fixture provider.",
  };

  await page.addInitScript(({ snapshot, statement, provider, options }) => {
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
    const controls: DeskHintFixture = {
      reviews: [],
      sends: [],
      stops: [],
      commands: [],
      exposures: [],
      loseNextSendAcknowledgement: false,
      finish(text) {
        const turn = turns.at(-1);
        if (!turn) throw new Error("A fixture hint has not started.");
        turn.assistantText = text;
        turn.status = "completed";
        turn.completedAt = snapshot.savedAt;
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
        if (command.type !== "desk-add" || command.payload.kind !== "thread" || command.payload.problemId !== snapshot.state.problemId) {
          throw new Error("The fixture accepts only a thread for the attached problem.");
        }
        snapshot.state.desk!.push({
          id: command.id, problemId: currentProblem().id, createdAt: snapshot.savedAt, kind: "thread", text: command.payload.text,
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
          case "tutor-send": {
            const input = payload as TutorSendInput;
            controls.sends.push(structuredClone(input));
            if (options.contestMode || !currentStatement()) throw new Error("Tutor cannot send this hint.");
            const turn: TutorTurn = {
              id: input.turnId, requestId: input.requestId, conversationId: input.conversationId, action: input.action,
              userText: input.text, assistantText: "", status: "queued", createdAt: snapshot.savedAt, completedAt: null,
              error: null, hintLevel: 1, exposed: false, usage: null, model: provider.model, provider: provider.provider, standalone: true,
              context: {
                version: 1, identity: snapshot.state.identity!, problemId: currentProblem().id, title: currentProblem().title,
                url: currentProblem().url, workspaceId: "fixture-workspace", conversationId: input.conversationId,
                sessionId: currentTarget().sessionId, statement: currentStatement(), code: null, notes: [],
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
  }, { snapshot, statement, provider, options });

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
