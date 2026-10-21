import { createHash } from "node:crypto";
import type { SharedCode } from "../tutor/types";
import { parseSharedCode } from "../tutor/context";

/** A fence is deliberately wider than a URI: editing or rebinding invalidates consent. */
export interface CodeSourceFence {
  fileUri: string; identity: string; bindingId: string; generation: number; version: number;
}
export function sameCodeSource(a: CodeSourceFence, b: CodeSourceFence | null) {
  return !!b && a.fileUri === b.fileUri && a.identity === b.identity && a.bindingId === b.bindingId && a.generation === b.generation && a.version === b.version;
}

/** Only the explicit VS Code command calls this. No watcher can collect source text. */
export async function collectExplicitCode(options: {
  fence: CodeSourceFence;
  current: () => CodeSourceFence | null;
  permitted: () => Promise<unknown>;
  credential: () => Promise<string>;
  read: () => { text: string; startLine: number; endLine: number; language: string; filename: string };
  id: string; workspaceId: string; clientId: string; now?: () => Date;
}): Promise<{ code: SharedCode; credential: string }> {
  const unchanged = () => { if (!sameCodeSource(options.fence, options.current())) throw new Error("The editor, source, or problem changed. Choose the code again."); };
  await options.permitted();
  const token = await options.credential(); unchanged();
  const source = options.read(); unchanged();
  if (!source.text.trim()) throw new Error("Select some code or choose a nonempty current file.");
  if (source.text.length > 24000) throw new Error("This code exceeds 24,000 characters. Select a smaller relevant section.");
  const revision = `version:${options.fence.version}:sha256:${createHash("sha256").update(source.text).digest("hex")}`;
  // Recheck real paths, workspace trust, folder permission and pairing after collection.
  await options.permitted();
  if (await options.credential() !== token) throw new Error("Pairing changed. Choose the code again.");
  unchanged();
  const code = parseSharedCode({ id: options.id, identity: options.fence.identity, workspaceId: options.workspaceId, clientId: options.clientId, fileUri: options.fence.fileUri, ...source, revision, capturedAt: (options.now?.() ?? new Date()).toISOString() });
  return { code, credential: token };
}
