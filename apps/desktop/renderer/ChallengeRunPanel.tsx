import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Code2, RotateCcw } from "lucide-react";
import { readChallengeRunReceipt, type ChallengeRunReceipt } from "../../../packages/tutor/challenge-run";
import type { TutorTurn } from "../../../packages/tutor/types";
import type { FormaBridge } from "./api";
import "./challenge-run-panel.css";

const labels: Record<ChallengeRunReceipt["outcome"], string> = {
  match: "Output matched",
  mismatch: "Output differed",
  "compile-error": "Compilation failed",
  "runtime-error": "Program stopped with an error",
  timeout: "Time limit reached",
  "output-limit": "Output limit reached",
};
const expectation = (source: ChallengeRunReceipt["expectedSource"]) => source === "statement-sample" ? "Captured statement sample" : "Your expected answer";

function evidenceText(run: ChallengeRunReceipt) {
  return [
    `Run in VS Code · ${run.fileName} · ${run.ranAt}`,
    `Source SHA-256 ${run.sourceHash}`,
    `Input\n${run.input}`,
    `Expected output (${expectation(run.expectedSource)})\n${run.expectedOutput}`,
    `Actual output\n${run.output}`,
  ].join("\n\n");
}

function RunResult({ run, saved, saving, disabled, onSave }: {
  run: ChallengeRunReceipt;
  saved: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: (run: ChallengeRunReceipt) => Promise<void>;
}) {
  const compared = run.outcome === "match" || run.outcome === "mismatch";
  return <div className="challenge-run-result">
    <p className="challenge-run-outcome"><strong>{labels[run.outcome]}</strong> <span>{expectation(run.expectedSource)}</span></p>
    {compared && <div className="challenge-run-outputs">
      <div><span>Expected output</span><pre tabIndex={0}>{run.expectedOutput || "(empty)"}</pre></div>
      <div><span>Actual output</span><pre tabIndex={0}>{run.output || "(empty)"}</pre></div>
    </div>}
    {run.diagnostic && <details className="challenge-run-diagnostic">
      <summary>Run details</summary><pre tabIndex={0}>{run.diagnostic}</pre>
    </details>}
    <p className="challenge-run-provenance">
      {run.fileName} · <time dateTime={run.ranAt}>{new Date(run.ranAt).toLocaleString()}</time>
      <span title={run.sourceHash}>SHA-256 {run.sourceHash.slice(0, 12)}…</span>
    </p>
    {run.outcome === "mismatch" && <button type="button" className="desk-idea-quiet"
      disabled={disabled || saved} onClick={() => void onSave(run)}>
      {saved && <Check size={13} aria-hidden="true"/>}
      {saved ? "Failing case saved" : saving ? "Saving case…" : "Save failing case to Desk"}
    </button>}
  </div>;
}

export function ChallengeRunPanel({ bridge, turn, blocked, savedEvidence, onSave }: {
  bridge: FormaBridge;
  turn: TutorTurn;
  blocked: boolean;
  savedEvidence: ReadonlySet<string>;
  onSave: (text: string) => Promise<boolean>;
}) {
  const { id: turnId, requestId } = turn;
  const [runs, setRuns] = useState(turn.challengeRuns ?? []);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const saveLock = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async (showStatus = true) => {
    const sequence = ++generation.current;
    if (showStatus) { setChecking(true); setError(""); }
    try {
      const rows = await bridge.ui("desk-challenge-runs", { turnId, requestId });
      if (!Array.isArray(rows)) throw new Error("The local run history is unavailable.");
      if (sequence === generation.current) { setRuns(rows.map(readChallengeRunReceipt)); setError(""); }
    } catch (reason) {
      if (sequence === generation.current && showStatus) setError(reason instanceof Error ? reason.message : "The local run history is unavailable.");
    } finally {
      if (sequence === generation.current) setChecking(false);
    }
  }, [bridge, turnId, requestId]);

  useEffect(() => {
    const invalidate = () => { generation.current++; };
    const unsubscribe = bridge.subscribeTutor?.(event => {
      if (event.kind === "updated" && event.turnId === turnId && event.requestId === requestId) void refresh(false);
    });
    void refresh(false);
    return () => { invalidate(); unsubscribe?.(); };
  }, [bridge, turnId, requestId, refresh]);

  async function save(run: ChallengeRunReceipt) {
    const text = evidenceText(run);
    if (blocked || saveLock.current || savedEvidence.has(text)) return;
    saveLock.current = true;
    setSaving(run.id);
    try {
      await onSave(text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The failing case could not be saved.");
    } finally {
      saveLock.current = false;
      setSaving(null);
    }
  }

  const [latest, ...history] = [...runs].reverse();
  return <section className="challenge-run-panel" aria-label="Verify in VS Code">
    <div className="challenge-run-heading"><Code2 size={15} aria-hidden="true"/><h4>Verify in VS Code</h4></div>
    <p>With your saved C++ solution open, choose <strong>Forma: Run Challenge Case</strong> in VS Code. After editing, run the same case again.</p>
    {latest && <RunResult run={latest} saved={savedEvidence.has(evidenceText(latest))}
      saving={saving === latest.id} disabled={blocked || !!saving} onSave={save} />}
    {history.length > 0 && <details className="challenge-run-history">
      <summary>Earlier runs ({history.length})</summary>
      {history.map(run => <RunResult key={run.id} run={run} saved={savedEvidence.has(evidenceText(run))}
        saving={saving === run.id} disabled={blocked || !!saving} onSave={save} />)}
    </details>}
    {error && <p className="desk-idea-error" role="alert">{error}</p>}
    <button type="button" className="desk-idea-quiet" onClick={() => void refresh()} disabled={checking}>
      <RotateCcw size={12} aria-hidden="true"/> {checking ? "Checking…" : "Check for runs"}
    </button>
  </section>;
}
