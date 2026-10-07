import type { ImportedAttempt } from "./codeforces-types";
import type { Problem } from "./model";

export function attemptAfterReviewCompletion(
  problem: Problem,
  attempt: ImportedAttempt,
): boolean {
  return (
    !problem.reviewCompletedAt ||
    Date.parse(attempt.firstSubmittedAt) > Date.parse(problem.reviewCompletedAt)
  );
}

/** Completing a revisit retires its schedule; it is not an opt-out for a later
 * attempt. A reflection-owned choice (including no revisit) remains manual. */
export function preservesManualReview(
  problem: Problem,
  attempt: ImportedAttempt,
): boolean {
  if (!problem.reviewManual) return false;
  const laterPracticeAfterCompletion =
    !!problem.reviewCompletedAt &&
    attemptAfterReviewCompletion(problem, attempt) &&
    !problem.reviewAt &&
    !problem.reviewAttemptId;
  return !laterPracticeAfterCompletion;
}
