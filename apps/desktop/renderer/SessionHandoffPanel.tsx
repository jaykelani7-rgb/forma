import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowUpRight, Check, Clock3, Globe2, RefreshCw } from "lucide-react";
import type { DesktopHandoffView } from "../main/session-handoff-client";
import { DESK_THREAD_LIMIT } from "../../../packages/contracts/src";
import type { FormaBridge } from "./api";
import "./session-handoff.css";

const terminal = (value: DesktopHandoffView | null) => value?.state === "received" || value?.state === "cancelled";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The handoff could not be checked.";
const timeLabel = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

export function SessionHandoffPanel({
  bridge, sessionId, problemTitle, elapsedMs, savedThread, initialDraft, onDraftChange, onPrepare, onBack,
}: {
  bridge: FormaBridge;
  sessionId?: string;
  problemTitle?: string;
  elapsedMs?: number;
  savedThread: string;
  initialDraft?: string;
  onDraftChange: (thread: string) => void;
  onPrepare: (thread: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const [handoff, setHandoff] = useState<DesktopHandoffView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(initialDraft || savedThread);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (bridge.ui("handoff-local") as Promise<DesktopHandoffView | null>).then(value => {
      if (!cancelled) setHandoff(value);
    }).catch(reason => {
      if (!cancelled) setError(errorMessage(reason));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bridge]);

  async function perform(work: () => Promise<DesktopHandoffView | null | void>, quiet = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    if (!quiet) setError("");
    try {
      const next = await work();
      if (next) setHandoff(next);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const poll = useEffectEvent(() => {
    if (handoff && !document.hidden) void perform(
      () => bridge.ui("handoff-refresh", handoff.id) as Promise<DesktopHandoffView>, true,
    );
  });
  const handoffId = handoff?.id;
  const done = terminal(handoff);
  useEffect(() => {
    if (!handoffId || done || error) return;
    const timer = setInterval(() => poll(), 2800);
    return () => clearInterval(timer);
  }, [handoffId, done, error]);

  function begin() {
    if (!sessionId) return;
    void perform(async () => {
      if (!await onPrepare(draft.trim())) return;
      try {
        return await bridge.ui("handoff-begin", sessionId) as DesktopHandoffView;
      } catch (reason) {
        const pending = await bridge.ui("handoff-local").catch(() => null) as DesktopHandoffView | null;
        if (pending) setHandoff(pending);
        throw reason;
      }
    });
  }

  function act(action: "open" | "refresh" | "send" | "cancel") {
    if (!handoff) return;
    const value = action === "send" ? { id: handoff.id, accountId: handoff.accountId } : handoff.id;
    void perform(() => bridge.ui(`handoff-${action}`, value) as Promise<DesktopHandoffView | null>);
  }

  function editDraft(thread: string) {
    setDraft(thread);
    onDraftChange(thread);
  }

  const title = handoff?.title ?? problemTitle;
  const time = handoff?.elapsedMs ?? elapsedMs;
  return <section className="desktop-handoff" aria-label="Continue on web">
    <header className="intro panel-intro">
      <span className="eyebrow"><Globe2 size={13} aria-hidden="true"/> DESKTOP → WEB</span>
      <h1>Continue<br/><em>on web.</em></h1>
      <p>Carry this paused session and your next step into your Forma account.</p>
    </header>
    {title && <div className="desktop-handoff-summary">
      <strong>{title}</strong>
      {time !== undefined && <span><Clock3 size={13} aria-hidden="true"/>{timeLabel(time)} paused</span>}
      {handoff?.thread && <p>{handoff.thread}</p>}
    </div>}
    {loading ? <p className="field-help" role="status">Checking this session…</p>
      : !handoff && sessionId ? <>
        <label className="field-label" htmlFor="handoff-next-step">What would you try next? <span>optional</span></label>
        <textarea id="handoff-next-step" value={draft} rows={3} maxLength={DESK_THREAD_LIMIT}
          onChange={event => editDraft(event.target.value)} disabled={busy} placeholder="Leave a sentence for the browser."/>
        {savedThread && !draft.trim() && <p className="field-help">Enter a next step or restore the saved one.</p>}
        {savedThread && !draft.trim() && <button className="text-button" type="button" onClick={() => editDraft(savedThread)}>Use saved thread</button>}
        <button type="button" className="button" onClick={begin}
          disabled={busy || draft.length > DESK_THREAD_LIMIT || (!!savedThread && !draft.trim())}>
          Open browser to link <ArrowUpRight size={14} aria-hidden="true"/>
        </button>
      </> : !handoff ? <p className="field-help">Pause a practice session to begin.</p> : <>
        {handoff.state === "waiting" && <p role="status" className="field-help">
          {handoff.offered ? "The desktop is holding the paused session while it checks for a web receipt."
            : "In the browser, sign in and choose Link this workspace."}
        </p>}
        {handoff.state === "linked" && <div className="desktop-handoff-destination">
          <span className="eyebrow">LINKED FORMA ACCOUNT</span>
          <strong>{handoff.accountLabel || handoff.accountId}</strong>
          <p className="field-help">Confirm the account before sharing the paused timer and notes.</p>
          <button type="button" className="button" disabled={busy || !handoff.accountId} onClick={() => act("send")}>
            {handoff.offered ? "Retry sending" : "Send paused session"} <ArrowUpRight size={14} aria-hidden="true"/>
          </button>
        </div>}
        {handoff.state === "ready" && <p role="status" className="field-help">
          The session is ready for {handoff.accountLabel || "your account"}. Choose Receive session in the browser.
        </p>}
        {handoff.state === "received" && <p role="status" className="desktop-handoff-receipt">
          <Check size={15} aria-hidden="true"/> Received in your web workspace. Resume there when you’re ready.
        </p>}
        {handoff.state === "cancelled" && <p role="status" className="field-help">The handoff was cancelled. You can resume on this desktop.</p>}
        {!done && <div className="desktop-handoff-actions">
          <button type="button" className="settings-link" disabled={busy} onClick={() => act("open")}>
            <ArrowUpRight size={14} aria-hidden="true"/> Reopen browser
          </button>
          <button type="button" className="settings-link" disabled={busy} onClick={() => act("refresh")}>
            <RefreshCw size={14} aria-hidden="true"/> Check status
          </button>
          <button type="button" className="text-button" disabled={busy} onClick={() => act("cancel")}>Cancel handoff</button>
        </div>}
      </>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {done && <button type="button" className="button button--secondary" onClick={onBack}>Back to practice</button>}
  </section>;
}
