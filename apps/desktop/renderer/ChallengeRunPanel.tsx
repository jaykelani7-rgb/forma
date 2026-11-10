import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Code2, RotateCcw } from "lucide-react";
import {
  FIRST_CHALLENGE_CASE_ID, readChallengeCaseState,
  type ChallengeCaseState, type ChallengeFeedbackLabel, type ChallengeRunReceipt,
} from "../../../packages/tutor/challenge-run";
import type { IdeaChallenge, TutorTurn } from "../../../packages/tutor/types";
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
const expectations: Record<ChallengeRunReceipt["expectedSource"], string> = {
  "statement-sample": "Captured statement sample",
  user: "Your expected answer",
  reference: "Local reference solution",
};

const feedbackOptions = {
  helpful: "Helped me find the bug",
  "wrong-assumption": "Missed my assumption",
  "invalid-input": "Invalid input",
} satisfies Record<ChallengeFeedbackLabel, string>;

function evidenceText(run: ChallengeRunReceipt) {
  if (run.reference) {
    return [
      `Compared in VS Code · ${run.ranAt}`,
      `Solution ${run.fileName}\nSource SHA-256 ${run.sourceHash}`,
      `Reference ${run.reference.fileName}\nSource SHA-256 ${run.reference.sourceHash}`,
      `Input\n${run.input}`,
      `Reference output\n${run.expectedOutput}`,
      `Solution output\n${run.output}`,
    ].join("\n\n");
  }
  return [
    `Run in VS Code · ${run.fileName} · ${run.ranAt}`,
    `Source SHA-256 ${run.sourceHash}`,
    `Input\n${run.input}`,
    `Expected output (${expectations[run.expectedSource]})\n${run.expectedOutput}`,
    `Actual output\n${run.output}`,
  ].join("\n\n");
}

function ReferenceOutput({ label, fileName, sourceHash, output }: {
  label: string;
  fileName: string;
  sourceHash: string;
  output?: string;
}) {
  return <div className="challenge-reference-output" role="group" aria-label={label}>
    <strong aria-hidden="true">{label}</strong>
    {output !== undefined && <pre tabIndex={0}>{output || "(empty)"}</pre>}
    <span>{fileName}</span>
    <span title={sourceHash}>SHA-256 {sourceHash.slice(0, 12)}…</span>
  </div>;
}

function RunResult({ run, saved, saving, disabled, onSave }: {
  run: ChallengeRunReceipt;
  saved: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: (run: ChallengeRunReceipt) => Promise<void>;
}) {
  const compared = run.outcome === "match" || run.outcome === "mismatch";
  const { reference } = run;
  const outcome = reference && compared
    ? run.outcome === "match" ? "Output matched reference" : "Output differed from reference"
    : labels[run.outcome];
  const saveLabel = reference ? "Save difference to Desk" : "Save failing case to Desk";
  const savedLabel = reference ? "Difference saved" : "Failing case saved";
  return <div className="challenge-run-result">
    <p className="challenge-run-outcome"><strong>{outcome}</strong> <span>{expectations[run.expectedSource]}</span></p>
    {reference ? <div className="challenge-run-outputs">
      <ReferenceOutput label={compared ? "Reference output" : "Reference source"}
        {...reference} output={compared ? run.expectedOutput : undefined} />
      <ReferenceOutput label={compared ? "Solution output" : "Solution source"}
        fileName={run.fileName} sourceHash={run.sourceHash} output={compared ? run.output : undefined} />
    </div> : compared && <div className="challenge-run-outputs">
      <div><span>Expected output</span><pre tabIndex={0}>{run.expectedOutput || "(empty)"}</pre></div>
      <div><span>Actual output</span><pre tabIndex={0}>{run.output || "(empty)"}</pre></div>
    </div>}
    {run.diagnostic && <details className="challenge-run-diagnostic">
      <summary>Run details</summary><pre tabIndex={0}>{run.diagnostic}</pre>
    </details>}
    <p className="challenge-run-provenance">
      {!reference && `${run.fileName} · `}<time dateTime={run.ranAt}>{new Date(run.ranAt).toLocaleString()}</time>
      {!reference && <span title={run.sourceHash}>SHA-256 {run.sourceHash.slice(0, 12)}…</span>}
    </p>
    {run.outcome === "mismatch" && <button type="button" className="desk-idea-quiet"
      disabled={disabled || saved} onClick={() => void onSave(run)}>
      {saved && <Check size={13} aria-hidden="true"/>}
      {saved ? savedLabel : saving ? "Saving case…" : saveLabel}
    </button>}
  </div>;
}

