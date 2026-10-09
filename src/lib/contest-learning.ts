import type { PlatformSubmission } from "./codeforces-types";
import type { ContestProblem, PracticeContest } from "./contest-lab";
import type { LearningRecord } from "./learning";
import type { Data } from "./model";
import { practiceIdentity } from "./practice-state";

export interface ContestLearningSource {
  contestId: string;
  problemId: string;
  name: string;
  startedAt: string;
  endedAt: string;
  importedAttemptIds: string[];
}

const sourceKey = (handle: string, id: number) =>
  `${handle.toLowerCase()}:${id}`;
const identityKey = (handle: string, identity: string) =>
  `${handle.toLowerCase()}:${identity}`;

interface ContestEvidence {
  contest: PracticeContest;
  row: ContestProblem;
  submissions: PlatformSubmission[];
}
interface EvidenceIndex {
  rows: ContestEvidence[];
  owner: Map<string, ContestEvidence>;
  submissions: Map<string, PlatformSubmission>;
}
const indexes = new WeakMap<Data, EvidenceIndex>();

// Reuse the immutable workspace's submission index across shared consumers.
// Windows use binary search instead of scanning every submission for each row.
function indexFor(data: Data): EvidenceIndex {
  const cached = indexes.get(data);
  if (cached) return cached;
  const problems = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  const submissions = new Map<string, PlatformSubmission>();
  const byIdentity = new Map<string, PlatformSubmission[]>();
  const linkedIds = new Set(
    (data.learningLinks ?? []).map((link) => link.importedAttemptId),
  );
  const reserved = new Set<string>();
  for (const attempt of data.codeforces.practiceAttempts)
    if (linkedIds.has(attempt.id))
      for (const id of attempt.submissionIds)
        reserved.add(sourceKey(attempt.handle, id));
  for (const submission of data.codeforces.submissions) {
    submissions.set(sourceKey(submission.handle, submission.id), submission);
    const problem = problems.get(submission.problemId);
    if (!problem || reserved.has(sourceKey(submission.handle, submission.id)))
      continue;
    const key = identityKey(submission.handle, practiceIdentity(problem));
    const rows = byIdentity.get(key) ?? [];
    rows.push(submission);
    byIdentity.set(key, rows);
  }
  for (const rows of byIdentity.values())
    rows.sort(
      (a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id - b.id,
    );
  const rows: ContestEvidence[] = [];
  const owner = new Map<string, ContestEvidence>();
  // If windows overlap, the earliest started contest owns each submission once.
  const contests = (data.contests ?? [])
    .filter((contest) => contest.startedAt && contest.endedAt)
    .sort(
      (a, b) =>
        a.startedAt!.localeCompare(b.startedAt!) || a.id.localeCompare(b.id),
    );
  for (const contest of contests) {
    for (const row of contest.problems) {
      const evidence: ContestEvidence = { contest, row, submissions: [] };
      const candidates = contest.handle
        ? (byIdentity.get(identityKey(contest.handle, row.identity)) ?? [])
        : [];
      let low = 0;
      let high = candidates.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (candidates[mid].submittedAt < contest.startedAt!) low = mid + 1;
        else high = mid;
      }
      for (let i = low; i < candidates.length; i++) {
        const submission = candidates[i];
        if (submission.submittedAt > contest.endedAt!) break;
        const key = sourceKey(submission.handle, submission.id);
        if (owner.has(key)) continue;
        evidence.submissions.push(submission);
        owner.set(key, evidence);
      }
      if (
        row.reflection ||
        row.status !== "not-started" ||
        row.notes.trim() ||
        evidence.submissions.length
      )
        rows.push(evidence);
    }
  }
  const index = { rows, owner, submissions };
  indexes.set(data, index);
  return index;
}

/** A derived contest event retains originals and never creates a timed attempt.
 * Imported-only submissions inside its captured window belong to this event;
 * submissions outside remain a separate derived event. Explicit learning links
 * retain their selected source and real timed event instead of being folded. */
