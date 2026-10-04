"use client";
import { useState } from "react";
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
  reviewQueue,
  completeRevisit,
  rescheduleProblem,
} from "@/lib/model";
import { useWorkspace } from "./provider";
import { EmptyState, Modal, OutcomeLabel, PageHeader, Tags } from "./ui";

export function Revisit() {
  const { data, update, startSession, notify } = useWorkspace();
  const [showAll, setShowAll] = useState(false);
  const [reschedule, setReschedule] = useState<Problem | null>(null);
  const [retired, setRetired] = useState<Problem | null>(null);
  const [date, setDate] = useState(localDate(addDays(new Date(), 1)));
  const [error, setError] = useState("");
  const queue = reviewQueue(data);
  const batch = showAll ? queue : queue.slice(0, 3);
  function saveDate(e: React.FormEvent) {
    e.preventDefault();
    const chosen = String(
      new FormData(e.currentTarget as HTMLFormElement).get("revisitDate") ??
        date,
    );
    if (!chosen || chosen < localDate()) {
      setError("Choose today or a day that gives you a little more space.");
      return;
    }
    if (reschedule) update((d) => rescheduleProblem(d, reschedule.id, chosen));
    setReschedule(null);
    notify("Revisit rescheduled. Your pace, your choice.");
  }
  function retire(problem: Problem) {
    update((d) => completeRevisit(d, problem.id));
    setRetired(problem);
    notify("Revisit completed. Its history is still in Problems.");
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
      {retired && (
        <div className="undo-note" role="status">
          <span>{retired.title} is off your revisit list.</span>
          <button
            className="text-link"
            onClick={() => {
              update((d) => ({
                ...d,
                problems: d.problems.map((p) =>
                  p.id === retired.id
                    ? {
                        ...p,
                        reviewAt: retired.reviewAt,
                        reviewCount: retired.reviewCount,
                        reviewManual: retired.reviewManual,
                        reviewCompletedAt: retired.reviewCompletedAt,
                      }
                    : p,
                ),
              }));
              setRetired(null);
            }}
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
            {batch.map((problem, index) => {
              const last = latestReflection(data, problem.id);
              return (
                <article className="revisit-entry" key={problem.id}>
                  <div className="revisit-entry-index mono">0{index + 1}</div>
                  <div className="revisit-entry-main">
                    <div className="revisit-title-row">
                      <h2>{problem.title}</h2>
                      <span
                        className={`review-time ${problem.reviewAt! <= localDate() ? "ready" : ""}`}
                      >
                        <span className="status-dot" />
                        {reviewLabel(problem.reviewAt!)}
                      </span>
                    </div>
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
                      <OutcomeLabel outcome={last?.outcome} />
                    </div>
                    <div className="revisit-actions">
                      <button
                        className="button primary"
                        onClick={() => startSession(problem)}
                      >
                        Start revisit
                        <ArrowRight size={16} />
                      </button>
                      <button
                        className="button ghost"
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
                        onClick={() => retire(problem)}
                      >
                        <Check size={15} />
                        Complete this revisit
                      </button>
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
            <a href="/problems" className="button primary">
              Find a problem
              <ArrowRight size={16} />
            </a>
          }
        />
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
          onClose={() => setReschedule(null)}
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
                onClick={() => setReschedule(null)}
              >
                Cancel
              </button>
              <button className="button primary" type="submit">
                Save date
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
