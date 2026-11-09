import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, Feather, RotateCcw, Square, X } from "lucide-react";
import { IDEA_LIMITS } from "../../../packages/tutor/idea";
import type { DeskIdeaReview, IdeaChallenge, IdeaOutline, SharedCode } from "../../../packages/tutor/types";
import { StatementReview } from "./DeskHintCard";
import "./desk-idea-card.css";

interface DeskIdeaCardProps {
  review: DeskIdeaReview | null;
  explanation: string;
  outline: IdeaOutline | null;
  selectedAssumption: number | null;
  includeStatement: boolean;
  includeCode: boolean;
  challenge: IdeaChallenge | null;
  challengedAssumption?: string;
  verification?: ReactNode;
  pending: "outline" | "challenge" | null;
  loading?: boolean;
  error?: string;
  covered?: boolean;
  blocked?: boolean;
  voiceControls?: ReactNode;
  saving?: boolean;
  outlineKept?: boolean;
  onExplanationChange: (text: string) => void;
  onOutlineChange: (outline: IdeaOutline) => void;
  onReviseExplanation: () => void;
  onTryAnother: () => void;
  onSelectAssumption: (index: number) => void;
  onIncludeStatementChange: (include: boolean) => void;
  onIncludeCodeChange: (include: boolean) => void;
  onOutline: () => void;
  onChallenge: () => void;
  onKeepOutline?: () => void;
  onKeepChallenge: () => void;
  onChallengeVisible: () => void;
  onStop: () => void;
  onClose: () => void;
  onOpenTutor: () => void;
  onRefresh: () => void;
}

function CodeReview({ code }: { code: SharedCode }) {
  return (
    <details className="desk-idea-code">
      <summary>Review selected code <ChevronDown size={13} aria-hidden="true" /></summary>
      <p className="desk-idea-muted">
        {code.filename} · lines {code.startLine}–{code.endLine} · {new Date(code.capturedAt).toLocaleString()}
      </p>
      <pre tabIndex={0}>{code.text}</pre>
    </details>
  );
}

