"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { practicePreferences } from "@/lib/practice-plan";
import { validatePracticePreferences } from "@/lib/practice-plan-types";
import { useWorkspace } from "./provider";
import styles from "./practice-plan-preferences.module.css";

const weekdays = [
  { day: 1, label: "Monday", short: "Mon" },
  { day: 2, label: "Tuesday", short: "Tue" },
  { day: 3, label: "Wednesday", short: "Wed" },
  { day: 4, label: "Thursday", short: "Thu" },
  { day: 5, label: "Friday", short: "Fri" },
  { day: 6, label: "Saturday", short: "Sat" },
  { day: 0, label: "Sunday", short: "Sun" },
];

export function PracticePlanPreferences({
  compact = false,
}: {
  compact?: boolean;
}) {
  const {
    data,
    update,
    retryLocalSave,
    storageError,
    storagePending,
    guardWorkspace,
    notify,
  } = useWorkspace();
  const preferences = practicePreferences(data);
  const [draft, setDraft] = useState(() => ({
    minutes: String(preferences.dailyMinutes),
    days: preferences.preferredDays,
    mode: preferences.mode,
    target: preferences.targetDate ?? "",
    track: data.activeTrackId ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const lock = useRef(false);
  const { minutes, days, mode, target, track } = dirty
    ? draft
    : {
        minutes: String(preferences.dailyMinutes),
        days: preferences.preferredDays,
        mode: preferences.mode,
        target: preferences.targetDate ?? "",
        track: data.activeTrackId ?? "",
      };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const isCurrent = guardWorkspace();
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = validatePracticePreferences({
        dailyMinutes: Number(minutes),
        preferredDays: days,
        mode,
        targetDate: target || null,
      });
      const change = (current: typeof data) => {
        if (track && !current.tracks?.some((item) => item.id === track))
          throw new Error(
            "This track is no longer available. Choose another track or use your collection.",
          );
        return {
          ...current,
          activeTrackId: track || null,
          settings: { ...current.settings, practicePreferences: next },
        };
      };
      const saved = await (storageError
        ? retryLocalSave(change)
        : update(change));
      if (!isCurrent()) return;
      if (saved) {
        setDirty(false);
        notify(
          "Practice preferences saved. Today’s time override keeps its own value.",
        );
      } else
        setError(
          "Preferences were not committed. Your choices are still here. Review the storage message, then retry saving.",
        );
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "These preferences could not be saved. Your choices are still here.",
        );
    } finally {
      lock.current = false;
      if (isCurrent()) setBusy(false);
    }
  }

  function change(value: Partial<typeof draft>) {
    setDraft({ minutes, days, mode, target, track, ...value });
    setDirty(true);
    setDiscard(false);
  }
  function reset() {
    setDirty(false);
    setDiscard(false);
    setError("");
  }

  const form = (
    <form className={styles.form} onSubmit={save}>
      <p className="small muted">
        Optional preferences for a small daily plan. You can start immediately
        with the defaults.
      </p>
      <div className={styles.row}>
        <label>
          Usual daily time budget
          <span className={styles.minutes}>
            <input
              type="number"
              min={5}
              max={180}
              step={1}
              required
              value={minutes}
              disabled={busy || storagePending}
              onChange={(event) => change({ minutes: event.target.value })}
            />
            <span>minutes</span>
          </span>
          <span className="field-help">
            Planned time to make room for, rather than a completion estimate.
          </span>
        </label>
        <label>
          Active practice track
          <select
            value={track}
            disabled={busy || storagePending}
            onChange={(event) => change({ track: event.target.value })}
          >
            <option value="">Use my problem collection</option>
            {(data.tracks ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
            {track && !data.tracks?.some((item) => item.id === track) && (
              <option value={track}>
                Previously selected track · no longer available
              </option>
            )}
          </select>
          <span className="field-help">
            Track problems follow your existing stage order and progression.
          </span>
        </label>
      </div>
      <fieldset className={styles.days}>
        <legend>Preferred practice days</legend>
        <div>
          {weekdays.map(({ day, label, short }) => (
            <label
              key={day}
              className={days.includes(day) ? styles.checked : ""}
            >
              <input
                type="checkbox"
                aria-label={label}
                checked={days.includes(day)}
                disabled={busy || storagePending}
                onChange={() =>
                  change({
                    days: days.includes(day)
                      ? days.filter((value) => value !== day)
                      : [...days, day],
                  })
                }
              />
              <span>{short}</span>
            </label>
          ))}
        </div>
        <p className="field-help">
          On other days, you can deliberately make room for practice. An
          unfinished session stays available.
        </p>
      </fieldset>
      <div className={styles.row}>
        <label>
          How to choose activities
          <select
            value={mode}
            disabled={busy || storagePending}
            onChange={(event) =>
              change({ mode: event.target.value as typeof mode })
            }
          >
            <option value="mixed">Mix in due revision</option>
            <option value="track">Make room for my track</option>
          </select>
          <span className="field-help">
            Coding reattempts and written recall keep separate dates. The full
            backlog remains available. An unfinished session and the first due
            revision keep priority; track work can come next when time allows.
          </span>
        </label>
        <label>
          Target date <span className="optional">optional</span>
          <input
            type="date"
            value={target}
            disabled={busy || storagePending}
            onChange={(event) => change({ target: event.target.value })}
          />
          <span className="field-help">
            Planning context, such as placement preparation. A date does not
            measure readiness or promise an outcome.
          </span>
        </label>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {discard && (
        <p role="status" className={styles.discard}>
          Your edits are still here.{" "}
          <button type="button" className="text-link" onClick={reset}>
            Discard preference edits
          </button>
          <button
            type="button"
            className="text-link"
            onClick={() => setDiscard(false)}
          >
            Keep editing
          </button>
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="submit"
          className={`button ${compact ? "secondary" : "primary"}`}
          disabled={busy || storagePending}
        >
          {busy
            ? "Saving…"
            : storageError
              ? "Retry saving practice preferences"
              : "Save practice preferences"}
          <Check size={16} />
        </button>
        {dirty && (
          <button
            type="button"
            className="text-link muted"
            disabled={busy || storagePending}
            onClick={() => setDiscard(true)}
          >
            Reset edits
          </button>
        )}
      </div>
    </form>
  );
  return compact ? (
    <details className={styles.compact}>
      <summary>Practice preferences</summary>
      {form}
    </details>
  ) : (
    <section className="settings-section">
      <div className="settings-section-heading">
        <span className="mono">02</span>
        <div>
          <h2>My Practice Plan</h2>
          <p>A little structure, with room for your day.</p>
        </div>
      </div>
      <div className="settings-fields">{form}</div>
    </section>
  );
}
