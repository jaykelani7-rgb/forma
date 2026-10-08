"use client";

import { useRef, useState } from "react";
import {
  DIFFICULTIES,
  localDate,
  shortDate,
  uid,
  type Problem,
} from "@/lib/model";
import {
  problemMemory,
  revisionCueForProblem,
  revisionHandle,
  saveRevision,
  suggestedRecallDate,
} from "@/lib/memory";
import { MISTAKES, type RevisionRecord } from "@/lib/memory-types";
import { sharedPracticeState } from "@/lib/practice-state";
import type { TrackContext } from "@/lib/tracks-types";
import { useWorkspace } from "./provider";
import { Modal } from "./ui";
import styles from "./memory.module.css";

export const RECALL_OUTCOMES = {
  independent: "Recalled independently",
  cue: "Needed a cue",
  unrecalled: "Could not recall yet",
} as const;
export const REVISION_ACTIVITIES = {
  explain: "Explain the approach or invariant",
  complexity: "Recall complexity and edge cases",
} as const;

export function RevisionDialog({
  problem,
  activity,
  context,
  onClose,
  onSaved,
}: {
  problem: Problem;
  activity: RevisionRecord["activity"];
  context?: TrackContext;
  onClose: () => void;
  onSaved?: (cue: string) => void;
}) {
  const { data, update, retryLocalSave, guardWorkspace, notify } =
    useWorkspace();
  const memory = problemMemory(
    data,
    problem.id,
    problem.cfHandle ? { handle: problem.cfHandle } : undefined,
  );
  const identity = useRef<string | null>(null);
  const available = data.problems.some((item) => item.id === problem.id);
  const [profileIdentity] = useState(() =>
    available ? revisionHandle(data, problem.id) : (problem.cfHandle ?? null),
  );
  const completedAt = useRef<string | null>(null);
  const saving = useRef(false);
  const [response, setResponse] = useState("");
  const [cue, setCue] = useState(() =>
    revisionCueForProblem(
      data,
      problem.id,
      problem.cfHandle ? { handle: problem.cfHandle } : undefined,
    ),
  );
  const [outcome, setOutcome] = useState<RevisionRecord["outcome"] | null>(
    null,
  );
  const [date, setDate] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const practice = sharedPracticeState(
    data,
    problem,
    new Date(),
    problem.cfHandle ? { handle: problem.cfHandle } : undefined,
  );
  const earlierDifficulties = [
    ...new Set(
      memory.history.flatMap((record) =>
        record.difficulty ? [record.difficulty] : [],
      ),
    ),
  ];
  function choose(value: RevisionRecord["outcome"]) {
    setOutcome(value);
    setError("");
    if (!override) setDate(suggestedRecallDate(data, value));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    if (!available) {
      setError(
        "This problem is no longer available in the current notebook. Your written draft is still here; close this check after keeping any text you need.",
      );
      return;
    }
    if (
      revisionHandle(data, problem.id)?.toLowerCase() !==
      profileIdentity?.toLowerCase()
    ) {
      setError(
        "The connected Codeforces profile changed while this check was open. Your draft is still here. Return to the original profile before saving, or start a separate check for the new profile.",
      );
      return;
    }
    if (!response.trim()) {
      setError(
        "Write what you recalled, even if it is only the point you could not recover.",
      );
      return;
    }
    if (!outcome) {
      setError("Choose how the recall check went.");
      return;
    }
    if (
      date !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        localDate(new Date(`${date}T12:00:00`)) !== date)
    ) {
      setError("Choose a valid next recall date, or no further recall.");
      return;
    }
    const record: RevisionRecord = {
      id: identity.current ?? (identity.current = uid()),
      problemId: problem.id,
      handle: profileIdentity,
      activity,
      outcome,
      response: response.trim(),
      cue: cue.trim(),
      completedAt:
        completedAt.current ?? (completedAt.current = new Date().toISOString()),
      nextReviewAt: date,
      ...(context ? { trackContext: context } : {}),
    };
    const isCurrent = guardWorkspace();
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const proposal = (current: typeof data) => saveRevision(current, record);
      const saved = await (failed
        ? retryLocalSave(proposal)
        : update(proposal));
      if (!isCurrent()) return;
      if (!saved) {
        setFailed(true);
        setError(
          "Recall was not committed. Your written response and date are still here. Review the storage message, then retry this save.",
        );
        return;
      }
      notify("Recall saved. Your coding reattempt date is unchanged.");
      onSaved?.(record.cue);
      onClose();
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Recall was not committed. Keep this draft and retry.",
        );
    } finally {
      saving.current = false;
      if (isCurrent()) setPending(false);
    }
  }
  return (
    <Modal
      title={REVISION_ACTIVITIES[activity]}
      className={styles.dialog}
      onClose={() => {
        if (!saving.current) onClose();
      }}
    >
      <form className="form-stack" onSubmit={save}>
        <strong>{problem.title}</strong>
        <p className={styles.meta}>
          {profileIdentity
            ? `Codeforces profile: ${profileIdentity}`
            : "Personal notebook recall"}
        </p>
        <p>
          This is a written recall check. It records your recall assessment
          separately from coding attempts and platform acceptance.
        </p>
        {memory.summary.mistakes.length > 0 ? (
          <div>
            <h3>Previously recorded difficulties</h3>
            <ul className={styles.list}>
              {memory.summary.mistakes.map(({ category, count }) => (
                <li key={category}>
                  {MISTAKES[category]} · {count} reflection
                  {count === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">
            No mistake categories have been recorded for this problem.
          </p>
        )}
        {earlierDifficulties.length > 0 && (
          <p className={styles.meta}>
            Earlier difficulty selections:{" "}
            {earlierDifficulties
              .map((difficulty) => DIFFICULTIES[difficulty])
              .join(", ")}
            .
          </p>
        )}
        {memory.summary.assistance.length > 0 && (
          <p className={styles.meta}>
            A hint or editorial was marked in {memory.summary.assistance.length}{" "}
            earlier reflection
            {memory.summary.assistance.length === 1 ? "" : "s"}.
          </p>
        )}
        <label>
          My recall cue <span className="optional">optional</span>
          <input
            value={cue}
            onChange={(event) => setCue(event.target.value)}
            maxLength={300}
            disabled={pending}
            placeholder="A small reminder, without the full solution"
          />
        </label>
        <button
          type="button"
          className="button secondary"
          aria-expanded={revealed}
          onClick={() => setRevealed(!revealed)}
          disabled={pending}
        >
          {revealed ? "Hide previous notes" : "Reveal previous notes"}
        </button>
        {revealed && (
          <section
            className={styles.notes}
            aria-label="Previous solution notes"
          >
            {memory.history.some(
              (record) =>
                record.notes ||
                record.approach ||
                record.takeaway ||
                record.mistakeNote,
            ) ? (
              memory.history
                .filter(
                  (record) =>
                    record.notes ||
                    record.approach ||
                    record.takeaway ||
                    record.mistakeNote,
                )
                .map((record) => (
                  <div key={record.id} className={styles.source}>
                    <p className={styles.meta}>
                      {shortDate(record.reflectedAt ?? record.completedAt)}
                    </p>
                    {record.approach && (
                      <p className={styles.quote}>{record.approach}</p>
                    )}
                    {record.notes && (
                      <p className={styles.quote}>{record.notes}</p>
                    )}
                    {record.mistakeNote && (
                      <p className={styles.quote}>{record.mistakeNote}</p>
                    )}
                    {record.takeaway && (
                      <p className={styles.quote}>{record.takeaway}</p>
                    )}
                  </div>
                ))
            ) : (
              <p className="muted">
                No previous solution notes have been recorded.
              </p>
            )}
          </section>
        )}
        <label>
          {activity === "explain"
            ? "Explain what makes the approach work"
            : "Recall the complexity and important edge cases"}
          <textarea
            data-initial-focus
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            disabled={pending}
            rows={5}
            maxLength={6000}
            placeholder={
              activity === "explain"
                ? "The invariant is… It stays true because…"
                : "Time: … Space: … Edge cases to check: …"
            }
          />
        </label>
        <fieldset>
          <legend>How did the recall check go?</legend>
          <div className={styles.choices}>
            {Object.entries(RECALL_OUTCOMES).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={outcome === key}
                onClick={() => choose(key as RevisionRecord["outcome"])}
                disabled={pending}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {outcome && (
          <div className={styles.date}>
            {date !== null ? (
              <label>
                Next recall date
                <input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setOverride(true);
                  }}
                  disabled={pending}
                />
              </label>
            ) : (
              <p>No further recall scheduled.</p>
            )}
            <button
              type="button"
              className="button secondary"
              aria-pressed={date === null}
              disabled={pending}
              onClick={() => {
                setDate(null);
                setOverride(true);
              }}
            >
              No further recall
            </button>
            {date === null && (
              <button
                type="button"
                className="button secondary"
                disabled={pending}
                onClick={() => {
                  setDate(suggestedRecallDate(data, outcome));
                  setOverride(false);
                }}
              >
                Use suggested date
              </button>
            )}
          </div>
        )}
        <p className={styles.meta}>
          Suggested intervals: {data.settings.recallDays?.independent ?? 7} days
          after independent recall, {data.settings.recallDays?.cue ?? 3} after
          needing a cue, and {data.settings.recallDays?.unrecalled ?? 1} after
          an unsuccessful recall. You can choose another date or stop recall
          reminders.
        </p>
        <p className={styles.notice}>
          {practice.codingAt
            ? `Coding reattempt date: ${shortDate(practice.codingAt)}. This check keeps that date.`
            : "No coding reattempt is scheduled. This check changes only the recall reminder."}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogFooter}>
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="button" disabled={pending}>
            {pending
              ? "Saving…"
              : failed
                ? "Retry recall save"
                : "Save recall check"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
