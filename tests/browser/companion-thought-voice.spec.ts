import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { CompanionSnapshot } from "../../apps/desktop/renderer/api";
import type { CompanionCommand } from "../../packages/contracts/src";
import { initialCompanionState } from "../../packages/core/src/companion";
import { emptyData } from "../../src/lib/model";

interface RecordedClip { requestId: string; mime: string; bytes: number[] }
interface FailedTake {
  id: string;
  problemKey: string;
  title: string;
  recordedAt: string;
  audio: RecordedClip;
}

interface ThoughtVoiceFixture {
  microphoneRequests: { requestId: string; problemKey: string; sessionId?: string }[];
  audioRequests: number;
  audioMeters: number;
  closedAudioMeters: number;
  stoppedTracks: number;
  transcriptions: RecordedClip[];
  retries: { takeId: string; requestId: string }[];
  discards: string[];
  listRequests: number;
  cancellations: string[];
  notebookCommands: CompanionCommand[];
  releaseTranscript(text: string): Promise<void>;
  failTranscript(): Promise<string>;
  switchProblem(problem?: "first" | "second"): void;
  deliverShortcut(count: number): Promise<void>;
}

declare global {
  interface Window {
    __thoughtVoiceFixture: ThoughtVoiceFixture;
  }
}

async function openRibbon(page: Page, reducedMotion = true) {
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
    preferences: { theme: "ink", reducedMotion, snoozedUntil: null, thoughtShortcut: "Control+Option+R" },
    integration: { connected: true, paired: true, status: "Fixture connected" },
    codeforces: { checking: false, checkedAt: null, error: null },
    presentation: { expanded: false, thoughtShortcutPress: 7, thoughtShortcutAvailable: true },
  };

  await page.addInitScript(({ snapshot }) => {
    const listeners = new Set<(value: CompanionSnapshot) => void>();
    let pendingTranscript: {
      audio: RecordedClip;
      resolve: (result: { text: string }) => void;
      reject: (error: Error) => void;
    } | undefined;
    const presentation = (): NonNullable<CompanionSnapshot["presentation"]> =>
      snapshot.presentation ?? { expanded: false };
    function broadcast() {
      for (const listener of listeners) listener(structuredClone(snapshot));
    }
    function afterPaint() {
      return new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }
    // The mocked host's audio survives a fresh renderer document. The UI receives metadata only.
    const takeStorageKey = "fixture-thought-takes";
    const retainedTakes = () => JSON.parse(sessionStorage.getItem(takeStorageKey) ?? "[]") as FailedTake[];
    const writeTakes = (takes: FailedTake[]) => sessionStorage.setItem(takeStorageKey, JSON.stringify(takes));
    const fixture: ThoughtVoiceFixture = {
      microphoneRequests: [],
      audioRequests: 0,
      audioMeters: 0,
      closedAudioMeters: 0,
      stoppedTracks: 0,
      transcriptions: [],
      retries: [],
      discards: [],
      listRequests: 0,
      cancellations: [],
      notebookCommands: [],
      async releaseTranscript(text) {
        if (!pendingTranscript) throw new Error("No transcription is pending");
        pendingTranscript.resolve({ text });
        pendingTranscript = undefined;
        await afterPaint();
      },
      async failTranscript() {
        if (!pendingTranscript) throw new Error("No transcription is pending");
        const { audio, reject } = pendingTranscript;
        pendingTranscript = undefined;
        const capture = fixture.microphoneRequests.find(request => request.requestId === audio.requestId);
        const problem = snapshot.data.problems.find(problem => problem.id === snapshot.state.problemId);
        if (!capture || !problem) throw new Error("No attached problem for this recording");
        const take = { id: crypto.randomUUID(), problemKey: capture.problemKey, title: problem.title, recordedAt: snapshot.savedAt, audio };
        writeTakes([...retainedTakes(), take]);
        reject(new Error("Fixture transcription failed."));
        await afterPaint();
        return take.id;
      },
      switchProblem(problem = "second") {
        snapshot.state = {
          ...snapshot.state,
          identity: problem === "first" ? "contest:4:A" : "contest:5:A",
          problemId: `voice-${problem}`,
        };
        broadcast();
      },
      async deliverShortcut(count) {
        snapshot.presentation = { ...presentation(), thoughtShortcutPress: count };
        broadcast();
        await afterPaint();
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
            snapshot.presentation = { ...presentation(), expanded: payload === true };
            return null;
          case "today":
            snapshot.presentation = {
              ...presentation(),
              expanded: true,
              panelRequest: { id: (presentation().panelRequest?.id ?? 0) + 1, panel: "today" },
            };
            broadcast();
            return null;
          case "thought-voice-status":
            return { providerName: "Gemini", available: true };
          case "thought-microphone":
            fixture.microphoneRequests.push(payload as ThoughtVoiceFixture["microphoneRequests"][number]);
            return { allowed: true };
          case "thought-transcribe": {
            const input = payload as { requestId: string; mime: string; bytes: Uint8Array };
            const audio = { requestId: input.requestId, mime: input.mime, bytes: [...input.bytes] };
            fixture.transcriptions.push(audio);
            return new Promise((resolve, reject) => { pendingTranscript = { audio, resolve, reject }; });
          }
          case "thought-takes":
            fixture.listRequests++;
            return retainedTakes().map(({ id, problemKey, title, recordedAt }) => ({ id, problemKey, title, recordedAt }));
          case "thought-retry": {
            const input = payload as ThoughtVoiceFixture["retries"][number];
            fixture.retries.push(input);
            const take = retainedTakes().find(take => take.id === input.takeId);
            if (!take || take.problemKey !== snapshot.state.identity) throw new Error("Attach the recorded problem before retrying.");
            if (take.audio.bytes.join(",") !== "3,1,4") throw new Error("The saved audio was lost.");
            writeTakes(retainedTakes().filter(take => take.id !== input.takeId));
            return { text: "Recovered the original reasoning." };
          }
          case "thought-discard": {
            const { takeId } = payload as { takeId: string };
            fixture.discards.push(takeId);
            writeTakes(retainedTakes().filter(take => take.id !== takeId));
            return null;
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
    class FixtureAudioContext {
      state: AudioContextState = "running";

      constructor() { fixture.audioMeters++; }

      createMediaStreamSource() { return { connect() {} }; }

      createAnalyser() {
        return {
          fftSize: 256,
          getByteTimeDomainData(samples: Uint8Array) { samples.fill(146); },
        };
      }

      async close() { fixture.closedAudioMeters++; this.state = "closed"; }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FixtureAudioContext });
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
  expect(await page.evaluate(() => window.__thoughtVoiceFixture.audioMeters)).toBe(0);
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

test("the Ribbon seam reacts only while the microphone is recording and releases its meter", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openRibbon(page, false);
  const seam = page.locator(".desktop-ribbon-seam");
  await expect(seam).toHaveCount(0);
  await page.getByRole("button", { name: "Speak a thought", exact: true }).click();
  await expect(seam).toBeVisible();
  await expect.poll(() => seam.evaluate(element => Number(element.style.getPropertyValue("--ribbon-mic-level")))).toBeGreaterThan(0.5);
  await page.getByRole("button", { name: "Cancel recording", exact: true }).click();
  await expect(seam).toHaveCount(0);
  expect(await page.evaluate(() => {
    const { audioMeters, closedAudioMeters, stoppedTracks, transcriptions } = window.__thoughtVoiceFixture;
    return [audioMeters, closedAudioMeters, stoppedTracks, transcriptions.length];
  })).toEqual([1, 1, 1, 0]);
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

test("the recording shortcut ignores starting and replayed counts and toggles once per new press", async ({ page }) => {
  await openRibbon(page);
  const shortcut = (count: number) => page.evaluate(count => window.__thoughtVoiceFixture.deliverShortcut(count), count);
  const finish = page.getByRole("button", { name: "Finish recording and transcribe", exact: true });

  await shortcut(7);
  expect(await page.evaluate(() => window.__thoughtVoiceFixture.audioRequests)).toBe(0);
  await expect(page.getByLabel("Your thought", { exact: true })).toHaveCount(0);
  await shortcut(8);
  await expect(finish).toBeVisible();

  await shortcut(7); // A delayed snapshot must not let the next copy replay count 8.
  await shortcut(8);
  await expect(finish).toBeVisible();
  expect(await page.evaluate(() => window.__thoughtVoiceFixture.transcriptions)).toEqual([]);

  await shortcut(9);
  await expect.poll(() => page.evaluate(() => window.__thoughtVoiceFixture.transcriptions.length)).toBe(1);
  await shortcut(9);
  await page.evaluate(() => window.__thoughtVoiceFixture.releaseTranscript("Practice the invariant again."));
  await expect(page.getByLabel("Your thought", { exact: true })).toHaveValue("Practice the invariant again.");
  expect(await page.evaluate(() => {
    const fixture = window.__thoughtVoiceFixture;
    return {
      recordings: fixture.audioRequests,
      stoppedTracks: fixture.stoppedTracks,
      transcriptions: fixture.transcriptions.length,
      commands: fixture.notebookCommands,
    };
  })).toEqual({ recordings: 1, stoppedTracks: 1, transcriptions: 1, commands: [] });
});

async function failRecording(page: Page) {
  await openRibbon(page);
  await recordThought(page);
  const takeId = await page.evaluate(() => window.__thoughtVoiceFixture.failTranscript());
  await expect(page.getByRole("alert")).toContainText("Fixture transcription failed.");
  return takeId;
}

async function reopenFailedRecordings(page: Page) {
  await page.reload();
  await page.getByRole("button", { name: /^Open companion/ }).click();
  await page.getByRole("button", { name: /Recover spoken thoughts/ }).click();
  const failed = page.getByRole("region", { name: "Failed recordings", exact: true });
  await expect(failed.getByText("Parity practice", { exact: true })).toBeVisible();
  return failed;
}

test("retained audio can be retried after reopening and the reviewed transcript saves to the original problem", async ({ page }) => {
  const takeId = await failRecording(page);
  const failed = await reopenFailedRecordings(page);
  const retry = failed.getByRole("button", { name: "Retry", exact: true });
  const draft = page.getByLabel("Your thought", { exact: true });

  await page.evaluate(() => window.__thoughtVoiceFixture.switchProblem());
  await expect(retry).toBeDisabled();
  await expect(failed.getByText("Attach this problem to retry this recording.")).toBeVisible();
  await expect(draft).toHaveValue("");
  expect(await page.evaluate(() => window.__thoughtVoiceFixture.retries)).toEqual([]);

  await page.evaluate(() => window.__thoughtVoiceFixture.switchProblem("first"));
  await retry.click();
  await expect(draft).toHaveValue("Recovered the original reasoning.");
  await expect(retry).toHaveCount(0);
  expect(await page.evaluate(() => {
    const { retries, audioRequests, notebookCommands } = window.__thoughtVoiceFixture;
    return { retries, audioRequests, notebookCommands };
  })).toEqual({
    retries: [{ takeId, requestId: expect.any(String) }],
    audioRequests: 0,
    notebookCommands: [],
  });

  await draft.fill("Reviewed the original reasoning and checked the parity case.");
  await page.getByRole("button", { name: "Save thought locally", exact: true }).click();
  await expect(page.getByText("Thought saved locally.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__thoughtVoiceFixture.notebookCommands)).toEqual([
    expect.objectContaining({
      type: "thought",
      expectedProblemKey: "contest:4:A",
      payload: { text: "Reviewed the original reasoning and checked the parity case." },
    }),
  ]);
});

test("discard removes failed audio and it stays absent after reopening", async ({ page }) => {
  const takeId = await failRecording(page);
  const failed = await reopenFailedRecordings(page);
  await page.evaluate(() => window.__thoughtVoiceFixture.switchProblem());
  await expect(failed.getByRole("button", { name: "Retry", exact: true })).toBeDisabled();
  await failed.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(failed.getByText("Parity practice", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => {
    const { discards, retries, notebookCommands } = window.__thoughtVoiceFixture;
    return { discards, retries, notebookCommands };
  })).toEqual({ discards: [takeId], retries: [], notebookCommands: [] });

  await page.reload();
  await page.getByRole("button", { name: /^Open companion/ }).click();
  await expect(page.getByRole("button", { name: "Back to practice", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__thoughtVoiceFixture.listRequests)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /Recover spoken thoughts/ })).toHaveCount(0);
});
