import { useState } from "react";

export interface ShortcutSettingsValue {
  shortcut: string | null;
  available: boolean;
  busy: boolean;
  onSave: (shortcut: string | null) => void;
}

export function GlobalShortcutSettings({
  shortcut, available, busy, onSave, inputId, sectionLabel, label, example, description, feature,
}: ShortcutSettingsValue & {
  inputId: string;
  sectionLabel: string;
  label: string;
  example: string;
  description: string;
  feature: string;
}) {
  const [draft, setDraft] = useState(shortcut ?? "");
  const value = draft.trim();
  const canSave = !busy && !!value && (!available || value !== shortcut);
  return (
    <section className="settings-section" aria-label={sectionLabel}>
      <label className="field-label" htmlFor={inputId}>{label}</label>
      <form onSubmit={event => { event.preventDefault(); if (canSave) onSave(value); }}>
        <div className="handle-row">
          <input id={inputId} value={draft} maxLength={100} placeholder={example} autoComplete="off"
            onChange={event => setDraft(event.target.value)}/>
          <button type="submit" className="small-button" disabled={!canSave}>Save shortcut</button>
        </div>
      </form>
      <p className="field-help">{description}</p>
      <p className="field-help">
        {shortcut === null ? `${feature} is off.` : available
          ? `${shortcut} is ready.` : `${shortcut} is unavailable. Try another key combination.`}
      </p>
      {shortcut !== null && <button type="button" className="settings-link" disabled={busy} onClick={() => onSave(null)}>
        Turn off {feature.toLowerCase()}
      </button>}
    </section>
  );
}
