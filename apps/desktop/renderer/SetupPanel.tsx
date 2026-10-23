import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Link2, RefreshCw, Unplug } from "lucide-react";
import type { CompanionSnapshot, FormaBridge } from "./api";
import type { SetupItem, SetupStatus } from "../../../packages/setup/status";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Setup status could not be read. Reopen Fenn to try again.";

export function SetupPanel({ bridge, snapshot, pairing, disabled, onPair, onRevoke, onDismissPairing, onOpenVscode, onProvider }: {
  bridge: FormaBridge; snapshot: CompanionSnapshot; pairing: { credential: string; endpoint: string } | null; disabled: boolean;
  onPair: () => void; onRevoke: () => void; onDismissPairing: () => void; onOpenVscode: () => void; onProvider: () => void;
}) {
  const [status, setStatus] = useState<SetupStatus | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const generation = useRef(0), mounted = useRef(true);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await bridge.ui("setup-status") as SetupStatus;
      if (mounted.current && request === generation.current) { setStatus(next); setError(""); }
    } catch (reason) { if (mounted.current && request === generation.current) setError(errorMessage(reason)); }
  }, [bridge]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { void refresh(); }, [refresh, snapshot]);
  async function change(action: string, payload: unknown) {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try { await bridge.ui(action, payload); await refresh(); }
    catch (reason) { if (mounted.current) setError(errorMessage(reason)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const locked = disabled || busy;
  return <section className="settings-section setup-panel" aria-label="Setup and connection">
    <div className="settings-section-head"><span className="field-label">Setup &amp; connection</span><button type="button" className="icon-button" onClick={() => void refresh()} disabled={locked} aria-label="Refresh setup status"><RefreshCw size={13}/></button></div>
    <p className="setup-summary" role="status">{status?.summary ?? "Reading local setup…"}</p>
    <p className="field-help">Practice works locally. Chrome capture and Tutor are optional.</p>
    {status && <details className="setup-details"><summary>Connection details</summary><dl className="setup-status-list">
      <StatusRow title="Companion storage" item={status.storage}/>
      <StatusRow title="VS Code pairing" item={status.pairing}/>
      <StatusRow title="Current VS Code connection" item={status.connection}><button type="button" className="text-button" disabled={locked} onClick={onOpenVscode}>Open VS Code <ArrowUpRight size={11}/></button></StatusRow>
      <StatusRow title="Practice-folder approval" item={status.practiceFolders}/>
      <StatusRow title="Chrome integration · optional" item={status.browser}><label className="toggle-row"><span><strong>Allow Chrome capture</strong><small>Connect only the problem page you choose</small></span><input type="checkbox" checked={!!snapshot.integration.browserEnabled} disabled={locked || snapshot.integration.browserSupported === false} onChange={event => void change("enable-browser", event.target.checked)}/></label></StatusRow>
      <StatusRow title="Tutor provider · optional" item={status.provider}><button type="button" className="text-button" disabled={locked} onClick={onProvider}>Configure Tutor <ArrowUpRight size={11}/></button></StatusRow>
      <StatusRow title="Launch at login" item={status.login}><label className="toggle-row"><span><strong>Open Fenn when I sign in</strong></span><input type="checkbox" aria-label="Open Fenn when I sign in" checked={status.login.enabled} disabled={locked || !status.login.canChange} onChange={event => void change("launch-at-login", event.target.checked)}/></label></StatusRow>
    </dl></details>}
    {pairing ? <div className="pairing-box"><span className="eyebrow">SHOWN ONLY FOR THIS PAIRING</span><label className="field-label" htmlFor="pair-code">Pairing credential</label><input id="pair-code" readOnly value={pairing.credential}/><label className="field-label" htmlFor="pair-endpoint">Local endpoint</label><input id="pair-endpoint" readOnly value={pairing.endpoint}/><p>Use “Forma: Pair with Companion” in VS Code. Keep this credential secret; it grants access to your local companion.</p><button type="button" className="text-button" onClick={onDismissPairing}><Check size={12}/>I’ve copied it securely</button></div> : <button type="button" className="settings-link" onClick={onPair} disabled={locked}><Link2 size={14}/>{snapshot.integration.paired ? "Replace pairing credential" : "Pair VS Code extension"}</button>}
    {snapshot.integration.paired && <details className="setup-details"><summary>Pairing and recognition help</summary><p className="field-help">In VS Code, choose “Forma: Select Allowed Folders” to approve a folder, then “Forma: Recognise Problems from CPH” to opt in. Only supported metadata for the active solution is observed. Starting a timer stays explicit.</p><p className="field-help">Install the optional Forma Chrome extension using the setup guide, then choose “Include statement in Fenn” on a problem page. A native host on disk does not prove Chrome capture works.</p><button type="button" className="settings-link muted" onClick={onRevoke} disabled={locked}><Unplug size={14}/>Revoke pairing</button></details>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

function StatusRow({ title, item, children }: { title: string; item: SetupItem; children?: ReactNode }) {
  return <div className="setup-status-row"><dt>{title}</dt><dd><span className={`setup-badge setup-badge--${item.state.replace(/ /g, "-")}`}>{item.label}</span><p>{item.detail}</p>{children}</dd></div>;
}
