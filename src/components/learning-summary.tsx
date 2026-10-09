"use client";
import { useState } from "react";
import Link from "next/link";
import { addDays, localDate, weekStart } from "@/lib/model";
import { memoryPeriod } from "@/lib/memory";
import { MISTAKES } from "@/lib/memory-types";
import { learningEvidenceHref } from "@/lib/learning-insights";
import { useWorkspace } from "./provider";
import styles from "./learning-summary.module.css";

export function LearningSummary({
  handle,
  renderInsights,
}: {
  handle: string;
  renderInsights?: (from: string, to: string) => React.ReactNode;
}) {
  const { data } = useWorkspace();
  const [period, setPeriod] = useState("this");
  const [from, setFrom] = useState(localDate(weekStart()));
  const [to, setTo] = useState(localDate(addDays(weekStart(), 6)));
  function choose(value: string) {
    setPeriod(value);
    if (value !== "custom") {
      const first = addDays(weekStart(), value === "last" ? -7 : 0);
      setFrom(localDate(first));
      setTo(localDate(addDays(first, 6)));
    }
  }
  const valid = from && to && from <= to;
  const evidence = valid
    ? memoryPeriod(data, from, to, { handle: handle || null })
    : null;
  return (
    <section className={styles.summary} aria-labelledby="weekly-learning-title">
      <div className={styles.heading}>
        <div>
          <p className="eyebrow">YOUR LEARNING THIS WEEK</p>
          <h2 id="weekly-learning-title">What your records show.</h2>
        </div>
        <label>
          <span id="learning-period-label">Learning period</span>
          <select
            aria-labelledby="learning-period-label"
            value={period}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="this">This week</option>
            <option value="last">Last week</option>
            <option value="custom">Choose dates</option>
          </select>
        </label>
      </div>
      {period === "custom" && (
        <div className={`form-row ${styles.dates}`}>
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Through
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      )}
      <p className="small muted">
        {from} through {to}, including both days. Linked coding and imported
        activity count as one practice event; written recall stays separate.
        Imported submissions within a contest event count there once.
      </p>
      {!valid ? (
        <p role="alert" className="form-error">
          Choose a start date on or before the end date.
        </p>
      ) : (
        evidence && (
          <>
            <dl className={styles.metrics}>
              <div>
                <dt>Practice events</dt>
                <dd>{evidence.history.length}</dd>
              </div>
              <div>
                <dt>Timed only</dt>
                <dd>{evidence.timedSessions - evidence.linkedEvents}</dd>
              </div>
              <div>
                <dt>Imported only</dt>
                <dd>{evidence.importedActivity - evidence.linkedEvents}</dd>
              </div>
              <div>
                <dt>Linked timed + imported</dt>
                <dd>{evidence.linkedEvents}</dd>
              </div>
              <div>
                <dt>Contest problem events</dt>
                <dd>{evidence.contestEvents}</dd>
              </div>
              <div>
                <dt>Measured practice</dt>
                <dd>{evidence.measuredMinutes} min</dd>
              </div>
              <div>
                <dt>Written recall checks</dt>
                <dd>{evidence.revisions.length}</dd>
              </div>
            </dl>
            <p className="small muted">
              Measured minutes include linked timed sessions. Contest problem
              events, imported activity, and written checks add no estimated
              time.
            </p>
            <div className={styles.columns}>
              <div>
                <h3>Independent after assistance</h3>
                {evidence.independentAfterAssistance.length ? (
                  <ul>
                    {evidence.independentAfterAssistance.map(
                      ({ problem, attempt }) => (
                        <li key={attempt.id}>
                          <Link
                            className="text-link"
                            href={learningEvidenceHref(
                              problem.id,
                              "practice",
                              attempt.id,
                              attempt.handle,
                            )}
                          >
                            {problem.title}
                          </Link>
                          <span className="small muted">
                            {" "}
                            ·{" "}
                            {new Date(attempt.completedAt).toLocaleDateString()}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p className="small muted">
                    No independent reflection after an earlier hint or editorial
                    is recorded in this period. More comparable history is
                    needed.
                  </p>
                )}
              </div>
              <div>
                <h3>Recorded recall outcomes</h3>
                {evidence.revisions.length ? (
                  <>
                    <p className="small">
                      {evidence.outcomes.independent} independently ·{" "}
                      {evidence.outcomes.cue} with a cue ·{" "}
                      {evidence.outcomes.unrecalled} not recalled yet
                    </p>
                    <ul>
                      {evidence.revisions.map((revision) => {
                        const problem = data.problems.find(
                          (p) => p.id === revision.problemId,
                        );
                        return (
                          <li key={revision.id}>
                            <Link
                              className="text-link"
                              href={learningEvidenceHref(
                                revision.problemId,
                                "revision",
                                revision.id,
                                revision.handle,
                              )}
                            >
                              {problem?.title ?? "Problem"}
                            </Link>
                            <span className="small muted">
                              {" "}
                              ·{" "}
                              {revision.activity === "explain"
                                ? "Approach"
                                : "Complexity and edges"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <p className="small muted">
                    No written recall checks recorded in this period.
                  </p>
                )}
              </div>
              <div>
                <h3>Mistakes you marked</h3>
                {evidence.mistakes.length ? (
                  <ul>
                    {evidence.mistakes.map(({ category, count }) => (
                      <li key={category}>
                        {MISTAKES[category]}{" "}
                        <span className="mono">
                          · {count} {count === 1 ? "reflection" : "reflections"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">
                    No mistake labels recorded in this period. Platform verdicts
                    are not classified for you.
                  </p>
                )}
              </div>
            </div>
            {renderInsights?.(from, to)}
          </>
        )
      )}
    </section>
  );
}
