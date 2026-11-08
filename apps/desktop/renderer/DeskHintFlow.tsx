import { useCallback, useEffect, useRef, useState } from "react";
import type { DeskHintReview, TutorSendInput, TutorTurn } from "../../../packages/tutor/types";
import type { FormaBridge } from "./api";
import { DeskHintCard } from "./DeskHintCard";
import { mergeTutorTurns } from "./tutor-stream-view";

const question = "Give me one small hint about what to try next.";
const hypothesisLimit = 2_000;
const pendingStatus = (turn: TutorTurn) => turn.status === "queued" || turn.status === "streaming";
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Tutor couldn’t complete that action.";

type Attempt = { input: TutorSendInput; running: boolean };

export function DeskHintFlow({
  bridge, problemId, hypothesis, onClose, onOpenTutor, onLeaveThread, onKeep, onOpenLink,
}: {
  bridge: FormaBridge;
  problemId: string;
  hypothesis?: string;
  onClose: () => void;
  onOpenTutor: () => void;
  onLeaveThread: () => void;
  onKeep: (text: string) => void;
  onOpenLink: (url: string) => void;
}) {
  const [review, setReview] = useState<DeskHintReview | null>(null);
  const [turn, setTurn] = useState<TutorTurn | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [locked, setLocked] = useState(false);
  const [included, setIncluded] = useState(false);
  const [excerpt] = useState(() => hypothesis?.slice(0, hypothesisLimit).trim());
  const generation = useRef(0);
  const attempt = useRef<Attempt | null>(null);
  const exposure = useRef<{ requestId: string; pending: Promise<void> } | null>(null);

  const refresh = useCallback(async () => {
    if (attempt.current?.running) return;
    const sequence = ++generation.current;
    attempt.current = null;
    setLocked(false);
    setTurn(null);
    setReview(null);
    setLoading(true);
    setError("");
    try {
      const next = await bridge.ui("desk-hint-review", { problemId }) as DeskHintReview;
      if (sequence === generation.current) setReview(next);
    } catch (reason) {
      if (sequence === generation.current) setError(message(reason));
    } finally {
      if (sequence === generation.current) setLoading(false);
    }
  }, [bridge, problemId]);

  const readTurn = useCallback(async (current: Attempt) => {
    const { conversationId, turnId, requestId } = current.input;
    const rows = await bridge.ui("tutor-turns", conversationId) as TutorTurn[];
    const found = rows.find(row => row.id === turnId && row.requestId === requestId);
    if (attempt.current !== current || !found) return false;
    setTurn(previous => mergeTutorTurns(previous ? [previous] : [], [found])[0]);
    if (!pendingStatus(found)) {
      current.running = false;
      setRunning(false);
    }
    return true;
  }, [bridge]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidateReview = () => { generation.current++; };
    const cancelAttempt = () => {
      const current = attempt.current;
      attempt.current = null;
      if (current?.running) void bridge.ui("tutor-stop", current.input.requestId).catch(() => {});
    };
    const stopRefreshing = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const unsubscribe = bridge.subscribeTutor?.(event => {
      if (event.kind === "recovery" || event.kind === "configuration") {
        invalidateReview();
        cancelAttempt();
        stopRefreshing();
        setTurn(null);
        setReview(null);
        setRunning(false);
        setLocked(false);
        setLoading(false);
        setError("Your notebook or Tutor settings changed. Review the hint context again.");
        return;
      }
      if (event.kind !== "delta" && event.kind !== "updated") return;
      const current = attempt.current;
      if (!current || current.input.requestId !== event.requestId || current.input.turnId !== event.turnId) return;
      if (event.kind === "delta" && timer !== undefined) return;
      stopRefreshing();
      const update = () => {
        timer = undefined;
        void readTurn(current).catch(reason => {
          if (attempt.current === current) setError(message(reason));
        });
      };
      if (event.kind === "updated") update();
      else timer = setTimeout(update, 45);
    });
    void refresh();
    return () => {
      invalidateReview();
      stopRefreshing();
      unsubscribe?.();
      cancelAttempt();
    };
  }, [bridge, readTurn, refresh]);

  async function send() {
    if (!review?.conversationId || !review.statement?.complete || review.contestMode || attempt.current?.running || turn?.status === "completed") return;
    const previous = attempt.current?.input;
    const input: TutorSendInput = previous ? {
      ...previous,
      requestId: turn?.status === "failed" || turn?.status === "interrupted" ? crypto.randomUUID() : previous.requestId,
    } : {
      turnId: crypto.randomUUID(), requestId: crypto.randomUUID(), conversationId: review.conversationId,
      action: "small-hint", statementId: review.statement.id, codeId: null, noteIds: [],
      text: included && excerpt ? `${question}\n\nMy current hypothesis:\n${excerpt}` : question,
      deskHint: review.target,
    };
    const current = { input, running: true };
    attempt.current = current;
    setLocked(true);
    setError("");
    setTurn(null);
    setRunning(true);
    let dispatched = false;
    try {
      await bridge.ui("tutor-send", input);
      dispatched = true;
      await readTurn(current);
    } catch (reason) {
      if (attempt.current !== current) return;
      // A lost acknowledgement can follow a successful write. Reconcile before offering a retry.
      const found = await readTurn(current).catch(() => false);
      if (attempt.current !== current || found) return;
      if (!dispatched) {
        current.running = false;
        setRunning(false);
      }
      setError(message(reason));
    }
  }

  async function stop() {
    const current = attempt.current;
    if (!current?.running) return;
    try {
      await bridge.ui("tutor-stop", current.input.requestId);
      if (!await readTurn(current) && attempt.current === current) {
        current.running = false;
        setRunning(false);
      }
    } catch (reason) {
      if (attempt.current === current) setError(message(reason));
    }
  }

  function acknowledge() {
    if (!turn?.assistantText.trim() || turn.exposed || document.hidden) return Promise.resolve();
    if (exposure.current?.requestId === turn.requestId) return exposure.current.pending;
    const requestId = turn.requestId;
    const pending = bridge.ui("tutor-exposed", { turnId: turn.id, requestId })
      .then(() => {
        if (attempt.current?.input.requestId === requestId) {
          setTurn(current => current?.requestId === requestId ? { ...current, exposed: true } : current);
        }
      })
      .catch(reason => {
        if (exposure.current?.requestId === requestId) exposure.current = null;
        throw reason;
      });
    exposure.current = { requestId, pending };
    return pending;
  }

  async function keep(text: string) {
    const current = attempt.current;
    if (!current || turn?.status !== "completed" || !text.trim()) return;
    try {
      await acknowledge();
      if (attempt.current === current) onKeep(text);
    } catch (reason) {
      if (attempt.current === current) setError(message(reason));
    }
  }

  function expose() {
    const current = attempt.current;
    void acknowledge().catch(reason => {
      if (attempt.current === current) setError(message(reason));
    });
  }

  return <DeskHintCard review={review} question={question} hypothesis={excerpt} includeHypothesis={included}
    onIncludeHypothesisChange={next => { if (!attempt.current) setIncluded(next); }}
    error={error} loading={loading} running={running} turn={turn} locked={locked}
    onSend={() => void send()} onStop={() => void stop()} onClose={onClose} onOpenTutor={onOpenTutor}
    onLeaveThread={onLeaveThread} onKeep={text => void keep(text)} onOpenLink={onOpenLink}
    onExpose={expose} onRefresh={() => void refresh()}/>;
}
