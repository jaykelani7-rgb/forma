/** Small cancellation scope shared by microphone, transcription and playback. No browser globals. */
export const TUTOR_RECORDING_LIMITS={durationMs:60_000,bytes:8*1024*1024} as const;
export function recordedAudioMime(supported:(mime:string)=>boolean):string|null {
  return ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(supported)??null;
}
/** PCM from Gemini is wrapped as WAV by the host. Raw PCM must never reach Audio. */
export function speechAudioMime(value:string):string|null {
  const mime=value.split(';')[0].trim().toLowerCase();
  return ['audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/ogg','audio/webm'].includes(mime)?mime:null;
}
export class TutorVoiceController {
  private generation=0;
  private cleanups=new Set<()=>void>();
  begin():number{this.cancel();return this.generation;}
  current(token:number):boolean{return token===this.generation;}
  own(token:number,cleanup:()=>void):()=>void{
    let owned=true;const once=()=>{if(owned){owned=false;this.cleanups.delete(once);cleanup();}};
    if(!this.current(token))once();else this.cleanups.add(once);
    return once;
  }
  cancel():void{
    this.generation++;
    for(const cleanup of [...this.cleanups]){try{cleanup();}catch{/* Continue releasing the other resources. */}}
    this.cleanups.clear();
  }
}

/** Observe the recorder's existing stream locally without routing it to the speakers. */
function watchMicrophoneLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const audio = new AudioContext();
  try {
    const source = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    if (audio.state === "suspended") void audio.resume().catch(() => {});

    const samples = new Uint8Array(analyser.fftSize);
    let level = 0;
    const timer = setInterval(() => {
      if (audio.state !== "running") return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        energy += centered * centered;
      }
      const rms = Math.sqrt(energy / samples.length);
      const next = Math.min(1, rms * 5);
      level = next > level ? next : level * .55 + next * .45;
      onLevel(level);
    }, 50);
    return () => {
      clearInterval(timer);
      void audio.close().catch(() => {});
    };
  } catch (error) {
    void audio.close().catch(() => {});
    throw error;
  }
}

/** Capture bounded audio locally. The caller decides when and where to send it. */
export async function captureVoice({
  voice, token, current, authorize, onSeconds, onError, onStopped, onLevel,
}: {
  voice: TutorVoiceController;
  token: number;
  current: () => boolean;
  authorize: () => Promise<unknown>;
  onSeconds: (seconds: number) => void;
  onError: (message: string) => void;
  onStopped: (clip: Blob, timeLimit: boolean) => void;
  onLevel?: (level: number) => void;
}): Promise<(() => void) | undefined> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
    throw new Error("Voice recording is unavailable here.");
  const mimeType = recordedAudioMime(value => MediaRecorder.isTypeSupported(value));
  if (!mimeType) throw new Error("This device has no supported recording format.");

  await authorize();
  if (!current()) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  const releaseTracks = voice.own(token, () => stream.getTracks().forEach(track => track.stop()));
  if (!current()) {
    releaseTracks();
    return;
  }

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  let bytes = 0;
  let seconds = 0;
  let timeLimit = false;
  const stop = () => {
    if (current() && recorder.state !== "inactive") recorder.stop();
  };
  const limit = setTimeout(() => {
    timeLimit = true;
    stop();
  }, TUTOR_RECORDING_LIMITS.durationMs);
  const ticker = setInterval(() => {
    if (current()) onSeconds(++seconds);
  }, 1000);
  let releaseLevel: (() => void) | undefined;
  const release = voice.own(token, () => {
    clearTimeout(limit);
    clearInterval(ticker);
    recorder.onstop = null;
    recorder.onerror = null;
    recorder.ondataavailable = null;
    try {
      releaseLevel?.();
      if (recorder.state !== "inactive") recorder.stop();
    } finally {
      releaseTracks();
    }
  });

  recorder.ondataavailable = ({ data }) => {
    if (!current()) return;
    bytes += data.size;
    if (bytes > TUTOR_RECORDING_LIMITS.bytes) {
      release();
      onError("The recording is too large. Try a shorter recording.");
    } else {
      chunks.push(data);
    }
  };
  recorder.onerror = () => {
    release();
    if (current()) onError("Microphone recording failed. You can still type instead.");
  };
  recorder.onstop = () => {
    release();
    if (!current()) return;
    if (!bytes) onError("The recording was empty. Try again or type instead.");
    else onStopped(new Blob(chunks, { type: recorder.mimeType }), timeLimit);
  };
  try {
    recorder.start(250);
  } catch (error) {
    release();
    throw error;
  }
  if (onLevel) {
    try {
      releaseLevel = watchMicrophoneLevel(stream, onLevel);
    } catch {
      // The recorder can still run with a steady indicator.
    }
  }
  onSeconds(0);
  return stop;
}
