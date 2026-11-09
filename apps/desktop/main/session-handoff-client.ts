import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isHandoffAccountId, isHandoffId, type HandoffRemote } from "../../../src/lib/session-handoff";
import type { PendingSessionHandoff } from "./store";

export interface DesktopHandoffView {
  id: string;
  state: "waiting" | "linked" | "ready" | "received" | "cancelled";
  title: string;
  thread: string;
  elapsedMs: number;
  offered: boolean;
  accountId?: string;
  accountLabel?: string;
}

interface HandoffPorts {
  call<T>(method: string, ...args: unknown[]): Promise<T>;
  open(url: string): Promise<void>;
  changed(): Promise<void>;
  configuredOrigin(): string;
  fetch?: typeof fetch;
}

function webOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Set FORMA_WEB_ORIGIN to the URL of your Forma website."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use an HTTPS Forma origin or a local loopback URL.");
  }
  return url.origin;
}

function view(pending: PendingSessionHandoff, remote?: HandoffRemote): DesktopHandoffView {
  return {
    id: pending.id,
    state: !remote || remote.state === "missing" ? "waiting" : remote.state,
    title: pending.packet.problem.title,
    thread: pending.packet.thread,
    elapsedMs: pending.packet.session.elapsedMs,
    offered: pending.offered,
    ...(remote?.accountId ? { accountId: remote.accountId } : {}),
    ...(remote?.accountLabel ? { accountLabel: remote.accountLabel } : {}),
  };
}

function remoteStatus(input: unknown): HandoffRemote {
  const response = input as Partial<HandoffRemote> | null;
  if (!response || !response.state || !["missing", "linked", "ready", "received", "cancelled"].includes(response.state)
    || (response.accountId !== undefined && !isHandoffAccountId(response.accountId))
    || (response.accountLabel !== undefined && (typeof response.accountLabel !== "string" || response.accountLabel.length > 320))
    || (response.sessionId !== undefined && (typeof response.sessionId !== "string" || response.sessionId.length > 100))) {
    throw new Error("The Forma website returned an unreadable handoff status.");
  }
  return { state: response.state, accountId: response.accountId, accountLabel: response.accountLabel, sessionId: response.sessionId };
}

async function responseJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The Forma website returned an empty handoff status.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) throw new Error("The Forma website returned an oversized handoff status.");
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** The source retains its durable lock until the website gives a terminal receipt. */
export class DesktopSessionHandoff {
  private busy = false;
  constructor(private readonly ports: HandoffPorts) {}

  private async run<T>(work: () => Promise<T>) {
    if (this.busy) throw new Error("The handoff is already being checked. Try again in a moment.");
    this.busy = true;
    try { return await work(); }
    finally { this.busy = false; }
  }

  private current() { return this.ports.call<PendingSessionHandoff | null>("handoff-current"); }

  async local() {
    const pending = await this.current();
    return pending ? view(pending) : null;
  }

  private async selected(id: unknown) {
    if (!isHandoffId(id)) throw new Error("Choose the current web handoff.");
    const pending = await this.current();
    if (!pending || pending.id !== id) throw new Error("This handoff is no longer open on the desktop.");
    return pending;
  }

  private async open(pending: PendingSessionHandoff) {
    const url = new URL("/handoff", webOrigin(pending.origin));
    const sourceDigest = createHash("sha256").update(pending.sourceKey).digest("hex");
    url.hash = new URLSearchParams({ id: pending.id, key: pending.claimKey, source: sourceDigest }).toString();
    await this.ports.open(url.toString());
  }

  begin(sessionId: unknown) {
    return this.run(async () => {
      if (typeof sessionId !== "string" || !sessionId || sessionId.length > 100) throw new Error("Choose the current paused session.");
      const pending = await this.ports.call<PendingSessionHandoff>("handoff-begin", {
        id: randomUUID(), sourceKey: randomBytes(32).toString("base64url"), claimKey: randomBytes(32).toString("base64url"),
        origin: webOrigin(this.ports.configuredOrigin()), sessionId,
      });
      await this.ports.changed();
      await this.open(pending);
      return view(pending);
    });
  }

  reopen(id: unknown) {
    return this.run(async () => { await this.open(await this.selected(id)); });
  }

  private async request(pending: PendingSessionHandoff, action: "source-status" | "source-send" | "source-cancel", extra?: object) {
    let response: Response;
    try {
      response = await (this.ports.fetch ?? fetch)(new URL("/api/handoff", webOrigin(pending.origin)), {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
        signal: AbortSignal.timeout(10_000), body: JSON.stringify({ action, id: pending.id, sourceKey: pending.sourceKey, ...extra }),
      });
    } catch {
      throw new Error("Couldn’t reach the Forma website. Check the connection and retry from this handoff.");
    }
    const body = await responseJson(response);
    if (!response.ok) {
      const error = (body as { error?: unknown } | null)?.error;
      throw new Error(typeof error === "string" ? error.slice(0, 320) : "The Forma website could not complete this handoff.");
    }
    return remoteStatus(body);
  }

  private async apply(pending: PendingSessionHandoff, remote: HandoffRemote) {
    if (remote.state === "received") {
      if (!pending.offered || remote.sessionId !== pending.packet.session.id || remote.accountId !== pending.accountId) {
        throw new Error("The web receipt does not match the paused desktop session. Reopen this handoff to check.");
      }
      await this.ports.call("handoff-complete", { id: pending.id, sessionId: remote.sessionId });
      await this.ports.changed();
    } else if (remote.state === "cancelled") {
      await this.ports.call("handoff-cancel", { id: pending.id, terminal: true });
      await this.ports.changed();
    }
    return view(pending, remote);
  }

  refresh(id: unknown) {
    return this.run(async () => {
      const pending = await this.selected(id);
      return this.apply(pending, await this.request(pending, "source-status"));
    });
  }

  send(input: unknown) {
    return this.run(async () => {
      const { id, accountId } = (input ?? {}) as { id?: unknown; accountId?: unknown };
      if (!isHandoffAccountId(accountId)) throw new Error("Link the destination Forma account in the browser before sending.");
      const pending = await this.selected(id);
      const remote = await this.request(pending, "source-status");
      if (remote.state === "received" || remote.state === "cancelled") return this.apply(pending, remote);
      if ((remote.state !== "linked" && remote.state !== "ready") || remote.accountId !== accountId) {
        throw new Error("The destination changed. Check the linked Forma account before sending.");
      }
      const offered = await this.ports.call<PendingSessionHandoff>("handoff-mark-sending", { id: pending.id, accountId });
      return this.apply(offered, await this.request(offered, "source-send", { accountId, packet: offered.packet }));
    });
  }

  cancel(id: unknown) {
    return this.run(async () => {
      const pending = await this.selected(id);
      if (pending.offered) return this.apply(pending, await this.request(pending, "source-cancel"));
      const remote = await this.request(pending, "source-cancel").catch(() => null);
      if (remote?.state === "received" || remote?.state === "cancelled") return this.apply(pending, remote);
      if (remote?.state === "ready") throw new Error("Check for the website’s cancellation before resuming.");
      await this.ports.call("handoff-cancel", { id: pending.id, terminal: false });
      await this.ports.changed();
      return view(pending, { state: "cancelled" });
    });
  }
}
