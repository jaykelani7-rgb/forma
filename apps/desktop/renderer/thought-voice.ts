import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CaptureTarget } from "../../../packages/core/src/capture-target";
import type { FormaBridge } from "./api";
import { captureVoice, TutorVoiceController } from "./tutor-voice";

type Phase = "idle" | "permission" | "recording" | "recorded" | "transcribing";

export type ThoughtTake = {
  id: string;
  problemKey: string;
  title: string;
  recordedAt: string;
};

export type ThoughtTakeRecoveryState = {
  takes: ThoughtTake[];
  loading: boolean;
  error: string;
  retryingId: string | null;
  discardingId: string | null;
  refresh: () => Promise<void>;
  discard: (takeId: string) => Promise<void>;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useThoughtVoice(
  bridge: FormaBridge | null,
  active: boolean,
  problemKey: string | null | undefined,
  sessionId: string | undefined,
  meterEnabled = true,
) {
  const [voice] = useState(() => new TutorVoiceController());
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [takes, setTakes] = useState<ThoughtTake[]>([]);
  const [takesLoading, setTakesLoading] = useState(false);
  const [takesError, setTakesError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const listing = useRef(0);
  const discardLock = useRef(false);
  const request = useRef<{
    id: string;
    target: CaptureTarget;
    takeId?: string;
  } | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const sendClip = useRef<(() => void) | null>(null);
  const levelRef = useRef<HTMLSpanElement>(null);

  const invalidateListing = useCallback(() => {
    listing.current++;
  }, []);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    const generation = ++listing.current;
    setTakesLoading(true);
    setTakesError("");
    try {
      const result = await bridge.ui("thought-takes");
      if (listing.current !== generation) return;
      if (!Array.isArray(result))
        throw new Error("The saved recordings list is unavailable.");
      setTakes(result as ThoughtTake[]);
    } catch (error) {
      if (listing.current === generation) {
        setTakesError(
          errorMessage(
            error,
            "Could not load saved recordings. Refresh to try again.",
          ),
        );
      }
    } finally {
      if (listing.current === generation) setTakesLoading(false);
    }
  }, [bridge]);

  const cancel = useCallback(() => {
    const pending = request.current;
    request.current = null;
    stop.current = null;
    sendClip.current = null;
    voice.cancel();
    setPhase("idle");
    setRetryingId(null);
    if (pending)
      void bridge
        ?.ui("thought-voice-cancel", { requestId: pending.id })
        .catch(() => {});
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
    const pending = request.current;
    if (
      pending &&
      (problemKey !== pending.target.problemKey ||
        sessionId !== pending.target.sessionId)
    ) {
      cancel();
      setError(
        pending.takeId
          ? "The practice context changed. Return to the original problem to retry a saved recording."
          : "The practice context changed. Start a new recording for the current problem.",
      );
    }
  }, [problemKey, sessionId, cancel]);
  useEffect(() => {
    void refresh();
    return invalidateListing;
  }, [active, invalidateListing, refresh]);
  useEffect(() => {
    function visibilityChanged() {
      if (document.hidden) cancel();
      else void refresh();
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    const unsubscribe = bridge?.subscribeTutor?.((event) => {
      if (event.kind === "recovery" || event.kind === "configuration") {
        cancel();
        void refresh();
      }
    });
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      unsubscribe?.();
      cancel();
    };
  }, [bridge, cancel, refresh]);

  function begin(target: CaptureTarget, takeId?: string) {
    if (request.current || discardLock.current || document.hidden) return;
    const id = crypto.randomUUID();
    const token = voice.begin();
    request.current = { id, target, takeId };
    const current = () =>
      request.current?.id === id && voice.current(token) && !document.hidden;
    const fail = (error: unknown) => {
      if (!current()) return;
      cancel();
      setError(
        errorMessage(
          error,
          "Could not transcribe this thought. You can still type it.",
        ),
      );
    };
    const accept = (text: string, onTranscript: (text: string) => void) => {
      if (!current()) return;
      if (!text.trim())
        throw new Error(
          "No speech was recognized. Try again or type your thought.",
        );
      onTranscript(text.trim());
      setNotice("Transcript added. Review or edit it before saving.");
      request.current = null;
      setPhase("idle");
      setRetryingId(null);
    };
    setError("");
    setNotice("");
    setProvider("");
    return { id, token, current, fail, accept };
  }

  async function start(
    target: CaptureTarget,
    onTranscript: (text: string) => void,
  ) {
    if (!bridge) return;
    const pending = begin(target);
    if (!pending) return;
    const { id, token, current, fail, accept } = pending;
    const audioBridge = bridge;
    setPhase("permission");

    async function transcribe(clip: Blob) {
      if (!current()) return;
      sendClip.current = null;
      setPhase("transcribing");
      try {
        const bytes = new Uint8Array(await clip.arrayBuffer());
        if (!current()) return;
        const { text } = (await audioBridge.ui("thought-transcribe", {
          requestId: id,
          bytes,
          mime: clip.type,
        })) as { text: string };
        accept(text, onTranscript);
      } catch (error) {
        fail(error);
        void refresh();
      }
    }

    try {
      const status = (await bridge.ui("thought-voice-status")) as {
        available: boolean;
        providerName: string;
        reason?: string;
      };
      if (!current()) return;
      setProvider(status.providerName);
      if (!status.available)
        throw new Error(
          status.reason || "Set up Tutor transcription to speak a thought.",
        );
      const finish = await captureVoice({
        voice,
        token,
        current,
        authorize: () =>
          bridge.ui("thought-microphone", {
            requestId: id,
            problemKey: target.problemKey,
            ...(target.sessionId ? { sessionId: target.sessionId } : {}),
          }),
        onSeconds: setSeconds,
        onLevel: meterEnabled ? level => levelRef.current?.style.setProperty("--ribbon-mic-level", String(level)) : undefined,
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

  async function retry(
    takeId: string,
    target: CaptureTarget,
    onTranscript: (text: string) => void,
  ) {
    if (
      !bridge ||
      !active ||
      target.problemKey !== problemKey ||
      target.sessionId !== sessionId ||
      !takes.some(
        (take) => take.id === takeId && take.problemKey === problemKey,
      )
    )
      return;
    const pending = begin(target, takeId);
    if (!pending) return;
    setRetryingId(takeId);
    setPhase("transcribing");
    try {
      const { text } = (await bridge.ui("thought-retry", {
        takeId,
        requestId: pending.id,
      })) as { text: string };
      pending.accept(text, onTranscript);
      setTakes((current) => current.filter((take) => take.id !== takeId));
    } catch (error) {
      pending.fail(error);
    } finally {
      void refresh();
    }
  }

  async function discard(takeId: string) {
    if (
      !bridge ||
      request.current ||
      discardLock.current ||
      !takes.some((take) => take.id === takeId)
    )
      return;
    discardLock.current = true;
    setDiscardingId(takeId);
    setTakesError("");
    try {
      await bridge.ui("thought-discard", { takeId });
      setTakes((current) => current.filter((take) => take.id !== takeId));
      await refresh();
    } catch (error) {
      setTakesError(
        errorMessage(
          error,
          "Could not discard the recording. Refresh to check if it is still saved.",
        ),
      );
    } finally {
      discardLock.current = false;
      setDiscardingId(null);
    }
  }

  const recovery: ThoughtTakeRecoveryState = {
    takes,
    loading: takesLoading,
    error: takesError,
    retryingId,
    discardingId,
    refresh,
    discard,
  };
  return {
    phase,
    levelRef,
    seconds,
    provider,
    error,
    notice,
    start,
    cancel,
    retry,
    recovery,
    finish: () => (stop.current ?? sendClip.current)?.(),
  };
}
