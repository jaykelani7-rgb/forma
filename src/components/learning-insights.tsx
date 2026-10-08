"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  learningInsights,
  learningEvidenceHref,
} from "@/lib/learning-insights";
import type { LearningRecord } from "@/lib/learning";
import { MISTAKES, RECALL_OUTCOMES } from "@/lib/memory-types";
import { shortDate, type Data } from "@/lib/model";
import styles from "./learning-insights.module.css";

function ObservationList({ children }: { children: ReactNode[] }) {
  return (
    <>
      {children.slice(0, 3)}
      {children.length > 3 && (
        <details>
          <summary>{children.length - 3} more observations</summary>
          {children.slice(3)}
        </details>
      )}
    </>
  );
}

export function LearningInsights({
  data,
  handle,
  from,
  to,
}: {
  data: Data;
  handle: string;
  from: string;
  to: string;
}) {
  const observations = learningInsights(data, from, to, {
    handle: handle || null,
  });
  const hasRevision =
    observations.dueCoding.length ||
    observations.dueRecall.length ||
    observations.revisions.length;
  const hasObservations =
    observations.mistakes.length ||
    observations.transitions.length ||
    observations.limitedTopics.length ||
    hasRevision;
  const range = `${from} through ${to}`;
  function recordLink(record: LearningRecord, label?: string) {
    const problem = data.problems.find(
      (problem) => problem.id === record.problemId,
    );
    return (
      <li key={record.id}>
        <Link
          className="text-link"
          href={learningEvidenceHref(
            record.problemId,
            "practice",
            record.id,
            record.handle,
          )}
        >
          {label ?? problem?.title ?? "Problem history"}
        </Link>
        <span className={styles.recordMeta}>
          {shortDate(record.completedAt)} ·{" "}
          {record.source === "linked"
            ? "Linked timed + imported event"
            : record.source === "timed"
              ? "Timed coding session"
              : "Imported coding activity"}
          {record.outcome === "independent"
            ? " · Recorded independent solve"
            : record.outcome === "hint"
              ? " · Recorded hint assistance"
              : record.outcome === "editorial"
                ? " · Recorded editorial assistance"
                : record.outcome === null
                  ? " · Reflection pending"
                  : " · Not solved yet"}
        </span>
      </li>
    );
  }
  return (
    <section
      className={styles.insights}
      aria-labelledby="learning-insights-title"
    >
      <div className={styles.heading}>
        <h2 id="learning-insights-title">Useful observations</h2>
        <p className="small muted">
          {range}. These are observations from your records, not assessments of
          ability.
        </p>
      </div>
      {!hasObservations ? (
        <p className="small muted">
          There is not enough saved evidence for an observation in this range.
          No evidence does not mean weak performance. Add a reflection or a
          written recall check when useful.
        </p>
      ) : (
        <div className={styles.grid}>
          {observations.mistakes.length > 0 && (
            <article className={styles.card}>
              <h3>Labels you recorded more than once</h3>
              <p className={styles.scope}>
                {range} ·{" "}
                {
                  observations.history.filter(
                    (record) => record.outcome !== null,
                  ).length
                }{" "}
                reflected coding records considered
              </p>
              <p className="small muted">
                A label appearing at least twice may be useful to revisit.
                Platform verdicts never create a mistake label.
              </p>
              <ObservationList>
                {observations.mistakes.map(({ category, records }) => (
                  <details key={category}>
                    <summary>
                      {MISTAKES[category]}{" "}
                      <span>· {records.length} reflections</span>
                    </summary>
                    <p className="tiny muted">
                      The same explicit label appears in these saved
                      reflections.
                    </p>
                    <ul>{records.map((record) => recordLink(record))}</ul>
                  </details>
                ))}
              </ObservationList>
            </article>
          )}
          {observations.transitions.length > 0 && (
            <article className={styles.card}>
              <h3>A later independent attempt</h3>
              <p className={styles.scope}>
                {range} · {observations.transitions.length} independent coding
                record{observations.transitions.length === 1 ? "" : "s"} after
                earlier recorded assistance
              </p>
              <p className="small muted">
                The later reflection records an independent solve. An accepted
                submission alone does not establish independence.
              </p>
              <ObservationList>
                {observations.transitions.map(
                  ({ problem, independent, assisted }) => (
                    <details key={independent.id}>
                      <summary>
                        {problem.title}{" "}
                        <span>· 2 supporting coding records</span>
                      </summary>
                      <p className="tiny muted">
                        The independent event is in the selected range; its
                        earlier assistance may be outside it.
                      </p>
                      <ul>
                        {recordLink(assisted, "Earlier assisted coding record")}
                        {recordLink(
                          independent,
                          "Later independent coding record",
                        )}
                      </ul>
                    </details>
                  ),
                )}
              </ObservationList>
            </article>
          )}
          {observations.limitedTopics.length > 0 && (
            <article className={styles.card}>
              <h3>Little recorded tagged practice</h3>
              <p className={styles.scope}>
                {range} · topics with 0 or 1 coding events
              </p>
              <p className="small muted">
                Current problem tags describe coverage, not demonstrated
                understanding. Missing records do not mean weak performance.
              </p>
              <ObservationList>
                {observations.limitedTopics.map(
                  ({ topic, records, problems }) => (
                    <details key={topic}>
                      <summary>
                        {topic}{" "}
                        <span>
                          · {records.length} coding event
                          {records.length === 1 ? "" : "s"}
                        </span>
                      </summary>
                      {records.length ? (
                        <ul>{records.map((record) => recordLink(record))}</ul>
                      ) : (
                        <p className="tiny muted">
                          No coding event with this tag is recorded in the
                          selected range.
                        </p>
                      )}
                      <p className="tiny muted">
                        {problems.length} saved problem
                        {problems.length === 1 ? "" : "s"} currently carry this
                        tag:
                      </p>
                      <ul>
                        {problems.map((problem) => (
                          <li key={problem.id}>
                            <Link
                              className="text-link"
                              href={learningEvidenceHref(
                                problem.id,
                                "schedule",
                                null,
                                handle || null,
                              )}
                            >
                              {problem.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ),
                )}
              </ObservationList>
            </article>
          )}
          {!!hasRevision && (
            <article className={styles.card}>
              <h3>Revision to return to</h3>
              <p className={styles.scope}>
                As of {observations.asOf} · {observations.dueCoding.length} due
                coding schedule{observations.dueCoding.length === 1 ? "" : "s"}{" "}
                · {observations.dueRecall.length} due written-recall schedule
                {observations.dueRecall.length === 1 ? "" : "s"}
              </p>
              <p className="small muted">
                Coding and written recall keep separate dates. Matching problem
                copies share each schedule; skipped, deferred and archived
                groups are excluded.
              </p>
              {(observations.dueCoding.length > 0 ||
                observations.dueRecall.length > 0) && (
                <details>
                  <summary>View saved due schedules</summary>
                  <ul>
                    {observations.dueCoding.map((item) => (
                      <li key={`coding-${item.identity}`}>
                        <Link
                          className="text-link"
                          href={learningEvidenceHref(
                            item.problem.id,
                            "schedule",
                            null,
                            handle || null,
                          )}
                        >
                          {item.problem.title}
                        </Link>
                        <span className={styles.recordMeta}>
                          Coding reattempt · due {item.date}
                        </span>
                      </li>
                    ))}
                    {observations.dueRecall.map((item) => (
                      <li key={`recall-${item.identity}`}>
                        <Link
                          className="text-link"
                          href={learningEvidenceHref(
                            item.problem.id,
                            "revision",
                            item.record?.id ?? null,
                            item.record && "handle" in item.record
                              ? item.record.handle
                              : handle || null,
                          )}
                        >
                          {item.problem.title}
                        </Link>
                        <span className={styles.recordMeta}>
                          Written recall · due {item.date}
                          {observations.dueCoding.some(
                            (coding) => coding.identity === item.identity,
                          )
                            ? " · Coding is also due; these are separate activities."
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <p className={styles.scope}>
                {range} · {observations.revisions.length} saved written-recall
                check{observations.revisions.length === 1 ? "" : "s"}
              </p>
              {observations.revisions.length > 0 ? (
                <details>
                  <summary>View recent recall outcomes</summary>
                  <p className="small">
                    {observations.recallOutcomes.independent} independently ·{" "}
                    {observations.recallOutcomes.cue} with a cue ·{" "}
                    {observations.recallOutcomes.unrecalled} not recalled yet
                  </p>
                  <ul>
                    {observations.revisions.map((record) => (
                      <li key={record.id}>
                        <Link
                          className="text-link"
                          href={learningEvidenceHref(
                            record.problemId,
                            "revision",
                            record.id,
                            record.handle,
                          )}
                        >
                          {data.problems.find(
                            (problem) => problem.id === record.problemId,
                          )?.title ?? "Problem history"}
                        </Link>
                        <span className={styles.recordMeta}>
                          {shortDate(record.completedAt)} ·{" "}
                          {RECALL_OUTCOMES[record.outcome]}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="tiny muted">
                    Written recall adds no coding attempt, platform acceptance
                    or measured duration.
                  </p>
                </details>
              ) : (
                <p className="tiny muted">
                  No written recall outcomes recorded in this range.
                </p>
              )}
              <Link className="text-link" href="/revisit">
                Open the full revision backlog
              </Link>
            </article>
          )}
        </div>
      )}
      <p className={styles.note}>
        Opening supporting history does not change your daily plan.
      </p>
    </section>
  );
}
