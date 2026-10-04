import { CodeforcesError, fetchActivityTransaction } from "./codeforces-api";
import {
  ActivityPage,
  CF_PAGE_SIZE,
  PublicProfile,
  SyncedProfile,
} from "./codeforces-types";

export async function codeforcesRequest<T>(
  action: "profile" | "activity",
  handle: string,
  from = 1,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const params = new URLSearchParams({
      action,
      handle,
      ...(action === "activity" ? { from: String(from) } : {}),
    });
    const response = await fetch(`/api/codeforces?${params}`, {
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(35000)])
        : AbortSignal.timeout(35000),
    });
    const body = await response.json();
    if (!response.ok)
      throw new CodeforcesError(
        body.error ?? "Activity could not be read.",
        body.code ?? "temporary",
        response.status,
      );
    return body as T;
  } catch (error) {
    if (error instanceof CodeforcesError) throw error;
    throw new CodeforcesError(
      "The sync service could not be reached. Your saved activity is still available.",
      "temporary",
    );
  }
}

export const previewPublicProfile = (handle: string, signal?: AbortSignal) =>
  codeforcesRequest<PublicProfile>("profile", handle, 1, signal);
/** Kept for callers importing the original bounded recent-activity helper. */
export const collectActivity = (
  handle: string,
  nextFrom: number,
  newestId: number,
  older: boolean,
  signal?: AbortSignal,
) =>
  fetchActivityTransaction(handle, nextFrom, newestId, older, (h, from) =>
    codeforcesRequest<ActivityPage>("activity", h, from, signal),
  );

export const PROFILE_REFRESH_MS = 24 * 60 * 60 * 1000;
export function profileMetadataDue(
  profile: SyncedProfile,
  now = new Date(),
): boolean {
  return (
    !profile.profileUpdatedAt ||
    now.getTime() - Date.parse(profile.profileUpdatedAt) >= PROFILE_REFRESH_MS
  );
}

export interface ActivityTransaction {
  pages: ActivityPage[];
  profile: PublicProfile | null;
  profileWarning: string | null;
}
interface SyncRequests {
  activity: (handle: string, from: number) => Promise<ActivityPage>;
  profile: (handle: string) => Promise<PublicProfile>;
}

/**
 * Backfill seeks a stable submission identity rather than trusting an API offset.
 * A recent head probe catches moving offsets. At most three overlapping backfill
 * pages are fetched; if a burst moved the anchor farther away, saved search
 * progress continues on the next explicit request. Coverage stays incomplete
 * until the fetched windows actually join.
 */
export async function collectProfileActivity(
  profile: SyncedProfile,
  newestId: number,
  older: boolean,
  signal?: AbortSignal,
  requests: SyncRequests = {
    activity: (handle, from) =>
      codeforcesRequest<ActivityPage>("activity", handle, from, signal),
    profile: (handle) => previewPublicProfile(handle, signal),
  },
  now = new Date(),
): Promise<ActivityTransaction> {
  const pages: ActivityPage[] = [];
  if (!older) {
    pages.push(
      ...(await fetchActivityTransaction(
        profile.handle,
        profile.nextFrom,
        newestId,
        false,
        requests.activity,
      )),
    );
  } else {
    const head = await requests.activity(profile.handle, 1);
    pages.push(head);
    const anchor = profile.gapUntilId
      ? profile.gapAnchorId
      : profile.historyAnchorId;
    const cursor = profile.gapUntilId
      ? (profile.gapNextFrom ?? profile.nextFrom)
      : profile.nextFrom;
    let from = Math.max(1, cursor - 10);
    for (let index = 0; index < 3; index++) {
      const page =
        from === 1 ? head : await requests.activity(profile.handle, from);
      if (page !== head) pages.push(page);
      if (
        page.submissions.length < page.count ||
        !anchor ||
        page.submissions.some((submission) => submission.id <= anchor)
      )
        break;
      from += Math.max(1, CF_PAGE_SIZE - 10);
    }
  }
  let metadata: PublicProfile | null = null;
  let profileWarning: string | null = null;
  if (!older && profileMetadataDue(profile, now)) {
    try {
      metadata = await requests.profile(profile.handle);
    } catch {
      if (signal?.aborted)
        throw new CodeforcesError(
          "The sync was cancelled. Saved activity is unchanged.",
          "temporary",
        );
      profileWarning =
        "Activity was imported; profile metadata could not be refreshed. The displayed rating remains from its previous profile check.";
    }
  }
  return { pages, profile: metadata, profileWarning };
}

export interface SyncState {
  busy: boolean;
  phase: "preview" | "refresh" | "older" | null;
  error: string | null;
  code: string | null;
}
export const idleSync: SyncState = {
  busy: false,
  phase: null,
  error: null,
  code: null,
};
