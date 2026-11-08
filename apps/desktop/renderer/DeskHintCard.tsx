import { useEffect, useEffectEvent, useRef } from "react";
import { ArrowRight, ChevronDown, CircleHelp, Feather, RotateCcw, Square, X } from "lucide-react";
import type { DeskHintReview, StatementSnapshot, TutorTurn } from "../../../packages/tutor/types";
import { TutorMarkdown } from "./tutor-markdown";
import "./desk-hint-card.css";

interface DeskHintCardProps {
  review: DeskHintReview | null;
  question: string;
  hypothesis?: string;
  includeHypothesis: boolean;
  error: string;
  loading: boolean;
  locked: boolean;
  running: boolean;
  turn: TutorTurn | null;
  onIncludeHypothesisChange: (include: boolean) => void;
  onSend: () => void;
  onStop: () => void;
  onClose: () => void;
  onOpenTutor: () => void;
  onLeaveThread: () => void;
  onKeep: (text: string) => void;
  onOpenLink: (url: string) => void;
  onExpose: () => void;
  onRefresh: () => void;
}

function StatementReview({ statement }: { statement: StatementSnapshot }) {
  const sections = [
    { label: "Description", text: statement.description },
    { label: "Input", text: statement.input },
    { label: "Output", text: statement.output },
    { label: "Constraints", text: statement.constraints },
  ];
  return (
    <details className="desk-hint-statement">
      <summary>Review problem statement<ChevronDown size={13} aria-hidden="true"/></summary>
      <div className="desk-hint-statement-body">
        <strong>{statement.title}</strong>
        {sections.filter(section => section.text).map(section => (
          <div key={section.label}>
            <h3>{section.label}</h3>
            <p>{section.text}</p>
          </div>
        ))}
        {statement.samples.map((sample, index) => (
          <div key={index}>
            <h3>Sample {index + 1}</h3>
            <span>Input</span><pre>{sample.input}</pre>
            <span>Output</span><pre>{sample.output}</pre>
          </div>
        ))}
        {statement.explanation && <div><h3>Sample explanation</h3><p>{statement.explanation}</p></div>}
      </div>
    </details>
  );
}

