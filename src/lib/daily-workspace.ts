import type { Data } from "./model";
import { ensureDailyReflectionBatch } from "./codeforces";

/** Pure, idempotent reconciliation shared by load, activation and cloud apply. */
export function reconcileWorkspaceDay(data: Data, now = new Date()): Data {
  return ensureDailyReflectionBatch(data, now);
}

/** Calendar arithmetic handles 23/25-hour days. The cap also detects a changed
 * timezone or system clock while a tab remains open, without a 24-hour assumption. */
export function nextDailyCheckDelay(now = new Date()): number {
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  return Math.max(1, Math.min(60_000, midnight.getTime() - now.getTime()));
}
