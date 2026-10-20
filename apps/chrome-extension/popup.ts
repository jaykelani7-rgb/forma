import { normalizeCodeforcesIdentity } from "../../packages/core/src/codeforces-identity";
import { NATIVE_HOST_NAME } from "../../packages/integrations/browser-id";
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const capture = document.querySelector<HTMLButtonElement>("#capture")!;
const confirm = document.querySelector<HTMLButtonElement>("#confirm")!;
const cancel = document.querySelector<HTMLButtonElement>("#cancel")!;
const targets = document.querySelector<HTMLSelectElement>("#targets")!;
let proposalId: string | undefined, selectedId: string | undefined;
let operation = 0;
function ready(label = "Capture again") { proposalId = selectedId = undefined; confirm.hidden = cancel.hidden = targets.hidden = true; confirm.disabled = false; capture.hidden = false; capture.disabled = false; capture.textContent = label; }
async function native(message: unknown) { const reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message); if (!reply.ok) throw new Error(reply.error || "Open Fenn and enable Chrome capture in Settings."); return reply; }
function failure(e: unknown) { status.textContent = e instanceof Error ? e.message : "Open Fenn and check the native host setup."; }
capture.addEventListener("click", () => { void (async () => {
  const current = ++operation;
  capture.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !normalizeCodeforcesIdentity({ url: tab.url })) throw new Error("Open an exact Codeforces problem page first.");
    const [page] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ url: location.href, title: (document.querySelector(".problem-statement .title")?.textContent || document.title).trim().slice(0, 240) }) });
    if (!page?.result || !normalizeCodeforcesIdentity({ url: page.result.url })) throw new Error("The problem page changed. Try again.");
    const reply = await native({ kind: "propose", ...page.result }); if (current !== operation) return; proposalId = reply.proposalId;
    if (!proposalId || !reply.targets?.length) throw new Error("Open a permitted solution in paired VS Code first.");
    targets.replaceChildren(...reply.targets.map(t => { const option = document.createElement("option"); option.value = t.id; option.textContent = t.label; return option; }));
    targets.hidden = reply.targets.length === 1; selectedId = reply.targets[0].id;
    confirm.textContent = reply.targets.length === 1 ? `Connect to ${reply.targets[0].label}` : "Connect to selected solution";
    status.textContent = `${page.result.title} — confirm the solution file below.`;
    capture.hidden = true; confirm.hidden = cancel.hidden = false;
  } catch (e) { if (current === operation) { failure(e); ready(); } } finally { if (current === operation) capture.disabled = false; }
})(); });
targets.addEventListener("change", () => { selectedId = targets.value; });
confirm.addEventListener("click", () => { void (async () => {
  const current = ++operation, frozenProposal = proposalId, frozenTarget = selectedId;
  confirm.disabled = true;
  try {
    let reply = await native({ kind: "confirm", proposalId: frozenProposal, targetId: frozenTarget });
    if (current !== operation) return;
    const until = Date.now() + 20000;
    while (reply.status === "waiting" && Date.now() < until && current === operation) {
      status.textContent = "Waiting for VS Code to validate and save this file association…";
      await new Promise(resolve => setTimeout(resolve, 1000)); if (current !== operation) return; reply = await native({ kind: "status", proposalId: frozenProposal });
    }
    if (current !== operation) return;
    status.textContent = reply.status === "saved" ? "Association saved locally. Return to your solution; starting time remains your choice." : reply.error || (reply.status === "waiting" ? "Still waiting for VS Code. This proposal expires after a minute." : `Proposal ${reply.status}. Capture again when ready.`);
    if (reply.status === "saved") ready("Use in Forma again");
    else if (reply.status !== "waiting") ready();
    else confirm.disabled = false;
  } catch (e) { if (current === operation) { failure(e); ready(); } }
})(); });
cancel.addEventListener("click", () => { void (async () => { const current = ++operation, frozen = proposalId; try { if (frozen) await native({ kind: "cancel", proposalId: frozen }); if (current === operation) { status.textContent = "Capture cancelled."; ready(); } } catch (e) { if (current === operation) { failure(e); ready(); } } })(); });