export function DeskHintCard({
  review, question, hypothesis, includeHypothesis, error, loading, locked, running, turn,
  onIncludeHypothesisChange, onSend, onStop, onClose, onOpenTutor, onLeaveThread, onKeep, onOpenLink,
  onExpose, onRefresh,
}: DeskHintCardProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const answer = useRef<HTMLDivElement>(null);
  const expose = useEffectEvent(onExpose);
  const response = turn?.assistantText ?? "";
  const hasResponse = !!response.trim();
  const visibleRequest = turn && hasResponse && !turn.exposed && !review?.contestMode ? turn.requestId : null;
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const element = answer.current;
    if (!visibleRequest || !element) return;
    const observer = new IntersectionObserver(entries => {
      if (!document.hidden && entries.some(entry => entry.isIntersecting)) expose();
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
  }, [visibleRequest]);

  const completed = turn?.status === "completed" && hasResponse;
  const interruption = turn?.status === "interrupted" ? "This hint was interrupted." : "";
  const emptyResult = turn?.status === "completed" && !hasResponse;
  const problem = error || turn?.error || (emptyResult ? "Tutor returned an empty hint. Review a new request to try again." : "");
  const retry = !!(problem || interruption || turn?.status === "failed");
  const otherRequest = !!review?.activeRequestId && review.activeRequestId !== turn?.requestId;
  const providerReady = review?.provider.configured && review.provider.capabilities.text;
  const unavailable = review && !review.contestMode
    ? !review.statement?.complete
      ? "Add a complete problem statement in Tutor before asking for a hint."
      : !providerReady
        ? "Set up a Tutor provider with text support to ask for a hint."
        : !review.conversationId ? "Refresh the hint context to continue." : ""
    : "";
  const canReview = review && !review.contestMode && !unavailable && !loading && !running && !completed && !emptyResult;
  const continueFromHeading = (action: () => void) => {
    heading.current?.focus({ preventScroll: true });
    action();
  };

  return (
    <section className="desk-hint" aria-label="Desk hint">
      <header className="desk-hint-header">
        <div className="desk-hint-heading">
          <span className="desk-hint-mark"><CircleHelp size={14} aria-hidden="true"/></span>
          <div>
            <span className="eyebrow">PROBLEM DESK · TUTOR</span>
            <h2 ref={heading} tabIndex={-1}>One small hint</h2>
          </div>
        </div>
        <button className="icon-button desk-hint-close" type="button" title="Close hint" aria-label="Close hint" onClick={onClose}>
          <X size={16} aria-hidden="true"/>
        </button>
      </header>
      {loading && <p className="desk-hint-status" role="status">Preparing the problem statement…</p>}
      {review?.contestMode && <div className="desk-hint-fallback">
        <p>Contest mode keeps this space for private notes.</p>
        <button className="desk-hint-quiet" type="button" onClick={onLeaveThread}>
          <Feather size={13} aria-hidden="true"/> Leave a private thread
        </button>
      </div>}
      {unavailable && !loading && <div className="desk-hint-fallback">
        <p>{unavailable}</p>
        <div className="desk-hint-actions">
          <button className="desk-hint-quiet" type="button" onClick={onOpenTutor}>
            Open Tutor <ArrowRight size={13} aria-hidden="true"/>
          </button>
          <button className="desk-hint-quiet" type="button" onClick={onLeaveThread}>
            <Feather size={13} aria-hidden="true"/> Leave a private thread
          </button>
        </div>
      </div>}
      {canReview && review.statement && <div className="desk-hint-review">
        <p className="desk-hint-help">Review the statement and request before sending them to <strong>{review.provider.name}</strong>.</p>
        <StatementReview statement={review.statement}/>
        <div className="desk-hint-question"><span className="eyebrow">YOUR REQUEST</span><p>{question}</p></div>
        {hypothesis && <div className="desk-hint-hypothesis">
          <label><input type="checkbox" checked={includeHypothesis} disabled={locked}
            onChange={event => onIncludeHypothesisChange(event.target.checked)}/> Include my latest hypothesis</label>
          {includeHypothesis && <p>{hypothesis}</p>}
        </div>}
      </div>}
      {!review?.contestMode && turn && hasResponse && <div className="desk-hint-answer" ref={answer}>
        <span className="eyebrow">TUTOR’S HINT</span>
        <TutorMarkdown text={response} turnId={turn.id} onOpenLink={onOpenLink}/>
      </div>}
      {!review?.contestMode && problem && <p className="desk-hint-error" role="alert">{problem}</p>}
      {!review?.contestMode && running && <div className="desk-hint-actions desk-hint-progress">
        <p className="desk-hint-status" role="status">{hasResponse ? "Writing your hint…" : "Finding one small step…"}</p>
        <button className="desk-hint-quiet" type="button" onClick={() => continueFromHeading(onStop)}>
          <Square size={12} aria-hidden="true"/> Stop hint
        </button>
      </div>}
      {!review?.contestMode && !running && interruption && <p className="desk-hint-status" role="status">{interruption}</p>}
      {!review?.contestMode && !running && completed && <>
        <span className="sr-only" role="status">Your hint is ready.</span>
        <button className="button desk-hint-submit" type="button" onClick={() => onKeep(response)}>
          Keep as next step <Feather size={14} aria-hidden="true"/>
        </button>
      </>}
      {canReview && <>
        {otherRequest && <p className="desk-hint-status" role="status">Tutor is answering another request.</p>}
        <button className="button desk-hint-submit" type="button" onClick={() => continueFromHeading(onSend)} disabled={otherRequest}>
          {retry ? "Retry hint" : "Send hint request"} <ArrowRight size={14} aria-hidden="true"/>
        </button>
      </>}
      {!loading && !running && !completed && !review?.contestMode && (problem || otherRequest || unavailable) && (
        <button className="desk-hint-quiet desk-hint-refresh" type="button" onClick={() => continueFromHeading(onRefresh)}>
          <RotateCcw size={12} aria-hidden="true"/> Refresh hint context
        </button>
      )}
    </section>
  );
}
