import type { LearningRecord } from "./learning";
import type { Problem } from "./model";
import { practiceIdentity } from "./practice-state";

export interface AttemptComparison {
  then: LearningRecord;
  now: LearningRecord;
  change: string | null;
}

function sharedAttempt(first: LearningRecord, second: LearningRecord) {
  return first.id === second.id ||
    (!!first.timedAttemptId && first.timedAttemptId === second.timedAttemptId) ||
    // A contest projection and a residual import can share the source import
    // while representing different, non-overlapping submissions.
    (!!first.importedAttemptId && first.importedAttemptId === second.importedAttemptId &&
      first.source !== "contest" && second.source !== "contest") ||
    first.submissionIds.some(id => second.submissionIds.includes(id));
}

/** Both records must come from the same problem's scoped learning history. */
export function compareAttempts(first: LearningRecord, second: LearningRecord): AttemptComparison | null {
  const difference = Date.parse(first.completedAt) - Date.parse(second.completedAt);
  if (!Number.isFinite(difference) || difference === 0 || sharedAttempt(first, second) ||
    (first.handle && second.handle && first.handle.toLowerCase() !== second.handle.toLowerCase())) return null;
  const [then, now] = difference < 0 ? [first, second] : [second, first];
  let change: string | null = null;
  if (then.reflectedAt && now.reflectedAt && now.outcome === "independent") {
    if (then.outcome === "hint") {
      change = "Your earlier attempt used a hint. You marked the later attempt solved independently.";
    } else if (then.outcome === "editorial") {
      change = "Your earlier attempt used the editorial. You marked the later attempt solved independently.";
    } else if (then.outcome === "unsolved") {
      change = "You marked the earlier attempt as unsolved and the later attempt as solved independently.";
    }
  }
  return { then, now, change };
}

export function attemptComparisonChoices(
  selected: LearningRecord,
  history: readonly LearningRecord[],
  problems: ReadonlyMap<string, Problem>,
): LearningRecord[] {
  const problem = problems.get(selected.problemId);
  if (!problem) return [];
  const identity = practiceIdentity(problem);
  const selectedTime = Date.parse(selected.completedAt);
  const seen = new Set<string>();
  const candidates: { record: LearningRecord; difference: number }[] = [];
  for (const record of history) {
    const candidate = problems.get(record.problemId);
    if (!candidate || practiceIdentity(candidate) !== identity || seen.has(record.id) || !compareAttempts(selected, record)) continue;
    seen.add(record.id);
    candidates.push({ record, difference: Date.parse(record.completedAt) - selectedTime });
  }
  return candidates.sort((first, second) =>
    Number(first.difference > 0) - Number(second.difference > 0) ||
    Number(!!second.record.reflectedAt) - Number(!!first.record.reflectedAt) ||
    Math.abs(first.difference) - Math.abs(second.difference) ||
    first.record.id.localeCompare(second.record.id),
  ).map(({ record }) => record);
}
