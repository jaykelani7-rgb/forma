import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCodeforcesIdentity } from "../../../packages/core/src/codeforces-identity";
import type { CompanionCommand } from "../../../packages/contracts/src";
import { parseRecognition, recognitionId, type EditorContext, type RecognitionRequest, type RecognitionView, type BrowserDelivery } from "../../../packages/integrations/recognition";
import { parseBrowserMessage, type BrowserReply } from "../../../packages/integrations/browser";
import type { LocalSnapshot } from "./store";

type Client = EditorContext & { seenAt: number; focusedAt: number };
type Proposal = { id: string; url: string; title: string; expiresAt: number; targets: Map<string, Client>; chosen?: string; status: "choose-file" | "waiting" | "saved" | "cancelled" | "expired" | "rejected"; error?: string };
export const CLIENT_MAX_AGE = 75000;
export const PROPOSAL_MAX_AGE = 60000;

/** Focus is ephemeral; only durable association changes enter the notebook journal. */
export class RecognitionHub {
  private clients = new Map<string, Client>();
  private withdrawn = new Map<string, { generation: number; at: number }>();
  private owner: string | null = null;
  private lastOwner: string | null = null;
  private activeTarget: Pick<Client, "instanceId" | "fileUri" | "generation"> | null = null;
  private focusTime = 0;
  private view: RecognitionView = null;
  private conflictTarget: Client | null = null;
  private suppressed: string | null = null;
  private switchTarget: Client | null = null;
  private proposals = new Map<string, Proposal>();
  private listeners = new Map<string, () => void>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private host: { snapshot: () => Promise<LocalSnapshot>; command: (c: CompanionCommand) => Promise<unknown>; select: (fileUri: string, clientId: string) => Promise<unknown>; changed: () => void; now?: () => number }) {}
  private now() { return this.host.now?.() ?? Date.now(); }
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.tail.then(work); this.tail = next.catch(() => {}); return next; }
  presentation() { const c = this.clients.get(this.lastOwner ?? ""); return c && this.eligible(c) ? this.view : null; }
  activeFileUri() { const c = this.clients.get(this.activeTarget?.instanceId ?? ""); return c && this.eligible(c) && !c.suppressed && c.fileUri === this.activeTarget?.fileUri && c.generation === this.activeTarget?.generation ? c.fileUri : null; }
  cancelBrowser() { for (const p of this.proposals.values()) if (["waiting", "choose-file"].includes(p.status)) p.status = "cancelled"; for (const wake of this.listeners.values()) wake(); }
  reset() { this.clients.clear(); this.withdrawn.clear(); this.owner = this.lastOwner = null; this.activeTarget = this.conflictTarget = null; this.focusTime = 0; this.suppressed = null; this.view = null; this.switchTarget = null; for (const p of this.proposals.values()) if (p.status === "waiting" || p.status === "choose-file") p.status = "cancelled"; for (const wake of this.listeners.values()) wake(); this.host.changed(); }
  private eligible(c: Client) { return !!c.fileUri && this.now() - c.seenAt <= CLIENT_MAX_AGE; }
  private binding(snapshot: LocalSnapshot, c: Client) { return snapshot.state.bindings.find(b => b.fileUri === c.fileUri && (!b.clientId || b.clientId === c.clientId)); }
  private delivery(instanceId: string): BrowserDelivery | undefined {
    this.expire();
    for (const p of this.proposals.values()) {
      if (p.status !== "waiting" || !p.chosen) continue;
      const target = p.targets.get(p.chosen)!;
      if (target.instanceId === instanceId) return { proposalId: p.id, fileUri: target.fileUri!, generation: target.generation, url: p.url, title: p.title };
    }
  }
  private expire() {
    for (const p of this.proposals.values()) if (p.expiresAt < this.now() && ["choose-file", "waiting"].includes(p.status)) p.status = "expired";
    for (const p of this.proposals.values()) if (p.status === "waiting" && p.chosen) {
      const target = p.targets.get(p.chosen)!, current = this.clients.get(target.instanceId);
      if (!current || !this.eligible(current) || current.fileUri !== target.fileUri || current.generation !== target.generation) { p.status = "rejected"; p.error = "The chosen solution changed. Capture the page again."; }
    }
    for (const [id, p] of this.proposals) if (this.now() - p.expiresAt > 120000) this.proposals.delete(id);
    for (const [id, c] of this.withdrawn) if (this.now() - c.at > CLIENT_MAX_AGE + 5000) this.withdrawn.delete(id);
  }
  private projection(snapshot: LocalSnapshot, client: Client, conflict = false) {
    const saved = this.binding(snapshot, client), active = this.activeFileUri() === client.fileUri && snapshot.state.problemId === saved?.problemId;
    return { fileUri: client.fileUri, status: !saved ? "unbound" : client.suppressed || (saved.source === "cph" && !client.automatic) ? "disabled" : conflict ? "conflict" : snapshot.data.session && snapshot.data.session.problemId !== saved.problemId ? "candidate" : active ? "active" : "inactive" };
  }
  async request(raw: RecognitionRequest): Promise<Record<string, unknown>> {
    const input = parseRecognition(raw);
    if (input.reason === "poll") {
      if (!this.clients.has(input.instanceId)) return { unregistered: true };
      if (!this.delivery(input.instanceId)) await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); if (this.listeners.get(input.instanceId) === done) this.listeners.delete(input.instanceId); resolve(); };
        const timer = setTimeout(done, 20000); timer.unref?.();
        this.listeners.get(input.instanceId)?.(); this.listeners.set(input.instanceId, done);
      });
      return { proposal: this.delivery(input.instanceId) ?? null };
    }
    return this.serial(async () => {
      if (input.reason === "proposal-result") {
        const p = this.proposals.get(input.proposalId);
        if (p?.status === "waiting" && p.chosen && p.targets.get(p.chosen)?.instanceId === input.instanceId) {
          const target = p.targets.get(p.chosen)!, current = this.clients.get(input.instanceId);
          const binding = current && this.binding(await this.host.snapshot(), current);
          const valid = current && this.eligible(current) && current.fileUri === target.fileUri && current.generation === target.generation && p.expiresAt >= this.now() && binding?.identity === normalizeCodeforcesIdentity(p.url)?.key && binding?.source === "browser";
          p.status = input.accepted && valid ? "saved" : "rejected"; p.error = input.error ?? (input.accepted && !valid ? "The target changed or its association was not saved." : undefined);
        }
        return {};
      }
      if (input.observedAt > this.now() + 5000 || this.now() - input.observedAt > CLIENT_MAX_AGE) return { stale: true };
      this.expire();
      if (input.generation <= (this.withdrawn.get(input.instanceId)?.generation ?? -1)) return { stale: true };
      const previous = this.clients.get(input.instanceId);
      if (!previous && this.withdrawn.size >= 256 && !this.withdrawn.has(input.instanceId)) throw new Error("Too many recently closed Forma windows. Try again shortly.");
      if (previous && input.generation < previous.generation) return { stale: true };
      if (input.reason === "withdraw") {
        this.withdrawn.set(input.instanceId, { generation: input.generation, at: this.now() });
        this.clients.delete(input.instanceId); this.listeners.get(input.instanceId)?.();
        if (this.owner === input.instanceId) this.owner = null;
        if (this.lastOwner === input.instanceId) { this.lastOwner = null; this.view = null; }
        if (this.switchTarget?.instanceId === input.instanceId) this.switchTarget = null;
        this.host.changed(); return {};
      }
      if (input.reason === "heartbeat") {
        if (previous) { previous.seenAt = this.now(); if (input.focused && this.owner === input.instanceId && previous.focused) previous.focusedAt = this.now(); }
        return { ...(previous ? { recognition: this.projection(await this.host.snapshot(), previous, this.presentation()?.status === "conflict" && this.presentation()?.fileUri === previous.fileUri) } : {}), proposal: this.delivery(input.instanceId) ?? null };
      }
      if (!previous && this.clients.size >= 16) { for (const [id, c] of this.clients) if (!this.eligible(c)) this.clients.delete(id); if (this.clients.size >= 16) throw new Error("Too many active Forma windows."); }
      const client: Client = { ...input, seenAt: this.now(), focusedAt: previous?.focusedAt ?? 0 };
      if (input.reason === "focus" && input.observedAt >= this.focusTime) {
        this.focusTime = input.observedAt;
        if (input.focused) { this.owner = this.lastOwner = input.instanceId; this.activeTarget = { ...client }; client.focusedAt = this.now(); }
        else if (this.owner === input.instanceId) this.owner = null;
      }
      this.clients.set(input.instanceId, client);

      if (!client.fileUri) { if (this.lastOwner === client.instanceId) this.view = null; this.host.changed(); return {}; }
      let snap = await this.host.snapshot();
      const known = this.binding(snap, client);
      const identity = input.binding && normalizeCodeforcesIdentity(input.binding.url)!;
      const p = input.proposalId ? this.proposals.get(input.proposalId) : undefined;
      const target = p?.chosen ? p.targets.get(p.chosen) : undefined;
      const browserConfirmed = input.binding?.source === "browser" && p?.status === "waiting" && p.expiresAt >= this.now() && target?.instanceId === client.instanceId && target?.generation === client.generation && target?.fileUri === client.fileUri && normalizeCodeforcesIdentity(p.url)?.key === identity?.key;
      if (input.proposalId && !browserConfirmed) throw new Error("This browser proposal expired, was cancelled, or belongs to another file.");
      if (input.binding?.source === "browser" && !browserConfirmed && !known) throw new Error("Confirm this browser proposal for the exact solution first.");
      const staleBrowserCache = input.binding?.source === "browser" && !browserConfirmed && !!known && (known.source !== "browser" || known.identity !== identity?.key);
      if (browserConfirmed) { this.lastOwner = client.instanceId; this.activeTarget = { ...client }; client.suppressed = false; this.suppressed = null; }

      const conflict = !staleBrowserCache && !!known && !!identity && known.identity !== identity.key && !input.binding?.replace;
      // A confirmed manual/browser mapping wins even when automatic metadata agrees.
      const preserve = !!known && (staleBrowserCache || conflict || ((known.source === "manual" || known.source === "browser") && input.binding?.source === "cph" && !input.binding.replace));
      if (input.binding && !preserve && (!known || known.identity !== identity!.key || known.source !== input.binding.source || known.adapterVersion !== input.binding.adapterVersion)) {
        await this.host.command({ id: `binding:${recognitionId(client.clientId, client.workspaceId, client.fileUri, input.binding, client.generation, client.instanceId)}`, type: "attach", payload: { ...input.binding, fileUri: client.fileUri, clientId: client.clientId, workspaceId: client.workspaceId, activate: false } });
        snap = await this.host.snapshot();
      }
      if ((this.owner === client.instanceId && client.focused) || browserConfirmed) await this.select(client, snap, conflict);
      const current = await this.host.snapshot(), saved = this.binding(current, client);
      return { savedBinding: saved ?? null, recognition: this.projection(current, client, conflict), proposal: this.delivery(client.instanceId) ?? null };
    });
  }
  private async select(client: Client, snapshot: LocalSnapshot, conflict = false) {
    const binding = this.binding(snapshot, client);
    if (!binding || client.suppressed || (binding.source === "cph" && !client.automatic)) { this.view = null; this.host.changed(); return; }
    const problem = snapshot.data.problems.find(p => p.id === binding.problemId)!;
    const needsChoice = !!snapshot.data.session && snapshot.data.session.problemId !== binding.problemId;
    const id = recognitionId(client.instanceId, client.fileUri, binding.identity, conflict, needsChoice);
    if (!needsChoice && !conflict && snapshot.state.problemId !== binding.problemId) {
      await this.host.select(binding.fileUri, client.clientId);
    }
    if (conflict) this.conflictTarget = structuredClone(client);
    else if (this.conflictTarget?.fileUri !== client.fileUri || this.conflictTarget?.generation !== client.generation) this.conflictTarget = null;
    this.view = id === this.suppressed ? null : { id, fileUri: binding.fileUri, title: problem.title, source: binding.source ?? "manual", status: conflict ? "conflict" : needsChoice ? "needs-choice" : "recognised", message: conflict ? "CPH identifies a different problem. Your confirmed association is kept." : needsChoice ? "Your current session stays on its problem." : `${problem.title} · recognised from ${binding.source === "cph" ? "CPH" : binding.source === "browser" ? "Chrome" : "your saved association"}` };
    this.host.changed();
  }
  dismiss(expectedId?: string) { if (expectedId && this.view?.id !== expectedId) return; this.suppressed = this.view?.id ?? null; this.view = null; this.host.changed(); }
  async resolveConflict() { return this.serial(async () => { const c = this.conflictTarget, current = c && this.clients.get(c.instanceId); if (!c || !current || !this.eligible(current) || current.fileUri !== c.fileUri || current.generation !== c.generation || !c.binding) throw new Error("Return to the eligible solution in VS Code first."); await this.host.command({ id: randomUUID(), type: "attach", payload: { ...c.binding, fileUri: c.fileUri!, clientId: c.clientId, workspaceId: c.workspaceId, replace: true, activate: false } }); this.conflictTarget = null; await this.select(c, await this.host.snapshot()); }); }
  async finishAndSwitch() { return this.serial(async () => { const c = this.clients.get(this.lastOwner ?? ""); if (!c || !this.eligible(c)) throw new Error("Return to the eligible solution in VS Code first."); const snap = await this.host.snapshot(); if (!snap.data.session) return this.select(c, snap); this.switchTarget = { ...c }; await this.host.command({ id: randomUUID(), type: "finish", payload: {}, expectedSessionId: snap.data.session.id }); }); }
  async afterReflection() { return this.serial(async () => { const c = this.switchTarget; this.switchTarget = null; if (!c) return; const current = this.clients.get(c.instanceId); if (current && current.fileUri === c.fileUri && current.generation === c.generation && this.eligible(current)) await this.select(current, await this.host.snapshot()); }); }
  browser(raw: unknown): Promise<BrowserReply> { return this.serial(async () => {
    const message = parseBrowserMessage(raw); this.expire();
    if (message.kind === "propose") {
      if (this.proposals.size >= 32) throw new Error("Too many pending browser proposals. Cancel one or wait for expiry.");
      const targets = new Map<string, Client>();
      // Only a window that actually held focus can be offered. No latest-file guessing.
      const unique = new Map<string, Client>();
      for (const c of this.clients.values()) if (this.eligible(c) && c.focusedAt > 0 && this.now() - c.focusedAt <= CLIENT_MAX_AGE) {
        const key = recognitionId(c.clientId, c.workspaceId, c.fileUri), previous = unique.get(key);
        if (!previous || c.focusedAt >= previous.focusedAt) unique.set(key, c);
      }
      for (const c of unique.values()) targets.set(recognitionId(c.instanceId, c.generation, c.fileUri), { ...c });
      if (!targets.size) throw new Error("Open a permitted solution in paired VS Code, then click Use in Forma again.");
      const p: Proposal = { id: randomUUID(), url: message.url, title: message.title, targets, expiresAt: this.now() + PROPOSAL_MAX_AGE, status: "choose-file" }; this.proposals.set(p.id, p);
      return this.browserReply(p);
    }
    const p = this.proposals.get(message.proposalId);
    if (!p) throw new Error("This browser proposal is no longer available.");
    if (message.kind === "cancel") { if (p.status !== "saved") p.status = "cancelled"; return this.browserReply(p); }
    if (message.kind === "confirm" && ["expired", "cancelled", "rejected"].includes(p.status)) return this.browserReply(p);
    if (message.kind === "confirm" && p.status === "choose-file") {
      const target = p.targets.get(message.targetId); const current = target && this.clients.get(target.instanceId);
      if (!target || !current || !this.eligible(current) || current.fileUri !== target.fileUri || current.generation !== target.generation) throw new Error("The chosen solution changed. Capture the page again.");
      p.chosen = message.targetId; p.status = "waiting"; this.listeners.get(target.instanceId)?.();
    } else if (message.kind === "confirm" && p.chosen !== message.targetId) throw new Error("This proposal is already frozen to another target.");
    return this.browserReply(p);
  }); }
  private browserReply(p: Proposal): BrowserReply { return { ok: true, proposalId: p.id, expiresAt: p.expiresAt, status: p.status, ...(p.error ? { error: p.error } : {}), ...(p.status === "choose-file" ? { targets: [...p.targets].map(([id, c]) => ({ id, label: `${basename(fileURLToPath(c.fileUri!)).slice(0, 140)} · VS Code ${c.workspaceId.slice(0, 6)}` })) } : {}) }; }
}
