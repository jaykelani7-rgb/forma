import type { Data } from "./model";
import {
  currentPracticePlan,
  markPlanStarted,
  reconcilePracticePlan,
  resolvePlanProblem,
} from "./practice-plan";
import { withPracticeSession } from "./practice-session";

/** Bind the selected item and its real session in one workspace proposal. */
export function withPlannedPracticeSession(
  data: Data,
  itemId: string,
  now: number,
  sessionId: string,
): Data {
  const at = new Date(now);
  const checked = reconcilePracticePlan(data, at);
  const item = currentPracticePlan(checked, at)?.items.find(
    (value) => value.id === itemId && value.status === "pending",
  );
  const choice = item && resolvePlanProblem(checked, item);
  if (!item || !choice || item.activity !== "coding")
    throw new Error(
      "This planned activity changed. Choose the current activity on Today.",
    );
  return markPlanStarted(
    withPracticeSession(
      checked,
      choice.problem,
      item.timeboxMinutes,
      now,
      sessionId,
      choice.fresh,
      choice.trackContext,
    ),
    itemId,
    sessionId,
    at,
  );
}
