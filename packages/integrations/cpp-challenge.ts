import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHALLENGE_BATCH_OUTPUT_LIMIT, CHALLENGE_CASE_LIMIT, CHALLENGE_RUN_LIMITS, type ChallengeReferenceBatchCase } from "../tutor/challenge-run";

const SOURCE_LIMIT = 256 * 1024;
const COMPILE_TIMEOUT = 15_000;
const RUN_TIMEOUT = 3_000;

export interface CppChallengeResult {
  sourceHash: string;
  output: string;
  outcome: "exited" | "compile-error" | "runtime-error" | "timeout" | "output-limit";
  diagnostic: string;
}

export function cppChallengeSupported() {
  return process.platform === "darwin" || process.platform === "linux";
}

/** Read only a regular file and keep the exact bytes the compiler will receive. */
export async function readCppChallengeSource(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > SOURCE_LIMIT) throw new Error("Use a regular C++ file up to 256 KiB.");
    const source = Buffer.alloc(SOURCE_LIMIT + 1);
    let length = 0;
    while (length < source.length) {
      const { bytesRead } = await handle.read(source, length, source.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length === 0 || length > SOURCE_LIMIT) throw new Error("Save a nonempty C++ file up to 256 KiB.");
    return source.subarray(0, length);
  } finally {
    await handle.close();
  }
}

type ProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
  stopped: "timeout" | "output-limit" | null;
};

/** Detached process groups allow cancellation to release descendants holding the pipes. */
function runProcess(executable: string, args: string[], cwd: string, input: string, timeoutMs: number, signal?: AbortSignal, outputLimit: number = CHALLENGE_RUN_LIMITS.output) {
  signal?.throwIfAborted();
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      env: { NODE_ENV: "production", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: cwd },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stopped: ProcessResult["stopped"] = null;
    let aborted = false;
    let spawnError: Error | undefined;
    let killed = false;
    let pipeTimeout: ReturnType<typeof setTimeout> | undefined;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let outputBytes = 0, errorBytes = 0;
    function killGroup() {
      if (killed || !child.pid) return;
      killed = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* The process group already exited. */ }
    }
    function stop(reason: NonNullable<ProcessResult["stopped"]>) {
      stopped ??= reason;
      killGroup();
    }
    function cancel() {
      aborted = true;
      killGroup();
    }
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.once("error", error => { spawnError = error; });
    child.once("exit", () => {
      killGroup();
      pipeTimeout = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
      }, 250);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (outputBytes < outputLimit) {
        stdout.push(chunk.subarray(0, outputLimit - outputBytes));
      }
      outputBytes += chunk.length;
      if (outputBytes > outputLimit) stop("output-limit");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes < CHALLENGE_RUN_LIMITS.diagnostic) {
        stderr.push(chunk.subarray(0, CHALLENGE_RUN_LIMITS.diagnostic - errorBytes));
      }
      errorBytes += chunk.length;
      if (errorBytes > CHALLENGE_RUN_LIMITS.diagnostic) stop("output-limit");
    });
    child.stdin.on("error", () => { /* A process can exit before reading all of the input. */ });
    child.stdin.end(input);
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(pipeTimeout);
      signal?.removeEventListener("abort", cancel);
      if (aborted) { reject(signal?.reason ?? new Error("The challenge run was cancelled.")); return; }
      if (spawnError) { reject(spawnError); return; }
      resolve({
        code, signal: exitSignal, stopped,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8").replaceAll("\0", "\uFFFD"),
      });
    });
  });
}

function sourceBytes(source: Buffer | string) {
  const bytes = Buffer.from(source);
  if (bytes.length === 0 || bytes.length > SOURCE_LIMIT) throw new Error("Use a nonempty C++ file up to 256 KiB.");
  return bytes;
}

function validateInput(input: string) {
  if (input.length > CHALLENGE_RUN_LIMITS.input) throw new Error("This case exceeds the local input limit.");
}

async function compileCppChallenge(bytes: Buffer, directory: string, signal?: AbortSignal): Promise<
  { executable: string; sourceHash: string } | { failure: CppChallengeResult }
> {
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const compiler = process.platform === "darwin" ? "/usr/bin/clang++" : "/usr/bin/c++";
  await writeFile(join(directory, "solution.cpp"), bytes, { mode: 0o600, flag: "wx" });
  const compiled = await runProcess(compiler, ["-std=c++17", "solution.cpp", "-o", "solution"], directory, "", COMPILE_TIMEOUT, signal).catch(error => {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new Error("Install your system C++ compiler before running a challenge case.");
    throw error;
  });
  if (compiled.stopped || compiled.code !== 0) {
    const explanation = compiled.stopped === "timeout" ? "Compilation reached the 15 second limit."
      : compiled.stopped === "output-limit" ? "Compiler output reached the size limit."
      : "The source could not be compiled.";
    return { failure: {
      sourceHash, output: "", outcome: compiled.stopped ?? "compile-error",
      diagnostic: compiled.stderr.trim() || explanation,
    } };
  }
  return { executable: join(directory, "solution"), sourceHash };
}

