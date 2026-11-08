import { isThoughtAudio, type ThoughtTakeMetadata, type ThoughtTakeScope, type ThoughtTakes } from "./thought-take-store";

/** A lease begins before asynchronous checks, so cancellation also fences setup. */
export class TutorHostVoice {
  private active:AbortController|null=null;
  cancel():void {this.active?.abort();this.active=null;}
  begin(){
    this.cancel();const controller=new AbortController();this.active=controller;
    return {
      signal:controller.signal,
      assertCurrent:()=>{if(this.active!==controller||controller.signal.aborted)throw new DOMException('The voice request was stopped.','AbortError');},
      finish:()=>{if(this.active===controller)this.active=null;},
    };
  }
}

export interface ThoughtVoiceContext extends Omit<ThoughtTakeScope, "problemId"> {
  problemKey: string | null;
  problemId: string | null;
  title: string | null;
  sessionId?: string;
  contestMode: boolean;
}

interface ThoughtVoiceHost {
  readContext(): Promise<ThoughtVoiceContext>;
  requireProvider(): void;
  requestMicrophone(): Promise<void>;
  transcribe(bytes: Uint8Array, mime: string, signal: AbortSignal): Promise<string>;
  takes: ThoughtTakes;
}

interface ThoughtTarget extends ThoughtTakeScope {
  problemKey: string;
  title: string;
}

interface ThoughtRecording {
  target: ThoughtTarget;
  sessionId?: string;
  microphoneUntil: number;
  uploadUntil: number;
}

interface ThoughtRequest {
  id: string;
  lease: ReturnType<TutorHostVoice["begin"]>;
  recording?: ThoughtRecording;
  retryTakeId?: string;
}

const MICROPHONE_GRANT_MS = 15_000;
const RECORDING_DURATION_MS = 60_000;
const REVIEW_GRACE_MS = 60_000;

function voiceFields(payload: unknown, allowed: string[]): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(key => !allowed.includes(key))) {
    throw new Error("Invalid spoken thought request.");
  }
  return payload as Record<string, unknown>;
}

function thoughtRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value)) {
    throw new Error("Invalid spoken thought request ID.");
  }
  return value;
}

/** A single, short-lived permission grant bound to the problem and session where recording began. */
export class ThoughtHostVoice {
  private readonly voice = new TutorHostVoice();
  private request: ThoughtRequest | null = null;

  constructor(private readonly host: ThoughtVoiceHost, private readonly now = () => performance.now()) {}

  get microphoneAllowed(): boolean {
    return this.now() < (this.request?.recording?.microphoneUntil ?? 0);
  }

  cancel(): void {
    this.request = null;
    this.voice.cancel();
  }

  cancelRequest(payload: unknown): void {
    const { requestId } = voiceFields(payload, ["requestId"]);
    if (thoughtRequestId(requestId) === this.request?.id) this.cancel();
  }

  listTakes(): ThoughtTakeMetadata[] {
    return this.host.takes.list();
  }

  discardTake(payload: unknown): void {
    const { takeId } = voiceFields(payload, ["takeId"]);
    const id = thoughtRequestId(takeId);
    if (this.request?.retryTakeId === id) this.cancel();
    this.host.takes.remove(id);
  }

