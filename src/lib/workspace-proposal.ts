import { validateData } from "./model";
import type { Data, Problem } from "./model";
import { normalizeCodeforcesIdentity } from "./codeforces-identity";

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}
export function validateWorkspaceProposal(proposed: Data): Data {
  try {
    return validateData(proposed);
  } catch (error) {
    throw new WorkspaceValidationError(
      `This change cannot be saved: ${error instanceof Error ? error.message : "the workspace references are invalid."} Your saved workspace is unchanged. Correct the draft and try again.`,
    );
  }
}
export function problemIdentityProtected(
  data: Data,
  problemId: string,
): boolean {
  return (
    data.trackEntries?.some((e) => e.problemId === problemId) === true ||
    data.attempts.some((a) => a.problemId === problemId) ||
    data.codeforces.practiceAttempts.some((a) => a.problemId === problemId) ||
    data.revisions?.some((r) => r.problemId === problemId) === true ||
    data.session?.problemId === problemId ||
    !!data.problems.find((p) => p.id === problemId)?.cfHandle
  );
}
export function assertSafeProblemEdit(
  data: Data,
  previous: Problem,
  proposed: Problem,
): void {
  if (!problemIdentityProtected(data, previous.id)) return;
  const identity = (p: Problem) =>
    normalizeCodeforcesIdentity({
      url: p.url,
      code: p.platform.toLowerCase() === "codeforces" ? p.problemCode : "",
    });
  const before = identity(previous),
    after = identity(proposed);
  const same =
    previous.platform.toLowerCase() === proposed.platform.toLowerCase() &&
    (before && after
      ? before.key === after.key
      : previous.url === proposed.url &&
        previous.problemCode === proposed.problemCode);
  if (!same)
    throw new WorkspaceValidationError(
      "This problem is referenced by a track or recorded practice. Keep its platform, problem ID and link attached to the original problem. You can edit its name, topics and rating here. To replace a track problem, use Edit track; add a separate problem for a different identity. Your draft is still here.",
    );
  // A valid URL must not hide a contradictory manually entered Codeforces ID.
  if (before && proposed.problemCode) {
    const code = normalizeCodeforcesIdentity({ code: proposed.problemCode });
    const explicitNamespace = /^(?:CF|Codeforces|Gym)(?=\s|\d)/i.test(
      proposed.problemCode.trim(),
    );
    // Bare codes do not encode a Gym/contest namespace; the unchanged URL does.
    // An explicit namespace still must agree, and a changed index never does.
    if (
      !code ||
      code.code !== before.code ||
      (explicitNamespace && code.key !== before.key)
    )
      throw new WorkspaceValidationError(
        "Keep the original Codeforces ID for this recorded problem. To change a track entry, use Edit track. Your draft is still here.",
      );
  }
}
