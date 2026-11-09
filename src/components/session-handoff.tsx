"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, Laptop, RefreshCw } from "lucide-react";
import { getBrowserAuth } from "@/lib/cloud-client";
import { encodeBackup } from "@/lib/concurrency";
import type { SyncCheckpoint } from "@/lib/cloud-sync";
import { activeContest } from "@/lib/contest-lab";
import { clockTime } from "@/lib/model";
import { loadWorkspace, syncMetadata } from "@/lib/storage";
import {
  isHandoffDigest,
  isHandoffId,
  isHandoffKey,
  parseSessionHandoffPacket,
  type HandoffRemote,
} from "@/lib/session-handoff";
import { RibbonMark } from "../../packages/ribbon/RibbonMark";
import { useWorkspace } from "./provider";
import styles from "./session-handoff.module.css";

const ticketStorage = "forma.handoff.receiver.v1";
const states = ["missing", "linked", "ready", "received", "cancelled"] as const;

type Ticket = { id: string; claimKey: string; sourceDigest: string };
type Action = "link" | "destination-status" | "receive";

function readTicket(value: unknown): Ticket | null {
  if (!value || typeof value !== "object") return null;
  const { id, claimKey, sourceDigest } = value as Record<string, unknown>;
  if (!isHandoffId(id) || !isHandoffKey(claimKey) || !isHandoffDigest(sourceDigest)) return null;
  return { id, claimKey, sourceDigest };
}

function readTabTicket(): Ticket | null {
  const hash = window.location.hash;
  if (hash) {
    const params = new URLSearchParams(hash.slice(1));
    const ticket = [...params.keys()].length === 3
      ? readTicket({
          id: params.get("id"),
          claimKey: params.get("key"),
          sourceDigest: params.get("source"),
        })
      : null;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    try {
      if (ticket) sessionStorage.setItem(ticketStorage, JSON.stringify(ticket));
      else sessionStorage.removeItem(ticketStorage);
    } catch {
      // The current page can still use the ticket when tab storage is disabled.
    }
    return ticket;
  }
  try {
    return readTicket(JSON.parse(sessionStorage.getItem(ticketStorage) ?? "null"));
  } catch {
    return null;
  }
}

function forgetTicket(id: string) {
  try {
    if (readTicket(JSON.parse(sessionStorage.getItem(ticketStorage) ?? "null"))?.id === id)
      sessionStorage.removeItem(ticketStorage);
  } catch {
    // Receiving is durable even if browser storage is unavailable.
  }
}

function readRemote(value: unknown, accountId: string): HandoffRemote {
  if (!value || typeof value !== "object")
    throw new Error("Forma returned an unreadable handoff.");
  const remote = value as Record<string, unknown>;
  const state = states.find((candidate) => candidate === remote.state);
  if (!state || (state !== "missing" && remote.accountId !== accountId))
    throw new Error("This transfer could not be verified for your workspace.");
  if (state === "ready") {
    const packet = parseSessionHandoffPacket(remote.packet);
    if (remote.sessionId !== packet.session.id)
      throw new Error("Forma could not verify the session in this handoff. Check again.");
    return { state, packet, sessionId: packet.session.id };
  }
  if (state === "received") {
    if (typeof remote.sessionId !== "string" || !remote.sessionId.length)
      throw new Error("Forma could not verify the received session. Check again.");
    return { state, sessionId: remote.sessionId };
  }
  return { state };
}

export function SessionHandoff() {
  const { account, mode, workspaceKey } = useWorkspace();
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined);
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setTicket(readTabTicket());
  }, []);
  const accountId = mode === "personal" && account && workspaceKey === `account:${account.id}`
    ? account.id
    : null;

  return (
    <section className={styles.page} aria-labelledby="handoff-title">
      <header className={styles.intro}>
        <div className={styles.kicker}><RibbonMark size={26} /> RIBBON HANDOFF</div>
        <h1 id="handoff-title">Pick up the thread.</h1>
        <p>Move a paused Ribbon session into your Forma workspace.</p>
      </header>
      {ticket === undefined ? (
        <p className={styles.panel} role="status">Opening your transfer…</p>
      ) : ticket ? (
        <Receiver key={`${ticket.id}:${workspaceKey}:${accountId}`} ticket={ticket} accountId={accountId} />
      ) : (
        <div className={styles.panel}>
          <h2>Open a transfer from the Ribbon.</h2>
          <p>Choose Pause and continue on web on a paused desktop session.</p>
          <Link href="/" className="text-link">Back to Today <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      )}
    </section>
  );
}

