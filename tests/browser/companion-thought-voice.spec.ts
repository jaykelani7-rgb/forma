import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { CompanionSnapshot } from "../../apps/desktop/renderer/api";
import type { CompanionCommand } from "../../packages/contracts/src";
import { initialCompanionState } from "../../packages/core/src/companion";
import { emptyData } from "../../src/lib/model";

interface ThoughtVoiceFixture {
  microphoneRequests: { requestId: string; problemKey: string; sessionId?: string }[];
  audioRequests: number;
  stoppedTracks: number;
  transcriptions: { requestId: string; mime: string; bytes: number[] }[];
  cancellations: string[];
  notebookCommands: CompanionCommand[];
  releaseTranscript(text: string): Promise<void>;
  switchProblem(): void;
}

declare global {
  interface Window {
    __thoughtVoiceFixture: ThoughtVoiceFixture;
  }
}

async function openRibbon(page: Page) {
  const renderer = resolve(".companion-build/renderer");
  const prefix = "/__thought_voice__/";
  await page.route(`**${prefix}**`, async (route) => {
    const path = resolve(
      renderer,
      decodeURIComponent(new URL(route.request().url()).pathname.slice(prefix.length)),
    );
    if (!path.startsWith(renderer + sep)) {
      await route.abort();
      return;
    }
    const contentType = path.endsWith(".html") ? "text/html"
      : path.endsWith(".js") ? "text/javascript"
      : path.endsWith(".css") ? "text/css"
      : path.endsWith(".svg") ? "image/svg+xml"
      : "application/octet-stream";
    await route.fulfill({ body: await readFile(path), contentType });
  });

  const stamp = "2026-11-08T08:00:00.000Z";
  const data = emptyData();
  data.problems = [
    { id: "voice-first", title: "Parity practice", platform: "Codeforces", url: "https://codeforces.com/problemset/problem/4/A", problemCode: "4A", tags: [], rating: 800, createdAt: stamp, reviewAt: null, reviewCount: 0 },
    { id: "voice-second", title: "Another practice problem", platform: "Codeforces", url: "https://codeforces.com/problemset/problem/5/A", problemCode: "5A", tags: [], rating: 800, createdAt: stamp, reviewAt: null, reviewCount: 0 },
  ];
  const snapshot: CompanionSnapshot = {
    data,
    state: { ...initialCompanionState(), identity: "contest:4:A", problemId: "voice-first" },
    revision: 1,
    savedAt: stamp,
    preferences: { theme: "ink", reducedMotion: true, snoozedUntil: null },
    integration: { connected: true, paired: true, status: "Fixture connected" },
    codeforces: { checking: false, checkedAt: null, error: null },
    presentation: { expanded: false },
  };

  await page.addInitScript(({ snapshot }) => {
    const listeners = new Set<(value: CompanionSnapshot) => void>();
    let pendingTranscript: ((result: { text: string }) => void) | undefined;
    const fixture: ThoughtVoiceFixture = {
      microphoneRequests: [],
      audioRequests: 0,
      stoppedTracks: 0,
      transcriptions: [],
      cancellations: [],
      notebookCommands: [],
      async releaseTranscript(text) {
        if (!pendingTranscript) throw new Error("No transcription is pending");
        pendingTranscript({ text });
        pendingTranscript = undefined;
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      },
      switchProblem() {
        snapshot.state = { ...snapshot.state, identity: "contest:5:A", problemId: "voice-second" };
        for (const listener of listeners) listener(structuredClone(snapshot));
      },
    };
    window.__thoughtVoiceFixture = fixture;
    window.forma = {
      getSnapshot: async () => structuredClone(snapshot),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async command(command) {
        fixture.notebookCommands.push(structuredClone(command));
        if (command.type !== "thought") throw new Error("Only saving a thought is expected here");
        const { identity, problemId } = snapshot.state;
        if (!problemId || command.expectedProblemKey !== identity) throw new Error("The attached problem changed");
        snapshot.state.thoughts.push({
          id: command.id,
          problemId,
          text: command.payload.text,
          createdAt: snapshot.savedAt,
        });
        snapshot.revision++;
        return structuredClone(snapshot);
      },
      async ui(action, payload) {
        switch (action) {
          case "expand":
            snapshot.presentation = { ...snapshot.presentation, expanded: payload === true };
            return null;
          case "thought-voice-status":
            return { providerName: "Gemini", available: true };
          case "thought-microphone":
            fixture.microphoneRequests.push(payload as ThoughtVoiceFixture["microphoneRequests"][number]);
            return { allowed: true };
          case "thought-transcribe": {
            const input = payload as { requestId: string; mime: string; bytes: Uint8Array };
            fixture.transcriptions.push({ requestId: input.requestId, mime: input.mime, bytes: [...input.bytes] });
            return new Promise((resolve) => { pendingTranscript = resolve; });
          }
          case "thought-voice-cancel":
            // Let the pending response arrive after cancel to check the renderer's race guard.
            fixture.cancellations.push((payload as { requestId: string }).requestId);
            return null;
          default:
            return null;
        }
      },
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        async getUserMedia() {
          fixture.audioRequests++;
          return { getTracks: () => [{ stop: () => { fixture.stoppedTracks++; } }] };
        },
      },
    });
    class FixtureRecorder {
      static isTypeSupported(mime: string) { return mime.startsWith("audio/webm"); }
      state: RecordingState = "inactive";
      mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = options?.mimeType ?? "audio/webm";
      }

      start() { this.state = "recording"; }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        queueMicrotask(() => {
          const data = new Blob([new Uint8Array([3, 1, 4])], { type: this.mimeType });
          this.ondataavailable?.({ data });
          this.onstop?.();
        });
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FixtureRecorder });
  }, { snapshot });
  await page.goto(`${prefix}index.html`);
  await expect(page.getByRole("button", { name: "Speak a thought", exact: true })).toBeVisible();
}

