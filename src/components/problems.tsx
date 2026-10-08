"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  DIFFICULTIES,
  OUTCOMES,
  Problem,
  visibleProblems,
  shortDate,
  archiveProblem,
  deferProblem,
} from "@/lib/model";
import {
  learningByProblem,
  possibleImportedLearningLinks,
  linkLearningAttempts,
  unlinkLearningAttempts,
} from "@/lib/learning";
import { ActivityRows } from "./codeforces";
import { useWorkspace } from "./provider";
import { AddProblem } from "./problem-form";
import {
  EmptyState,
  Modal,
  OutcomeLabel,
  PageHeader,
  ProblemLink,
  Tags,
} from "./ui";

export function Problems() {
  const { data, setAddOpen, startSession, update, guardWorkspace } =
    useWorkspace();
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [outcome, setOutcome] = useState("");
  const [selected, setSelected] = useState<Problem | null>(null);
  const [editing, setEditing] = useState<Problem | null>(null);
  const [startPending, setStartPending] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const starting = useRef(false);
  const learning = useMemo(() => learningByProblem(data), [data]);
  const available = visibleProblems(data);
  const topics = [...new Set(available.flatMap((p) => p.tags))].sort();
  const filtered = available.filter(
    (p) =>
      [p.title, p.problemCode, p.platform, ...p.tags]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!topic || p.tags.includes(topic)) &&
      (!outcome || (learning.get(p.id)?.state ?? "fresh") === outcome),
  );
  function clear() {
    setQuery("");
    setTopic("");
    setOutcome("");
  }
  async function startSelected() {
    if (!selected || starting.current) return;
    const isCurrent = guardWorkspace();
    starting.current = true;
    setStartPending(true);
    setHistoryError("");
    try {
      const saved = await startSession(selected);
      if (!isCurrent()) return;
      if (saved) setSelected(null);
      else
        setHistoryError(
          "The session was not started. Review the storage message and recovery copies in Settings, then retry.",
        );
    } catch (failure) {
      if (isCurrent())
        setHistoryError(
          failure instanceof Error
            ? failure.message
            : "The session was not started. Review the storage message and retry.",
        );
    } finally {
      starting.current = false;
      if (isCurrent()) setStartPending(false);
    }
  }
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="THE PRACTICE NOTEBOOK"
        title="Problems worth your time."
        description="A collection of things to understand, one attempt at a time."
        action={
          <button className="button primary" onClick={() => setAddOpen(true)}>
            <Plus size={17} />
            Add problem
          </button>
        }
      />
      <div className="collection-intro">
        <span>
          <strong className="mono">
            {String(available.length).padStart(2, "0")}
          </strong>{" "}
          problems in your collection
        </span>
        <span className="muted small">Every attempt has a place here.</span>
      </div>
      <div className="filter-bar">
        <label className="search-field">
          <Search size={18} />
          <span className="sr-only">Search problems</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a problem, topic, or ID…"
          />
        </label>
        <div className="filter-select">
          <SlidersHorizontal size={16} />
          <label className="sr-only" htmlFor="topic-filter">
            Filter by topic
          </label>
          <select
            id="topic-filter"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="filter-select">
          <label className="sr-only" htmlFor="outcome-filter">
            Filter by outcome
          </label>
          <select
            id="outcome-filter"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="">All outcomes</option>
            <option value="fresh">Not attempted</option>
            <option value="pending">Attempted, reflection pending</option>
            {Object.entries(OUTCOMES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {filtered.length ? (
        <div className="problem-table-wrap">
          <table className="problem-table">
            <thead>
              <tr>
                <th scope="col">
                  PROBLEM <ArrowDown size={12} />
                </th>
                <th scope="col">TOPICS</th>
                <th scope="col">LAST ATTEMPT</th>
                <th scope="col">WHERE YOU LEFT OFF</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((problem) => {
                const item = learning.get(problem.id);
                const last = item?.history[0];
                return (
                  <tr key={problem.id}>
                    <td>
                      <button
                        className="problem-title-button"
                        onClick={() => {
                          setHistoryError("");
                          setSelected(problem);
                        }}
                      >
                        {problem.title}
                      </button>
                      <div className="problem-meta">
                        <span>{problem.platform}</span>
                        {problem.cfHandle && <span>{problem.cfHandle}</span>}
                        {problem.platform === "Codeforces" &&
                          !problem.cfHandle && <span>Personal notebook</span>}
                        {problem.problemCode && (
                          <span className="mono">#{problem.problemCode}</span>
                        )}
                        {problem.rating !== null && (
                          <span className="mono">{problem.rating}</span>
                        )}
                        <Link
                          className="text-link"
                          href={`/problems/${encodeURIComponent(problem.id)}?from=%2Fproblems`}
                        >
                          Learning Memory
                        </Link>
                      </div>
                    </td>
                    <td>
                      <Tags tags={problem.tags} />
                    </td>
                    <td className="date-cell mono">
                      {last ? shortDate(last.completedAt) : "—"}
                    </td>
                    <td>
                      {item?.state === "pending" ? (
                        <span className="pending-outcome">
                          Attempted, reflection pending
                        </span>
                      ) : item?.latestReflection ? (
                        <OutcomeLabel
                          outcome={item.latestReflection.outcome ?? undefined}
                        />
                      ) : (
                        <OutcomeLabel outcome={undefined} />
                      )}
                    </td>
                    <td>
                      <button
                        className="icon-button start-row"
                        aria-label={`Start session: ${problem.title}`}
                        onClick={() => startSession(problem)}
                      >
                        <ArrowUpRight size={19} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="list-end">
            <span>
              {filtered.length} of {available.length} problems
            </span>
            <span>Small steps add up.</span>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<BookOpen size={28} strokeWidth={1.4} />}
          title={
            available.length
              ? "No problems on this page yet."
              : "Your notebook is an open page."
          }
          description={
            available.length
              ? "Try a different search or loosen the filters a little."
              : "Bring a problem from Codeforces, LeetCode, or anywhere you like to practise."
          }
          action={
            available.length ? (
              <button className="button secondary" onClick={clear}>
                Clear filters
              </button>
            ) : (
              <button
                className="button primary"
                onClick={() => setAddOpen(true)}
              >
                <Plus size={17} />
                Add my first problem
              </button>
            )
          }
        />
      )}
      {selected && (
        <Modal
          title={selected.title}
          onClose={() => {
            if (!starting.current) setSelected(null);
          }}
          className="history-modal"
        >
          <div className="history-meta">
            <div className="problem-meta">
              <span>{selected.platform}</span>
              <span className="mono">
                {selected.problemCode ? `#${selected.problemCode}` : ""}
              </span>
              {selected.rating !== null && (
                <span className="mono">{selected.rating} rating</span>
              )}
            </div>
            <button
              className="text-link"
              disabled={startPending}
              onClick={() => {
                setEditing(selected);
                setSelected(null);
              }}
            >
              <Pencil size={14} />
              Edit details
            </button>
          </div>
          <Tags tags={selected.tags} />
          <div className="history-external">
            <ProblemLink problem={selected} />
          </div>
          <details className="help-details">
            <summary>Automatic practice choices</summary>
            <p className="small">
              These choices control suggestions. You can still start this
              problem intentionally.
            </p>
            <button
              className="text-link"
              onClick={() => {
                const archived = !data.problems.find(
                  (p) => p.id === selected.id,
                )?.archived;
                update((d) => archiveProblem(d, selected.id, archived));
                setSelected({ ...selected, archived });
              }}
            >
              {selected.archived
                ? "Include in automatic practice"
                : "Archive from automatic practice"}
            </button>
            <label>
              Defer suggestions until
              <input
                type="date"
                value={selected.deferredUntil ?? ""}
                onChange={(e) => {
                  const until = e.target.value || null;
                  update((d) => deferProblem(d, selected.id, until));
                  setSelected({
                    ...selected,
                    deferredUntil: until ?? undefined,
                  });
                }}
              />
            </label>
          </details>
          <div className="section-heading">
            <h3>Every attempt is part of the story.</h3>
          </div>
          {selected.cfHandle && (
            <p className="small muted">
              Imported activity belongs to {selected.cfHandle}.{" "}
              <a href="/activity" className="text-link">
                View or edit its quick reflections
              </a>
              . Timed sessions are listed below.
            </p>
          )}
          {selected.cfHandle && (
            <ActivityRows
              attempts={data.codeforces.practiceAttempts.filter(
                (a) => a.problemId === selected.id,
              )}
              details
            />
          )}
          <div className="attempt-history">
            {data.attempts
              .filter((a) => a.problemId === selected.id)
              .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
              .map((attempt) => (
                <article key={attempt.id} className="attempt-entry">
                  <div>
                    <OutcomeLabel outcome={attempt.outcome} />
                    <span className="mono tiny muted">
                      {shortDate(attempt.completedAt)} ·{" "}
                      {Math.floor(attempt.elapsedMs / 60000)} min
                    </span>
                  </div>
                  {attempt.difficulty && (
                    <p className="small muted">
                      Working on: {DIFFICULTIES[attempt.difficulty]}
                    </p>
                  )}
                  {attempt.takeaway && (
                    <p className="takeaway">“{attempt.takeaway}”</p>
                  )}
                  {possibleImportedLearningLinks(data, attempt.id).length >
                    0 && (
                    <details className="help-details">
                      <summary>
                        Link this timed session to imported practice
                      </summary>
                      <p className="tiny">
                        Choose only if both records describe the same attempt.
                        One learning credit uses this timed reflection; both
                        sources and measured minutes are preserved.
                      </p>
                      <select
                        aria-label={`Link imported attempt for ${attempt.id}`}
                        value={
                          data.learningLinks?.find(
                            (l) => l.timedAttemptId === attempt.id,
                          )?.importedAttemptId ?? ""
                        }
                        onChange={(e) =>
                          update((d) =>
                            e.target.value
                              ? linkLearningAttempts(
                                  unlinkLearningAttempts(d, attempt.id),
                                  attempt.id,
                                  e.target.value,
                                )
                              : unlinkLearningAttempts(d, attempt.id),
                          )
                        }
                      >
                        <option value="">Separate attempts</option>
                        {possibleImportedLearningLinks(data, attempt.id).map(
                          (a) => (
                            <option key={a.id} value={a.id}>
                              {shortDate(a.lastSubmittedAt)} · {a.handle} ·{" "}
                              {a.submissionIds.length} submissions
                            </option>
                          ),
                        )}
                      </select>
                    </details>
                  )}
                  {attempt.notes && (
                    <details>
                      <summary>Session notes</summary>
                      <p className="saved-notes">{attempt.notes}</p>
                    </details>
                  )}
                </article>
              ))}
            {!data.attempts.some((a) => a.problemId === selected.id) && (
              <p className="muted">
                No timed sessions yet. Imported practice is listed above.
              </p>
            )}
          </div>
          {historyError && (
            <p role="alert" className="form-error">
              {historyError}
            </p>
          )}
          <div className="form-actions">
            <button
              className="button primary"
              disabled={startPending}
              onClick={startSelected}
            >
              {startPending ? "Starting…" : "Start a fresh attempt"}
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <AddProblem problem={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
