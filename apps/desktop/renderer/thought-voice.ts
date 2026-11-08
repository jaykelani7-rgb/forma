import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CaptureTarget } from "../../../packages/core/src/capture-target";
import type { FormaBridge } from "./api";
import { captureVoice, TutorVoiceController } from "./tutor-voice";

type Phase = "idle" | "permission" | "recording" | "recorded" | "transcribing";

export function useThoughtVoice(
  bridge: FormaBridge | null,
  active: boolean,
  problemKey: string | null | undefined,
  sessionId: string | undefined,
) {
  const [voice] = useState(() => new TutorVoiceController());
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<{ id: string; target: CaptureTarget } | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const sendClip = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    const pending = request.current;
    request.current = null;
    stop.current = null;
    sendClip.current = null;
    voice.cancel();
    setPhase("idle");
    if (pending) void bridge?.ui("thought-voice-cancel", { requestId: pending.id }).catch(() => {});
  }, [bridge, voice]);

  useLayoutEffect(() => {
    if (!active) {
      cancel();
      setError("");
      setNotice("");
      setProvider("");
    }
  }, [active, cancel]);
  useLayoutEffect(() => {
    const target = request.current?.target;
    if (target && (problemKey !== target.problemKey || sessionId !== target.sessionId)) {
      cancel();
      setError("The practice context changed. Start a new recording for the current problem.");
    }
  }, [problemKey, sessionId, cancel]);
  useEffect(() => {
    function visibilityChanged() {
      if (document.hidden) cancel();
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    const unsubscribe = bridge?.subscribeTutor?.(event => {
      if (event.kind === "recovery" || event.kind === "configuration") cancel();
    });
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      unsubscribe?.();
      cancel();
    };
  }, [bridge, cancel]);

  async function start(target: CaptureTarget, onTranscript: (text: string) => void) {
    if (!bridge || request.current) return;
    const id = crypto.randomUUID();
    const token = voice.begin();
    request.current = { id, target };
    const current = () => voice.current(token) && !document.hidden;
    const fail = (error: unknown) => {
      if (!current()) return;
      cancel();
      setError(error instanceof Error ? error.message : "Could not transcribe this thought. You can still type it.");
    };
    setError("");
    setNotice("");
    setProvider("");
    setPhase("permission");

    async function transcribe(clip: Blob) {
      if (!current()) return;
      sendClip.current = null;
      setPhase("transcribing");
      try {
        const bytes = new Uint8Array(await clip.arrayBuffer());
        if (!current()) return;
        const { text } = await bridge!.ui("thought-transcribe", {
          requestId: id, bytes, mime: clip.type,
        }) as { text: string };
        if (!current()) return;
        if (!text.trim()) throw new Error("No speech was recognized. Try again or type your thought.");
        onTranscript(text.trim());
        setNotice("Transcript added. Review or edit it before saving.");
        request.current = null;
        setPhase("idle");
      } catch (error) {
        fail(error);
      }
    }

    try {
      const status = await bridge.ui("thought-voice-status") as {
        available: boolean; providerName: string; reason?: string;
      };
      if (!current()) return;
      setProvider(status.providerName);
      if (!status.available) throw new Error(status.reason || "Set up Tutor transcription to speak a thought.");
      const finish = await captureVoice({
        voice,
        token,
        current,
        authorize: () => bridge.ui("thought-microphone", {
          requestId: id, problemKey: target.problemKey,
          ...(target.sessionId ? { sessionId: target.sessionId } : {}),
        }),
        onSeconds: setSeconds,
        onError: fail,
        onStopped: (clip, timeLimit) => {
          stop.current = null;
          if (timeLimit) {
            sendClip.current = () => void transcribe(clip);
            setPhase("recorded");
          } else {
            void transcribe(clip);
          }
        },
      });
      if (current() && finish) {
        stop.current = finish;
        setPhase("recording");
      }
    } catch (error) {
      fail(error);
    }
  }

  return {
    phase, seconds, provider, error, notice, start, cancel,
    finish: () => (stop.current ?? sendClip.current)?.(),
  };
}