export function ChallengeRunPanel({ bridge, turn, challenge, blocked, savedEvidence, onSave }: {
  bridge: FormaBridge;
  turn: TutorTurn;
  challenge: IdeaChallenge;
  blocked: boolean;
  savedEvidence: ReadonlySet<string>;
  onSave: (text: string) => Promise<boolean>;
}) {
  const { id: turnId, requestId } = turn;
  const [state, setState] = useState<ChallengeCaseState>(() => ({
    caseId: turn.challengeCaseId ?? challenge.cases[0]?.id ?? null,
    runs: turn.challengeRuns ?? [],
    feedback: turn.challengeFeedback ?? [],
  }));
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const saveLock = useRef(false);
  const updateLock = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async (showStatus = true) => {
    if (updateLock.current) return;
    const sequence = ++generation.current;
    if (showStatus) { setChecking(true); setError(""); }
    try {
      const latest = readChallengeCaseState(await bridge.ui("desk-challenge-state", { turnId, requestId }));
      if (sequence === generation.current) setState(latest);
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

  async function update(change: { caseId: string; label?: ChallengeFeedbackLabel | null }) {
    if (blocked || updateLock.current || saveLock.current) return;
    updateLock.current = true;
    const sequence = ++generation.current;
    setUpdating(true);
    setChecking(false);
    setError("");
    const action = "label" in change ? "desk-challenge-feedback" : "desk-challenge-select";
    try {
      const latest = readChallengeCaseState(await bridge.ui(action, { turnId, requestId, ...change }));
      if (sequence === generation.current) setState(latest);
    } catch (reason) {
      if (sequence === generation.current) setError(reason instanceof Error ? reason.message : "Forma could not save that change.");
    } finally {
      updateLock.current = false;
      if (sequence === generation.current) {
        setUpdating(false);
        void refresh(false);
      }
    }
  }

  async function save(run: ChallengeRunReceipt) {
    const text = evidenceText(run);
    if (blocked || saveLock.current || updateLock.current || savedEvidence.has(text)) return;
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

  const index = Math.max(0, challenge.cases.findIndex(candidate => candidate.id === state.caseId));
  const candidate = challenge.cases[index];
  if (!candidate) return null;
  const disabled = blocked || updating || !!saving;
  const label = state.feedback.find(item => item.caseId === candidate.id)?.label ?? "";
  const [latest, ...history] = state.runs
    .filter(run => (run.caseId ?? FIRST_CHALLENGE_CASE_ID) === candidate.id)
    .reverse();
  const compared = latest?.outcome === "match" || latest?.outcome === "mismatch";
  return <section className="challenge-run-panel" aria-label="Verify in VS Code">
    <div className="desk-idea-example">
      <div className="challenge-case-heading">
        <span className="eyebrow">{compared ? "SUGGESTED CASE" : "SUGGESTED CASE · UNVERIFIED"}</span>
        {challenge.cases.length > 1 && <span role="status">Case {index + 1} of {challenge.cases.length}</span>}
      </div>
      {candidate.reason !== challenge.observation && <p>{candidate.reason}</p>}
      <span>Input</span><pre tabIndex={0}>{candidate.input || "(empty)"}</pre>
      {candidate.expectedOutput !== null && <><span>Tutor’s suggested output</span><pre tabIndex={0}>{candidate.expectedOutput || "(empty)"}</pre></>}
      {challenge.cases.length > 1 && <div className="challenge-case-actions">
        {index > 0 && <button type="button" className="desk-idea-quiet" disabled={disabled}
          onClick={() => void update({ caseId: challenge.cases[index - 1].id })}>
          <ArrowLeft size={13} aria-hidden="true"/> Previous case
        </button>}
        {index + 1 < challenge.cases.length && <button type="button" className="desk-idea-quiet" disabled={disabled}
          onClick={() => void update({ caseId: challenge.cases[index + 1].id })}>
          Try another case <ArrowRight size={13} aria-hidden="true"/>
        </button>}
      </div>}
    </div>
    <div className="challenge-run-heading"><Code2 size={15} aria-hidden="true"/><h4>Verify in VS Code</h4></div>
    <p>With your saved C++ solution open, choose <strong>Forma: Run Challenge Case</strong> in VS Code to run the case shown here.</p>
    <p>Choose <strong>Forma: Run Challenge with Reference</strong> to compare with a C++ reference solution you select.</p>
    {latest && <RunResult run={latest} saved={savedEvidence.has(evidenceText(latest))}
      saving={saving === latest.id} disabled={disabled} onSave={save} />}
    {history.length > 0 && <details className="challenge-run-history" key={candidate.id}>
      <summary>Earlier runs ({history.length})</summary>
      {history.map(run => <RunResult key={run.id} run={run} saved={savedEvidence.has(evidenceText(run))}
        saving={saving === run.id} disabled={disabled} onSave={save} />)}
    </details>}
    <label className="challenge-case-feedback">
      <span>How useful was this case?</span>
      <select value={label} disabled={disabled} onChange={event => void update({
        caseId: candidate.id, label: event.target.value ? event.target.value as ChallengeFeedbackLabel : null,
      })}>
        <option value="">No feedback</option>
        {Object.entries(feedbackOptions).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
    {error && <p className="desk-idea-error" role="alert">{error}</p>}
    <button type="button" className="desk-idea-quiet" onClick={() => void refresh()} disabled={checking || updating}>
      <RotateCcw size={12} aria-hidden="true"/> {checking ? "Checking…" : "Check for runs"}
    </button>
  </section>;
}
