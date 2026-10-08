export interface CodeforcesIdentity {
  key: string;
  code: string;
  url: string;
}

/** Only a supported URL or an explicit contest/index code supplies identity.
 * Titles and ratings never participate. C1 and C2 remain distinct indices. */
export function normalizeCodeforcesIdentity(
  input: string | { url?: string; code?: string },
): CodeforcesIdentity | null {
  const rawUrl =
    typeof input === "string" ? input.trim() : (input.url?.trim() ?? "");
  let contest = "",
    index = "",
    gym = false;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (
        ["https:", "http:"].includes(parsed.protocol) &&
        /^(www\.)?codeforces\.com$/i.test(parsed.hostname) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port
      ) {
        const match = parsed.pathname.match(
          /^\/(?:problemset\/problem\/(\d+)\/([A-Za-z]\d*)|(?:contest|gym)\/(\d+)\/problem\/([A-Za-z]\d*))\/?$/,
        );
        if (match) {
          contest = match[1] ?? match[3];
          index = (match[2] ?? match[4]).toUpperCase();
          gym = parsed.pathname.startsWith("/gym/");
        }
      }
    } catch {
      /* An explicit code may still resolve the row. */
    }
  }
  if (!contest) {
    const rawCode =
      typeof input === "string" ? input.trim() : (input.code?.trim() ?? "");
    const match = rawCode.match(
      /^(?:(CF|Codeforces|Gym)\s*)?(\d{1,9})[\s\/-]*([A-Za-z]\d*)$/i,
    );
    if (!match) return null;
    gym = match[1]?.toLowerCase() === "gym";
    contest = match[2];
    index = match[3].toUpperCase();
  }
  const numeric = Number(contest);
  if (
    !Number.isSafeInteger(numeric) ||
    numeric < 1 ||
    numeric > 999999999 ||
    index.length > 10
  )
    return null;
  contest = String(numeric);
  return {
    key: `${gym ? "gym" : "contest"}:${contest}:${index}`,
    code: `${contest}${index}`,
    url: gym
      ? `https://codeforces.com/gym/${contest}/problem/${index}`
      : `https://codeforces.com/problemset/problem/${contest}/${index}`,
  };
}

/** Resolve legacy Gym keys from their explicit URL without rewriting saved records. */
export function canonicalProblemIdentity(problem: {
  platform: string;
  url: string;
  problemCode?: string;
  cfKey?: string;
}): string | undefined {
  const identity = normalizeCodeforcesIdentity({
    url: problem.url,
    code:
      problem.platform.toLowerCase() === "codeforces"
        ? problem.problemCode
        : "",
  });
  if (problem.cfKey && identity && problem.cfKey !== identity.key) {
    if (
      identity.key.startsWith("gym:") &&
      problem.cfKey === identity.key.replace(/^gym:/, "contest:")
    )
      return identity.key;
    return undefined;
  }
  return identity?.key ?? problem.cfKey;
}