export function projectContestLearning(
  data: Data,
  baseRecords: LearningRecord[],
): LearningRecord[] {
  const index = indexFor(data);
  const originalByRow = new Map<ContestEvidence, LearningRecord[]>();
  const residual: LearningRecord[] = [];
  for (const record of baseRecords) {
    if (record.source !== "codeforces" || !record.handle) {
      residual.push(record);
      continue;
    }
    const outside: PlatformSubmission[] = [];
    const owners = new Set<ContestEvidence>();
    for (const id of record.submissionIds) {
      const key = sourceKey(record.handle, id);
      const owner = index.owner.get(key);
      if (owner) owners.add(owner);
      else {
        const submission = index.submissions.get(key);
        if (submission) outside.push(submission);
      }
    }
    for (const owner of owners) {
      const originals = originalByRow.get(owner) ?? [];
      originals.push(record);
      originalByRow.set(owner, originals);
    }
    if (!owners.size) residual.push(record);
    else if (outside.length) {
      outside.sort(
        (a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id - b.id,
      );
      // A quick reflection follows its original last submission; earlier failure
      // evidence must not inherit a later solve inside a contest.
      const retainsReflection =
        outside.at(-1)!.submittedAt === record.completedAt;
      residual.push({
        ...record,
        completedAt: outside.at(-1)!.submittedAt,
        submissionIds: outside.map((submission) => submission.id),
        accepted: outside.some((submission) => submission.verdict === "OK"),
        ...(!retainsReflection
          ? {
              outcome: null,
              difficulty: null,
              reflectedAt: null,
              takeaway: "",
              mistakes: undefined,
              mistakeNote: undefined,
              approach: undefined,
              reflectionPending: true,
              reflectionSource: null,
            }
          : {}),
      });
    }
  }
  for (const evidence of index.rows) {
    const { contest, row, submissions } = evidence;
    const originals = originalByRow.get(evidence) ?? [];
    const submittedAt = new Set(
      submissions.map((submission) => submission.submittedAt),
    );
    const importedReflection = originals
      .filter(
        (record) =>
          record.outcome !== null && submittedAt.has(record.completedAt),
      )
      .sort(
        (a, b) =>
          (b.reflectedAt ?? "").localeCompare(a.reflectedAt ?? "") ||
          a.id.localeCompare(b.id),
      )[0];
    const reflection = row.reflection ?? importedReflection;
    const completedAt =
      contest.endReason === "expired"
        ? (submissions.at(-1)?.submittedAt ?? contest.startedAt!)
        : contest.endedAt!;
    residual.push({
      id: `contest:${contest.id}:${row.id}`,
      source: "contest",
      problemId: row.problemId,
      problemIds: [
        ...new Set([
          row.problemId,
          ...originals.flatMap((record) => record.problemIds),
        ]),
      ],
      handle: contest.handle,
      learningKey: `${contest.handle ? `cf:${contest.handle.toLowerCase()}` : "notebook"}:${row.identity}`,
      completedAt,
      reflectedAt:
        row.reflection?.savedAt ?? importedReflection?.reflectedAt ?? null,
      outcome: reflection?.outcome ?? null,
      difficulty: reflection?.difficulty ?? null,
      takeaway: reflection?.takeaway ?? "",
      notes: row.notes,
      elapsedMs: null,
      timedAttemptId: null,
      importedAttemptId:
        importedReflection?.importedAttemptId ??
        originals[0]?.importedAttemptId ??
        null,
      submissionIds: submissions.map((submission) => submission.id),
      accepted: submissions.length
        ? submissions.some((submission) => submission.verdict === "OK")
        : null,
      reflectionPending: !reflection,
      reflectionSource: row.reflection
        ? "contest"
        : importedReflection
          ? "codeforces"
          : null,
      ...(reflection?.mistakes !== undefined
        ? { mistakes: [...reflection.mistakes] }
        : {}),
      ...(reflection?.mistakeNote !== undefined
        ? { mistakeNote: reflection.mistakeNote }
        : {}),
      ...(reflection?.approach !== undefined
        ? { approach: reflection.approach }
        : {}),
      contestSource: {
        contestId: contest.id,
        problemId: row.id,
        name: contest.name,
        startedAt: contest.startedAt!,
        endedAt: contest.endedAt!,
        importedAttemptIds: originals.flatMap((record) =>
          record.importedAttemptId ? [record.importedAttemptId] : [],
        ),
      },
    });
  }
  return residual;
}
