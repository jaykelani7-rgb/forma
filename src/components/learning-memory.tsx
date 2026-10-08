"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import {
  DIFFICULTIES,
  OUTCOMES,
  shortDate,
  type Data,
  type Attempt,
  type Difficulty,
  type Outcome,
  type Problem,
} from "@/lib/model";
import { problemMemory } from "@/lib/memory";
import {
  MISTAKES,
  type ReflectionMemory,
  type RevisionRecord,
} from "@/lib/memory-types";
import type { LearningRecord } from "@/lib/learning";
import { trackContextForEntry } from "@/lib/tracks";
import { normalizeCodeforcesIdentity } from "@/lib/codeforces-identity";
import { practiceIdentity } from "@/lib/practice-state";
import { sharedPracticeState } from "@/lib/practice-state";
import {
  learningEvidenceProfile,
  memoryRecordAnchor,
} from "@/lib/learning-insights";
import { verdictLabel } from "@/lib/codeforces";
import { useWorkspace } from "./provider";
import { EmptyState, Modal, PageHeader, ProblemLink } from "./ui";
import { QuickReflectionDialog } from "./quick-reflection";
import { ReflectionMemoryFields } from "./reflection-memory-fields";
import {
  RECALL_OUTCOMES,
  REVISION_ACTIVITIES,
  RevisionDialog,
} from "./revision";
import styles from "./memory.module.css";

