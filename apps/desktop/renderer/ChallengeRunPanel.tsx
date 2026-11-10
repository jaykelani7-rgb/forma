import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Code2, RotateCcw } from "lucide-react";
import {
  challengeOutputEqual, FIRST_CHALLENGE_CASE_ID, readChallengeCaseState,
  type ChallengeCaseState, type ChallengeFeedbackLabel, type ChallengeRunReceipt,
} from "../../../packages/tutor/challenge-run";
import type { IdeaChallenge, StatementSnapshot, TutorTurn } from "../../../packages/tutor/types";
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

type StatementSamples = StatementSnapshot["samples"];

function inputValidity(input: string, samples: StatementSamples) {
  return samples.some(sample => challengeOutputEqual(sample.input, input))
    ? "Captured sample input"
    : "Input validity unverified";
}

function runOutcome(run: ChallengeRunReceipt) {
  if (!run.reference) return labels[run.outcome];
  const program = run.referenceFailed ? "Reference" : "Solution";
  switch (run.outcome) {
    case "match": return "Output matched reference";
    case "mismatch": return "Output differed from reference";
    case "compile-error": return `${program} compilation failed`;
    case "runtime-error": return `${program} stopped with an error`;
    case "timeout": return `${program} reached the time limit`;
    case "output-limit": return `${program} reached the output limit`;
  }
}

function evidenceText(run: ChallengeRunReceipt, samples: StatementSamples) {
  if (run.reference) {
    return [
      `Compared in VS Code · ${run.ranAt}`,
      `Solution ${run.fileName}\nSource SHA-256 ${run.sourceHash}`,
      `Reference ${run.reference.fileName}\nSource SHA-256 ${run.reference.sourceHash}`,
      ...(run.batchId ? [inputValidity(run.input, samples)] : []),
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

function RunResult({ run, saved, saving, disabled, onSave, batchCase }: {
  run: ChallengeRunReceipt;
  saved: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: (run: ChallengeRunReceipt) => Promise<void>;
  batchCase?: { label: string; validity: string };
}) {
  const compared = run.outcome === "match" || run.outcome === "mismatch";
  const { reference } = run;
  const saveLabel = reference ? "Save difference to Desk" : "Save failing case to Desk";
  const savedLabel = reference ? "Difference saved" : "Failing case saved";
  return <div className="challenge-run-result" role={batchCase ? "group" : undefined} aria-label={batchCase?.label}>
    {batchCase && <div className="challenge-batch-input">
      <p><strong>{batchCase.label}</strong> · {batchCase.validity}</p>
      <pre tabIndex={0}>{run.input || "(empty)"}</pre>
    </div>}
    <p className="challenge-run-outcome"><strong>{runOutcome(run)}</strong> <span>{expectations[run.expectedSource]}</span></p>
    {reference ? <div className="challenge-run-outputs">
      <ReferenceOutput label={run.referenceFailed ? "Reference source" : "Reference output"}
        {...reference} output={run.referenceFailed ? undefined : run.expectedOutput} />
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

function CounterexampleBatch({ runs, samples, savedEvidence, saving, disabled, onSave }: {
  runs: ChallengeRunReceipt[];
  samples: StatementSamples;
  savedEvidence: ReadonlySet<string>;
  saving: string | null;
  disabled: boolean;
  onSave: (run: ChallengeRunReceipt) => Promise<void>;
}) {
  const differences = runs.filter(run => run.outcome === "mismatch");
  const matches = runs.filter(run => run.outcome === "match").length;
  const unavailable = runs.length - matches - differences.length;
  const shortest = differences.reduce<ChallengeRunReceipt | undefined>((best, run) =>
    !best || run.input.length < best.input.length ? run : best, undefined);
  const otherRuns = runs.filter(run => run.id !== shortest?.id);
  function result(run: ChallengeRunReceipt) {
    const caseNumber = (run.caseId ?? FIRST_CHALLENGE_CASE_ID).slice("case-".length);
    return <RunResult key={run.id} run={run} saved={savedEvidence.has(evidenceText(run, samples))}
      saving={saving === run.id} disabled={disabled} onSave={onSave}
      batchCase={{ label: `Case ${caseNumber} result`, validity: inputValidity(run.input, samples) }} />;
  }
  return <section className="challenge-batch" aria-label="Latest counterexample search">
    <h5>Latest counterexample search</h5>
    <p role="status">{runs.length} {runs.length === 1 ? "case" : "cases"} tried · {matches} matched · {differences.length} differed
      {unavailable > 0 && ` · ${unavailable} could not be compared`}</p>
    {shortest ? <section className="challenge-batch-shortest" aria-label="Shortest differing input">
      <h6>Shortest differing input</h6>
      {result(shortest)}
    </section> : <p>{matches > 0 ? "No differing output among compared cases." : "No cases could be compared."}</p>}
    {otherRuns.length > 0 && <details className="challenge-run-history">
      <summary>{shortest ? "Other case results" : "Case results"} ({otherRuns.length})</summary>
      {otherRuns.map(result)}
    </details>}
  </section>;
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
  const samples = turn.context.statement?.samples ?? [];
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
    const text = evidenceText(run, samples);
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
  const latestBatchId = state.runs.findLast(run => run.batchId)?.batchId;
  const latestBatch = latestBatchId ? state.runs.filter(run => run.batchId === latestBatchId) : [];
  const caseRuns = state.runs.filter(run => (run.caseId ?? FIRST_CHALLENGE_CASE_ID) === candidate.id);
  const [latest, ...history] = caseRuns
    .filter(run => !latestBatchId || run.batchId !== latestBatchId)
    .reverse();
  const compared = caseRuns.some(run => run.outcome === "match" || run.outcome === "mismatch");
  return <section className="challenge-run-panel" aria-label="Verify in VS Code">
    <div className="desk-idea-example">
      <div className="challenge-case-heading">
        <span className="eyebrow">{compared ? "SUGGESTED CASE" : "SUGGESTED CASE · OUTPUT UNVERIFIED"}</span>
        {challenge.cases.length > 1 && <span role="status">Case {index + 1} of {challenge.cases.length}</span>}
      </div>
      {candidate.reason !== challenge.observation && <p>{candidate.reason}</p>}
      <span>Input · {inputValidity(candidate.input, samples)}</span><pre tabIndex={0}>{candidate.input || "(empty)"}</pre>
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
    <p>Choose <strong>Forma: Find a Counterexample</strong> to compare up to three suggested inputs with a reference solution you select.</p>
    {latestBatchId && <CounterexampleBatch key={latestBatchId} runs={latestBatch} samples={samples}
      savedEvidence={savedEvidence} saving={saving} disabled={disabled} onSave={save} />}
    {latest && <RunResult run={latest} saved={savedEvidence.has(evidenceText(latest, samples))}
      saving={saving === latest.id} disabled={disabled} onSave={save} />}
    {history.length > 0 && <details className="challenge-run-history" key={candidate.id}>
      <summary>Earlier runs ({history.length})</summary>
      {history.map(run => <RunResult key={run.id} run={run} saved={savedEvidence.has(evidenceText(run, samples))}
        saving={saving === run.id} disabled={disabled} onSave={save} />)}
    </details>}
    <label className="challenge-case-feedback">
      <span>{challenge.cases.length > 1 ? `How useful was case ${index + 1}?` : "How useful was this case?"}</span>
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