export function DeskIdeaCard({
  review, explanation, outline, selectedAssumption, includeStatement, includeCode, challenge,
  challengedAssumption, verification, pending, loading = false, error, covered = false, blocked = false,
  voiceControls, saving = false, outlineKept,
  onExplanationChange, onOutlineChange, onReviseExplanation, onTryAnother, onSelectAssumption, onIncludeStatementChange,
  onIncludeCodeChange, onOutline, onChallenge, onKeepOutline, onKeepChallenge,
  onChallengeVisible, onStop, onClose, onOpenTutor, onRefresh,
}: DeskIdeaCardProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const explanationField = useRef<HTMLTextAreaElement>(null);
  const outlineHeading = useRef<HTMLHeadingElement>(null);
  const answer = useRef<HTMLElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef<string | null>(null);
  const revealChallenge = useEffectEvent(onChallengeVisible);
  const statement = review?.statement?.complete ? review.statement : null;
  const contestMode = !!review?.contestMode;
  const ready = !!(review?.conversationId && review.provider.configured && review.provider.capabilities.text);
  const editingDisabled = !!pending || saving;
  const requestDisabled = !ready || loading || blocked || editingDisabled;
  const explanationTooLong = explanation.length > IDEA_LIMITS.explanation;
  const selected = selectedAssumption === null ? "" : outline?.assumptions[selectedAssumption]?.trim();
  const stage = challenge ? "answer" : outline ? "outline" : "explanation";
  const visibleChallenge = !!challenge && !covered && !contestMode;

  useEffect(() => {
    const previous = previousStage.current;
    previousStage.current = stage;
    if (covered || document.hidden || stage === previous) return;
    const current = stage === "answer" ? answerHeading : stage === "outline" ? outlineHeading : previous ? explanationField : heading;
    current.current?.focus();
  }, [covered, stage]);

  useEffect(() => {
    const element = answer.current;
    if (!visibleChallenge || !element) return;
    const observer = new IntersectionObserver(entries => {
      if (!document.hidden && entries.some(entry => entry.isIntersecting)) revealChallenge();
    });
    const observe = () => {
      observer.disconnect();
      if (!document.hidden) observer.observe(element);
    };
    observe();
    document.addEventListener("visibilitychange", observe);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", observe);
    };
  }, [challenge, visibleChallenge]);

  return (
    <section className="desk-idea" aria-labelledby={`${id}-heading`}>
      <header className="desk-idea-header">
        <div>
          <span className="eyebrow">PROBLEM DESK · TUTOR</span>
          <h2 ref={heading} id={`${id}-heading`} tabIndex={-1}>Explain my idea</h2>
        </div>
        <button className="icon-button" type="button" aria-label="Close idea review" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {loading && <p className="desk-idea-muted" role="status">Preparing your problem context…</p>}
      {contestMode && <p className="desk-idea-muted" role="status">Contest mode keeps this space for private notes.</p>}

      {!contestMode && !outline && !challenge && <div className="desk-idea-stack">
        <label className="desk-idea-field">
          <span>Your explanation</span>
          <textarea ref={explanationField} rows={4} value={explanation} maxLength={IDEA_LIMITS.explanation}
            disabled={editingDisabled || blocked} aria-describedby={`${id}-length`}
            placeholder="I would narrow the range because…"
            onChange={event => onExplanationChange(event.target.value)} />
        </label>
        <p id={`${id}-length`} className={explanationTooLong ? "desk-idea-error" : "desk-idea-count"}>
          {explanationTooLong ? "Shorten your explanation before sending. " : ""}
          {explanation.length.toLocaleString()} / {IDEA_LIMITS.explanation.toLocaleString()}
        </p>
        {voiceControls}
        {statement && <>
          <label className="desk-idea-check">
            <input type="checkbox" checked={includeStatement} disabled={editingDisabled}
              onChange={event => onIncludeStatementChange(event.target.checked)} /> Include captured statement
          </label>
          {includeStatement && <StatementReview statement={statement} />}
        </>}
        {ready && <p className="desk-idea-muted">
          {review.provider.name} will organize the explanation you send into an editable outline.
        </p>}
        <button className="button desk-idea-primary" type="button" onClick={onOutline}
          disabled={requestDisabled || explanationTooLong || !explanation.trim()}>
          Outline my idea <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>}

      {!contestMode && outline && !challenge && <div className="desk-idea-stack desk-idea-outline">
        <h3 ref={outlineHeading} tabIndex={-1}>Your working idea</h3>
        <p className="desk-idea-muted">Edit the outline to match your thinking. Choose one assumption to test.</p>
        <button className="desk-idea-quiet" type="button" onClick={onReviseExplanation} disabled={editingDisabled || blocked}>
          Revise explanation
        </button>
        <label className="desk-idea-field">
          <span>Approach</span>
          <textarea rows={2} value={outline.approach} maxLength={IDEA_LIMITS.approach} disabled={editingDisabled}
            onChange={event => onOutlineChange({ ...outline, approach: event.target.value })} />
        </label>
        <fieldset className="desk-idea-assumptions" disabled={editingDisabled}>
          <legend>Assumptions</legend>
          {!outline.assumptions.length && <p className="desk-idea-muted">Add a claim your approach depends on.</p>}
          {outline.assumptions.map((assumption, index) => (
            <div className="desk-idea-assumption" key={index}>
              <label className="desk-idea-check">
                <input type="radio" name={`${id}-assumption`} checked={selectedAssumption === index}
                  onChange={() => onSelectAssumption(index)} /> Challenge assumption {index + 1}
              </label>
              <textarea rows={2} value={assumption} maxLength={IDEA_LIMITS.assumption}
                aria-label={`Assumption ${index + 1}`} onChange={event => {
                  const assumptions = [...outline.assumptions];
                  assumptions[index] = event.target.value;
                  onOutlineChange({ ...outline, assumptions });
                }} />
            </div>
          ))}
          {outline.assumptions.length < IDEA_LIMITS.assumptions && (
            <button className="desk-idea-quiet" type="button" onClick={() => {
              onOutlineChange({ ...outline, assumptions: [...outline.assumptions, ""] });
              onSelectAssumption(outline.assumptions.length);
            }}>Add an assumption</button>
          )}
        </fieldset>
        <label className="desk-idea-field">
          <span>Uncertainty</span>
          <textarea rows={2} value={outline.uncertainty} maxLength={IDEA_LIMITS.uncertainty} disabled={editingDisabled}
            onChange={event => onOutlineChange({ ...outline, uncertainty: event.target.value })} />
        </label>
        {onKeepOutline && <button className="desk-idea-quiet" type="button" onClick={onKeepOutline}
          disabled={editingDisabled || blocked || outlineKept || !outline.approach.trim()}>
          {outlineKept ? <Check size={13} aria-hidden="true" /> : <Feather size={13} aria-hidden="true" />}
          {outlineKept ? "Outline saved" : "Keep outline"}
        </button>}

        {!statement && <p className="desk-idea-muted">Add a complete problem statement in Tutor to challenge an assumption.</p>}
        {statement && <StatementReview statement={statement} />}
        {statement && review?.code && <>
          <label className="desk-idea-check">
            <input type="checkbox" checked={includeCode} disabled={editingDisabled}
              onChange={event => onIncludeCodeChange(event.target.checked)} /> Include selected code
          </label>
          {includeCode && <CodeReview code={review.code} />}
        </>}
        {statement && !review?.code && <p className="desk-idea-muted">
          You can include code shared from VS Code with <strong>Forma: Ask About Selected Code</strong>. Refresh context after sharing.
        </p>}
        {ready && statement && <p className="desk-idea-muted">
          Your approach, selected assumption, uncertainty, and the problem statement will go to {review.provider.name}.
          {includeCode && review.code ? " The selected code will be included." : ""}
        </p>}
        <button className="button desk-idea-primary" type="button" onClick={onChallenge}
          disabled={requestDisabled || !statement || !outline.approach.trim() || !selected}>
          Challenge this assumption <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>}

      {!contestMode && challenge && <section className="desk-idea-answer" ref={answer} aria-labelledby={`${id}-answer`}>
        <h3 id={`${id}-answer`} ref={answerHeading} tabIndex={-1}>One assumption to test</h3>
        {challengedAssumption && <p className="desk-idea-muted">{challengedAssumption}</p>}
        <p>{challenge.observation}</p>
        <blockquote>{challenge.question}</blockquote>
        {challenge.exampleInput !== null && <div className="desk-idea-example">
          <span className="eyebrow">SUGGESTED CASE · UNVERIFIED</span>
          <span>Input</span>
          <pre>{challenge.exampleInput}</pre>
          {challenge.expectedOutput !== null && <>
            <span>Suggested output</span>
            <pre>{challenge.expectedOutput}</pre>
          </>}
        </div>}
        {verification}
        <button className="button button--secondary desk-idea-primary" type="button" onClick={onKeepChallenge}
          disabled={blocked || editingDisabled}>
          Keep as next step <Feather size={14} aria-hidden="true" />
        </button>
        <button className="desk-idea-quiet" type="button" onClick={onTryAnother} disabled={blocked || editingDisabled}>
          Try another assumption
        </button>
      </section>}

      {!contestMode && pending && <div className="desk-idea-actions">
        <p className="desk-idea-muted" role="status">
          {pending === "outline" ? "Outlining your idea…" : "Finding one way to test your assumption…"}
        </p>
        <button className="desk-idea-quiet" type="button" onClick={onStop}>
          <Square size={12} aria-hidden="true" /> Stop request
        </button>
        {error && <button className="desk-idea-quiet" type="button" onClick={onRefresh}>
          <RotateCcw size={12} aria-hidden="true" /> Check request status
        </button>}
      </div>}

      {!contestMode && error && <p className="desk-idea-error" role="alert">{error}</p>}
      {!contestMode && !challenge && !loading && !pending && (!ready || outline || error) && (
        <div className="desk-idea-stack">
          {review && !ready && <p className="desk-idea-muted">Set up a Tutor provider with text support to review your idea.</p>}
          <div className="desk-idea-actions">
            {(!ready || (outline && !statement)) && <button className="desk-idea-quiet" type="button" onClick={onOpenTutor}>
              Open Tutor <ArrowRight size={13} aria-hidden="true" />
            </button>}
            <button className="desk-idea-quiet" type="button" onClick={onRefresh} disabled={blocked || saving}>
              <RotateCcw size={12} aria-hidden="true" /> Refresh context
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
