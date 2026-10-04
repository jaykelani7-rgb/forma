"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Leaf,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { problemLearningHistory } from "@/lib/learning";
import {
  Attempt,
  BRAND,
  DIFFICULTIES,
  Difficulty,
  OUTCOMES,
  Outcome,
  elapsed,
  clockTime,
  nextReview,
  localDate,
  addDays,
  uid,
} from "@/lib/model";
import { useWorkspace, pauseSession } from "./provider";
import { BrandMark, FocusBack } from "./shell";
import { EmptyState, Modal, ProblemLink } from "./ui";

export function FocusedSession() {
  const { data, update, notify, storageError, storagePending } = useWorkspace();
  const session = data.session;
  const problem = data.problems.find((p) => p.id === session?.problemId);
  const [now, setNow] = useState(() => Date.now());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [reviewDate, setReviewDate] = useState<string | null | undefined>(
    undefined,
  );
  const [takeaway, setTakeaway] = useState("");
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [completed, setCompleted] = useState<{
    title: string;
    milestone: boolean;
    reviewAt: string | null;
  } | null>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (completed) successRef.current?.focus();
  }, [completed]);
  function pause() {
    update((d) => (d.session ? { ...d, session: pauseSession(d.session) } : d));
  }
  function resume() {
    setNow(Date.now());
    update((d) =>
      d.session
        ? { ...d, session: { ...d.session, runningSince: Date.now() } }
        : d,
    );
  }
  function reflect() {
    update((d) =>
      d.session
        ? { ...d, session: { ...pauseSession(d.session), phase: "reflection" } }
        : d,
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome || !session || !problem) {
      setError("Choose the reflection that fits this attempt.");
      return;
    }
    const review = nextReview(
      problem,
      outcome,
      new Date(),
      data.settings.reviewDays,
    );
    const submitted = new FormData(e.currentTarget as HTMLFormElement).get(
      "reviewDate",
    );
    if (reviewDate === null) review.reviewAt = null;
    else if (submitted) review.reviewAt = String(submitted);
    const milestone =
      outcome === "independent" &&
      problemLearningHistory(data, problem.id).some(
        (a) => a.outcome !== null && a.outcome !== "independent",
      ) &&
      !problemLearningHistory(data, problem.id).some(
        (a) => a.outcome === "independent",
      );
    const attempt: Attempt = {
      id: uid(),
      problemId: problem.id,
      startedAt: session.startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: elapsed(session),
      outcome,
      difficulty,
      takeaway: takeaway.trim(),
      notes: session.notes,
    };
    const saved = await update((d) => ({
      ...d,
      session: null,
      attempts: [...d.attempts, attempt],
      problems: d.problems.map((p) =>
        p.id === problem.id
          ? {
              ...p,
              ...review,
              reviewManual: reviewDate !== undefined,
              ...(p.cfHandle ? { reviewAttemptId: undefined } : {}),
              ...(reviewDate === null && p.reviewAt
                ? { reviewCompletedAt: attempt.completedAt }
                : {}),
            }
          : p,
      ),
    }));
    if (!saved) {
      setError(
        "Reflection was not committed. Review the storage message and recovery copies.",
      );
      return;
    }
    setCompleted({
      title: problem.title,
      milestone,
      reviewAt: review.reviewAt,
    });
    notify(
      milestone
        ? "A meaningful step: you solved it your own way."
        : "Reflection saved. A little sharper than before.",
    );
  }
  if (completed)
    return (
      <div className="session-complete page-enter">
        <Link href="/" className="brand">
          <BrandMark />
          <span>{BRAND.toLowerCase()}.</span>
        </Link>
        <div
          className={`completion-symbol ${completed.milestone ? "milestone" : ""}`}
        >
          <Leaf size={44} strokeWidth={1.2} />
        </div>
        <span className="eyebrow">A LITTLE TIME, WELL SPENT</span>
        <h1 ref={successRef} tabIndex={-1}>
          {completed.milestone ? (
            <>
              You found your
              <br />
              <em>own way through.</em>
            </>
          ) : (
            <>
              A small step.
              <br />
              <em>Something to build on.</em>
            </>
          )}
        </h1>
        <p>
          {completed.milestone
            ? `You solved ${completed.title} independently after it once needed more time or a little help. That’s worth remembering.`
            : "Your reflection is part of your story now. Take a breath; you’ve made time to understand something."}
        </p>
        {completed.reviewAt && (
          <div className="completion-review">
            <RotateCcw size={16} />A fresh try is suggested for{" "}
            {new Date(`${completed.reviewAt}T12:00:00`).toLocaleDateString(
              undefined,
              { month: "long", day: "numeric" },
            )}
            . You can adjust it in Revisit.
          </div>
        )}
        <div className="completion-actions">
          <Link href="/" className="button primary">
            Back to Today
            <ArrowRight size={16} />
          </Link>
          <Link href="/progress" className="text-link">
            See your progress
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  if (!session || !problem)
    return (
      <div className="focus-empty">
        <FocusBack />
        <EmptyState
          title="A little space to focus."
          description="Choose a problem from Today or your notebook to begin a session."
          action={
            <Link href="/" className="button primary">
              Find your next step
              <ArrowRight size={16} />
            </Link>
          }
        />
      </div>
    );
  const duration = elapsed(session, now);
  return (
    <div className="session-page page-enter">
      <header className="focus-header">
        <Link href="/" className="brand">
          <BrandMark small />
          <span>{BRAND.toLowerCase()}.</span>
        </Link>
        <FocusBack />
      </header>
      <div className="focus-content">
        <div className="focus-eyebrow">
          <span className="eyebrow">
            {session.phase === "reflection"
              ? "A MOMENT TO REFLECT"
              : "ONE PROBLEM. A LITTLE ROOM TO THINK."}
          </span>
          <span className="mono tiny muted">
            {session.targetMinutes} MIN INTENTION
          </span>
        </div>
        <h1>{problem.title}</h1>
        <div className="focus-problem-meta">
          <div className="problem-meta">
            <span>{problem.platform}</span>
            {problem.problemCode && (
              <span className="mono">#{problem.problemCode}</span>
            )}
          </div>
          <ProblemLink problem={problem} />
        </div>
        {session.phase === "focus" ? (
          <>
            <div className="focus-timer-area">
              <div className="timer-label">
                <span
                  className={`status-dot ${session.runningSince === null ? "paused" : ""}`}
                />
                {session.runningSince === null
                  ? "A MOMENT’S PAUSE"
                  : "TIME TO THINK"}
              </div>
              {session.timerVisible ? (
                <div
                  className="timer"
                  aria-label={`${clockTime(duration)} elapsed`}
                >
                  {clockTime(duration)}
                </div>
              ) : (
                <div className="hidden-timer">Go at your own pace.</div>
              )}
              <div className="timer-actions">
                <button
                  className="button secondary"
                  disabled={storagePending}
                  onClick={session.runningSince === null ? resume : pause}
                >
                  {session.runningSince === null ? (
                    <Play size={16} />
                  ) : (
                    <Pause size={16} />
                  )}{" "}
                  {session.runningSince === null
                    ? "Resume timer"
                    : "Pause timer"}
                </button>
                <button
                  className="icon-button"
                  aria-label={
                    session.timerVisible ? "Hide timer" : "Show timer"
                  }
                  onClick={() =>
                    update((d) =>
                      d.session
                        ? {
                            ...d,
                            session: {
                              ...d.session,
                              timerVisible: !d.session.timerVisible,
                            },
                          }
                        : d,
                    )
                  }
                >
                  {session.timerVisible ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
              <p className="timer-footnote">
                {duration >= session.targetMinutes * 60000
                  ? "Your time is here. Finish whenever it feels right."
                  : "An intention, not a deadline. Take the time you need."}
              </p>
            </div>
            <section className="notes-section">
              <div className="section-heading">
                <label htmlFor="session-notes">A place for your thoughts</label>
                <span className="tiny muted">
                  <span className="status-dot" />
                  {storageError
                    ? "Kept in this tab"
                    : storagePending
                      ? "Saving notes…"
                      : "Saved as you go"}
                </span>
              </div>
              <textarea
                id="session-notes"
                maxLength={50000}
                value={session.notes}
                onChange={(e) =>
                  update((d) =>
                    d.session
                      ? {
                          ...d,
                          session: { ...d.session, notes: e.target.value },
                        }
                      : d,
                  )
                }
                placeholder="An approach to try. An edge case. A question for later…"
                rows={6}
              />
            </section>
            <div className="focus-bottom">
              <button
                className="text-link muted"
                onClick={() => setDiscard(true)}
              >
                End without saving
              </button>
              <button className="button primary" onClick={reflect}>
                Finish session
                <Check size={17} />
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={save} className="reflection-form">
            <div className="reflection-intro">
              <h2>How did this attempt feel?</h2>
              <p>
                Honest is useful. Every answer helps you choose your next step.
              </p>
            </div>
            <fieldset>
              <legend className="sr-only">Attempt outcome</legend>
              <div className="outcome-options">
                {Object.entries(OUTCOMES).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={outcome === key ? "selected" : ""}
                    aria-pressed={outcome === key}
                    onClick={() => {
                      setOutcome(key as Outcome);
                      setReviewDate(undefined);
                      setError("");
                    }}
                  >
                    <span className="option-radio">
                      {outcome === key && <Check size={13} />}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="difficulty-options">
              <legend>
                Where did you get stuck?{" "}
                <span className="optional">optional</span>
              </legend>
              <div>
                {Object.entries(DIFFICULTIES).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={difficulty === key}
                    className={difficulty === key ? "selected" : ""}
                    onClick={() =>
                      setDifficulty(
                        difficulty === key ? null : (key as Difficulty),
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="takeaway-label">
              One thing to remember <span className="optional">optional</span>
              <input
                value={takeaway}
                onChange={(e) => setTakeaway(e.target.value)}
                maxLength={300}
                placeholder="Next time, I’ll…"
              />
            </label>
            {outcome && (
              <div className="schedule-preview">
                <div>
                  <RotateCcw size={16} />
                  <strong>Your next step</strong>
                </div>
                <div
                  className="schedule-choices"
                  role="group"
                  aria-label="Revisit choice"
                >
                  <button
                    type="button"
                    className={
                      (reviewDate === undefined
                        ? nextReview(
                            problem,
                            outcome,
                            new Date(),
                            data.settings.reviewDays,
                          ).reviewAt
                        : reviewDate) !== null
                        ? "selected"
                        : ""
                    }
                    onClick={() =>
                      setReviewDate(
                        nextReview(
                          problem,
                          outcome,
                          new Date(),
                          data.settings.reviewDays,
                        ).reviewAt ?? localDate(addDays(new Date(), 7)),
                      )
                    }
                  >
                    Suggest a revisit
                  </button>
                  <button
                    type="button"
                    className={reviewDate === null ? "selected" : ""}
                    onClick={() => setReviewDate(null)}
                  >
                    No revisit
                  </button>
                </div>
                {(reviewDate === undefined
                  ? nextReview(
                      problem,
                      outcome,
                      new Date(),
                      data.settings.reviewDays,
                    ).reviewAt
                  : reviewDate) !== null && (
                  <label>
                    Proposed revisit date
                    <input
                      name="reviewDate"
                      type="date"
                      value={
                        (reviewDate === undefined
                          ? nextReview(
                              problem,
                              outcome,
                              new Date(),
                              data.settings.reviewDays,
                            ).reviewAt
                          : reviewDate) ?? ""
                      }
                      onChange={(e) => setReviewDate(e.target.value)}
                      required
                    />
                  </label>
                )}
                <p className="tiny muted">
                  A default, at your pace. You can change the date or complete
                  this revisit.
                </p>
              </div>
            )}
            {session.notes && (
              <details className="reflection-notes">
                <summary>Your session notes</summary>
                <p className="saved-notes">{session.notes}</p>
              </details>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="focus-bottom">
              <button
                type="button"
                className="text-link"
                onClick={() =>
                  update((d) =>
                    d.session
                      ? { ...d, session: { ...d.session, phase: "focus" } }
                      : d,
                  )
                }
              >
                <ArrowLeft size={15} />
                Back to the session
              </button>
              <button type="submit" className="button primary">
                Save reflection
                <Check size={17} />
              </button>
            </div>
          </form>
        )}
      </div>
      {discard && (
        <Modal title="Close this chapter?" onClose={() => setDiscard(false)}>
          <div className="form-stack">
            <p className="muted">
              This session’s timer and notes will be discarded. Your problem and
              previous attempts will stay in your notebook.
            </p>
            <div className="form-actions">
              <button
                className="button secondary"
                onClick={() => setDiscard(false)}
              >
                Keep practising
              </button>
              <Link
                href="/"
                className="button primary"
                onClick={() => {
                  update((d) => ({ ...d, session: null }));
                  setDiscard(false);
                  notify("Session ended without adding an attempt.");
                }}
              >
                Discard session
              </Link>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
