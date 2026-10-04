import { Data, Outcome, Problem, addDays, localDate } from "./model";
import {
  ActivityPage,
  CF_INBOX_SIZE,
  ImportedAttempt,
  PublicProfile,
  QuickReflection,
  SubmissionInput,
  SubmissionCoverage,
  SyncedProfile,
  handleKey,
} from "./codeforces-types";

export function connectedProfile(data: Data): SyncedProfile | undefined {
  return data.codeforces.profiles.find(
    (p) =>
      handleKey(p.handle) === handleKey(data.codeforces.connectedHandle ?? ""),
  );
}
export function beginVisit(data: Data, now = new Date()): Data {
  return ensureDailyReflectionBatch(
    {
      ...data,
      codeforces: {
        ...data.codeforces,
        profiles: data.codeforces.profiles.map((p) => ({
          ...p,
          sinceAt: p.lastVisitAt,
          lastVisitAt: now.toISOString(),
        })),
      },
    },
    now,
  );
}
export function connectProfile(
  data: Data,
  profile: PublicProfile,
  now = new Date(),
): Data {
  const previous = data.codeforces.profiles.find(
    (p) => handleKey(p.handle) === handleKey(profile.handle),
  );
  const value: SyncedProfile = {
    lastSyncAt: null,
    lastVisitAt: now.toISOString(),
    sinceAt: null,
    nextFrom: 1,
    historyComplete: false,
    gapUntilId: null,
    ...previous,
    ...profile,
    profileUpdatedAt: now.toISOString(),
  };
  return {
    ...data,
    codeforces: {
      ...data.codeforces,
      connectedHandle: profile.handle,
      profiles: [
        ...data.codeforces.profiles.filter(
          (p) => handleKey(p.handle) !== handleKey(profile.handle),
        ),
        value,
      ],
    },
  };
}

/** Only a successful public-profile request updates rating freshness. */
export function mergeProfileMetadata(
  data: Data,
  profile: PublicProfile,
  now = new Date(),
): Data {
  return {
    ...data,
    codeforces: {
      ...data.codeforces,
      profiles: data.codeforces.profiles.map((saved) =>
        handleKey(saved.handle) === handleKey(profile.handle)
          ? {
              ...saved,
              rating: profile.rating,
              rank: profile.rank,
              profileUpdatedAt: now.toISOString(),
            }
          : saved,
      ),
    },
  };
}

function storedCoverage(
  profile: SyncedProfile,
  ids: number[],
): SubmissionCoverage[] {
  if (profile.coverage) return profile.coverage.map((range) => ({ ...range }));
  if (!ids.length) return [];
  const range = (values: number[], complete: boolean): SubmissionCoverage => ({
    newestId: Math.max(...values),
    oldestId: Math.min(...values),
    complete,
  });
  // Old backups did not record separate ranges. Preserve their explicit gap;
  // never infer continuity across its boundary during migration.
  if (profile.gapUntilId) {
    const above = ids.filter((id) => id > profile.gapUntilId!);
    const below = ids.filter((id) => id <= profile.gapUntilId!);
    return [
      ...(above.length ? [range(above, false)] : []),
      ...(below.length ? [range(below, false)] : []),
    ];
  }
  return [range(ids, profile.historyComplete)];
}

function mergeCoverage(ranges: SubmissionCoverage[]): SubmissionCoverage[] {
  const ordered = ranges
    .map((range) => ({ ...range }))
    .sort((a, b) => b.newestId - a.newestId);
  const merged: SubmissionCoverage[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.newestId >= previous.oldestId) {
      previous.oldestId = Math.min(previous.oldestId, range.oldestId);
      previous.complete ||= range.complete;
    } else merged.push(range);
  }
  return merged;
}

