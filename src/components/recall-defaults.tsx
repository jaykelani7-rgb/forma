"use client";
import { useRef, useState } from "react";
import {
  DEFAULT_RECALL_DAYS,
  RECALL_OUTCOMES,
  validateRecallDays,
} from "@/lib/memory-types";
import { useWorkspace } from "./provider";

export function RecallDefaults() {
  const { data, update, retryLocalSave, storageError, guardWorkspace, notify } =
    useWorkspace();
  const [values, setValues] = useState(
    data.settings.recallDays ?? DEFAULT_RECALL_DAYS,
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    const isCurrent = guardWorkspace();
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const days = validateRecallDays(values);
      const change = (current: typeof data) => ({
        ...current,
        settings: { ...current.settings, recallDays: days },
      });
      const saved = await (storageError
        ? retryLocalSave(change)
        : update(change));
      if (!isCurrent()) return;
      if (saved)
        notify(
          "Recall defaults saved. Existing dates keep your previous choices.",
        );
      else
        setError(
          "These defaults were not committed. Your choices remain here; review the storage message and retry.",
        );
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Recall defaults could not be saved.",
        );
    } finally {
      saving.current = false;
      if (isCurrent()) setPending(false);
    }
  }
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <span className="mono">05</span>
        <div>
          <h2>Written recall</h2>
          <p>A gentle next step after a revision check.</p>
        </div>
      </div>
      <form className="settings-fields" onSubmit={save}>
        <p className="small muted">
          New written checks suggest 7 days after independent recall, 3 after a
          cue, and 1 when you cannot recall yet. Choose 1–90 days for each. You
          can override the date or choose no further recall when saving. The
          latest written check sets the next recall date; coding reattempts keep
          their separate date in the same Revisit list.
        </p>
        <div className="form-row">
          {(
            Object.keys(RECALL_OUTCOMES) as (keyof typeof RECALL_OUTCOMES)[]
          ).map((key) => (
            <label key={key}>
              {RECALL_OUTCOMES[key]}
              <span className="field-help">Days until next written recall</span>
              <input
                type="number"
                min={1}
                max={90}
                step={1}
                required
                disabled={pending}
                value={Number.isNaN(values[key]) ? "" : values[key]}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [key]: e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button type="submit" className="button primary" disabled={pending}>
          {pending
            ? "Saving…"
            : storageError
              ? "Retry saving recall defaults"
              : "Save recall defaults"}
        </button>
      </form>
    </section>
  );
}
