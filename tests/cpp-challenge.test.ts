import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cppChallengeSupported, readCppChallengeSource, runCppChallenge } from "../packages/integrations/cpp-challenge";
import { CHALLENGE_RUN_LIMITS } from "../packages/tutor/challenge-run";

const compilerAvailable = cppChallengeSupported() &&
  spawnSync(process.platform === "darwin" ? "/usr/bin/clang++" : "/usr/bin/c++", ["--version"], { stdio: "ignore", timeout: 3000 }).status === 0;

test("local challenge runs preserve input and identify the exact compiled source", { skip: !compilerAvailable }, async () => {
  const source = Buffer.from("#include <cstdio>\r\nint main() { int c; while ((c = getchar()) != EOF) putchar(c); }\r\n");
  const input = "  α\nβ ";
  const result = await runCppChallenge({ source, input });
  assert.deepEqual(result, {
    sourceHash: createHash("sha256").update(source).digest("hex"),
    output: input,
    outcome: "exited",
    diagnostic: "",
  });
});

test("local challenge runs distinguish compile failure and bound emitted output", { skip: !compilerAvailable }, async () => {
  const invalid = await runCppChallenge({ source: "int main( {", input: "" });
  assert.equal(invalid.outcome, "compile-error");
  assert.equal(invalid.output, "");
  assert.match(invalid.diagnostic, /error/i);

  const loud = await runCppChallenge({
    source: "#include <cstdio>\nint main() { for (int i = 0; i < 10000; ++i) putchar('a'); }",
    input: "",
  });
  assert.equal(loud.outcome, "output-limit");
  assert.equal(loud.output.length, CHALLENGE_RUN_LIMITS.output);
});

test("local challenge runs time out and can be cancelled", { skip: !compilerAvailable }, async () => {
  const source = "int main() { volatile int step = 0; for (;;) step = 1 - step; }";
  const timedOut = await runCppChallenge({ source, input: "" });
  assert.equal(timedOut.outcome, "timeout");

  const controller = new AbortController();
  const cancellation = setTimeout(() => controller.abort(), 200);
  try {
    await assert.rejects(runCppChallenge({ source, input: "", signal: controller.signal }), { name: "AbortError" });
  } finally {
    clearTimeout(cancellation);
  }
});

test("source snapshots read exact bytes and reject oversized files and symlinks", { skip: !cppChallengeSupported() }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "forma-challenge-test-"));
  try {
    const file = join(directory, "answer.cpp");
    const source = Buffer.from("int main(){}\r\n");
    await writeFile(file, source);
    assert.deepEqual(await readCppChallengeSource(file), source);
    const linked = join(directory, "linked.cpp");
    await symlink(file, linked);
    await assert.rejects(readCppChallengeSource(linked));
    await writeFile(file, Buffer.alloc(256 * 1024 + 1));
    await assert.rejects(readCppChallengeSource(file), /256 KiB/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