function Receiver({ ticket, accountId }: { ticket: Ticket; accountId: string | null }) {
  const { account, data, savedData, cloudStatus, cloudError, storagePending, storageError, guardWorkspace, syncAccount, workspaceKey } =
    useWorkspace();
  const [remote, setRemote] = useState<HandoffRemote | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const active = useRef<{ controller: AbortController; quiet: boolean } | null>(null);
  const state = remote?.state;
  const hasSession = !!(data.session || savedData.session);
  const contest = activeContest(data) ?? activeContest(savedData);
  const canReceive = cloudStatus === "synced" && !storagePending && !storageError && !hasSession && !contest;
  const receipt = remote?.state === "received" ? remote.sessionId : undefined;
  const sessionHere = !!receipt && savedData.session?.id === receipt && data.session?.id === receipt;
  const completedHere = !!receipt && savedData.attempts.some((attempt) => attempt.id === receipt);

  async function request(action: Action, quiet = false) {
    if (!accountId || (action === "receive" && !canReceive)) return;
    const current = guardWorkspace();
    if (!current()) return;
    if (active.current) {
      if (quiet || !active.current.quiet) return;
      active.current.controller.abort();
    }
    const controller = new AbortController();
    active.current = { controller, quiet };
    if (!quiet) {
      setBusy(action);
      setError("");
    }
    try {
      const auth = await getBrowserAuth()?.auth.getSession();
      const session = auth?.data.session;
      if (!current() || controller.signal.aborted) return;
      if (!session || session.user.id !== accountId)
        throw new Error("Sign in to this Forma workspace again before continuing.");
      if (action === "receive") {
        const [local, checkpoint] = await Promise.all([
          loadWorkspace(workspaceKey),
          syncMetadata<SyncCheckpoint>(workspaceKey),
        ]);
        if (!current() || controller.signal.aborted) return;
        if (local.data.session)
          throw new Error("Finish your current browser session before receiving this transfer.");
        if (activeContest(local.data))
          throw new Error("Finish your active browser contest before receiving this transfer.");
        if (checkpoint?.pending || !checkpoint?.base.data ||
            encodeBackup(local.data) !== encodeBackup(checkpoint.base.data))
          throw new Error("Sync your latest account changes before receiving this transfer.");
      }
      const response = await fetch("/api/handoff", {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          id: ticket.id,
          claimKey: ticket.claimKey,
          ...(action === "link" ? { sourceDigest: ticket.sourceDigest } : {}),
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
      });
      const result = await response.json().catch(() => null);
      if (!current() || controller.signal.aborted) return;
      if (!response.ok)
        throw new Error(typeof result?.error === "string" ? result.error : "Forma couldn’t reach this transfer. Check again.");
      const next = readRemote(result, accountId);
      setRemote(next);
      setError("");
      if (next.state === "cancelled") forgetTicket(ticket.id);
      if (next.state === "received") await syncAccount();
    } catch (failure) {
      if (current() && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : "The handoff did not finish. Check again.");
    } finally {
      if (active.current?.controller === controller) {
        active.current = null;
        if (current()) setBusy(null);
      }
    }
  }

  const checkStatus = useEffectEvent(() => void request("destination-status", true));
  useEffect(() => {
    if (!accountId) return;
    checkStatus();
    return () => {
      const request = active.current;
      active.current = null;
      request?.controller.abort();
    };
  }, [accountId]);
  useEffect(() => {
    if (state !== "linked") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") checkStatus();
    }, 4_000);
    return () => clearInterval(timer);
  }, [state]);

  if (!accountId)
    return (
      <div className={styles.panel}>
        <h2>Sign in to your Forma account.</h2>
        <p>Open Account settings, sign in to the workspace where you want to continue, then return to this tab’s handoff.</p>
        <Link className="button primary" href="/settings#account">Open account settings <ArrowRight size={17} aria-hidden="true" /></Link>
      </div>
    );

  const review = remote?.state === "ready" ? remote.packet : undefined;
  const accountLabel = account?.email ?? "Your Forma account";

  return (
    <div className={styles.panel} aria-busy={!!busy}>
      <div className={styles.account}><Check size={15} aria-hidden="true" /> {accountLabel}</div>
      {!state && !error && <p role="status">Checking the handoff…</p>}
      {state === "missing" && (
        <>
          <h2>Choose this workspace.</h2>
          <p>Link this workspace, then confirm the destination in the Ribbon. Forma will bring your paused timer, next step, and session notes here.</p>
          <button type="button" className="button primary" onClick={() => void request("link")} disabled={!!busy}>
            {busy === "link" ? "Linking workspace…" : "Link this workspace"}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </>
      )}
      {state === "linked" && (
        <>
          <h2>Confirm in the Ribbon.</h2>
          <p role="status">Your workspace is linked. Approve the destination in the desktop Ribbon to send the paused session.</p>
          <div className={styles.waiting}><Laptop size={18} aria-hidden="true" /> Waiting for the desktop</div>
        </>
      )}
      {review && (
        <>
          <div className={styles.preview}>
            <div className={styles.kicker}>{review.problem.problemCode} · PAUSED SESSION</div>
            <h2>{review.problem.title}</h2>
            <div className={styles.time}><Clock3 size={18} aria-hidden="true" /> <strong>{clockTime(review.session.elapsedMs)}</strong><span> recorded</span></div>
            {review.thread && <blockquote><span>YOUR NEXT STEP</span><p>{review.thread}</p></blockquote>}
            {review.session.notes && <details><summary>Session notes</summary><p>{review.session.notes}</p></details>}
          </div>
          {hasSession ? (
            <p role="status">Finish your current browser session before receiving this transfer. <Link className="text-link" href="/session">Open current session</Link></p>
          ) : contest ? (
            <p role="status">Finish your active browser contest before receiving this transfer. <Link className="text-link" href={`/contests/${encodeURIComponent(contest.id)}`}>Open current contest</Link></p>
          ) : !canReceive && (
            <p role="status">{cloudStatus === "syncing" ? "Syncing your workspace…" : "Sync your latest account changes before receiving this session."}</p>
          )}
          <div className={styles.actions}>
            <button type="button" className="button primary" onClick={() => void request("receive")} disabled={!!busy || !canReceive}>
              {busy === "receive" ? "Receiving session…" : "Receive session"} <ArrowRight size={17} aria-hidden="true" />
            </button>
            {(!canReceive || error) && !hasSession && !contest && (
              <button type="button" className="button secondary" onClick={() => void syncAccount()}
                disabled={!!busy || storagePending || !!storageError || cloudStatus === "syncing"}>Sync workspace</button>
            )}
          </div>
        </>
      )}
      {state === "received" && (
        <>
          <h2>The session is in your workspace.</h2>
          {sessionHere && !storagePending && !storageError ? (
            <>
              <p>Your next step and recorded time are ready. Open the session when you’re ready to resume.</p>
              <Link className="button primary" href="/session" onClick={() => forgetTicket(ticket.id)}>
                Open session <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </>
          ) : completedHere ? (
            <Link className="button primary" href="/journal" onClick={() => forgetTicket(ticket.id)}>
              Open Journal <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ) : (
            <>
              <p role="status">Sync this browser to open the received session.</p>
              <button type="button" className="button secondary" onClick={() => void syncAccount()}
                disabled={!!busy || storagePending || !!storageError || cloudStatus === "syncing"}>
                {cloudStatus === "syncing" ? "Syncing workspace…" : "Sync workspace"}
              </button>
            </>
          )}
        </>
      )}
      {state === "cancelled" && (
        <>
          <h2>This handoff has closed.</h2>
          <p>Return to the Ribbon to continue your practice there or start a new transfer.</p>
        </>
      )}
      {cloudError && (review || (state === "received" && !sessionHere && !completedHere)) && (
        <p className={styles.error} role="alert">{cloudError}</p>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {state !== "cancelled" && state !== "received" && (
        <button type="button" className={`text-link ${styles.refresh}`} disabled={!!busy} onClick={() => void request("destination-status")}>
          <RefreshCw size={15} aria-hidden="true" /> Check transfer
        </button>
      )}
    </div>
  );
}
