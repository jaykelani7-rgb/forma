"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { revisitItems } from "@/lib/practice-state";
import { problemMemory, revisionCueForProblem } from "@/lib/memory";
import { MISTAKES } from "@/lib/memory-types";
import { RevisionDialog } from "./revision";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Leaf,
  RotateCcw,
  X,
} from "lucide-react";
import {
  DIFFICULTIES,
  Problem,
  addDays,
  latestReflection,
  localDate,
  reviewLabel,
  completeRevisit,
  rescheduleProblem,
} from "@/lib/model";
import { useWorkspace } from "./provider";
import { EmptyState, Modal, OutcomeLabel, PageHeader, Tags } from "./ui";

export function Revisit() {
  const { data, update, startSession, notify, guardWorkspace } = useWorkspace();
  const [showAll, setShowAll] = useState(false);
  const [revision, setRevision] = useState<{
    problem: Problem;
    activity: "explain" | "complexity";
  } | null>(null);
  const [reschedule, setReschedule] = useState<Problem | null>(null);
  const [retired, setRetired] = useState<Problem | null>(null);
  const [date, setDate] = useState(localDate(addDays(new Date(), 1)));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [retryCompletion, setRetryCompletion] = useState<Problem | null>(null);
  const saving = useRef(false);
  const queue = revisitItems(data);
  const batch = showAll ? queue : queue.slice(0, 3);
  async function commit(
    change: (current: typeof data) => typeof data,
    success: () => void,
    retry?: Problem,
  ) {
    if (saving.current) return;
    const isCurrent = guardWorkspace();
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await update(change);
      if (!isCurrent()) return;
      if (!saved) {
        setError(
          "This revisit change was not committed. Review the storage message and recovery copies in Settings, then retry.",
        );
        if (retry) setRetryCompletion(retry);
        return;
      }
      setRetryCompletion(null);
      success();
    } catch (failure) {
      if (isCurrent()) {
        setError(
          failure instanceof Error
            ? failure.message
            : "This revisit change was not committed. Review the storage message and retry.",
        );
        if (retry) setRetryCompletion(retry);
      }
    } finally {
      saving.current = false;
      if (isCurrent()) setPending(false);
    }
  }
  async function saveDate(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    const chosen = String(
      new FormData(e.currentTarget as HTMLFormElement).get("revisitDate") ??
        date,
    );
    if (!chosen || chosen < localDate()) {
      setError("Choose today or a day that gives you a little more space.");
      return;
    }
    if (!reschedule) return;
    const problemId = reschedule.id;
    await commit(
      (d) => rescheduleProblem(d, problemId, chosen),
      () => {
        setReschedule(null);
        notify("Revisit rescheduled. Your pace, your choice.");
      },
    );
  }
  async function retire(problem: Problem) {
    await commit(
      (d) => completeRevisit(d, problem.id),
      () => {
        setRetired(problem);
        notify("Revisit completed. Its history is still in Problems.");
      },
      problem,
    );
  }
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="UNDERSTANDING DEEPENS WITH A SECOND LOOK"
        title="Ready for another try."
        description="Return to an idea with a little more space and a fresh perspective."
      />
      <div className="revisit-intro">
        <div className="revisit-icon">
          <RotateCcw size={27} strokeWidth={1.3} />
        </div>
        <div>
          <h2>A small batch. No need to rush.</h2>
          <p>
            These problems are invitations to practise again. Dates are gentle
            suggestions; nothing is lost if you take a little longer.
          </p>
        </div>
        <span className="mono revisit-count">
          {String(queue.length).padStart(2, "0")}
          <small>in your list</small>
        </span>
      </div>
      {pending && !reschedule && (
        <p role="status" className="small muted">
          Saving revisit change…
        </p>
      )}
      {error && !reschedule && (
        <div role="alert" className="form-error">
          <p>{error}</p>
          {retryCompletion && (
            <button
              className="text-link"
              disabled={pending}
              onClick={() => retire(retryCompletion)}
            >
              Retry completing {retryCompletion.title}
            </button>
          )}
        </div>
      )}
      {retired && (
        <div className="undo-note" role="status">
          <span>{retired.title} is off your revisit list.</span>
          <button
            className="text-link"
            disabled={pending}
            onClick={() =>
              commit(
                (d) => ({
                  ...d,
                  problems: d.problems.map((p) =>
                    p.id === retired.id
                      ? {
                          ...p,
                          reviewAt: retired.reviewAt,
                          reviewCount: retired.reviewCount,
                          reviewManual: retired.reviewManual,
                          reviewCompletedAt: retired.reviewCompletedAt,
                          reviewUpdatedAt: retired.reviewUpdatedAt,
                          reviewAttemptId: retired.reviewAttemptId,
                        }
                      : p,
                  ),
                }),
                () => setRetired(null),
              )
            }
          >
            Undo
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => setRetired(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {queue.length ? (
        <>
          <div className="section-heading revisit-heading">
            <h2>
              {showAll ? "Your full revisit list" : "A few to come back to"}
            </h2>
            <button className="text-link" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show a small batch" : `Show all ${queue.length}`}
              <ChevronDown size={15} className={showAll ? "rotate-180" : ""} />
            </button>
          </div>
          <div className="revisit-list">
            {batch.map((item, index) => {
              const { problem, codingAt, recallAt, dueAt } = item;
              const memory = problemMemory(data, problem.id);
              const cue = revisionCueForProblem(data, problem.id);
              const last =
                memory.summary.latestReflection ??
                latestReflection(data, problem.id);
              return (
                <article className="revisit-entry" key={problem.id}>
                  <div className="revisit-entry-index mono">0{index + 1}</div>
                  <div className="revisit-entry-main">
                    <div className="revisit-title-row">
                      <h2>{problem.title}</h2>
                      <span
                        className={`review-time ${dueAt! <= localDate() ? "ready" : ""}`}
                      >
                        <span className="status-dot" />
                        {reviewLabel(dueAt!)}
                      </span>
                    </div>
                    <p className="small muted">
                      {codingAt
                        ? `Coding reattempt: ${codingAt}. `
                        : "No coding reattempt scheduled. "}
                      {recallAt
                        ? `Written recall: ${recallAt}.`
                        : "No written recall scheduled."}
                    </p>
                    {memory.summary.mistakes.length > 0 && (
                      <p className="small muted">
                        Previously marked:{" "}
                        {memory.summary.mistakes
                          .map((m) => MISTAKES[m.category])
                          .join(" · ")}
                      </p>
                    )}
                    {cue && <p className="small">Your cue: {cue}</p>}
                    <details className="revisit-notes">
                      <summary>Reveal previous notes</summary>
                      {memory.history
                        .filter(
                          (r) =>
                            r.outcome !== null &&
                            (r.approach || r.notes || r.takeaway),
                        )
                        .map((r) => (
                          <div key={r.id}>
                            <p className="small muted">
                              {new Date(r.completedAt).toLocaleDateString()}
                            </p>
                            {r.approach && <p>{r.approach}</p>}
                            {r.notes && <p>{r.notes}</p>}
                            {r.takeaway && <p>{r.takeaway}</p>}
                          </div>
                        ))}
                    </details>
                    <div className="problem-meta">
                      <span>{problem.platform}</span>
                      {problem.cfHandle && <span>{problem.cfHandle}</span>}
                      {problem.platform === "Codeforces" &&
                        !problem.cfHandle && <span>Personal notebook</span>}
                      {problem.problemCode && (
                        <span className="mono">#{problem.problemCode}</span>
                      )}
                    </div>
                    <p className="revisit-prompt">
                      {last?.difficulty
                        ? `A little more practice with ${DIFFICULTIES[last.difficulty].toLowerCase()}.`
                        : "Try it with fresh eyes. You may remember more than you think."}
                    </p>
                    <div className="revisit-entry-bottom">
                      <Tags tags={problem.tags} />
                      <OutcomeLabel outcome={last?.outcome ?? undefined} />
                    </div>
                    <div className="revisit-actions">
                      <Link
                        className="text-link"
                        href={`/problems/${encodeURIComponent(problem.id)}?from=%2Frevisit`}
                      >
                        Learning Memory
                      </Link>
                      <button
                        className="button primary"
                        disabled={pending}
                        onClick={() => startSession(problem)}
                      >
                        {codingAt ? "Start revisit" : "Re-solve problem"}
                        <ArrowRight size={16} />
                      </button>
                      <button
                        className="button secondary"
                        disabled={pending}
                        onClick={() =>
                          setRevision({ problem, activity: "explain" })
                        }
                      >
                        Explain approach
                      </button>
                      <button
                        className="button secondary"
                        disabled={pending}
                        onClick={() =>
                          setRevision({ problem, activity: "complexity" })
                        }
                      >
                        Recall complexity &amp; edges
                      </button>
                      {codingAt && (
                        <>
                          <button
                            className="button ghost"
                            disabled={pending}
                            onClick={() => {
                              setDate(
                                problem.reviewAt! < localDate()
                                  ? localDate(addDays(new Date(), 1))
                                  : problem.reviewAt!,
                              );
                              setError("");
                              setReschedule(problem);
                            }}
                          >
                            <CalendarDays size={15} />
                            Reschedule
                          </button>
                          <button
                            className="text-link retire"
                            disabled={pending}
                            onClick={() => retire(problem)}
                          >
                            <Check size={15} />
                            Complete this revisit
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <EmptyState
          title="A little breathing room."
          description="Your revisit list is clear. After a session, problems that need another attempt will appear here."
          action={
            <Link href="/problems" className="button primary">
              Find a problem
              <ArrowRight size={16} />
            </Link>
          }
        />
      )}
      {revision && (
        <RevisionDialog {...revision} onClose={() => setRevision(null)} />
      )}
      <section className="review-rule">
        <Leaf size={23} strokeWidth={1.3} />
        <div>
          <h3>A simple rule, with room for you.</h3>
          <p>
            Still need to understand it: {data.settings.reviewDays.unsolved}{" "}
            {data.settings.reviewDays.unsolved === 1 ? "day" : "days"}.
            Editorial: {data.settings.reviewDays.editorial} days. Hint:{" "}
            {data.settings.reviewDays.hint} days. Independent revisits can be
            completed or reviewed later. First-time independent solves don’t
            enter this queue. You can change any date or retire a revisit.
          </p>
          <span className="tiny muted">
            A transparent schedule based on your reflections. These are
            defaults, not scientifically optimal intervals.
          </span>
        </div>
      </section>
      {reschedule && (
        <Modal
          title="Give it a little space."
          onClose={() => {
            if (!saving.current) setReschedule(null);
          }}
        >
          <form onSubmit={saveDate} className="form-stack">
            <p className="muted">
              When would you like to return to{" "}
              <strong>{reschedule.title}</strong>?
            </p>
            <label>
              Revisit date
              <input
                name="revisitDate"
                type="date"
                value={date}
                disabled={pending}
                onChange={(e) => setDate(e.target.value)}
                min={localDate()}
                required
                autoFocus
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                disabled={pending}
                onClick={() => setReschedule(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={pending}
              >
                {pending ? "Saving…" : "Save date"}
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
