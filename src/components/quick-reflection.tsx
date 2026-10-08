"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Check, CalendarDays } from "lucide-react";
import {
  DIFFICULTIES,
  Difficulty,
  Outcome,
  addDays,
  localDate,
} from "@/lib/model";
import { ImportedAttempt } from "@/lib/codeforces-types";
import {
  attemptAfterReviewCompletion,
  preservesManualReview,
} from "@/lib/reflection-scheduling";
import { sharedPracticeState } from "@/lib/practice-state";
import {
  latestSubmission,
  proposedReview,
  reflectionFor,
  relevantSchedule,
  saveQuickReflection,
  skipReflection,
  verdictLabel,
} from "@/lib/codeforces";
import { useWorkspace } from "./provider";
import { Modal } from "./ui";
import type { ReflectionMemory } from "@/lib/memory-types";
import { ReflectionMemoryFields } from "./reflection-memory-fields";

export const QUICK_OUTCOMES: Record<Outcome, string> = {
  independent: "Solved independently",
  hint: "Used a hint",
  editorial: "Used the editorial",
  unsolved: "Still need to understand it",
};
export function QuickReflectionDialog({
  attempt,
  onClose,
}: {
  attempt: ImportedAttempt;
  onClose: () => void;
}) {
  const { data, update, retryLocalSave, storageError, notify, guardWorkspace } =
    useWorkspace();
  const problem = data.problems.find((p) => p.id === attempt.problemId)!;
  const previous = reflectionFor(data, attempt.id);
  const linked = data.learningLinks?.find(
    (link) => link.importedAttemptId === attempt.id,
  );
  const codingProblem =
    sharedPracticeState(data, problem, new Date(), { handle: attempt.handle })
      .codingProblem ?? problem;
  const keepCompletedSchedule = !attemptAfterReviewCompletion(
    codingProblem,
    attempt,
  );
  const keepManualSchedule =
    preservesManualReview(codingProblem, attempt) || keepCompletedSchedule;
  const [outcome, setOutcome] = useState<Outcome | null>(
    previous?.outcome ?? null,
  );
  const [difficulty, setDifficulty] = useState<Difficulty | null>(
    previous?.difficulty ?? null,
  );
  const [takeaway, setTakeaway] = useState(previous?.takeaway ?? "");
  const [memory, setMemory] = useState<ReflectionMemory>(() => ({
    ...(previous?.mistakes !== undefined
      ? { mistakes: previous.mistakes }
      : {}),
    ...(previous?.approach !== undefined
      ? { approach: previous.approach }
      : {}),
    ...(previous?.mistakeNote !== undefined
      ? { mistakeNote: previous.mistakeNote }
      : {}),
  }));
  const [date, setDate] = useState<string | null>(
    keepManualSchedule || codingProblem.reviewAttemptId === attempt.id
      ? codingProblem.reviewAt
      : previous
        ? proposedReview(data, problem, previous.outcome)
        : null,
  );
  const [override, setOverride] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"save" | "skip" | null>(null);
  const saving = useRef(false);
  const relevant = relevantSchedule(data, attempt);
  const latest = latestSubmission(data, attempt);
  function choose(value: Outcome) {
    setOutcome(value);
    setError("");
    if (!keepManualSchedule && !override)
      setDate(proposedReview(data, problem, value));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await commit(event.currentTarget as HTMLFormElement);
  }
  async function commit(form: HTMLFormElement, retry = false) {
    if (saving.current) return;
    if (!outcome) {
      setError("Choose the reflection that fits this attempt.");
      return;
    }
    const submitted = new FormData(form);
    const chosen =
      date === null ? null : String(submitted.get("reviewDate") ?? date);
    if (
      chosen !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(chosen) ||
        localDate(new Date(`${chosen}T12:00:00`)) !== chosen)
    ) {
      setError("Choose a valid local calendar date, or no revisit.");
      return;
    }
    const isCurrent = guardWorkspace();
    saving.current = true;
    setPending("save");
    setError("");
    try {
      const saved = await (retry ? retryLocalSave : update)((d) =>
        saveQuickReflection(d, attempt.id, {
          outcome,
          difficulty,
          takeaway,
          ...memory,
          reviewAt: chosen,
          overrideSchedule: override || chosen !== date,
        }),
      );
      if (!isCurrent()) return;
      if (!saved) {
        setError(
          "Reflection was not committed. Your input is still here. Review the storage message and recovery copies in Settings, then retry.",
        );
        return;
      }
      notify(
        relevant && keepManualSchedule && !override && chosen === date
          ? "Reflection saved. Your existing coding revisit choice is kept."
          : relevant
            ? chosen
              ? "Reflection saved. Your suggested revisit is in the queue."
              : "Reflection saved. No new revisit needed."
            : "Reflection saved. The newer attempt keeps its revisit date.",
      );
      onClose();
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Reflection was not committed. Keep this input and retry after reviewing the storage message.",
        );
    } finally {
      saving.current = false;
      if (isCurrent()) setPending(null);
    }
  }
  async function skip() {
    if (saving.current) return;
    if (previous) {
      onClose();
      return;
    }
    const isCurrent = guardWorkspace();
    saving.current = true;
    setPending("skip");
    setError("");
    try {
      const saved = await update((d) => skipReflection(d, attempt.id));
      if (!isCurrent()) return;
      if (saved) onClose();
      else
        setError(
          "The skip was not committed. Review the storage message and recovery copies in Settings, then retry.",
        );
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "The skip was not committed. Please retry.",
        );
    } finally {
      saving.current = false;
      if (isCurrent()) setPending(null);
    }
  }
  return (
    <Modal
      title="A moment to understand."
      onClose={() => {
        if (!saving.current) onClose();
      }}
      className="quick-reflection-modal"
    >
      <form onSubmit={save} className="form-stack">
        <div className="quick-scroll">
          <div className="quick-context">
            <strong>{problem.title}</strong>
            <span className="small muted">
              {attempt.handle} · #{problem.problemCode} ·{" "}
              {verdictLabel(latest?.verdict ?? null)} ·{" "}
              {attempt.submissionIds.length} submission
              {attempt.submissionIds.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="small muted">
            Codeforces records the verdict. You tell the story of how you got
            there.
          </p>
          {linked?.reflectionSource === "timed" && (
            <p className="small muted">
              This activity is linked to a timed attempt. Your imported
              reflection is kept separately; the timed reflection supplies the
              shared learning evidence. You can choose the reflection source in{" "}
              <Link
                className="text-link"
                href={`/problems/${encodeURIComponent(problem.id)}?from=${encodeURIComponent("/activity")}`}
              >
                Learning Memory
              </Link>
              .
            </p>
          )}
          <fieldset>
            <legend>How did you solve it?</legend>
            <div className="outcome-options">
              {Object.entries(QUICK_OUTCOMES).map(([key, label], i) => (
                <button
                  data-initial-focus={i === 0 ? "true" : undefined}
                  type="button"
                  disabled={pending !== null}
                  key={key}
                  aria-pressed={outcome === key}
                  className={outcome === key ? "selected" : ""}
                  onClick={() => choose(key as Outcome)}
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
            className="quick-optional"
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
                    className={difficulty === key ? "selected" : ""}
                    aria-pressed={difficulty === key}
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
          <label>
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
          {outcome && relevant && (
            <div className="schedule-preview">
              <div>
                <CalendarDays size={16} />
                <strong>Your next step</strong>
              </div>
              {keepManualSchedule && !override && (
                <p className="small muted">
                  {date === null
                    ? keepCompletedSchedule
                      ? "Keeping your completed coding revisit."
                      : "Keeping your choice of no revisit."
                    : "Keeping the revisit date you chose."}{" "}
                  Change it here only if you want to.
                </p>
              )}
              <div
                className="schedule-choices"
                role="group"
                aria-label="Revisit choice"
              >
                <button
                  type="button"
                  disabled={pending !== null}
                  aria-pressed={date !== null}
                  className={date !== null ? "selected" : ""}
                  onClick={() => {
                    setDate(
                      date ??
                        localDate(
                          addDays(
                            new Date(),
                            outcome === "independent"
                              ? 7
                              : data.settings.reviewDays[outcome],
                          ),
                        ),
                    );
                    setOverride(true);
                  }}
                >
                  Suggest a revisit
                  {outcome === "independent" ? " in 7 days" : ""}
                </button>
                <button
                  type="button"
                  disabled={pending !== null}
                  aria-pressed={date === null}
                  className={date === null ? "selected" : ""}
                  onClick={() => {
                    setDate(null);
                    setOverride(true);
                  }}
                >
                  No revisit
                </button>
              </div>
              {date !== null && (
                <label>
                  Proposed revisit date
                  <input
                    name="reviewDate"
                    type="date"
                    value={date}
                    disabled={pending !== null}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setOverride(true);
                    }}
                    required
                  />
                </label>
              )}
              <p className="tiny muted">
                A scheduling default, at your pace. Dates use your local
                calendar.
              </p>
            </div>
          )}
          {!relevant && (
            <p className="small muted">
              A newer reflected attempt sets this problem’s revisit. Editing
              this earlier reflection keeps that schedule.
            </p>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
        <div className="form-actions">
          <button
            type="button"
            disabled={pending !== null}
            className="text-link"
            onClick={skip}
          >
            {pending === "skip"
              ? "Skipping…"
              : previous
                ? "Cancel"
                : "Skip for now"}
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
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