async function recordThought(page: Page) {
  await page.getByRole("button", { name: "Speak a thought", exact: true }).click();
  const thought = page.getByLabel("Your thought", { exact: true });
  await expect(thought).toBeVisible();
  const finish = page.getByRole("button", { name: "Finish recording and transcribe", exact: true });
  await expect(finish).toBeVisible();
  expect(await page.evaluate(() => window.__thoughtVoiceFixture.transcriptions)).toEqual([]);
  await finish.click();
  await expect.poll(() => page.evaluate(() => window.__thoughtVoiceFixture.transcriptions.length)).toBe(1);
  return thought;
}

test("a recorded ribbon thought becomes an editable draft and saves only on request", async ({ page }) => {
  await openRibbon(page);
  const readFixture = () => page.evaluate(() => {
    const { microphoneRequests, audioRequests, stoppedTracks, transcriptions, notebookCommands } = window.__thoughtVoiceFixture;
    return { microphoneRequests, audioRequests, stoppedTracks, transcriptions, notebookCommands };
  });
  expect(await readFixture()).toEqual({
    microphoneRequests: [], audioRequests: 0, stoppedTracks: 0, transcriptions: [], notebookCommands: [],
  });
  const thought = await recordThought(page);
  const recorded = await readFixture();
  expect(recorded.microphoneRequests).toEqual([
    expect.objectContaining({ requestId: expect.any(String), problemKey: "contest:4:A" }),
  ]);
  expect(recorded.audioRequests).toBe(1);
  expect(recorded.stoppedTracks).toBe(1);
  expect(recorded.transcriptions).toEqual([{
    requestId: recorded.microphoneRequests[0].requestId,
    mime: expect.stringMatching(/^audio\/webm/),
    bytes: [3, 1, 4],
  }]);
  await page.evaluate(() => window.__thoughtVoiceFixture.releaseTranscript("Even input was important."));
  await expect(thought).toHaveValue("Even input was important.");
  expect((await readFixture()).notebookCommands).toEqual([]);

  await thought.fill("Check the parity and the smallest even input.");
  await page.getByRole("button", { name: "Save thought locally", exact: true }).click();
  await expect.poll(async () => (await readFixture()).notebookCommands).toEqual([
    expect.objectContaining({
      type: "thought",
      expectedProblemKey: "contest:4:A",
      payload: { text: "Check the parity and the smallest even input." },
    }),
  ]);
  await expect(page.getByText("Thought saved locally.", { exact: true })).toBeVisible();
});

for (const interruption of ["cancellation", "an attached problem change"] as const) {
  test(`a late thought transcript is discarded after ${interruption}`, async ({ page }) => {
    await openRibbon(page);
    const thought = await recordThought(page);
    const requestId = await page.evaluate(() => window.__thoughtVoiceFixture.transcriptions[0].requestId);
    if (interruption === "cancellation") {
      await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
    } else {
      await page.evaluate(() => window.__thoughtVoiceFixture.switchProblem());
    }
    await expect.poll(() => page.evaluate(() => window.__thoughtVoiceFixture.cancellations)).toContain(requestId);
    await page.evaluate(() => window.__thoughtVoiceFixture.releaseTranscript("Late speech must stay out of the notebook."));
    await expect(thought).toHaveValue("");
    await expect(page.getByRole("button", { name: "Save thought locally", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.__thoughtVoiceFixture.notebookCommands)).toEqual([]);
  });
}
