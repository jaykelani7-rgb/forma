"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { problemMemory, revisionCueForProblem } from "@/lib/memory";
import { sharedPracticeState } from "@/lib/practice-state";
import {
  Attempt,
  BRAND,
  DIFFICULTIES,
  Difficulty,
  OUTCOMES,
  Outcome,
  Problem,
  Session,
  elapsed,
  clockTime,
  nextReview,
  localDate,
  addDays,
} from "@/lib/model";
import { useWorkspace, pauseSession } from "./provider";
import { BrandMark, FocusBack } from "./shell";
import { EmptyState, Modal, ProblemLink } from "./ui";
import type { TrackContext } from "@/lib/tracks-types";
import { nextTrackEntry, trackContextForEntry } from "@/lib/tracks";
import { MISTAKES, type ReflectionMemory } from "@/lib/memory-types";
import { ReflectionMemoryFields } from "./reflection-memory-fields";

export function FocusedSession() {
  const {
    data,
    update,
    retryLocalSave,
    notify,
    storageError,
    storagePending,
    guardWorkspace,
    startSession,
    startFreshSession,
  } = useWorkspace();
  const router = useRouter();
  const [closingDraft, setClosingDraft] = useState<{
    session: Session;
    problem: Problem;
    reviewProblem?: Problem;
  } | null>(null);
  const session = closingDraft?.session ?? data.session;
  const problem =
    closingDraft?.problem ??
    data.problems.find((p) => p.id === session?.problemId);
  const reviewProblem =
    closingDraft?.reviewProblem ??
    (problem
      ? (sharedPracticeState(
          data,
          problem,
          new Date(),
          problem.cfHandle ? { handle: problem.cfHandle } : undefined,
        ).codingProblem ?? { ...problem, reviewAt: null, reviewCount: 0 })
      : undefined);
  const [now, setNow] = useState(() => Date.now());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [reviewDate, setReviewDate] = useState<string | null | undefined>(
    undefined,
  );
  const [takeaway, setTakeaway] = useState("");
  const [memory, setMemory] = useState<ReflectionMemory>({});
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [pending, setPending] = useState<"save" | "discard" | "restore" | null>(
    null,
  );
  const closing = useRef(false);
  const attemptIdentity = useRef<string | null>(null);
  const [completed, setCompleted] = useState<{
    title: string;
    problemId: string;
    milestone: boolean;
    reviewAt: string | null;
    trackContext?: TrackContext;
  } | null>(null);
  const [nextBusy, setNextBusy] = useState(false);
  const nextLock = useRef(false);
  const next = completed?.trackContext
    ? (nextTrackEntry(
        data,
        completed.trackContext.trackId,
        new Date(),
        completed.trackContext.stageId,
      ) ?? nextTrackEntry(data, completed.trackContext.trackId))
    : null;
  const currentEntry = data.trackEntries?.find(
    (entry) => entry.id === session?.trackContext?.entryId,
  );
  const stageExists = (context: TrackContext) =>
    data.trackStages?.some(
      (stage) =>
        stage.id === context.stageId && stage.trackId === context.trackId,
    );
  async function startNext() {
    if (!next || nextLock.current) return;
    const isCurrent = guardWorkspace();
    nextLock.current = true;
    setNextBusy(true);
    const context = trackContextForEntry(data, next.entry.id) ?? undefined;
    const saved = await (next.fresh ? startFreshSession : startSession)(
      next.problem,
      undefined,
      context,
    );
    nextLock.current = false;
    if (!isCurrent()) return;
    setNextBusy(false);
    if (saved) {
      setCompleted(null);
      setOutcome(null);
      setDifficulty(null);
      setTakeaway("");
      setMemory({});
      setReviewDate(undefined);
      attemptIdentity.current = null;
      setError("");
    } else
      setError(
        "The next session could not be saved. Your reflection is saved; review saving in Settings before trying again.",
      );
  }
  const successRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (completed) successRef.current?.focus();
  }, [completed]);
  function changeSession(change: (current: Session) => Session) {
    if (!session || closing.current) return;
    if (closingDraft)
      setClosingDraft((draft) =>
        draft ? { ...draft, session: change(draft.session) } : draft,
      );
    void update((d) =>
      d.session && d.session.id !== session.id
        ? d
        : { ...d, session: change(d.session ?? session) },
    );
  }
  function pause() {
    changeSession(pauseSession);
  }
  function resume() {
    setNow(Date.now());
    changeSession((current) => ({ ...current, runningSince: Date.now() }));
  }
  function reflect() {
    changeSession((current) => ({
      ...pauseSession(current),
      phase: "reflection",
    }));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    await commit(e.currentTarget as HTMLFormElement);
  }
  async function commit(form: HTMLFormElement, retry = false) {
    if (closing.current) return;
    if (!outcome || !session || !problem) {
      setError("Choose the reflection that fits this attempt.");
      return;
    }
    const review = nextReview(
      reviewProblem ?? problem,
      outcome,
      new Date(),
      data.settings.reviewDays,
    );
    const submitted = new FormData(form).get("reviewDate");
    if (reviewDate === null) review.reviewAt = null;
    else if (submitted) review.reviewAt = String(submitted);
    const priorLearning = attemptIdentity.current
      ? {
          ...data,
          attempts: data.attempts.filter(
            (a) => a.id !== attemptIdentity.current,
          ),
        }
      : data;
    const milestone =
      outcome === "independent" &&
      problemMemory(
        priorLearning,
        problem.id,
        problem.cfHandle ? { handle: problem.cfHandle } : undefined,
      ).history.some(
        (a) => a.outcome !== null && a.outcome !== "independent",
      ) &&
      !problemMemory(
        priorLearning,
        problem.id,
        problem.cfHandle ? { handle: problem.cfHandle } : undefined,
      ).history.some((a) => a.outcome === "independent");
    const attempt: Attempt = {
      id: attemptIdentity.current ?? (attemptIdentity.current = session.id),
      problemId: problem.id,
      startedAt: session.startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: elapsed(session),
      outcome,
      difficulty,
      takeaway: takeaway.trim(),
      notes: session.notes,
      ...memory,
      ...(session.trackContext ? { trackContext: session.trackContext } : {}),
    };
    const isCurrent = guardWorkspace();
    closing.current = true;
    setPending("save");
    setError("");
    setClosingDraft(closingDraft ?? { session, problem, reviewProblem });
    try {
      const saved = await (retry ? retryLocalSave : update)((d) => {
        if (d.session && d.session.id !== session.id)
          throw new Error(
            "Another session is now active. Review your recovery copy before saving this reflection.",
          );
        return {
          ...d,
          session: null,
          attempts: d.attempts.some((a) => a.id === attempt.id)
            ? d.attempts.map((a) => (a.id === attempt.id ? attempt : a))
            : [...d.attempts, attempt],
          problems: d.problems.map((p) =>
            p.id === problem.id
              ? {
                  ...p,
                  ...review,
                  reviewManual: reviewDate !== undefined,
                  reviewUpdatedAt: attempt.completedAt,
                  ...(p.cfHandle ? { reviewAttemptId: undefined } : {}),
                  ...(reviewDate === null && p.reviewAt
                    ? { reviewCompletedAt: attempt.completedAt }
                    : {}),
                }
              : p,
          ),
        };
      });
      if (!isCurrent()) return;
      if (!saved) {
        setError(
          "Reflection was not committed. Your reflection and session notes are still here. Review the storage message and recovery copies in Settings, then retry.",
        );
        return;
      }
      setCompleted({
        title: problem.title,
        problemId: problem.id,
        milestone,
        reviewAt: review.reviewAt,
        ...(session.trackContext ? { trackContext: session.trackContext } : {}),
      });
      setClosingDraft(null);
      notify(
        milestone
          ? "A meaningful step: you solved it your own way."
          : "Reflection saved. A little sharper than before.",
      );
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Reflection was not committed. Keep your input and retry after reviewing the storage message.",
        );
    } finally {
      closing.current = false;
      if (isCurrent()) setPending(null);
    }
  }
  async function discardSession() {
    if (closing.current || !session || !problem) return;
    const isCurrent = guardWorkspace();
    closing.current = true;
    setPending("discard");
    setError("");
    setClosingDraft({ session, problem });
    try {
      const saved = await update((d) => {
        if (d.session && d.session.id !== session.id)
          throw new Error(
            "Another session is now active. Review your recovery copy before discarding this one.",
          );
        return { ...d, session: null };
      });
      if (!isCurrent()) return;
      if (!saved) {
        setError(
          "The session was not discarded. Your timer and notes are still here. Review the storage message and recovery copies in Settings, then retry.",
        );
        return;
      }
      setDiscard(false);
      setClosingDraft(null);
      notify("Session ended without adding an attempt.");
      router.push("/");
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "The session was not discarded. Review the storage message and retry.",
        );
    } finally {
      closing.current = false;
      if (isCurrent()) setPending(null);
    }
  }
  async function restoreFocus() {
    if (closing.current || !session || !problem) return;
    const isCurrent = guardWorkspace();
    closing.current = true;
    setPending("restore");
    try {
      const saved = await update((d) => {
        if (d.session && d.session.id !== session.id)
          throw new Error(
            "Another session is now active. Review your recovery copy before continuing this one.",
          );
        const hadTentativeAttempt =
          !!attemptIdentity.current &&
          d.attempts.some((a) => a.id === attemptIdentity.current);
        return {
          ...d,
          session: { ...(d.session ?? session), phase: "focus" },
          attempts: d.attempts.filter((a) => a.id !== attemptIdentity.current),
          ...(d.practicePlans
            ? {
                practicePlans: d.practicePlans.map((plan) => ({
                  ...plan,
                  items: plan.items.map((item) => {
                    if (
                      item.completion?.type !== "attempt" ||
                      item.completion.recordId !== attemptIdentity.current
                    )
                      return item;
                    // Returning from an uncommitted reflection removes its
                    // tentative attempt and the derived completion together.
                    const pendingItem = { ...item, status: "pending" as const };
                    delete pendingItem.completion;
                    return pendingItem;
                  }),
                })),
              }
            : {}),
          problems:
            hadTentativeAttempt && closingDraft
              ? d.problems.map((p) =>
                  p.id === problem.id
                    ? {
                        ...p,
                        reviewAt: closingDraft.problem.reviewAt,
                        reviewCount: closingDraft.problem.reviewCount,
                        reviewManual: closingDraft.problem.reviewManual,
                        reviewAttemptId: closingDraft.problem.reviewAttemptId,
                        reviewCompletedAt:
                          closingDraft.problem.reviewCompletedAt,
                        reviewUpdatedAt: closingDraft.problem.reviewUpdatedAt,
                      }
                    : p,
                )
              : d.problems,
        };
      });
      if (!isCurrent()) return;
      // A failed commit still restores the draft into the provider's explicit
      // unsaved memory state, so edited notes remain editable and exportable.
      setClosingDraft(
        saved
          ? null
          : {
              session: { ...session, phase: "focus" },
              problem: closingDraft?.problem ?? problem,
            },
      );
      setDiscard(false);
      setError(
        saved
          ? ""
          : "Your session is kept in this tab. Local saving has not completed; export your data or review recovery copies in Settings before closing, then restore saving and retry.",
      );
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Your session could not be restored. Keep this draft and review recovery copies in Settings.",
        );
    } finally {
      closing.current = false;
      if (isCurrent()) setPending(null);
    }
  }
  async function keepSession() {
    if (closing.current) return;
    if (closingDraft) {
      await restoreFocus();
      return;
    }
    setDiscard(false);
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
          {next && (
            <button
              className="button primary"
              disabled={nextBusy || storagePending}
              onClick={() => void startNext()}
            >
              Next problem <ArrowRight size={16} />
            </button>
          )}
          {completed.trackContext && stageExists(completed.trackContext) && (
            <Link
              className="button secondary"
              href={`/tracks/${completed.trackContext.trackId}/stages/${completed.trackContext.stageId}`}
            >
              Return to stage
            </Link>
          )}
          <Link href="/" className="button primary">
            Back to Today
            <ArrowRight size={16} />
          </Link>
          <Link href="/progress" className="text-link">
            See your progress
            <ArrowRight size={16} />
          </Link>
          <Link
            className="text-link"
            href={`/problems/${encodeURIComponent(completed.problemId)}?from=${encodeURIComponent(completed.trackContext && stageExists(completed.trackContext) ? `/tracks/${completed.trackContext.trackId}/stages/${completed.trackContext.stageId}` : "/")}`}
          >
            View Learning Memory
            <ArrowRight size={16} />
          </Link>
        </div>
        {next && (
          <p className="small muted">
            Next: {next.entry.title} · {next.stage.title}. Start whenever you’re
            ready.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
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
  const memoryScope = problem.cfHandle
    ? { handle: problem.cfHandle }
    : undefined;
  const priorMemory =
    session.phase === "focus"
      ? problemMemory(data, problem.id, memoryScope)
      : null;
  const recallCue = revisionCueForProblem(data, problem.id, memoryScope);
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
        {session.trackContext && (
          <div className="session-track-context">
            <p className="small muted">
              {session.trackContext.trackTitle} ·{" "}
              {session.trackContext.stageTitle}
            </p>
            {stageExists(session.trackContext) && (
              <Link
                className="text-link"
                href={`/tracks/${session.trackContext.trackId}/stages/${session.trackContext.stageId}`}
              >
                Return to stage
              </Link>
            )}
          </div>
        )}
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
        {currentEntry?.pattern && session.phase === "focus" && (
          <details className="session-pattern">
            <summary>Reveal pattern hint</summary>
            <p>{currentEntry.pattern}</p>
          </details>
        )}
        {priorMemory && (priorMemory.history.length > 0 || recallCue) && (
          <section className="session-memory" aria-label="Before you re-solve">
            <h2>Before you re-solve</h2>
            {priorMemory.summary.mistakes.length > 0 && (
              <p className="small muted">
                Previously marked:{" "}
                {priorMemory.summary.mistakes
                  .map(({ category }) => MISTAKES[category])
                  .join(" · ")}
                .
              </p>
            )}
            {priorMemory.history.some((record) => record.difficulty) && (
              <p className="small muted">
                Earlier difficulties:{" "}
                {[
                  ...new Set(
                    priorMemory.history.flatMap((record) =>
                      record.difficulty
                        ? [DIFFICULTIES[record.difficulty]]
                        : [],
                    ),
                  ),
                ].join(" · ")}
                .
              </p>
            )}
            {recallCue && <p>Your cue: {recallCue}</p>}
            {priorMemory.history.some(
              (record) => record.approach || record.notes || record.takeaway,
            ) && (
              <details>
                <summary>Reveal previous notes</summary>
                {priorMemory.history
                  .filter(
                    (record) =>
                      record.approach || record.notes || record.takeaway,
                  )
                  .map((record) => (
                    <div key={record.id}>
                      <p className="small muted">
                        {new Date(record.completedAt).toLocaleDateString()}
                      </p>
                      {record.approach && <p>{record.approach}</p>}
                      {record.notes && <p>{record.notes}</p>}
                      {record.takeaway && <p>{record.takeaway}</p>}
                    </div>
                  ))}
              </details>
            )}
          </section>
        )}
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
                    changeSession((current) => ({
                      ...current,
                      timerVisible: !current.timerVisible,
                    }))
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
                  {storageError || closingDraft
                    ? "Kept in this tab"
                    : storagePending
                      ? "Saving notes…"
                      : "Saved as you go"}
                </span>
              </div>
              <textarea
                id="session-notes"
                disabled={pending !== null}
                maxLength={50000}
                value={session.notes}
                onChange={(e) => {
                  const notes = e.target.value;
                  changeSession((current) => ({ ...current, notes }));
                }}
                placeholder="An approach to try. An edge case. A question for later…"
                rows={6}
              />
            </section>
            {error && !discard && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="focus-bottom">
              <button
                className="text-link muted"
                disabled={pending !== null}
                onClick={() => setDiscard(true)}
              >
                End without saving
              </button>
              <button
                className="button primary"
                onClick={reflect}
                disabled={pending !== null}
              >
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
                    disabled={pending !== null}
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
            <ReflectionMemoryFields
              value={memory}
              onChange={setMemory}
              disabled={pending !== null}
            >
              <fieldset className="difficulty-options">
                <legend>
                  Broad difficulty <span className="optional">optional</span>
                </legend>
                <div>
                  {Object.entries(DIFFICULTIES).map(([key, label]) => (
                    <button
                      type="button"
                      disabled={pending !== null}
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
            </ReflectionMemoryFields>
            <label className="takeaway-label">
              One thing to remember <span className="optional">optional</span>
              <input
                value={takeaway}
                disabled={pending !== null}
                onChange={(e) => setTakeaway(e.target.value)}
                maxLength={300}
                placeholder="Next time, I’ll…"
              />
              <span className="small muted">
                What would you notice sooner next time?
              </span>
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
                    disabled={pending !== null}
                    className={
                      (reviewDate === undefined
                        ? nextReview(
                            reviewProblem ?? problem,
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
                          reviewProblem ?? problem,
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
                    disabled={pending !== null}
                    className={reviewDate === null ? "selected" : ""}
                    onClick={() => setReviewDate(null)}
                  >
                    No revisit
                  </button>
                </div>
                {(reviewDate === undefined
                  ? nextReview(
                      reviewProblem ?? problem,
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
                              reviewProblem ?? problem,
                              outcome,
                              new Date(),
                              data.settings.reviewDays,
                            ).reviewAt
                          : reviewDate) ?? ""
                      }
                      disabled={pending !== null}
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
                disabled={pending !== null}
                onClick={restoreFocus}
              >
                <ArrowLeft size={15} />
                Back to the session
              </button>
              {storageError && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={pending !== null}
                  onClick={(event) => {
                    const form = event.currentTarget.form;
                    if (form?.reportValidity()) void commit(form, true);
                  }}
                >
                  Retry saving reflection
                </button>
              )}
              <button
                type="submit"
                className="button primary"
                disabled={pending !== null}
              >
                {pending === "save" ? "Saving…" : "Save reflection"}
                <Check size={17} />
              </button>
            </div>
          </form>
        )}
      </div>
      {discard && (
        <Modal title="Close this chapter?" onClose={keepSession}>
          <div className="form-stack">
            <p className="muted">
              This session’s timer and notes will be discarded. Your problem and
              previous attempts will stay in your notebook.
            </p>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                className="button secondary"
                disabled={pending !== null}
                onClick={keepSession}
              >
                Keep practising
              </button>
              <button
                className="button primary"
                disabled={pending !== null}
                onClick={discardSession}
              >
                {pending === "discard" ? "Discarding…" : "Discard session"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
