import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CPH_EXTENSION_ID, SUPPORTED_CPH_VERSIONS, cphMetadataPath, parseCphMetadata, pathWithinFolder, readCphBinding } from "../packages/integrations/cph";
import { BoundedJsonLines, MAX_MESSAGE_BYTES, defaultCompanionEndpoint, encodeTransportMessage, parseTransportRequest, parseTransportResponse } from "../packages/integrations/protocol";
import { enqueueCommand, MAX_QUEUED_COMMANDS, restoreQueue, retryCommand } from "../packages/integrations/queue";
import { attributeSubmission, parseVerifiedCodeforcesPage, reconcileSubmissionVerdict } from "../packages/integrations/codeforces";
import { parseCommand } from "../packages/contracts/src";
import { CompanionStore } from "../apps/desktop/main/store";

const version = SUPPORTED_CPH_VERSIONS[0];
const metadata = (source: string, url = "https://codeforces.com/contest/100/problem/A1") => ({ name: "A1. Example", url, srcPath: source, tests: [{ id: 1, input: "1", output: "1" }], interactive: false, memoryLimit: 256, timeLimit: 1000 });

test("CPH adapter resolves the inspected version's exact source-path mapping without inferring a solve", () => {
  const source = "/permitted/solution.cpp";
  assert.equal(CPH_EXTENSION_ID, "divyanshuagrawal.competitive-programming-helper");
  assert.equal(cphMetadataPath(source), path.join("/permitted/.cph", `.solution.cpp_${createHash("md5").update(source).digest("hex")}.prob`));
  const result = parseCphMetadata(metadata(source), source, version);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.binding.problemKey, "contest:100:A1");
    assert.equal(result.binding.fileUri, "file:///permitted/solution.cpp");
    assert.equal("localTests" in result.binding, false);
    assert.equal("outcome" in result.binding, false);
  }
  assert.deepEqual(parseCphMetadata(metadata(source), source, "future-version"), { ok: false, reason: "unsupported-version" });
  assert.equal(parseCphMetadata(metadata("/other/solution.cpp"), source, version).ok, false);
  assert.equal(parseCphMetadata({ ...metadata(source), local: true }, source, version).ok, false);
  assert.equal(parseCphMetadata({ ...metadata(source), url: "https://codeforces.com.evil.test/contest/100/problem/A" }, source, version).ok, false);
  assert.equal(parseCphMetadata({ ...metadata(source), url: "100A1" }, source, version).ok, false);
  assert.equal(parseCphMetadata({ ...metadata(source), srcPath: undefined }, source, version).ok, false);
  assert.equal(pathWithinFolder("/workspace-other/solution.cpp", "/workspace"), false);
});