function fetchedCoverage(pages: ActivityPage[]): SubmissionCoverage[] {
  const ranges: SubmissionCoverage[] = [];
  let chain: SubmissionCoverage | null = null;
  let previousEnd = -1;
  for (const page of pages) {
    const ids = page.submissions.map((submission) => submission.id);
    if (!ids.length) continue;
    const range = {
      newestId: Math.max(...ids),
      oldestId: Math.min(...ids),
      complete: page.submissions.length < page.count,
    };
    // Consecutive offset pages form one fetched window. New submissions moving
    // offsets backwards cause duplicates, which remain safe within that window.
    if (chain && page.from <= previousEnd) {
      chain.newestId = Math.max(chain.newestId, range.newestId);
      chain.oldestId = Math.min(chain.oldestId, range.oldestId);
      chain.complete ||= range.complete;
    } else {
      chain = range;
      ranges.push(chain);
    }
    previousEnd = page.from + page.submissions.length;
  }
  return ranges;
}

export function disconnectProfile(data: Data): Data {
  return { ...data, codeforces: { ...data.codeforces, connectedHandle: null } };
}
export function platformProblemId(handle: string, key: string) {
  return `cf:${handleKey(handle)}:${key}`;
}
export function codeforcesIdentity(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^(www\.)?codeforces\.com$/.test(u.hostname)) return null;
    const match = u.pathname.match(
      /^\/(?:problemset\/problem\/|(?:contest|gym)\/)(\d+)\/(?:problem\/)?([A-Za-z0-9]+)\/?$/,
    );
    return match ? `contest:${match[1]}:${match[2].toUpperCase()}` : null;
  } catch {
    return null;
  }
}

