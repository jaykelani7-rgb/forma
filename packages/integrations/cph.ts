import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeCodeforcesIdentity } from "../../src/lib/codeforces-identity";

export const CPH_EXTENSION_ID = "divyanshuagrawal.competitive-programming-helper";
export const SUPPORTED_CPH_VERSIONS = ["2026.10.1792170155"] as const;
export const MAX_CPH_METADATA_BYTES = 1024 * 1024;
export type CphBinding = { url: string; title: string; problemKey: string; fileUri: string; source: "cph"; adapterVersion: string; confidence: "metadata" };
export type CphResult = { ok: true; binding: CphBinding } | { ok: false; reason: "unsupported-version" | "invalid-metadata" | "outside-permitted-folder" | "missing" | "oversized" };

export function pathWithinFolder(file: string, folder: string): boolean {
  const relative = path.relative(path.resolve(folder), path.resolve(file));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** The inspected CPH version hashes the complete source path; no name guessing. */
export function cphMetadataPath(solutionPath: string, configuredSaveLocation = ""): string {
  const file = `.${path.basename(solutionPath)}_${createHash("md5").update(solutionPath).digest("hex")}.prob`;
  return path.join(configuredSaveLocation || path.join(path.dirname(solutionPath), ".cph"), file);
}

export function parseCphMetadata(value: unknown, solutionPath: string, version: string): CphResult {
  if (!SUPPORTED_CPH_VERSIONS.includes(version as typeof SUPPORTED_CPH_VERSIONS[number])) return { ok: false, reason: "unsupported-version" };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, reason: "invalid-metadata" };
  const record = value as Record<string, unknown>;
  if (typeof record.srcPath !== "string" || !path.isAbsolute(record.srcPath) || path.normalize(record.srcPath) !== path.normalize(solutionPath) || typeof record.name !== "string" || !record.name.trim() || record.name.length > 500 || typeof record.url !== "string" || record.url.length > 2048 || !/^https?:\/\//.test(record.url) || !Array.isArray(record.tests) || record.tests.length > 10000 || record.local === true) return { ok: false, reason: "invalid-metadata" };
  const identity = normalizeCodeforcesIdentity({ url: record.url });
  if (!identity) return { ok: false, reason: "invalid-metadata" };
  return { ok: true, binding: { url: identity.url, title: record.name.trim(), problemKey: identity.key, fileUri: pathToFileURL(solutionPath).toString(), source: "cph", adapterVersion: version, confidence: "metadata" } };
}

/** Reads one exact metadata file only. Never reads or writes solution contents. */
export async function readCphBinding(options: { solutionPath: string; version: string; permittedFolders: string[]; saveLocation?: string }): Promise<CphResult> {
  if (!SUPPORTED_CPH_VERSIONS.includes(options.version as typeof SUPPORTED_CPH_VERSIONS[number])) return { ok: false, reason: "unsupported-version" };
  let handle;
  try {
    const source = await realpath(options.solutionPath);
    const metadata = cphMetadataPath(options.solutionPath, options.saveLocation);
    const actualMetadata = await realpath(metadata);
    const roots = await Promise.all(options.permittedFolders.map((folder) => realpath(folder)));
    if (!roots.some((folder) => pathWithinFolder(source, folder)) || !roots.some((folder) => pathWithinFolder(actualMetadata, folder))) return { ok: false, reason: "outside-permitted-folder" };
    handle = await open(metadata, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile()) return { ok: false, reason: "invalid-metadata" };
    if (stat.size > MAX_CPH_METADATA_BYTES) return { ok: false, reason: "oversized" };
    const buffer = Buffer.alloc(MAX_CPH_METADATA_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_CPH_METADATA_BYTES) return { ok: false, reason: "oversized" };
    return parseCphMetadata(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")), options.solutionPath, options.version);
  } catch (error) {
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid-metadata" };
  } finally { await handle?.close(); }
}
