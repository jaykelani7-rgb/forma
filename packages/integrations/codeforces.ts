import { validHandle, type SubmissionInput } from "../../src/lib/codeforces-types";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export type VerifiedSubmission = { submission: SubmissionInput; handle: string; observedAt: string; sourceReference: string };
export type SubmissionCandidate = { id: string; handle: string; problemKey: string; startedAt: string; finishedAt?: string | null };
export type SubmissionAttribution = { status: "linked"; sessionId: string } | { status: "unassigned"; reason: "handle-mismatch" | "no-session" | "ambiguous" };

/** Contest namespaces must come from a verified context/catalogue, never a title or filename. */
export function parseVerifiedCodeforcesPage(raw: unknown, options: {
  handle: string; observedAt: string;
  namespaceForContest: (contestId: number) => "contest" | "gym" | null;
}): VerifiedSubmission[] {
  if (!validHandle(options.handle) || !Number.isFinite(Date.parse(options.observedAt)) || !Array.isArray(raw) || raw.length > 100) throw new Error("Invalid Codeforces activity page.");
  const ids = new Set<number>();
  return raw.map((item) => {
    if (!object(item) || !Number.isSafeInteger(item.id) || Number(item.id) < 1 || ids.has(Number(item.id)) || !Number.isSafeInteger(item.creationTimeSeconds) || Number(item.creationTimeSeconds) < 0 || Number(item.creationTimeSeconds) > 8640000000000 || !object(item.author) || item.author.ghost === true || !Array.isArray(item.author.members) || item.author.members.length < 1 || item.author.members.length > 100 || !item.author.members.every((member) => object(member) && typeof member.handle === "string" && validHandle(member.handle)) || !item.author.members.some((member) => member.handle.toLowerCase() === options.handle.toLowerCase()) || !object(item.problem) || typeof item.programmingLanguage !== "string" || item.programmingLanguage.length > 120 || (item.verdict !== undefined && (typeof item.verdict !== "string" || !/^[A-Z_0-9]{1,80}$/.test(item.verdict)))) throw new Error("Unverified Codeforces submission author or shape.");
    const problem = item.problem;
    if (!Number.isSafeInteger(problem.contestId) || Number(problem.contestId) < 1 || Number(problem.contestId) > 999999999 || typeof problem.index !== "string" || !/^[A-Za-z]\d{0,9}$/.test(problem.index) || typeof problem.name !== "string" || problem.name.length < 1 || problem.name.length > 300 || (problem.rating !== undefined && (!Number.isInteger(problem.rating) || Number(problem.rating) < 0 || Number(problem.rating) > 10000)) || !Array.isArray(problem.tags) || problem.tags.length > 20 || !problem.tags.every((tag) => typeof tag === "string" && tag.length <= 60)) throw new Error("Unsupported Codeforces problem identity.");
    const contestId = Number(problem.contestId);
    if ((item.contestId !== undefined && item.contestId !== contestId) || (item.author.contestId !== undefined && item.author.contestId !== contestId)) throw new Error("Conflicting Codeforces contest identity.");
    const namespace = options.namespaceForContest(contestId);
    if (namespace !== "contest" && namespace !== "gym") throw new Error("The Codeforces problem namespace has not been verified.");
    const index = problem.index.toUpperCase();
    const id = Number(item.id);
    ids.add(id);
    return {
      handle: options.handle, observedAt: options.observedAt,
      sourceReference: `https://codeforces.com/${namespace}/${contestId}/submission/${id}`,
      submission: { id, submittedAt: new Date(Number(item.creationTimeSeconds) * 1000).toISOString(), verdict: typeof item.verdict === "string" ? item.verdict : null, language: item.programmingLanguage, problem: { key: `${namespace}:${contestId}:${index}`, title: problem.name, code: `${contestId}${index}`, url: `https://codeforces.com/${namespace}/${contestId}/problem/${index}`, rating: typeof problem.rating === "number" ? problem.rating : null, tags: [...problem.tags] as string[] } },
    };
  });
}

/** Delayed delivery uses platform submission time. Several plausible sessions stay unassigned. */
export function attributeSubmission(observation: VerifiedSubmission, connectedHandle: string | null, candidates: SubmissionCandidate[]): SubmissionAttribution {
  if (!connectedHandle || observation.handle.toLowerCase() !== connectedHandle.toLowerCase()) return { status: "unassigned", reason: "handle-mismatch" };
  const submittedAt = Date.parse(observation.submission.submittedAt);
  const observedAt = Date.parse(observation.observedAt);
  const matches = candidates.filter((candidate) => {
    const start = Date.parse(candidate.startedAt);
    const finish = candidate.finishedAt ? Date.parse(candidate.finishedAt) : observedAt;
    return candidate.handle.toLowerCase() === connectedHandle.toLowerCase() && candidate.problemKey === observation.submission.problem.key && Number.isFinite(start) && Number.isFinite(finish) && finish >= start && submittedAt >= start && submittedAt <= finish && submittedAt <= observedAt;
  });
  if (matches.length !== 1) return { status: "unassigned", reason: matches.length ? "ambiguous" : "no-session" };
  return { status: "linked", sessionId: matches[0].id };
}

/** Retain first evidence and latest verdict independently from personal learning reflections. */
export function reconcileSubmissionVerdict(previous: VerifiedSubmission[], incoming: VerifiedSubmission): VerifiedSubmission[] {
  const row = previous.filter((entry) => entry.handle.toLowerCase() === incoming.handle.toLowerCase() && entry.submission.id === incoming.submission.id).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
  if (row && (row.submission.problem.key !== incoming.submission.problem.key || row.submission.submittedAt !== incoming.submission.submittedAt)) throw new Error("A submission cannot change its original identity or platform time.");
  if (row && Date.parse(row.observedAt) >= Date.parse(incoming.observedAt)) return previous;
  return [...previous, incoming];
}
