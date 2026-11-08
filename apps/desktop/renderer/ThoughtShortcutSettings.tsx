import { useState } from "react";
import { DEFAULT_THOUGHT_SHORTCUT } from "../main/preferences";

export function ThoughtShortcutSettings({
  shortcut, available, busy, onSave,
}: {
  shortcut: string | null;
  available: boolean;
  busy: boolean;
  onSave: (shortcut: string | null) => void;
}) {
  const [draft, setDraft] = useState(shortcut ?? "");
  return (
    <section className="settings-section" aria-label="Recording shortcut settings">
      <label className="field-label" htmlFor="thought-shortcut">Speak a thought shortcut</label>
      <form onSubmit={event => { event.preventDefault(); onSave(draft.trim()); }}>
        <div className="handle-row">
          <input id="thought-shortcut" value={draft} maxLength={100}
            placeholder={DEFAULT_THOUGHT_SHORTCUT} autoComplete="off"
            onChange={event => setDraft(event.target.value)}/>
          <button type="submit" className="small-button" disabled={busy || !draft.trim() || (available && draft.trim() === shortcut)}>
            Save shortcut
          </button>
        </div>
      </form>
      <p className="field-help">
        With a problem attached, tap the shortcut once to record and again to transcribe. Review the draft before saving.
      </p>
      <p className="field-help">
        {shortcut === null ? "Recording shortcut is off." : available
          ? `${shortcut} is ready.` : `${shortcut} is unavailable. Try another key combination.`}
      </p>
      {shortcut !== null && <button type="button" className="settings-link" disabled={busy} onClick={() => onSave(null)}>
        Turn off recording shortcut
      </button>}
    </section>
  );
}
