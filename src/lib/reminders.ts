import type { Data } from "./model";

export interface ReminderPreferences {
  enabled: boolean;
  time: string;
  dismissedOn: string | null;
}

export const defaultReminder = (): ReminderPreferences => ({
  enabled: false,
  time: "18:00",
  dismissedOn: null,
});

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validateReminder(value: unknown): ReminderPreferences {
  if (value === undefined) return defaultReminder();
  const fail = (): never => {
    throw new Error("The in-app reminder preferences are invalid.");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const reminder = value as Record<string, unknown>;
  if (
    typeof reminder.enabled !== "boolean" ||
    typeof reminder.time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time) ||
    !(
      reminder.dismissedOn === null ||
      (typeof reminder.dismissedOn === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(reminder.dismissedOn) &&
        localDay(new Date(`${reminder.dismissedOn}T12:00:00`)) ===
          reminder.dismissedOn)
    )
  )
    return fail();
  return {
    enabled: reminder.enabled,
    time: reminder.time,
    dismissedOn: reminder.dismissedOn as string | null,
  };
}

export function inAppReminderDue(data: Data, now = new Date()): boolean {
  const reminder = data.settings.reminder ?? defaultReminder();
  const today = localDay(now);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (
    !reminder.enabled ||
    reminder.dismissedOn === today ||
    data.session ||
    time < reminder.time
  )
    return false;
  const practiced =
    data.attempts.some(
      (attempt) => localDay(new Date(attempt.completedAt)) === today,
    ) ||
    data.codeforces.submissions.some(
      (submission) =>
        submission.handle.toLowerCase() ===
          data.codeforces.connectedHandle?.toLowerCase() &&
        localDay(new Date(submission.submittedAt)) === today,
    );
  return !practiced;
}

export function dismissInAppReminder(data: Data, now = new Date()): Data {
  return {
    ...data,
    settings: {
      ...data.settings,
      reminder: {
        ...(data.settings.reminder ?? defaultReminder()),
        dismissedOn: localDay(now),
      },
    },
  };
}
