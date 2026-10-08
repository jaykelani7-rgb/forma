"use client";
import { useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  Copy,
  Laptop,
  Moon,
  Sun,
} from "lucide-react";
import { BRAND, Data, Duration, Focus, Theme, matchesFocus } from "@/lib/model";
import { useWorkspace } from "./provider";
import { CodeforcesConnection, RevisitDefaults } from "./codeforces";
import { AccountSettings } from "./account";
import { Modal, PageHeader } from "./ui";
import {
  CAPACITY_LABEL,
  MAX_BACKUP_BYTES,
  encodeBackup,
  decodeBackup,
} from "@/lib/concurrency";
import { recoveriesFor, Recovery } from "@/lib/storage";
import { DailyAccessSettings } from "./install";
import { RecallDefaults } from "./recall-defaults";

export function Settings() {
  const {
    data,
    mode,
    theme,
    setTheme,
    update,
    retryLocalSave,
    notify,
    replaceData,
    setMode,
    storageError,
    storagePending,
    workspaceKey,
    guardWorkspace,
  } = useWorkspace();
  const [name, setName] = useState(data.settings.displayName);
  const [goal, setGoal] = useState(String(data.settings.weeklyGoal));
  const [duration, setDuration] = useState<Duration>(
    data.settings.defaultDuration,
  );
  const [focus, setFocus] = useState<Focus>(data.settings.focus);
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [pending, setPending] = useState<{
    data: Data;
    theme: Theme | null;
    filename: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [backup, setBackup] = useState<{
    json: string;
    filename: string;
  } | null>(null);
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const restoring = useRef(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  const [textError, setTextError] = useState("");
  const textLock = useRef(false);
  async function chooseTextSize(textSize: "comfortable" | "large") {
    if (textLock.current) return;
    const isCurrent = guardWorkspace();
    textLock.current = true;
    setTextBusy(true);
    const saved = await update((d) => ({
      ...d,
      settings: { ...d.settings, textSize },
    }));
    textLock.current = false;
    if (!isCurrent()) return;
    setTextBusy(false);
    setTextError(
      saved
        ? ""
        : "Text size changed in this tab. Retry saving below to keep it after reopening.",
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    const weeklyGoal = Number(goal);
    if (!Number.isInteger(weeklyGoal) || weeklyGoal < 1 || weeklyGoal > 14) {
      setError("Choose a weekly goal between 1 and 14 sessions.");
      return;
    }
    const isCurrent = guardWorkspace();
    saving.current = true;
    const saved = await update((d) => ({
      ...d,
      settings: {
        ...d.settings,
        displayName: name.trim(),
        weeklyGoal,
        defaultDuration: duration,
        focus,
      },
    }));
    saving.current = false;
    if (!isCurrent()) return;
    setError(
      saved
        ? ""
        : "Preferences could not be saved. Your entries remain here; review saving and recovery copies below, then retry.",
    );
    if (saved)
      notify("Your preferences are saved. Make this practice your own.");
  }
  function exportData() {
    try {
      const json = encodeBackup(data, {
        theme,
        exportedAt: new Date().toISOString(),
      });
      setBackup({
        json,
        filename: `${BRAND.toLowerCase()}-${mode}-${new Date().toISOString().slice(0, 10)}.json`,
      });
    } catch (e) {
      setImportError(
        e instanceof Error ? e.message : "Backup could not be produced.",
      );
    }
  }
  function downloadBackup() {
    if (!backup) return;
    const url = URL.createObjectURL(
      new Blob([backup.json], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = backup.filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function copyBackup() {
    if (!backup) return;
    const isCurrent = guardWorkspace();
    try {
      await navigator.clipboard.writeText(backup.json);
      if (!isCurrent()) return;
      notify("Backup JSON copied. Save it in a .json file to restore later.");
    } catch {
      if (!isCurrent()) return;
      notify(
        "This browser couldn’t copy automatically. Select the JSON below and copy it into a .json file.",
      );
    }
  }
  async function readFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const isCurrent = guardWorkspace();
    setImportError("");
    setImporting(true);
    try {
      if (file.size > MAX_BACKUP_BYTES)
        throw new Error(
          `Choose a JSON backup no larger than ${CAPACITY_LABEL}.`,
        );
      const raw = await file.text();
      const input = JSON.parse(raw);
      const incoming = decodeBackup(raw);
      if (!isCurrent()) return;
      setPending({
        data: incoming,
        theme: ["light", "dark", "system"].includes(input.theme)
          ? input.theme
          : null,
        filename: file.name,
      });
    } catch (error) {
      if (!isCurrent()) return;
      setImportError(
        error instanceof SyntaxError
          ? "This file isn’t valid JSON. Choose a Forma backup and try again."
          : error instanceof Error
            ? error.message
            : "The file could not be read.",
      );
    } finally {
      if (isCurrent()) setImporting(false);
    }
  }
  async function confirmImport() {
    if (!pending || restoring.current) return;
    restoring.current = true;
    setRestoreBusy(true);
    // Replacement invalidates earlier operations synchronously, so capture its
    // own generation after starting it.
    const completion = replaceData(pending.data);
    const isCurrent = guardWorkspace();
    const saved = await completion;
    restoring.current = false;
    if (!isCurrent()) return;
    setRestoreBusy(false);
    if (!saved) {
      setImportError(
        "Restoration needs attention. Review storage errors and recovery copies.",
      );
      return;
    }
    if (pending.theme) setTheme(pending.theme);
    setName(pending.data.settings.displayName);
    setGoal(String(pending.data.settings.weeklyGoal));
    setDuration(pending.data.settings.defaultDuration);
    setFocus(pending.data.settings.focus);
    setPending(null);
  }
  const focusSupported =
    focus === "mixed" || data.problems.some((p) => matchesFocus(p, focus));
  return (
    <div className="page-enter settings-page">
      <PageHeader
        eyebrow="MAKE YOURSELF AT HOME"
        title="A practice that fits you."
        description="A few preferences. A little room to make this space your own."
      />
      <form onSubmit={save}>
        <section className="settings-section">
          <div className="settings-section-heading">
            <span className="mono">01</span>
            <div>
              <h2>Your practice</h2>
              <p>The way you want to show up.</p>
            </div>
          </div>
          <div className="settings-fields">
            <label>
              What should we call you?
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="Your first name"
                autoComplete="given-name"
              />
            </label>
            <div className="form-row">
              <label>
                Weekly session goal
                <input
                  type="number"
                  min={1}
                  max={14}
                  step={1}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  required
                />
                <span className="field-help">
                  A flexible intention, never a streak to protect.
                </span>
              </label>
              <label>
                Default session duration
                <select
                  value={duration}
                  onChange={(e) =>
                    setDuration(Number(e.target.value) as Duration)
                  }
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
                <span className="field-help">
                  You can change this before any session.
                </span>
              </label>
            </div>
            <fieldset className="focus-preference">
              <legend>Your focus</legend>
              <div className="preference-options">
                {(
                  [
                    {
                      value: "cp",
                      label: "Competitive programming",
                      note: "Patterns, contests, and problem solving.",
                    },
                    {
                      value: "placement",
                      label: "Placement preparation",
                      note: "DSA and interview foundations.",
                    },
                    {
                      value: "mixed",
                      label: "A little of both",
                      note: "Room for your whole collection.",
                    },
                  ] as { value: Focus; label: string; note: string }[]
                ).map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    aria-pressed={focus === option.value}
                    className={focus === option.value ? "selected" : ""}
                    onClick={() => setFocus(option.value)}
                  >
                    <span>
                      {option.label}
                      {focus === option.value && <Check size={15} />}
                    </span>
                    <small>{option.note}</small>
                  </button>
                ))}
              </div>
              <p className="field-help">
                Today prioritizes revisits and new problems whose topics support
                this focus. Shared DSA topics can support both.
              </p>
              {!focusSupported && (
                <p className="focus-fallback">
                  Your collection doesn’t have matching topics yet. Suggestions
                  will use your full collection until you add some.
                </p>
              )}
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="settings-save">
              <button
                className="button primary"
                type="submit"
                disabled={storagePending}
              >
                {storagePending ? "Saving…" : "Save preferences"}
                <Check size={16} />
              </button>
            </div>
          </div>
        </section>
      </form>
      <section className="settings-section">
        <div className="settings-section-heading">
          <span className="mono">02</span>
          <div>
            <h2>The room around you</h2>
            <p>Choose an appearance that feels comfortable.</p>
          </div>
        </div>
        <div className="settings-fields">
          <div className="theme-options" role="group" aria-label="Appearance">
            {(
              [
                { value: "light", label: "Warm paper", icon: Sun },
                { value: "dark", label: "Ink", icon: Moon },
                { value: "system", label: "Follow device", icon: Laptop },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                className={`theme-option ${value} ${theme === value ? "selected" : ""}`}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                <span className="theme-preview">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="theme-option-label">
                  <Icon size={16} />
                  {label}
                  {theme === value && <Check size={15} />}
                </span>
              </button>
            ))}
          </div>
          <fieldset className="text-size-options">
            <legend>Text size</legend>
            <div className="segmented">
              {(["comfortable", "large"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={textBusy || storagePending}
                  aria-pressed={
                    (data.settings.textSize ?? "comfortable") === value
                  }
                  className={
                    (data.settings.textSize ?? "comfortable") === value
                      ? "selected"
                      : ""
                  }
                  onClick={() => void chooseTextSize(value)}
                >
                  {value === "comfortable" ? "Comfortable" : "Large"}
                </button>
              ))}
            </div>
            <p className="field-help">
              A saved preference across the app. Browser zoom works alongside
              it.
            </p>
            {textError && (
              <p className="form-error" role="alert">
                {textError}
              </p>
            )}
          </fieldset>
        </div>
      </section>
      <CodeforcesConnection />
      <RevisitDefaults key={JSON.stringify(data.settings.reviewDays)} />
      <RecallDefaults key={JSON.stringify(data.settings.recallDays)} />
      <section className="settings-section">
        <div className="settings-section-heading">
          <span className="mono">05</span>
          <div>
            <h2>Your notebook, with you</h2>
            <p>A backup for the practice you’ve put in.</p>
          </div>
        </div>
        <div className="settings-fields">
          <p className="muted small">
            Your {mode === "demo" ? "demo" : "personal"} data lives in this
            browser on this device. Export a JSON backup to keep it safe or move
            it to another browser. Supported workspace and backup capacity:{" "}
            {CAPACITY_LABEL}. Original legacy records remain preserved after
            migration.
          </p>
          {storageError && (
            <div className="form-error">
              <p>
                Storage needs attention. Export your current data before closing
                this tab. Retry saving when space or storage access is
                available; conflicting changes remain in recovery copies.
              </p>
              <button
                type="button"
                className="button secondary"
                disabled={storagePending}
                onClick={async () => {
                  const isCurrent = guardWorkspace();
                  const saved = await retryLocalSave();
                  if (saved && isCurrent()) {
                    setTextError("");
                    notify("Your unsaved changes are now saved.");
                  }
                }}
              >
                Retry saving
              </button>
            </div>
          )}
          <div className="backup-actions">
            <button className="button secondary" onClick={exportData}>
              <ArrowDownToLine size={17} />
              Export {mode === "demo" ? "demo" : "my"} data
            </button>
            <button
              className="button secondary"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              <ArrowUpFromLine size={17} />
              {importing ? "Checking file…" : "Import a backup"}
            </button>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              accept=".json,application/json"
              onChange={readFile}
              aria-label="Import JSON backup"
            />
          </div>
          {importError && (
            <p className="form-error" role="alert">
              {importError}
            </p>
          )}
          <p className="tiny muted">
            Imports are checked before you confirm. Existing records are
            replaced only with your approval.{" "}
            {storagePending ? "Saving changes…" : "Local writes complete."}
          </p>
          <button
            className="text-link"
            onClick={async () => {
              const isCurrent = guardWorkspace();
              try {
                const copies = await recoveriesFor(workspaceKey);
                if (isCurrent()) setRecoveries(copies);
              } catch {
                if (isCurrent())
                  setImportError(
                    "Recovery copies could not be read. Export the visible workspace before closing this tab.",
                  );
              }
            }}
          >
            Review recovery copies
          </button>
          {recoveries.map((copy) => (
            <div key={copy.id} className="schedule-preview">
              <p className="small">
                {new Date(copy.createdAt).toLocaleString()} · {copy.reason}
              </p>
              <button
                className="text-link"
                onClick={() =>
                  setBackup({
                    json: encodeBackup(copy.data),
                    filename: `forma-recovery-${copy.id}.json`,
                  })
                }
              >
                Export recovery copy
              </button>
            </div>
          ))}
        </div>
      </section>
      <AccountSettings />
      <DailyAccessSettings />
      <div className="settings-demo-note">
        <div>
          <h3>
            {mode === "demo"
              ? "You’re in a sample workspace."
              : "Curious what a growing practice looks like?"}
          </h3>
          <p>
            {mode === "demo"
              ? "Your own problems and reflections are in a separate workspace."
              : "Explore a demo with sample problems and reflections. Your records stay separate."}
          </p>
        </div>
        <button
          className="text-link"
          onClick={() => setMode(mode === "demo" ? "personal" : "demo")}
        >
          {mode === "demo" ? "Go to my workspace" : "Explore the demo"}
          <ArrowRight size={16} />
        </button>
      </div>
      {pending && (
        <Modal
          title="Bring your notebook back."
          onClose={() => {
            if (!restoreBusy) setPending(null);
          }}
        >
          <div className="form-stack">
            <p className="muted">
              The file <strong>{pending.filename}</strong> is valid and contains{" "}
              <strong>{pending.data.problems.length} problems</strong> and{" "}
              <strong>{pending.data.attempts.length} timed attempts</strong>,
              plus {pending.data.codeforces.submissions.length} platform
              submissions and {pending.data.codeforces.reflections.length} quick
              reflections
              {pending.data.session ? ", including an active session" : ""}.
            </p>
            <div className="import-warning">
              <h3>
                This replaces your {mode === "demo" ? "demo" : "personal"}{" "}
                workspace.
              </h3>
              <p>
                Your current {data.problems.length} problems and{" "}
                {data.attempts.length} attempts
                {data.session ? ", including your active session," : ""} will be
                replaced. Export a backup first if you want to keep them.
              </p>
            </div>
            <div className="form-actions">
              <button
                className="button secondary"
                disabled={restoreBusy}
                onClick={() => setPending(null)}
              >
                Keep current data
              </button>
              <button
                className="button primary"
                disabled={restoreBusy}
                onClick={confirmImport}
              >
                {restoreBusy ? "Restoring…" : "Replace and restore"}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {backup && (
        <Modal
          title="Keep your practice with you."
          onClose={() => setBackup(null)}
        >
          <div className="form-stack">
            <p className="muted">
              Your backup includes {data.problems.length} problems,{" "}
              {data.attempts.length} attempts, your preferences, your Codeforces
              history and reflections, and any active session.
            </p>
            <p className="small muted">
              Download the JSON file. If your browser doesn’t support downloads,
              copy the JSON below into a file ending in <strong>.json</strong>.
            </p>
            <details className="export-preview">
              <summary>View backup JSON</summary>
              <label className="sr-only" htmlFor="export-json">
                Backup JSON
              </label>
              <textarea
                id="export-json"
                value={backup.json}
                readOnly
                rows={8}
                className="mono"
                spellCheck={false}
              />
            </details>
            <div className="backup-actions">
              <button className="button secondary" onClick={copyBackup}>
                <Copy size={16} />
                Copy JSON
              </button>
              <button className="button primary" onClick={downloadBackup}>
                <ArrowDownToLine size={16} />
                Download JSON
              </button>
            </div>
            <button className="text-link" onClick={() => setBackup(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