  async start(payload: unknown): Promise<{ allowed: true }> {
    const { requestId, problemKey, sessionId } = voiceFields(payload, ["requestId", "problemKey", "sessionId"]);
    const id = thoughtRequestId(requestId);
    if (typeof problemKey !== "string" || problemKey.length > 100 || !/^(contest|gym):\d+:[A-Z]\d*$/.test(problemKey) || (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId || sessionId.length > 100))) {
      throw new Error("Choose an active problem to record a thought.");
    }
    const request = this.begin(id);
    try {
      const context = await this.currentContext(request);
      if (context.problemKey !== problemKey || context.sessionId !== sessionId || !context.problemId) {
        throw new Error("The active problem or session changed. Record again for the current problem.");
      }
      const target = {
        problemKey, problemId: context.problemId, title: context.title ?? problemKey,
        profileKey: context.profileKey, recoveryEpoch: context.recoveryEpoch,
      };
      this.host.requireProvider();
      await this.host.requestMicrophone();
      await this.checkContext(request, target, sessionId);
      this.host.requireProvider();
      const microphoneUntil = this.now() + MICROPHONE_GRANT_MS;
      request.recording = { target, sessionId, microphoneUntil, uploadUntil: microphoneUntil + RECORDING_DURATION_MS + REVIEW_GRACE_MS };
      return { allowed: true };
    } catch (error) {
      this.finish(request);
      throw error;
    }
  }

  async transcribe(payload: unknown): Promise<{ text: string }> {
    const { requestId, bytes, mime } = voiceFields(payload, ["requestId", "bytes", "mime"]);
    const id = thoughtRequestId(requestId);
    if (typeof mime !== "string" || !isThoughtAudio(bytes, mime)) {
      throw new Error("Choose a supported, nonempty recording no larger than 8 MB.");
    }
    const request = this.request;
    const recording = request?.recording;
    if (!request || request.id !== id || !recording) throw new Error("Start a new recording to transcribe your thought.");
    request.recording = undefined;
    const { target, sessionId, uploadUntil } = recording;
    try {
      if (this.now() >= uploadUntil) throw new Error("This recording expired. Record again or type your thought.");
      await this.checkContext(request, target, sessionId);
      const recordedAt = new Date().toISOString();
      let text: string;
      try {
        this.host.requireProvider();
        text = await this.host.transcribe(bytes, mime, request.lease.signal);
      } catch (error) {
        await this.checkContext(request, target, sessionId);
        const message = error instanceof Error ? error.message : "Transcription failed.";
        try {
          this.host.takes.keep({ id, ...target, recordedAt, bytes, mime });
        } catch (saveError) {
          const reason = saveError instanceof Error ? saveError.message : "Local recording storage is unavailable.";
          throw new Error(`${message} Recording was not kept. ${reason}`);
        }
        throw new Error(`${message} Recording kept on this device. Retry or discard it.`);
      }
      await this.checkContext(request, target, sessionId);
      return { text };
    } finally {
      this.finish(request);
    }
  }

  async retryTake(payload: unknown): Promise<{ text: string }> {
    const { requestId, takeId } = voiceFields(payload, ["requestId", "takeId"]);
    const id = thoughtRequestId(requestId);
    const retryTakeId = thoughtRequestId(takeId);
    const request = this.begin(id, retryTakeId);
    try {
      const context = await this.currentContext(request);
      const take = this.host.takes.read(retryTakeId);
      if (!take) throw new Error("This saved recording is no longer available.");
      if (context.recoveryEpoch !== take.recoveryEpoch) {
        throw new Error("This recording belongs to the notebook before a restore. You can discard it or record again.");
      }
      if (!this.matchesTarget(context, take)) {
        throw new Error("Return to the original problem and Codeforces profile to retry this recording.");
      }
      this.host.requireProvider();
      const text = await this.host.transcribe(take.bytes, take.mime, request.lease.signal);
      await this.checkContext(request, take, context.sessionId);
      this.host.takes.remove(retryTakeId);
      return { text };
    } finally {
      this.finish(request);
    }
  }

  private begin(id: string, retryTakeId?: string): ThoughtRequest {
    const request = { id, lease: this.voice.begin(), retryTakeId };
    this.request = request;
    return request;
  }

  private async currentContext(request: ThoughtRequest): Promise<ThoughtVoiceContext> {
    request.lease.assertCurrent();
    const context = await this.host.readContext();
    request.lease.assertCurrent();
    if (context.contestMode) throw new Error("Voice transcription is off in contest mode. You can type your thought.");
    return context;
  }

  private matchesTarget(context: ThoughtVoiceContext, target: ThoughtTarget): boolean {
    return context.problemKey === target.problemKey && context.problemId === target.problemId
      && context.profileKey === target.profileKey && context.recoveryEpoch === target.recoveryEpoch;
  }

  private async checkContext(request: ThoughtRequest, target: ThoughtTarget, sessionId?: string): Promise<void> {
    const context = await this.currentContext(request);
    if (!this.matchesTarget(context, target) || context.sessionId !== sessionId) {
      throw new Error("The active problem or session changed. Return to the original problem to continue.");
    }
  }

  private finish(request: ThoughtRequest): void {
    if (this.request === request) this.request = null;
    request.lease.finish();
  }
}
