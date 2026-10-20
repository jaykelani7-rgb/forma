import type { CompanionBinding } from "./companion";

/** A problem can have several solution files; confirmation order is not editor focus. */
export function activeSolutionBinding(bindings: CompanionBinding[], problemId: string | undefined, fileUri: string | null | undefined) {
  return fileUri ? bindings.find(binding => binding.fileUri === fileUri && binding.problemId === problemId) : undefined;
}