// Apply a complete fetched transaction only. The caller collects all required pages
// before committing. Failed requests never reach this pure reducer.
export function mergeActivity(
  data: Data,
  handle: string,
  pages: ActivityPage[],
  kind: "refresh" | "older",
  now = new Date(),
): Data {
  const profile = data.codeforces.profiles.find(
    (p) => handleKey(p.handle) === handleKey(handle),
  );
  if (
    !profile ||
    !pages.length ||
    pages.some((p) => handleKey(p.handle) !== handleKey(handle))
  )
    throw new Error("Activity does not match a saved profile.");
  const cf = data.codeforces;
  const problems = data.problems.map((p) => ({ ...p }));
  const submissions = cf.submissions.map((s) => ({ ...s }));
  const attempts = cf.practiceAttempts.map((a) => ({
    ...a,
    submissionIds: [...a.submissionIds],
  }));
  const known = new Set(
    submissions
      .filter((s) => handleKey(s.handle) === handleKey(handle))
      .map((s) => s.id),
  );
  const priorNewest = Math.max(0, ...known);
  const inputs = [
    ...new Map(
      pages.flatMap((p) => p.submissions).map((s) => [s.id, s]),
    ).values(),
  ];
  for (const input of inputs.sort(
    (a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id - b.id,
  )) {
    let problem = problems.find(
      (p) =>
        p.cfKey === input.problem.key &&
        handleKey(p.cfHandle ?? "") === handleKey(handle),
    );
    const problemId =
      problem?.id ?? platformProblemId(handle, input.problem.key);
    if (!problem) {
      problem = {
        id: problemId,
        title: input.problem.title,
        platform: "Codeforces",
        url: input.problem.url,
        problemCode: input.problem.code,
        tags: [...input.problem.tags],
        rating: input.problem.rating,
        createdAt: now.toISOString(),
        reviewAt: null,
        reviewCount: 0,
        cfHandle: profile.handle,
        cfKey: input.problem.key,
      };
      problems.push(problem);
    } else {
      // A missing upstream rating or tags must not erase useful stored metadata.
      if (input.problem.rating !== null) problem.rating = input.problem.rating;
      if (input.problem.tags.length) problem.tags = [...input.problem.tags];
    }
    const existing = submissions.find(
      (s) => s.id === input.id && handleKey(s.handle) === handleKey(handle),
    );
    if (existing) {
      existing.verdict = input.verdict;
      existing.language = input.language;
      continue;
    }
    const sub = {
      id: input.id,
      handle: profile.handle,
      problemId,
      submittedAt: input.submittedAt,
      verdict: input.verdict,
      language: input.language,
    };
    const groups = attempts.filter((a) => a.problemId === problemId);
    const boundary = (a: ImportedAttempt, last: boolean) =>
      submissions.find(
        (s) =>
          s.id === (last ? a.submissionIds.at(-1) : a.submissionIds[0]) &&
          handleKey(s.handle) === handleKey(handle),
      );
    // Same problem, <=2h between submissions; an accepted submission closes an
    // attempt. Older pagination can prepend related failures to a saved anchor.
    // Existing memberships remain stable when pending verdicts change later.
    const before = groups
      .filter(
        (a) =>
          a.lastSubmittedAt <= sub.submittedAt &&
          Date.parse(sub.submittedAt) - Date.parse(a.lastSubmittedAt) <=
            7200000 &&
          boundary(a, true)?.verdict !== "OK",
      )
      .sort((a, b) => b.lastSubmittedAt.localeCompare(a.lastSubmittedAt))[0];
    const after = groups
      .filter(
        (a) =>
          a.firstSubmittedAt > sub.submittedAt &&
          Date.parse(a.firstSubmittedAt) - Date.parse(sub.submittedAt) <=
            7200000 &&
          sub.verdict !== "OK",
      )
      .sort((a, b) => a.firstSubmittedAt.localeCompare(b.firstSubmittedAt))[0];
    let group = before ?? after;
    if (!group) {
      group = {
        id: `cf-attempt:${handleKey(handle)}:${sub.id}`,
        handle: profile.handle,
        problemId,
        submissionIds: [],
        firstSubmittedAt: sub.submittedAt,
        lastSubmittedAt: sub.submittedAt,
        inbox: false,
        skipped: false,
        wasRevisit:
          !!problem.reviewAt &&
          sub.submittedAt >
            (cf.reflections
              .filter((r) =>
                attempts.some(
                  (a) => a.id === r.attemptId && a.problemId === problemId,
                ),
              )
              .map((r) => r.savedAt)
              .sort()
              .at(-1) ?? now.toISOString()),
      };
      attempts.push(group);
    }
    submissions.push(sub);
    group.submissionIds.push(sub.id);
    group.submissionIds.sort((a, b) => {
      const x = submissions.find(
        (s) => s.id === a && s.problemId === problemId,
      )!;
      const y = submissions.find(
        (s) => s.id === b && s.problemId === problemId,
      )!;
      return x.submittedAt.localeCompare(y.submittedAt) || a - b;
    });
    group.firstSubmittedAt = [
      group.firstSubmittedAt,
      sub.submittedAt,
    ].sort()[0];
    group.lastSubmittedAt = [group.lastSubmittedAt, sub.submittedAt]
      .sort()
      .at(-1)!;
  }
  const last = pages.at(-1)!;
  const reachedEnd = last.submissions.length < last.count;
  const addedNewer = inputs.filter((s) => s.id > priorNewest).length;
  const previousCoverage = storedCoverage(profile, [...known]);
  const coverage = mergeCoverage([
    ...previousCoverage,
    ...fetchedCoverage(pages),
  ]);
  // A zero-result request proves the end only when the preceding cursor anchor
  // was fetched in this same transaction (or the whole profile is empty).
  const priorAnchor = profile.gapUntilId
    ? (profile.gapAnchorId ?? previousCoverage[0]?.oldestId)
    : (profile.historyAnchorId ?? previousCoverage.at(-1)?.oldestId);
  if (
    reachedEnd &&
    !last.submissions.length &&
    priorAnchor &&
    inputs.some((s) => s.id === priorAnchor)
  ) {
    const tail = coverage.find(
      (range) => range.newestId >= priorAnchor && range.oldestId <= priorAnchor,
    );
    if (tail) tail.complete = true;
  }
  const gapUntilId = coverage.length > 1 ? coverage[1].newestId : null;
  const hasHistory = coverage.length > 0;
  const historyComplete = hasHistory
    ? coverage.length === 1 && coverage[0].complete
    : reachedEnd && pages[0].from === 1;
  const historicalTail = coverage.at(-1);
  const recentTail = coverage[0];
  let nextFrom = profile.nextFrom;
  let gapNextFrom = profile.gapNextFrom ?? null;
  if (kind === "refresh") {
    // Recent requests never reset the historical backfill cursor.
    nextFrom = profile.lastSyncAt
      ? profile.nextFrom + addedNewer
      : last.from + last.submissions.length;
    if (gapUntilId) {
      const priorGapAnchor =
        profile.gapAnchorId ?? previousCoverage[0]?.oldestId;
      const sameAnchor = priorGapAnchor === recentTail.oldestId;
      gapNextFrom =
        sameAnchor && profile.gapNextFrom
          ? profile.gapNextFrom + addedNewer
          : last.from + last.submissions.length;
    } else gapNextFrom = null;
  } else if (profile.gapUntilId) {
    gapNextFrom = gapUntilId ? last.from + last.submissions.length : null;
    // Filling the recent gap must not reset an independent historical cursor.
  } else nextFrom = last.from + last.submissions.length;
  const value: SyncedProfile = {
    ...profile,
    lastSyncAt: now.toISOString(),
    nextFrom: Math.max(1, nextFrom),
    historyComplete,
    gapUntilId,
    coverage,
    historyAnchorId: historicalTail?.oldestId ?? null,
    gapAnchorId: gapUntilId ? recentTail.oldestId : null,
    gapNextFrom: gapNextFrom === null ? null : Math.max(1, gapNextFrom),
  };
  const merged = {
    ...data,
    problems,
    codeforces: {
      ...cf,
      submissions,
      practiceAttempts: attempts,
      profiles: cf.profiles.map((p) =>
        handleKey(p.handle) === handleKey(handle) ? value : p,
      ),
    },
  };
  return kind === "refresh" ? ensureDailyReflectionBatch(merged, now) : merged;
}

export function profileActivity(data: Data, handle: string) {
  return data.codeforces.practiceAttempts
    .filter((a) => handleKey(a.handle) === handleKey(handle))
    .sort(
      (a, b) =>
        b.lastSubmittedAt.localeCompare(a.lastSubmittedAt) ||
        b.id.localeCompare(a.id),
    );
}
/** The complete unreflected history remains in Activity; this is today's small commitment. */
export function dailyReflectionBatch(
  data: Data,
  handle: string,
  now = new Date(),
): ImportedAttempt[] {
  const date = localDate(now);
  return profileActivity(data, handle)
    .filter(
      (attempt) =>
        attempt.batchDate === date &&
        !attempt.skipped &&
        !practiceReflectionFor(data, attempt.id),
    )
    .slice(0, CF_INBOX_SIZE);
}
export function dailyReflectionCounts(
  data: Data,
  handle: string,
  now = new Date(),
) {
  const date = localDate(now);
  const activity = profileActivity(data, handle);
  const assigned = activity.filter((attempt) => attempt.batchDate === date);
  return {
    total: assigned.length,
    pending: dailyReflectionBatch(data, handle, now).length,
    unreflected: activity.filter(
      (attempt) => !practiceReflectionFor(data, attempt.id),
    ).length,
  };
}

/** Assign once per local calendar day. Saving or skipping never refills the batch. */
export function ensureDailyReflectionBatch(data: Data, now = new Date()): Data {
  const handle = data.codeforces.connectedHandle;
  if (!handle) return data;
  const date = localDate(now);
  const activity = profileActivity(data, handle);
  const existing = activity.filter((attempt) => attempt.batchDate === date);
  const selected = existing.length
    ? existing
    : activity
        .filter(
          (attempt) =>
            !attempt.skipped && !practiceReflectionFor(data, attempt.id),
        )
        .slice(0, CF_INBOX_SIZE);
  const selectedIds = new Set(selected.map((attempt) => attempt.id));
  let changed = false;
  const practiceAttempts = data.codeforces.practiceAttempts.map((attempt) => {
    if (handleKey(attempt.handle) !== handleKey(handle)) return attempt;
    const assigned = selectedIds.has(attempt.id);
    const inbox =
      assigned && !attempt.skipped && !practiceReflectionFor(data, attempt.id);
    const batchDate = assigned ? date : attempt.batchDate;
    if (attempt.inbox === inbox && attempt.batchDate === batchDate)
      return attempt;
    changed = true;
    return { ...attempt, inbox, ...(batchDate ? { batchDate } : {}) };
  });
  return changed
    ? { ...data, codeforces: { ...data.codeforces, practiceAttempts } }
    : data;
}

export function reflectionFor(data: Data, id: string) {
  return data.codeforces.reflections.find((r) => r.attemptId === id);
}
/** Use the reflection source explicitly selected for a linked attempt. */
export function practiceReflectionFor(
  data: Data,
  id: string,
): QuickReflection | undefined {
  const link = data.learningLinks?.find(
    (value) => value.importedAttemptId === id,
  );
  if (link?.reflectionSource === "timed") {
    const timed = data.attempts.find(
      (attempt) => attempt.id === link.timedAttemptId,
    );
    if (timed)
      return {
        attemptId: id,
        outcome: timed.outcome,
        difficulty: timed.difficulty,
        takeaway: timed.takeaway,
        savedAt: timed.completedAt,
      };
  }
  return reflectionFor(data, id);
}
export function latestSubmission(data: Data, attempt: ImportedAttempt) {
  return data.codeforces.submissions
    .filter(
      (s) =>
        handleKey(s.handle) === handleKey(attempt.handle) &&
        attempt.submissionIds.includes(s.id),
    )
    .sort(
      (a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id - a.id,
    )[0];
}
export function profileStats(
  data: Data,
  handle: string,
  sinceAt: string | null = null,
) {
  const submissions = data.codeforces.submissions.filter(
    (s) =>
      handleKey(s.handle) === handleKey(handle) &&
      (!sinceAt || s.submittedAt > sinceAt),
  );
  const attempts = profileActivity(data, handle);
  const reflected = attempts.flatMap((a) => {
    const r = practiceReflectionFor(data, a.id);
    return r ? [{ ...r, wasRevisit: a.wasRevisit }] : [];
  });
  return {
    submissions: submissions.length,
    accepted: new Set(
      submissions.filter((s) => s.verdict === "OK").map((s) => s.problemId),
    ).size,
    reflected: reflected.length,
    independent: reflected.filter((r) => r.outcome === "independent").length,
    assisted: reflected.filter(
      (r) => r.outcome === "hint" || r.outcome === "editorial",
    ).length,
    revisits: reflected.filter(
      (r) => r.wasRevisit && r.outcome === "independent",
    ).length,
    pending: attempts.filter(
      (a) => a.inbox && !a.skipped && !practiceReflectionFor(data, a.id),
    ).length,
    unreflected: attempts.filter((a) => !practiceReflectionFor(data, a.id))
      .length,
  };
}
export function relevantSchedule(
  data: Data,
  attempt: ImportedAttempt,
): boolean {
  const linkedTimedId = data.learningLinks?.find(
    (link) => link.importedAttemptId === attempt.id,
  )?.timedAttemptId;
  const importedIsOlder = profileActivity(data, attempt.handle).some(
    (activity) =>
      activity.problemId === attempt.problemId &&
      Date.parse(activity.lastSubmittedAt) >
        Date.parse(attempt.lastSubmittedAt) &&
      reflectionFor(data, activity.id),
  );
  const timedIsNewer = data.attempts.some(
    (timed) =>
      timed.problemId === attempt.problemId &&
      timed.id !== linkedTimedId &&
      Date.parse(timed.completedAt) > Date.parse(attempt.lastSubmittedAt),
  );
  return !importedIsOlder && !timedIsNewer;
}
export function proposedReview(
  data: Data,
  problem: Problem,
  outcome: Outcome,
  now = new Date(),
): string | null {
  if (outcome === "independent") return null;
  return localDate(addDays(now, data.settings.reviewDays[outcome]));
}
export function saveQuickReflection(
  data: Data,
  id: string,
  input: Omit<QuickReflection, "attemptId" | "savedAt"> & {
    reviewAt: string | null;
    overrideSchedule: boolean;
  },
  now = new Date(),
): Data {
  const attempt = data.codeforces.practiceAttempts.find((a) => a.id === id);
  if (!attempt) throw new Error("This activity is no longer available.");
  const problem = data.problems.find((p) => p.id === attempt.problemId)!;
  const previous = reflectionFor(data, id);
  const reflection = {
    attemptId: id,
    outcome: input.outcome,
    difficulty: input.difficulty,
    takeaway: input.takeaway.trim(),
    savedAt: now.toISOString(),
  };
  const afterCompletion =
    !problem.reviewCompletedAt ||
    Date.parse(attempt.firstSubmittedAt) >
      Date.parse(problem.reviewCompletedAt);
  const newPracticeAfterCompletion =
    !!problem.reviewCompletedAt && afterCompletion && !problem.reviewAt;
  const canSchedule =
    relevantSchedule(data, attempt) &&
    (afterCompletion || input.overrideSchedule) &&
    (!problem.reviewManual ||
      input.overrideSchedule ||
      newPracticeAfterCompletion);
  return {
    ...data,
    problems: data.problems.map((p) =>
      p.id === problem.id && canSchedule
        ? {
            ...p,
            reviewAt: input.reviewAt,
            reviewCount:
              input.outcome === "independent" && input.reviewAt
                ? previous
                  ? p.reviewCount
                  : p.reviewCount + 1
                : 0,
            reviewAttemptId: id,
            reviewManual: input.overrideSchedule,
          }
        : p,
    ),
    codeforces: {
      ...data.codeforces,
      reflections: [
        ...data.codeforces.reflections.filter((r) => r.attemptId !== id),
        reflection,
      ],
      practiceAttempts: data.codeforces.practiceAttempts.map((a) =>
        a.id === id
          ? {
              ...a,
              inbox: false,
              skipped: false,
              wasRevisit: previous
                ? a.wasRevisit
                : a.wasRevisit ||
                  (!previous &&
                    !!problem.reviewAt &&
                    !!problem.reviewAttemptId &&
                    data.codeforces.reflections.some(
                      (r) =>
                        r.attemptId === problem.reviewAttemptId &&
                        r.attemptId !== id &&
                        r.savedAt < attempt.firstSubmittedAt,
                    )),
            }
          : a,
      ),
    },
  };
}
export function skipReflection(data: Data, id: string): Data {
  return {
    ...data,
    codeforces: {
      ...data.codeforces,
      practiceAttempts: data.codeforces.practiceAttempts.map((a) =>
        a.id === id ? { ...a, skipped: true, inbox: false } : a,
      ),
    },
  };
}
export function relativeTime(stamp: string, now = new Date()) {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(stamp)) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  const days = Math.floor(minutes / 1440);
  return days < 7
    ? `${days}d ago`
    : new Date(stamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}
export function verdictLabel(verdict: string | null) {
  if (verdict === "OK") return "Accepted";
  if (!verdict || ["TESTING", "SUBMITTED"].includes(verdict)) return "Judging";
  return verdict
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}

export function withCodeforcesDemo(data: Data, now = new Date()): Data {
  if (data.codeforces.profiles.length) return data;
  let demo = connectProfile(
    data,
    { handle: "forma_demo", rating: null, rank: null },
    now,
  );
  const make = (
    id: number,
    key: string,
    title: string,
    days: number,
    verdict: string,
    minutes = 0,
  ): SubmissionInput => ({
    id,
    submittedAt: new Date(
      addDays(now, days).getTime() + minutes * 60000,
    ).toISOString(),
    verdict,
    language: "GNU C++20",
    problem: {
      key: `contest:${key}`,
      title,
      code: key.replace(":", ""),
      url: `https://codeforces.com/problemset/problem/${key.replace(":", "/")}`,
      rating: 1200,
      tags: ["implementation", "greedy"],
    },
  });
  demo = mergeActivity(
    demo,
    "forma_demo",
    [
      {
        handle: "forma_demo",
        from: 1,
        count: 50,
        submissions: [
          make(9001, "4:A", "Watermelon", -2, "WRONG_ANSWER"),
          make(9002, "4:A", "Watermelon", -2, "OK", 15),
          make(9003, "189:A", "Cut Ribbon", -1, "OK"),
          make(9004, "455:A", "Boredom", 0, "TESTING", -20),
        ],
      },
    ],
    "refresh",
    now,
  );
  return demo;
}