function returnDestination(from?: string) {
  if (from === "/") return { href: "/", label: "Back to Today" };
  if (!from || !from.startsWith("/") || from.startsWith("//"))
    return { href: "/problems", label: "Back to problems" };
  try {
    const url = new URL(from, "https://forma.local");
    if (
      url.origin !== "https://forma.local" ||
      !/^\/(today|problems|activity|revisit|progress|tracks|contests)(?:\/[^?#]*)?$/.test(
        url.pathname,
      )
    )
      throw new Error("Unsupported return destination");
    const label = url.pathname.startsWith("/tracks/")
      ? "Back to track"
      : `Back to ${url.pathname.split("/")[1]}`;
    return { href: url.pathname + url.search + url.hash, label };
  } catch {
    return { href: "/problems", label: "Back to problems" };
  }
}

function trackHref(context: NonNullable<Attempt["trackContext"]>) {
  return `/tracks/${encodeURIComponent(context.trackId)}/stages/${encodeURIComponent(context.stageId)}`;
}

function TimedReflectionEditor({
  attempt,
  onClose,
}: {
  attempt: Attempt;
  onClose: () => void;
}) {
  const { update, retryLocalSave, guardWorkspace, notify } = useWorkspace();
  const [outcome, setOutcome] = useState<Outcome>(attempt.outcome);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(
    attempt.difficulty,
  );
  const [notes, setNotes] = useState(attempt.notes);
  const [takeaway, setTakeaway] = useState(attempt.takeaway);
  const [memory, setMemory] = useState<ReflectionMemory>({
    mistakes: attempt.mistakes ?? [],
    mistakeNote: attempt.mistakeNote ?? "",
    approach: attempt.approach ?? "",
  });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    const isCurrent = guardWorkspace();
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const proposal = (data: Data) => {
        if (!data.attempts.some((item) => item.id === attempt.id))
          throw new Error(
            "This attempt is no longer available. Your edit is still here.",
          );
        return {
          ...data,
          attempts: data.attempts.map((item) =>
            item.id === attempt.id
              ? {
                  ...item,
                  outcome,
                  difficulty,
                  notes: notes.trim(),
                  takeaway: takeaway.trim(),
                  ...memory,
                }
              : item,
          ),
        };
      };
      const saved = await (failed
        ? retryLocalSave(proposal)
        : update(proposal));
      if (!isCurrent()) return;
      if (!saved) {
        setFailed(true);
        setError(
          "Reflection was not committed. Your changes are still here. Review the storage message, then retry this save.",
        );
        return;
      }
      notify("Reflection updated. Existing revisit dates are unchanged.");
      onClose();
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Reflection was not committed. Keep this draft and retry.",
        );
    } finally {
      saving.current = false;
      if (isCurrent()) setPending(false);
    }
  }
  return (
    <Modal
      title="Edit timed reflection"
      className={styles.dialog}
      onClose={() => {
        if (!saving.current) onClose();
      }}
    >
      <form className="form-stack" onSubmit={save}>
        <p className={styles.meta}>
          This edits the original timed source. Its problem identity, timestamp,
          measured time, and existing revisit dates are preserved.
        </p>
        <fieldset>
          <legend>How did you solve it?</legend>
          <div className={styles.choices}>
            {Object.entries(OUTCOMES).map(([key, label]) => (
              <button
                type="button"
                aria-pressed={outcome === key}
                onClick={() => setOutcome(key as Outcome)}
                key={key}
                disabled={pending}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Session notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={50000}
            disabled={pending}
          />
        </label>
        <label>
          One thing to remember <span className="optional">optional</span>
          <input
            value={takeaway}
            onChange={(event) => setTakeaway(event.target.value)}
            maxLength={300}
            disabled={pending}
          />
          <span className={styles.meta}>
            What would you notice sooner next time?
          </span>
        </label>
        <ReflectionMemoryFields
          value={memory}
          onChange={setMemory}
          disabled={pending}
        >
          <fieldset className="difficulty-options">
            <legend>
              Earlier difficulty <span className="optional">optional</span>
            </legend>
            <div>
              {Object.entries(DIFFICULTIES).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className={difficulty === key ? "selected" : ""}
                  aria-pressed={difficulty === key}
                  onClick={() =>
                    setDifficulty(
                      difficulty === key ? null : (key as Difficulty),
                    )
                  }
                  disabled={pending}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </ReflectionMemoryFields>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.dialogFooter}>
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button type="submit" className="button" disabled={pending}>
            {pending
              ? "Saving…"
              : failed
                ? "Retry reflection save"
                : "Save reflection changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function LearningMemory({
  problemId,
  from,
  initialRevision,
  profile,
}: {
  problemId: string;
  from?: string;
  initialRevision?: string;
  profile?: string;
}) {
  const { data, update, retryLocalSave, guardWorkspace, notify, startSession } =
    useWorkspace();
  // Route segments can retain percent encoding; prefer the exact saved ID so
  // legacy notebook IDs containing literal percent sequences remain addressable.
  let decodedId = problemId;
  try {
    decodedId = decodeURIComponent(problemId);
  } catch {
    /* A literal legacy ID may contain %. */
  }
  const problem =
    data.problems.find((item) => item.id === problemId) ??
    data.problems.find((item) => item.id === decodedId);
  const destination = returnDestination(from);
  const [timedEditing, setTimedEditing] = useState<Attempt | null>(null);
  const [importedEditing, setImportedEditing] = useState<string | null>(null);
  const [revision, setRevision] = useState<RevisionRecord["activity"] | null>(
    profile === undefined &&
      (initialRevision === "explain" || initialRevision === "complexity")
      ? initialRevision
      : null,
  );
  const [startPending, setStartPending] = useState(false);
  const [error, setError] = useState("");
  const [sourcePending, setSourcePending] = useState(false);
  const [sourceFailed, setSourceFailed] = useState(false);
  const practiceLock = useRef(false);
  const sourceLock = useRef(false);
  if (!problem)
    return (
      <div className={styles.page}>
        <Link className="text-link" href={destination.href}>
          <ArrowLeft size={16} />
          {destination.label}
        </Link>
        <EmptyState
          title="This problem is not in this workspace."
          description="Choose a problem from the current notebook. A different account or profile may have its own history."
          action={
            <Link className="button" href="/problems">
              Open problems
            </Link>
          }
        />
      </div>
    );
  const profileView = profile !== undefined;
  const evidenceProfile = profileView
    ? learningEvidenceProfile(data, profile)
    : null;
  const memoryScope = evidenceProfile?.valid
    ? { handle: evidenceProfile.handle }
    : problem.cfHandle
      ? { handle: problem.cfHandle }
      : undefined;
  const memory = problemMemory(data, problem.id, memoryScope);
  const contestMemory = (data.contests ?? [])
    .filter(
      (c) =>
        !c.handle ||
        c.handle.toLowerCase() ===
          (memoryScope?.handle === undefined
            ? data.codeforces.connectedHandle
            : memoryScope.handle
          )?.toLowerCase(),
    )
    .flatMap((c) =>
      c.problems
        .filter((p) => p.identity === practiceIdentity(problem) && !!c.endedAt)
        .map((p) => ({ c, p })),
    );
  const timedSources = new Map(data.attempts.map((item) => [item.id, item]));
  const importedSources = new Map(
    data.codeforces.practiceAttempts.map((item) => [item.id, item]),
  );
  const importedReflections = new Map(
    data.codeforces.reflections.map((item) => [item.attemptId, item]),
  );
  const submissionsBySource = new Map(
    data.codeforces.submissions.map((item) => [
      `${item.handle.toLowerCase()}:${item.id}`,
      item,
    ]),
  );
  const archivedProfile =
    !!problem.cfHandle &&
    problem.cfHandle.toLowerCase() !==
      data.codeforces.connectedHandle?.toLowerCase();
  const problemIds = new Set(memory.problems.map((item) => item.id));
  const problemKey = normalizeCodeforcesIdentity({
    url: problem.url,
    code: problem.problemCode,
  })?.key;
  const memberships = (data.trackEntries ?? []).filter(
    (entry) =>
      problemIds.has(entry.problemId) ||
      (!!problemKey &&
        normalizeCodeforcesIdentity({ url: entry.url, code: entry.code })
          ?.key === problemKey),
  );
  const sourceContext =
    memberships.find((entry) =>
      from?.includes(`/tracks/${entry.trackId}/stages/${entry.stageId}`),
    ) ??
    memberships.find((entry) => entry.trackId === data.activeTrackId) ??
    memberships[0];
  const context = sourceContext
    ? (trackContextForEntry(data, sourceContext.id) ?? undefined)
    : undefined;
  const accepted = memory.history.some((record) => record.accepted === true);
  const practice = sharedPracticeState(data, problem, new Date(), memoryScope);
  const importedAttempt = importedEditing
    ? importedSources.get(importedEditing)
    : undefined;
  async function resolveAgain(selected: Problem) {
    if (profileView || practiceLock.current) return;
    const isCurrent = guardWorkspace();
    practiceLock.current = true;
    setStartPending(true);
    setError("");
    try {
      const saved = await startSession(selected, undefined, context);
      if (isCurrent() && !saved)
        setError(
          "The session could not be saved. Your history is here; review saving in Settings before trying again.",
        );
    } finally {
      practiceLock.current = false;
      if (isCurrent()) setStartPending(false);
    }
  }
  async function selectReflectionSource(
    record: LearningRecord,
    source: "timed" | "codeforces",
  ) {
    if (
      profileView ||
      sourceLock.current ||
      !record.timedAttemptId ||
      !record.importedAttemptId
    )
      return;
    const isCurrent = guardWorkspace();
    sourceLock.current = true;
    setSourcePending(true);
    setError("");
    try {
      const proposal = (current: Data) => ({
        ...current,
        learningLinks: (current.learningLinks ?? []).map((link) =>
          link.timedAttemptId === record.timedAttemptId &&
          link.importedAttemptId === record.importedAttemptId
            ? { ...link, reflectionSource: source }
            : link,
        ),
      });
      const saved = await (sourceFailed
        ? retryLocalSave(proposal)
        : update(proposal));
      if (!isCurrent()) return;
      if (saved) {
        setSourceFailed(false);
        notify(
          `The ${source === "timed" ? "timed" : "imported"} reflection now supplies this linked event’s assessment.`,
        );
      } else {
        setSourceFailed(true);
        setError(
          "The reflection source was not committed. Both originals are preserved. Review the storage message, then retry.",
        );
      }
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Reflection source was not committed.",
        );
    } finally {
      sourceLock.current = false;
      if (isCurrent()) setSourcePending(false);
    }
  }
  function contextLabel(record: LearningRecord) {
    const attempt = record.timedAttemptId
      ? timedSources.get(record.timedAttemptId)
      : undefined;
    if (!attempt?.trackContext) return null;
    const snapshot = attempt.trackContext;
    const stageExists = data.trackStages?.some(
      (stage) =>
        stage.id === snapshot.stageId && stage.trackId === snapshot.trackId,
    );
    return (
      <p className={styles.meta}>
        {stageExists ? (
          <Link className="text-link" href={trackHref(snapshot)}>
            {snapshot.trackTitle} · {snapshot.stageTitle}
          </Link>
        ) : (
          `${snapshot.trackTitle} · ${snapshot.stageTitle} (track no longer available)`
        )}
      </p>
    );
  }
  function originalSources(record: LearningRecord) {
    const timed = record.timedAttemptId
      ? timedSources.get(record.timedAttemptId)
      : undefined;
    const imported = record.importedAttemptId
      ? importedSources.get(record.importedAttemptId)
      : undefined;
    const importedReflection = imported
      ? importedReflections.get(imported.id)
      : undefined;
    return (
      <details className={styles.sources}>
        <summary>
          Original source record{record.source === "linked" ? "s" : ""}
          {record.source === "linked"
            ? " · explicitly linked as one practice event"
            : ""}
        </summary>
        {timed && (
          <div className={styles.source}>
            <strong>Timed source</strong>
            <p>
              {shortDate(timed.completedAt)} · {OUTCOMES[timed.outcome]} ·{" "}
              {Math.round(timed.elapsedMs / 1000)} seconds measured
            </p>
            {timed.notes && <p className={styles.quote}>{timed.notes}</p>}
            {timed.approach && <p className={styles.quote}>{timed.approach}</p>}
            {timed.takeaway && <p className={styles.quote}>{timed.takeaway}</p>}
            <button
              className="button secondary"
              disabled={profileView}
              onClick={() => setTimedEditing(timed)}
            >
              Edit timed source
            </button>
          </div>
        )}
        {imported && (
          <div className={styles.source}>
            <strong>Codeforces source · {imported.handle}</strong>
            <p>
              {imported.submissionIds.length} submission
              {imported.submissionIds.length === 1 ? "" : "s"}; imported
              duration is not measured.
            </p>
            <ul className={styles.list}>
              {imported.submissionIds
                .flatMap((id) => {
                  const submission = submissionsBySource.get(
                    `${imported.handle.toLowerCase()}:${id}`,
                  );
                  return submission ? [submission] : [];
                })
                .sort(
                  (a, b) =>
                    a.submittedAt.localeCompare(b.submittedAt) || a.id - b.id,
                )
                .map((submission) => (
                  <li key={submission.id}>
                    <span>
                      #{submission.id} · {verdictLabel(submission.verdict)} ·{" "}
                      {submission.language || "Language not recorded"} ·{" "}
                    </span>
                    <time dateTime={submission.submittedAt}>
                      {new Date(submission.submittedAt).toLocaleString()}
                    </time>
                  </li>
                ))}
            </ul>
            {importedReflection && (
              <p>
                {OUTCOMES[importedReflection.outcome]}
                {importedReflection.takeaway &&
                  ` · ${importedReflection.takeaway}`}
              </p>
            )}
            {importedReflection?.approach && (
              <p className={styles.quote}>{importedReflection.approach}</p>
            )}
            {importedReflection?.mistakeNote && (
              <p className={styles.quote}>{importedReflection.mistakeNote}</p>
            )}
            {!!importedReflection?.mistakes?.length && (
              <div className={styles.pills}>
                {importedReflection.mistakes.map((category) => (
                  <span className={styles.pill} key={category}>
                    {MISTAKES[category]}
                  </span>
                ))}
              </div>
            )}
            <Link href="/activity" className="text-link">
              Open imported activity
            </Link>
            <button
              className="button secondary"
              disabled={profileView}
              onClick={() => setImportedEditing(imported.id)}
            >
              Edit imported source
            </button>
          </div>
        )}
        {record.source === "linked" && (
          <>
            <p className={styles.meta}>
              The{" "}
              {record.reflectionSource === "codeforces"
                ? "Codeforces"
                : "timed"}{" "}
              reflection supplies this event’s learning assessment. Both
              originals remain available.
            </p>
            <div className={styles.actions}>
              <button
                className="button secondary"
                disabled={profileView || sourcePending}
                aria-pressed={record.reflectionSource === "timed"}
                onClick={() => void selectReflectionSource(record, "timed")}
              >
                Use timed reflection
              </button>
              <button
                className="button secondary"
                disabled={profileView || sourcePending || !importedReflection}
                aria-pressed={record.reflectionSource === "codeforces"}
                onClick={() =>
                  void selectReflectionSource(record, "codeforces")
                }
              >
                Use imported reflection
              </button>
            </div>
            {!importedReflection && (
              <p className={styles.meta}>
                Add an imported reflection before selecting it as this event’s
                assessment.
              </p>
            )}
          </>
        )}
      </details>
    );
  }
  return (
    <div className={styles.page}>
      <div className={styles.back}>
        <Link className="text-link" href={destination.href}>
          <ArrowLeft size={16} />
          {destination.label}
        </Link>
      </div>
      <PageHeader
        eyebrow="LEARNING MEMORY"
        title={problem.title}
        description="A notebook of your attempts, reflections, and deliberate revision."
        action={<ProblemLink problem={problem} />}
      />
      <p className={styles.meta}>
        {problem.platform || "Platform not recorded"}
        {problem.problemCode && ` · ${problem.problemCode}`}
        {problem.rating !== null && ` · Rating ${problem.rating}`}
        {problem.cfHandle && ` · Profile ${problem.cfHandle}`}
      </p>
      {archivedProfile && (
        <p className={styles.notice}>
          You are viewing the archived {problem.cfHandle} profile explicitly.
          Its imported history is kept separate from your current profile.
        </p>
      )}
      {profileView && (
        <p className={styles.notice}>
          {evidenceProfile?.valid
            ? `Read-only evidence for ${evidenceProfile.handle ?? "personal practice"}. The connected profile is unchanged.`
            : "The requested learning profile is not saved in this workspace. Showing this problem’s usual history in a read-only view."}
        </p>
      )}
      {memberships.length > 0 && (
        <p className={styles.meta}>
          In{" "}
          {memberships.map((entry, index) => {
            const linked = trackContextForEntry(data, entry.id);
            return linked ? (
              <span key={entry.id}>
                {index > 0 && " · "}
                <Link href={trackHref(linked)} className="text-link">
                  {linked.trackTitle} / {linked.stageTitle}
                </Link>
              </span>
            ) : null;
          })}
        </p>
      )}
      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="memory-evidence">
          <h2 id="memory-evidence">What your records show</h2>
          {!!contestMemory.length && (
            <p className={styles.meta}>
              This summary covers timed practice, imported reflections, and
              written recall. Original contest reflections appear separately
              below.
            </p>
          )}
          <dl className={styles.evidence}>
            <div>
              <dt>Platform acceptance</dt>
              <dd>
                {accepted
                  ? "Accepted submission recorded on Codeforces"
                  : "No platform acceptance recorded in this history"}
              </dd>
            </div>
            <div>
              <dt>Most recent reflected outcome</dt>
              <dd>
                {memory.summary.latestReflection?.outcome
                  ? OUTCOMES[memory.summary.latestReflection.outcome]
                  : "No reflection recorded yet"}
              </dd>
            </div>
            <div>
              <dt>Previous assistance</dt>
              <dd>
                {memory.summary.assistance.length
                  ? `${memory.summary.assistance.length} reflection${memory.summary.assistance.length === 1 ? "" : "s"} recorded a hint or editorial.`
                  : "No assistance marked in a reflection."}
              </dd>
            </div>
            <div>
              <dt>Recorded mistakes</dt>
              <dd>
                {memory.summary.mistakes.length ? (
                  <ul className={styles.list}>
                    {memory.summary.mistakes.map(({ category, count }) => (
                      <li key={category}>
                        {MISTAKES[category]} was marked in {count} reflection
                        {count === 1 ? "" : "s"}.
                      </li>
                    ))}
                  </ul>
                ) : (
                  "No mistake labels recorded. Submission verdicts do not create labels."
                )}
              </dd>
            </div>
            <div>
              <dt>Latest takeaway</dt>
              <dd>
                {memory.summary.latestTakeaway || "No takeaway recorded yet."}
              </dd>
            </div>
            <div>
              <dt>Revision status</dt>
              <dd>
                {memory.summary.latestRevision
                  ? `${RECALL_OUTCOMES[memory.summary.latestRevision.outcome]} · ${shortDate(memory.summary.latestRevision.completedAt)}`
                  : "No written recall checks recorded."}
              </dd>
            </div>
          </dl>
        </section>
        <section className={styles.card} aria-labelledby="memory-revision">
          <h2 id="memory-revision">A deliberate next visit</h2>
          <p>
            {practice.codingAt
              ? `Coding reattempt: ${shortDate(practice.codingAt)}.`
              : "No coding reattempt scheduled."}
          </p>
          <p>
            {memory.summary.recallAt
              ? `Written recall: ${shortDate(memory.summary.recallAt)}.`
              : "No written recall scheduled."}
          </p>
          {practice.archived && (
            <p className={styles.meta}>
              Archived from automatic recommendations. Manual practice is
              available.
            </p>
          )}
          {practice.skipped && (
            <p className={styles.meta}>
              Skipped for today’s automatic recommendations.
            </p>
          )}
          {practice.deferredUntil && (
            <p className={styles.meta}>
              Deferred from automatic recommendations until{" "}
              {shortDate(practice.deferredUntil)}.
            </p>
          )}
          <p className={styles.meta}>
            A written recall changes its own next date. It keeps any separately
            scheduled coding reattempt.
          </p>
          <div className={styles.actions}>
            <button
              className="button"
              disabled={profileView || startPending}
              onClick={() => void resolveAgain(problem)}
            >
              {startPending ? "Starting…" : "Re-solve the problem"}
            </button>
            <button
              className="button secondary"
              disabled={profileView}
              onClick={() => setRevision("explain")}
            >
              Explain the approach or invariant
            </button>
            <button
              className="button secondary"
              disabled={profileView}
              onClick={() => setRevision("complexity")}
            >
              Recall complexity and edge cases
            </button>
          </div>
          <p className={styles.meta}>
            You can write an optional cue while recording a recall check.
            Earlier solution notes stay behind “Reveal previous notes” during
            that check.
          </p>
        </section>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {contestMemory.map(({ c, p }) => (
        <section className={styles.card} key={p.id}>
          <h2>Contest reflection · {c.name}</h2>
          <p className={styles.meta}>
            Original contest record. Whole-contest time does not measure this
            problem’s working time.
          </p>
          <p>
            {p.reflection
              ? OUTCOMES[p.reflection.outcome]
              : "No contest reflection saved yet."}
          </p>
          {p.reflection?.takeaway && (
            <p className={styles.quote}>{p.reflection.takeaway}</p>
          )}
          {p.reflection?.approach && (
            <p className={styles.quote}>{p.reflection.approach}</p>
          )}
          {p.reflection?.mistakeNote && (
            <p className={styles.quote}>{p.reflection.mistakeNote}</p>
          )}
          {p.reflection?.mistakes?.length ? (
            <ul className={styles.list}>
              {p.reflection.mistakes.map((k) => (
                <li key={k}>{MISTAKES[k]}</li>
              ))}
            </ul>
          ) : null}
          <Link className="text-link" href={`/contests/${c.id}`}>
            Review contest and evidence
          </Link>
          {p.upsolve?.completionId && (
            <p className={styles.meta}>
              Later upsolve has its own timed record below.
            </p>
          )}
        </section>
      ))}
      <section className={styles.card} aria-labelledby="memory-history">
        <h2 id="memory-history">Your learning history</h2>
        <p className={styles.meta}>
          Oldest to newest. Explicitly linked timed and imported sources count
          as one practice event; written recall is a separate activity.
        </p>
        {memory.timeline.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={28} />}
            title="This page starts with your first record."
            description="Finish a timed session, reflect on imported activity, or write a recall check. No learning outcome is inferred from a problem being in a track."
          />
        ) : (
          <ol className={styles.timeline}>
            {[...memory.timeline]
              .sort(
                (a, b) =>
                  a.completedAt.localeCompare(b.completedAt) ||
                  a.id.localeCompare(b.id),
              )
              .map((event) => (
                <li
                  className={styles.event}
                  key={`${event.type}:${event.id}`}
                  id={memoryRecordAnchor(event.type, event.record.id)}
                >
                  {event.type === "practice" ? (
                    <>
                      <div className={styles.eventHeader}>
                        <div>
                          <h3>
                            {event.record.source === "linked"
                              ? "Timed practice + Codeforces activity"
                              : event.record.source === "timed"
                                ? "Timed practice"
                                : "Imported Codeforces activity"}
                          </h3>
                          <time
                            className={styles.meta}
                            dateTime={event.record.completedAt}
                          >
                            {new Date(
                              event.record.completedAt,
                            ).toLocaleString()}
                          </time>
                        </div>
                        {event.record.outcome && (
                          <span className={styles.pill}>
                            {OUTCOMES[event.record.outcome]}
                          </span>
                        )}
                      </div>
                      <p className={styles.meta}>
                        {event.record.handle && `${event.record.handle} · `}
                        {event.record.accepted === true
                          ? "Platform accepted · "
                          : event.record.accepted === false
                            ? "No accepted submission in this event · "
                            : ""}
                        {event.record.elapsedMs === null
                          ? "Time not measured"
                          : `${Math.round(event.record.elapsedMs / 1000)} seconds measured`}
                      </p>
                      {contextLabel(event.record)}
                      {event.record.outcome === null && (
                        <p className="muted">
                          No reflection recorded. This event has no mistake
                          classification or self-reported understanding.
                        </p>
                      )}
                      {event.record.difficulty && (
                        <p>
                          Earlier difficulty:{" "}
                          {DIFFICULTIES[event.record.difficulty]}
                        </p>
                      )}
                      {!!event.record.mistakes?.length && (
                        <div className={styles.pills}>
                          {event.record.mistakes.map((category) => (
                            <span className={styles.pill} key={category}>
                              {MISTAKES[category]}
                            </span>
                          ))}
                        </div>
                      )}
                      {event.record.approach && (
                        <div>
                          <h3>What you tried</h3>
                          <p className={styles.quote}>
                            {event.record.approach}
                          </p>
                        </div>
                      )}
                      {event.record.mistakeNote && (
                        <div>
                          <h3>Where you got stuck</h3>
                          <p className={styles.quote}>
                            {event.record.mistakeNote}
                          </p>
                        </div>
                      )}
                      {event.record.notes && (
                        <div>
                          <h3>Session notes</h3>
                          <p className={styles.quote}>{event.record.notes}</p>
                        </div>
                      )}
                      {event.record.takeaway && (
                        <div>
                          <h3>One thing to remember</h3>
                          <p className={styles.quote}>
                            {event.record.takeaway}
                          </p>
                        </div>
                      )}
                      <div className={styles.actions}>
                        <button
                          className="button secondary"
                          disabled={profileView}
                          onClick={() => {
                            if (
                              event.record.reflectionSource === "codeforces" ||
                              !event.record.timedAttemptId
                            )
                              setImportedEditing(
                                event.record.importedAttemptId,
                              );
                            else
                              setTimedEditing(
                                timedSources.get(event.record.timedAttemptId) ??
                                  null,
                              );
                          }}
                          aria-label={`Edit reflection: ${new Date(event.record.completedAt).toLocaleString()}`}
                        >
                          {event.record.outcome === null
                            ? "Add reflection"
                            : "Edit reflection"}
                        </button>
                      </div>
                      {originalSources(event.record)}
                    </>
                  ) : (
                    <>
                      <div className={styles.eventHeader}>
                        <div>
                          <h3>{REVISION_ACTIVITIES[event.record.activity]}</h3>
                          <time
                            className={styles.meta}
                            dateTime={event.record.completedAt}
                          >
                            {new Date(
                              event.record.completedAt,
                            ).toLocaleString()}
                          </time>
                        </div>
                        <span className={styles.pill}>
                          {RECALL_OUTCOMES[event.record.outcome]}
                        </span>
                      </div>
                      <p className={styles.meta}>
                        Written recall · no coding session or platform
                        acceptance added
                        {event.record.handle ? ` · ${event.record.handle}` : ""}
                      </p>
                      {event.record.trackContext && (
                        <p className={styles.meta}>
                          {event.record.trackContext.trackTitle} ·{" "}
                          {event.record.trackContext.stageTitle}
                        </p>
                      )}
                      <p className={styles.quote}>{event.record.response}</p>
                      {event.record.cue && <p>Cue: {event.record.cue}</p>}
                      <p className={styles.meta}>
                        {event.record.nextReviewAt
                          ? `Next recall chosen: ${shortDate(event.record.nextReviewAt)}`
                          : "No further recall chosen"}
                      </p>
                    </>
                  )}
                </li>
              ))}
          </ol>
        )}
      </section>
      {timedEditing && (
        <TimedReflectionEditor
          attempt={timedEditing}
          onClose={() => setTimedEditing(null)}
        />
      )}
      {importedAttempt && (
        <QuickReflectionDialog
          attempt={importedAttempt}
          onClose={() => setImportedEditing(null)}
        />
      )}
      {revision && (
        <RevisionDialog
          problem={problem}
          activity={revision}
          context={context}
          onClose={() => setRevision(null)}
        />
      )}
    </div>
  );
}