test("CPH bounded reader rejects symlink escape, oversized files and disabled versions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "forma-cph-"));
  try {
    const source = path.join(directory, "solution.cpp");
    await writeFile(source, "private source never leaves this file");
    await mkdir(path.join(directory, ".cph"));
    const target = cphMetadataPath(source);
    await writeFile(target, JSON.stringify(metadata(source)));
    assert.equal((await readCphBinding({ solutionPath: source, version, permittedFolders: [directory] })).ok, true);
    assert.deepEqual(await readCphBinding({ solutionPath: source, version, permittedFolders: [path.join(directory, "no-permission")] }), { ok: false, reason: "missing" });
    await writeFile(target, "x".repeat(1024 * 1024 + 1));
    assert.deepEqual(await readCphBinding({ solutionPath: source, version, permittedFolders: [directory] }), { ok: false, reason: "oversized" });
    await rm(target);
    await symlink(source, target);
    assert.deepEqual(await readCphBinding({ solutionPath: source, version, permittedFolders: [directory] }), { ok: false, reason: "invalid-metadata" });
    assert.deepEqual(await readCphBinding({ solutionPath: source, version: "unknown", permittedFolders: [directory] }), { ok: false, reason: "unsupported-version" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("integration framing handles UTF-8 chunk boundaries and rejects malformed or oversized input", () => {
  const request = { version: 1 as const, id: "request-1", credential: "x".repeat(64), command: { id: "stable-id", type: "thought", payload: { text: "A thought 🌿" }, expectedProblemKey: "gym:100:A2", expectedSessionId: "companion:session", occurredAt: new Date().toISOString() } };
  const bytes = Buffer.from(encodeTransportMessage(request));
  const parser = new BoundedJsonLines();
  const split = bytes.indexOf(Buffer.from("🌿")) + 1;
  assert.deepEqual(parser.push(bytes.subarray(0, split)), []);
  const lines = parser.push(bytes.subarray(split));
  assert.deepEqual(parseTransportRequest(lines[0]), request);
  assert.throws(() => parseTransportRequest(JSON.stringify({ ...request, version: 2 })), /version/);
  assert.throws(() => parseTransportRequest(JSON.stringify({ ...request, action: "open" })), /action/);
  assert.throws(() => parseTransportRequest(JSON.stringify({ ...request, credential: "short" })), /envelope/);
  assert.throws(() => parseTransportRequest(JSON.stringify({ ...request, executable: "run" })), /Unexpected/);
  assert.throws(() => parseTransportRequest(JSON.stringify({ ...request, command: { ...request.command, occurredAt: "invalid" } })), /envelope/);
  assert.throws(() => new BoundedJsonLines().push(Buffer.alloc(MAX_MESSAGE_BYTES + 1, 65)), /64 KiB/);
  assert.throws(() => encodeTransportMessage({ ...request, command: { ...request.command, payload: { text: "a".repeat(MAX_MESSAGE_BYTES) } } }), /64 KiB/);
  assert.throws(() => parseTransportResponse(JSON.stringify({ version: 1, id: "other", ok: true, revision: 3 }), request.id), /acknowledgement/);
  assert.throws(() => parseTransportResponse(JSON.stringify({ version: 1, id: request.id, ok: true }), request.id), /acknowledgement/);
  assert.equal(parseTransportResponse(JSON.stringify({ version: 1, id: request.id, ok: true, revision: 3 }), request.id).ok, true);
});

test("runtime endpoints are user scoped and the offline queue retains stable IDs through bounded retries", () => {
  assert.equal(defaultCompanionEndpoint({ platform: "darwin", home: "/Users/test" }), "/Users/test/Library/Application Support/Forma Companion/runtime/companion.sock");
  assert.equal(defaultCompanionEndpoint({ platform: "linux", runtimeDirectory: "/run/user/1000" }), "/run/user/1000/forma-companion/companion.sock");
  assert.notEqual(defaultCompanionEndpoint({ platform: "win32", userIdentity: "user-a" }), defaultCompanionEndpoint({ platform: "win32", userIdentity: "user-b" }));
  const command = { id: "stable", type: "thought", payload: { text: "preserve me" }, occurredAt: new Date().toISOString() };
  const initial = enqueueCommand([], command, 1000);
  assert.equal(enqueueCommand(initial, command, 2000), initial);
  const retried = retryCommand(initial[0], 2000);
  assert.equal(retried.command.id, command.id);
  assert.equal(retried.command.occurredAt, command.occurredAt);
  assert.equal(retried.nextAttemptAt, 3000);
  assert.equal(retryCommand({ ...retried, attempts: 1000 }, 3000).nextAttemptAt, 63000);
  assert.deepEqual(restoreQueue(JSON.parse(JSON.stringify([retried]))), [retried]);
  assert.throws(() => restoreQueue([retried, retried]), /recovery/);
  assert.throws(() => enqueueCommand(Array.from({ length: MAX_QUEUED_COMMANDS }, (_, index) => ({ ...initial[0], command: { ...command, id: `id-${index}` } })), command, 2000), /full/);
});

test("delayed captures retain occurrence and receipt times while live timers use host application time", () => {
  const store = new CompanionStore(":memory:");
  const received = Date.now();
  const occurredAt = new Date(received - 3600000).toISOString();
  try {
    store.command({ id: "timestamp-attach", type: "attach", payload: { url: "https://codeforces.com/contest/100/problem/A1" }, occurredAt }, "vscode", received);
    const command = { id: "timestamp-start", type: "start", payload: {}, occurredAt };
    const queue = restoreQueue(JSON.parse(JSON.stringify(enqueueCommand([], command, received - 3600000))));
    const saved = store.command(queue[0].command, "vscode", received);
    const receipt = JSON.parse(String(store.db.prepare("SELECT body FROM observations WHERE id=?").get(command.id)!.body));
    assert.equal(receipt.occurredAt, occurredAt);
    assert.equal(receipt.receivedAt, new Date(received).toISOString());
    assert.equal(saved.data.session!.runningSince, received);
    assert.equal(saved.data.session!.elapsedMs, 0);
    assert.equal(store.command(queue[0].command, "vscode", received + 10000).revision, saved.revision);
    assert.throws(() => parseCommand({ ...command, occurredAt: new Date(received + 86400000).toISOString() }), /time|future/i);
  } finally { store.close(); }
});

const rawSubmission = (overrides: Record<string, unknown> = {}) => ({ id: 123, creationTimeSeconds: Date.parse("2026-10-19T10:01:00Z") / 1000, contestId: 100, problem: { contestId: 100, index: "A2", name: "Example", tags: [] }, author: { contestId: 100, members: [{ handle: "tourist" }], participantType: "PRACTICE" }, programmingLanguage: "GNU C++20", verdict: "OK", ...overrides });
const parse = (raw: unknown) => parseVerifiedCodeforcesPage(raw, { handle: "Tourist", observedAt: "2026-10-19T10:05:00Z", namespaceForContest: (id) => id === 100 ? "contest" : null });

test("Codeforces evidence verifies actual author, full problem identity and platform time", () => {
  const [observation] = parse([rawSubmission()]);
  assert.equal(observation.submission.problem.key, "contest:100:A2");
  assert.equal(observation.submission.submittedAt, "2026-10-19T10:01:00.000Z");
  assert.equal("learning" in observation, false);
  assert.throws(() => parse([rawSubmission({ author: { members: [{ handle: "someone_else" }] } })]), /author/);
  assert.throws(() => parse([rawSubmission({ author: { ghost: true, members: [{ handle: "Tourist" }] } })]), /author/);
  assert.throws(() => parse([rawSubmission({ problem: { contestId: 100001, index: "A2", name: "Gym", tags: [] } })]), /Conflicting/);
  assert.throws(() => parseVerifiedCodeforcesPage([rawSubmission()], { handle: "tourist", observedAt: "2026-10-19T10:05:00Z", namespaceForContest: () => null }), /namespace/);
  const candidates = [{ id: "session-one", handle: "tourist", problemKey: "contest:100:A2", startedAt: "2026-10-19T10:00:00Z", finishedAt: "2026-10-19T10:02:00Z" }];
  assert.deepEqual(attributeSubmission(observation, "tourist", candidates), { status: "linked", sessionId: "session-one" });
  assert.deepEqual(attributeSubmission(observation, "tourist", [...candidates, { ...candidates[0], id: "another" }]), { status: "unassigned", reason: "ambiguous" });
  assert.deepEqual(attributeSubmission(observation, "tourist", [{ ...candidates[0], problemKey: "gym:100:A2" }]), { status: "unassigned", reason: "no-session" });
  assert.deepEqual(attributeSubmission(observation, "tourist", [{ ...candidates[0], problemKey: "contest:100:A1" }]), { status: "unassigned", reason: "no-session" });
  assert.deepEqual(attributeSubmission(observation, "other", candidates), { status: "unassigned", reason: "handle-mismatch" });
});

test("rejudges append authoritative evidence without changing original identity or old observations", () => {
  const [accepted] = parse([rawSubmission()]);
  const rejected = { ...accepted, observedAt: "2026-10-19T11:00:00Z", submission: { ...accepted.submission, verdict: "WRONG_ANSWER" } };
  const history = reconcileSubmissionVerdict([accepted], rejected);
  assert.equal(history.length, 2);
  assert.equal(history[0].submission.verdict, "OK");
  assert.equal(history[1].submission.verdict, "WRONG_ANSWER");
  assert.equal(reconcileSubmissionVerdict(history, accepted), history);
  assert.throws(() => reconcileSubmissionVerdict(history, { ...rejected, submission: { ...rejected.submission, problem: { ...rejected.submission.problem, key: "gym:100:A2" } } }), /identity/);
});
