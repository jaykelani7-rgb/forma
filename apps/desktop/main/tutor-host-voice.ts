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

export interface ThoughtVoiceContext {
  problemKey: string | null;
  sessionId?: string;
  contestMode: boolean;
}

interface ThoughtVoiceHost {
  readContext(): Promise<ThoughtVoiceContext>;
  requireProvider(): void;
  requestMicrophone(): Promise<void>;
  transcribe(bytes: Uint8Array, mime: string, signal: AbortSignal): Promise<string>;
}

interface ThoughtRecording {
  id: string;
  problemKey: string;
  sessionId?: string;
  lease: ReturnType<TutorHostVoice["begin"]>;
  microphoneUntil: number;
  uploadUntil: number;
}

const MICROPHONE_GRANT_MS = 15_000;
const RECORDING_DURATION_MS = 60_000;
const REVIEW_GRACE_MS = 60_000;
const RECORDING_LIMIT_BYTES = 8 * 1024 * 1024;
const RECORDING_FORMATS = new Set(["audio/webm", "audio/mp4"]);

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
  private recording: ThoughtRecording | null = null;

  constructor(private readonly host: ThoughtVoiceHost, private readonly now = () => performance.now()) {}

  get microphoneAllowed(): boolean {
    return this.recording !== null && this.now() < this.recording.microphoneUntil;
  }

  cancel(): void {
    this.recording = null;
    this.voice.cancel();
  }

  cancelRequest(payload: unknown): void {
    const { requestId } = voiceFields(payload, ["requestId"]);
    if (thoughtRequestId(requestId) === this.recording?.id) this.cancel();
  }

  async start(payload: unknown): Promise<{ allowed: true }> {
    const { requestId, problemKey, sessionId } = voiceFields(payload, ["requestId", "problemKey", "sessionId"]);
    const id = thoughtRequestId(requestId);
    if (typeof problemKey !== "string" || problemKey.length > 100 || !/^(contest|gym):\d+:[A-Z]\d*$/.test(problemKey) || (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId || sessionId.length > 100))) {
      throw new Error("Choose an active problem to record a thought.");
    }
    this.cancel();
    const recording: ThoughtRecording = { id, problemKey, sessionId, lease: this.voice.begin(), microphoneUntil: 0, uploadUntil: 0 };
    this.recording = recording;
    try {
      await this.checkContext(recording);
      await this.host.requestMicrophone();
      await this.checkContext(recording);
      recording.microphoneUntil = this.now() + MICROPHONE_GRANT_MS;
      recording.uploadUntil = recording.microphoneUntil + RECORDING_DURATION_MS + REVIEW_GRACE_MS;
      return { allowed: true };
    } catch (error) {
      this.finish(recording);
      throw error;
    }
  }

  async transcribe(payload: unknown): Promise<{ text: string }> {
    const { requestId, bytes, mime } = voiceFields(payload, ["requestId", "bytes", "mime"]);
    const id = thoughtRequestId(requestId);
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > RECORDING_LIMIT_BYTES || typeof mime !== "string" || mime.length > 128 || !RECORDING_FORMATS.has(mime.split(";")[0].trim().toLowerCase())) {
      throw new Error("Choose a supported, nonempty recording no larger than 8 MB.");
    }
    const recording = this.recording;
    if (!recording || recording.id !== id || !recording.uploadUntil) throw new Error("Start a new recording to transcribe your thought.");
    const expiresAt = recording.uploadUntil;
    recording.microphoneUntil = recording.uploadUntil = 0;
    try {
      if (this.now() >= expiresAt) throw new Error("This recording expired. Record again or type your thought.");
      await this.checkContext(recording);
      const text = await this.host.transcribe(bytes, mime, recording.lease.signal);
      await this.checkContext(recording);
      return { text };
    } finally {
      this.finish(recording);
    }
  }

  private async checkContext(recording: ThoughtRecording): Promise<void> {
    recording.lease.assertCurrent();
    const context = await this.host.readContext();
    recording.lease.assertCurrent();
    if (context.problemKey !== recording.problemKey || context.sessionId !== recording.sessionId) {
      throw new Error("The active problem or session changed. Record again for the current problem.");
    }
    if (context.contestMode) throw new Error("Voice transcription is off in contest mode. You can type your thought.");
    this.host.requireProvider();
  }

  private finish(recording: ThoughtRecording): void {
    if (this.recording === recording) this.recording = null;
    recording.lease.finish();
  }
}
