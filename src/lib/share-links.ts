import { canonicalSharedTrack, type SharedTrackFile } from "./shared-tracks";

export const SHARE_TOKEN = /^[a-f0-9]{64}$/;
export const SHARE_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export interface OwnedShare {
  id: string;
  token: string;
  title: string;
  publishedAt: string;
  revokedAt: string | null;
}
export interface Publication {
  share: OwnedShare;
  replayed: boolean;
}
export function ownedShare(value: unknown): OwnedShare {
  if (!value || typeof value !== "object")
    throw new Error("Invalid share response.");
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !SHARE_ID.test(row.id) ||
    typeof row.token !== "string" ||
    !SHARE_TOKEN.test(row.token) ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    row.title.length > 240 ||
    typeof row.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(row.publishedAt)) ||
    !(
      row.revokedAt === null ||
      (typeof row.revokedAt === "string" &&
        Number.isFinite(Date.parse(row.revokedAt)))
    )
  )
    throw new Error("Invalid share response.");
  return {
    id: row.id,
    token: row.token,
    title: row.title,
    publishedAt: row.publishedAt,
    revokedAt: row.revokedAt as string | null,
  };
}
export function publicShare(value: unknown): SharedTrackFile {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).some((key) => key !== "file")
  )
    throw new Error("This shared track is unavailable.");
  return canonicalSharedTrack((value as { file: unknown }).file);
}
export function sharePath(token: string) {
  if (!SHARE_TOKEN.test(token)) throw new Error("Invalid share link.");
  return `/share/${token}`;
}