async function runCompiledChallenge(executable: string, directory: string, input: string, signal?: AbortSignal, outputLimit?: number): Promise<{
  output: string;
  outcome: ChallengeReferenceBatchCase["outcome"];
  diagnostic: string;
}> {
  const run = await runProcess(executable, [], directory, input, RUN_TIMEOUT, signal, outputLimit);
  let output: string;
  try {
    output = new TextDecoder("utf-8", { fatal: !run.stopped, ignoreBOM: true }).decode(run.stdout);
  } catch {
    return { output: "", outcome: "runtime-error", diagnostic: "The program emitted invalid UTF-8 output." };
  }
  if (output.includes("\0")) {
    if (!run.stopped) return { output: "", outcome: "runtime-error", diagnostic: "The program emitted binary output." };
    output = "";
  }
  const outcome = run.stopped ?? (run.code === 0 ? "exited" : "runtime-error");
  const diagnostic = outcome === "timeout" ? "The program reached the 3 second limit."
    : outcome === "output-limit" ? "The program output reached the size limit."
    : outcome === "runtime-error" ? run.stderr.trim() || (run.signal ? `The program stopped with ${run.signal}.` : `The program exited with code ${run.code}.`)
    : run.stderr.trim();
  return { output, outcome, diagnostic };
}

export async function runCppChallenge({ source, input, signal }: {
  source: Buffer | string;
  input: string;
  signal?: AbortSignal;
}): Promise<CppChallengeResult> {
  if (!cppChallengeSupported()) throw new Error("Local C++ challenge runs are available on macOS and Linux.");
  signal?.throwIfAborted();
  const bytes = sourceBytes(source);
  validateInput(input);
  const directory = await mkdtemp(join(tmpdir(), "forma-challenge-"));
  try {
    const compiled = await compileCppChallenge(bytes, directory, signal);
    if ("failure" in compiled) return compiled.failure;
    const result = await runCompiledChallenge(compiled.executable, directory, input, signal);
    return { sourceHash: compiled.sourceHash, ...result };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runCppReferenceChallenge({ source, reference, input, signal }: {
  source: Buffer | string;
  reference: Buffer | string;
  input: string;
  signal?: AbortSignal;
}): Promise<{ result: CppChallengeResult; expectedOutput: string; referenceHash: string }> {
  signal?.throwIfAborted();
  const solution = Buffer.from(source);
  const referenceRun = await runCppChallenge({ source: reference, input, signal });
  if (referenceRun.outcome !== "exited") {
    throw new Error(`Reference solution failed. ${referenceRun.diagnostic}`.trim());
  }
  const result = await runCppChallenge({ source: solution, input, signal });
  return { result, expectedOutput: referenceRun.output, referenceHash: referenceRun.sourceHash };
}

export async function runCppReferenceChallengeBatch({ source, reference, cases, signal }: {
  source: Buffer | string;
  reference: Buffer | string;
  cases: readonly { caseId: string; input: string }[];
  signal?: AbortSignal;
}): Promise<{ sourceHash: string; referenceHash: string; cases: ChallengeReferenceBatchCase[] }> {
  if (!cppChallengeSupported()) throw new Error("Local C++ challenge runs are available on macOS and Linux.");
  signal?.throwIfAborted();
  const solutionBytes = sourceBytes(source), referenceBytes = sourceBytes(reference);
  if (!cases.length || cases.length > CHALLENGE_CASE_LIMIT || new Set(cases.map(item => item.caseId)).size !== cases.length) {
    throw new Error("Choose one to three distinct challenge cases.");
  }
  const reviewedCases = cases.map(({ caseId, input }) => {
    validateInput(input);
    return { caseId, input };
  });
  const directory = await mkdtemp(join(tmpdir(), "forma-challenge-batch-"));
  async function execute(executable: string, input: string) {
    const runDirectory = await mkdtemp(join(directory, "run-"));
    try {
      return await runCompiledChallenge(executable, runDirectory, input, signal, CHALLENGE_BATCH_OUTPUT_LIMIT);
    } finally {
      await rm(runDirectory, { recursive: true, force: true });
    }
  }
  try {
    const referenceProgram = await compileCppChallenge(referenceBytes, await mkdtemp(join(directory, "reference-")), signal);
    if ("failure" in referenceProgram) throw new Error(`Reference compilation failed. ${referenceProgram.failure.diagnostic}`);
    const solutionProgram = await compileCppChallenge(solutionBytes, await mkdtemp(join(directory, "solution-")), signal);
    if ("failure" in solutionProgram) throw new Error(`Solution compilation failed. ${solutionProgram.failure.diagnostic}`);

    // Freeze the expected outputs before any solution process runs with local user permissions.
    const referenceRuns = [];
    for (const { caseId, input } of reviewedCases) {
      const expected = await execute(referenceProgram.executable, input);
      referenceRuns.push({ caseId, input, expected });
    }
    const results: ChallengeReferenceBatchCase[] = [];
    for (const { caseId, input, expected } of referenceRuns) {
      if (expected.outcome !== "exited") {
        results.push({ caseId, outcome: expected.outcome, referenceFailed: true, output: "", expectedOutput: "" });
        continue;
      }
      const actual = await execute(solutionProgram.executable, input);
      results.push({ caseId, outcome: actual.outcome, output: actual.output, expectedOutput: expected.output });
    }
    signal?.throwIfAborted();
    return { sourceHash: solutionProgram.sourceHash, referenceHash: referenceProgram.sourceHash, cases: results };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
