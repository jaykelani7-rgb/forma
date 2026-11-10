import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IDEA_LIMITS, readIdeaChallenge, readIdeaOutline, readIdeaQuestion } from "../../../packages/tutor/idea";
import type { DeskIdeaReview, IdeaChallenge, IdeaOutline, TutorSendInput, TutorTurn } from "../../../packages/tutor/types";
import type { FormaBridge } from "./api";
import { DeskIdeaCard } from "./DeskIdeaCard";
import { ChallengeRunPanel } from "./ChallengeRunPanel";

type Stage = "outline" | "challenge";
type Request = { stage: Stage; input: TutorSendInput; assumption?: string };
type ChallengeResult = { value: IdeaChallenge; turn: TutorTurn; assumption: string };
export type DeskIdeaDraft = { explanation: string; outline: IdeaOutline | null; selected: number | null; outlineKept: boolean };
export const emptyDeskIdeaDraft: DeskIdeaDraft = { explanation: "", outline: null, selected: null, outlineKept: false };

const errorText = (error: unknown) => error instanceof Error ? error.message : "Tutor couldn’t complete that action.";

export function DeskIdeaFlow({
  bridge, problemId, draft, onDraftChange, renderVoiceControls,
  covered, blocked, savedRunEvidence, onClose, onOpenTutor, onKeepOutline, onKeepChallenge, onSaveRun,
}: {
  bridge: FormaBridge;
  problemId: string;
  draft: DeskIdeaDraft;
  onDraftChange: (patch: Partial<DeskIdeaDraft>) => void;
  renderVoiceControls: (onTranscript: (text: string) => void, disabled: boolean) => ReactNode;
  covered: boolean;
  blocked: boolean;
  savedRunEvidence: ReadonlySet<string>;
  onClose: () => void;
  onOpenTutor: () => void;
  onKeepOutline: (text: string) => Promise<boolean>;
  onKeepChallenge: (text: string) => void;
  onSaveRun: (text: string) => Promise<boolean>;
}) {
  const { explanation, outline, selected, outlineKept } = draft;
  const [review, setReview] = useState<DeskIdeaReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [includeStatement, setIncludeStatement] = useState(false);
  const [includeCode, setIncludeCode] = useState(false);
  const [result, setResult] = useState<ChallengeResult | null>(null);
  const [pending, setPending] = useState<Stage | null>(null);
  const [saving, setSaving] = useState(false);
  const request = useRef<Request | null>(null);
  const reviewVersion = useRef(0);
  const savingResult = useRef(false);
  const exposure = useRef<{ requestId: string; saved: Promise<unknown> } | null>(null);

  const refresh = useCallback(async (restoreChallenge = false) => {
    if (request.current) return;
    const version = ++reviewVersion.current;
    setLoading(true);
    setError("");
    setReview(null);
    setIncludeStatement(false);
    setIncludeCode(false);
    setResult(null);
    try {
      const next = await bridge.ui("desk-idea-review", { problemId }) as DeskIdeaReview;
      if (reviewVersion.current !== version) return;
      setReview(next);
      if (restoreChallenge && !next.contestMode && next.conversationId) {
        const turns = await bridge.ui("tutor-turns", next.conversationId) as TutorTurn[];
        if (reviewVersion.current !== version) return;
        const turn = turns.findLast(item => item.action === "challenge-assumption" && item.standalone &&
          item.status === "completed" && item.context.problemId === problemId && item.context.sessionId === next.target.sessionId);
        if (turn) setResult({ value: readIdeaChallenge(turn.assistantText), turn, assumption: readIdeaQuestion(turn.userText).assumption });
      }
    } catch (reason) {
      if (reviewVersion.current === version) setError(errorText(reason));
    } finally {
      if (reviewVersion.current === version) setLoading(false);
    }
  }, [bridge, problemId]);

  const readRequest = useCallback(async (current: Request) => {
    const { input, stage } = current;
    const turns = await bridge.ui("tutor-turns", input.conversationId) as TutorTurn[];
    if (request.current !== current) return true;
    const turn = turns.find(item => item.id === input.turnId && item.requestId === input.requestId);
    if (!turn) return false;
    if (turn.status === "queued" || turn.status === "streaming") return true;
    request.current = null;
    setPending(null);
    setReview(previous => previous ? { ...previous, activeRequestId: null } : null);
    setError("");
    if (turn.status !== "completed") {
      setError(turn.error ?? "The request stopped. Your idea is still here.");
      return true;
    }
    try {
      if (stage === "outline") {
        const next = readIdeaOutline(turn.assistantText);
        onDraftChange({ outline: next, selected: next.assumptions.length === 1 ? 0 : null, outlineKept: false });
      } else if (current.assumption) {
        setResult({ value: readIdeaChallenge(turn.assistantText), turn, assumption: current.assumption });
      }
    } catch (reason) {
      setError(errorText(reason));
    }
    return true;
  }, [bridge, onDraftChange]);

  useEffect(() => {
    const invalidateReview = () => { reviewVersion.current++; };
    function releaseRequest() {
      const current = request.current;
      request.current = null;
      if (current) void bridge.ui("tutor-stop", current.input.requestId).catch(() => {});
    }
    const unsubscribe = bridge.subscribeTutor?.(event => {
      if (event.kind === "recovery" || event.kind === "configuration") {
        invalidateReview();
        releaseRequest();
        setPending(null);
        void refresh();
        return;
      }
      const current = request.current;
      if (event.kind !== "updated" || !current || event.requestId !== current.input.requestId) return;
      void readRequest(current).catch(reason => {
        if (request.current === current) setError(errorText(reason));
      });
    });
    void refresh(true);
    return () => {
      invalidateReview();
      unsubscribe?.();
      releaseRequest();
    };
  }, [bridge, readRequest, refresh]);

  function changeExplanation(text: string) {
    onDraftChange({ explanation: text, outline: null, selected: null, outlineKept: false });
    setResult(null);
  }

  function changeOutline(value: IdeaOutline) {
    onDraftChange({ outline: value, outlineKept: false });
    setResult(null);
  }

  async function run(stage: Stage) {
    if (!review?.conversationId || review.contestMode || blocked || request.current || savingResult.current) return;
    const assumption = selected === null ? "" : outline?.assumptions[selected]?.trim();
    const approach = outline?.approach.trim();
    if (stage === "outline" && (!explanation.trim() || explanation.length > IDEA_LIMITS.explanation)) return;
    if (stage === "challenge" && (!assumption || !approach || !review.statement?.complete)) return;
    const input: TutorSendInput = {
      turnId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      conversationId: review.conversationId,
      action: stage === "outline" ? "outline-idea" : "challenge-assumption",
      text: stage === "outline" ? explanation.trim() : JSON.stringify({ approach, assumption, uncertainty: outline?.uncertainty.trim() }),
      statementId: stage === "challenge" || includeStatement ? review.statement?.id ?? null : null,
      codeId: stage === "challenge" && includeCode ? review.code?.id ?? null : null,
      noteIds: [],
      deskIdea: review.target,
    };
    const current = { stage, input, assumption };
    request.current = current;
    setResult(null);
    setPending(stage);
    setError("");
    let sent = false;
    try {
      await bridge.ui("tutor-send", input);
      sent = true;
      if (!await readRequest(current)) throw new Error("The Tutor response could not be loaded. Check the request status.");
    } catch (reason) {
      if (request.current !== current) return;
      // The host may have accepted the request before its acknowledgement was lost.
      const found = await readRequest(current).catch(() => null);
      if (request.current !== current || found) return;
      if (!sent && found === false) {
        request.current = null;
        setPending(null);
      }
      setError(errorText(reason));
    }
  }

  async function stop() {
    const current = request.current;
    if (!current) return;
    try {
      await bridge.ui("tutor-stop", current.input.requestId);
      if (!await readRequest(current) && request.current === current) {
        request.current = null;
        setPending(null);
      }
    } catch (reason) {
      if (request.current === current) setError(errorText(reason));
    }
  }

  function acknowledge(turn: TutorTurn) {
    if (turn.exposed) return Promise.resolve();
    if (exposure.current?.requestId === turn.requestId) return exposure.current.saved;
    const saved = bridge.ui("tutor-exposed", { turnId: turn.id, requestId: turn.requestId }).catch(reason => {
      if (exposure.current?.requestId === turn.requestId) exposure.current = null;
      throw reason;
    });
    exposure.current = { requestId: turn.requestId, saved };
    return saved;
  }

  async function keepOutline() {
    if (!outline?.approach.trim() || blocked || request.current || savingResult.current) return;
    const parts = [outline.approach.trim()];
    const assumptions = outline.assumptions.map(value => value.trim()).filter(Boolean);
    if (assumptions.length) parts.push(`Assumptions\n${assumptions.map(value => `• ${value}`).join("\n")}`);
    if (outline.uncertainty.trim()) parts.push(`What I’m unsure about\n${outline.uncertainty.trim()}`);
    const version = reviewVersion.current;
    savingResult.current = true;
    setSaving(true);
    try {
      if (await onKeepOutline(parts.join("\n\n")) && version === reviewVersion.current) onDraftChange({ outlineKept: true });
    } catch (reason) {
      if (version === reviewVersion.current) setError(errorText(reason));
    } finally {
      savingResult.current = false;
      setSaving(false);
    }
  }

  async function keepChallenge() {
    if (!result || blocked || covered || savingResult.current) return;
    const version = reviewVersion.current;
    savingResult.current = true;
    setSaving(true);
    try {
      await acknowledge(result.turn);
      if (version === reviewVersion.current) onKeepChallenge(`Check this assumption: ${result.assumption}\n\n${result.value.question}`);
    } catch (reason) {
      if (version === reviewVersion.current) setError(errorText(reason));
    } finally {
      savingResult.current = false;
      setSaving(false);
    }
  }

  function refreshContext() {
    const current = request.current;
    if (!current) void refresh();
    else void readRequest(current).catch(reason => {
      if (request.current === current) setError(errorText(reason));
    });
  }

  return <DeskIdeaCard
    review={review} explanation={explanation} outline={outline} selectedAssumption={selected}
    includeStatement={includeStatement} includeCode={includeCode} challenge={result?.value ?? null}
    challengedAssumption={result?.assumption}
    verification={result && result.value.cases.length > 0 && <ChallengeRunPanel key={result.turn.requestId}
      bridge={bridge} turn={result.turn} challenge={result.value}
      blocked={blocked || covered || saving} savedEvidence={savedRunEvidence} onSave={onSaveRun} />}
    loading={loading} pending={pending} error={error} covered={covered} blocked={blocked}
    saving={saving} outlineKept={outlineKept}
    voiceControls={renderVoiceControls(text => changeExplanation([explanation.trimEnd(), text].filter(Boolean).join("\n\n")), !!pending || saving)}
    onExplanationChange={changeExplanation} onOutlineChange={changeOutline}
    onReviseExplanation={() => { changeExplanation(explanation); setError(""); }}
    onTryAnother={() => { setResult(null); setError(""); }}
    onSelectAssumption={index => { onDraftChange({ selected: index }); setResult(null); }}
    onIncludeStatementChange={setIncludeStatement} onIncludeCodeChange={value => { setIncludeCode(value); setResult(null); }}
    onOutline={() => void run("outline")} onChallenge={() => void run("challenge")}
    onKeepOutline={() => void keepOutline()} onKeepChallenge={() => void keepChallenge()}
    onChallengeVisible={() => {
      if (result && !covered && !document.hidden) void acknowledge(result.turn).catch(() => {});
    }}
    onStop={() => void stop()} onClose={onClose} onOpenTutor={onOpenTutor} onRefresh={refreshContext}
  />;
}
