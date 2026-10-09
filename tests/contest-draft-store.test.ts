import test from "node:test";
import assert from "node:assert/strict";
import {
  contestDraftScope,
  readContestDraft,
  retainContestDraft,
  claimContestDraft,
  type RetainedContestDraft,
} from "../src/lib/contest-draft-store";

const scope = (
  workspace = "personal",
  handle = "fixture_user",
  kind: "scratch" | "reflection" | "overall" = "scratch",
  row = "row:1",
) => contestDraftScope(workspace, handle, "contest:1", kind, row);
const state = (): RetainedContestDraft<{ notes: string }> => ({
  source: { notes: "Original" },
  baseline: { notes: "Original" },
  draft: { notes: "My unfinished thought" },
  conflicts: [],
  status: "unsaved",
});

test("retained editors are scoped by workspace, profile, contest, problem and field", () => {
  const key = scope();
  retainContestDraft(key, state());
  assert.deepEqual(readContestDraft(key), state());
  assert.equal(readContestDraft(scope("account:another")), null);
  assert.equal(readContestDraft(scope("personal", "other_user")), null);
  assert.equal(
    readContestDraft(scope("personal", "fixture_user", "overall")),
    null,
  );
  assert.equal(
    readContestDraft(scope("personal", "fixture_user", "scratch", "row:2")),
    null,
  );
  assert.equal(
    readContestDraft(
      contestDraftScope(
        "personal",
        "fixture_user",
        "contest:2",
        "scratch",
        "row:1",
      ),
    ),
    null,
  );
  assert.equal(scope("personal", "FIXTURE_USER"), key);
});

test("failed saves retain text and a clean durable save clears retention", () => {
  const key = scope("account:failed");
  retainContestDraft(key, { ...state(), status: "failed" });
  assert.equal(
    readContestDraft<{ notes: string }>(key)?.draft.notes,
    "My unfinished thought",
  );
  assert.equal(readContestDraft(key)?.status, "failed");
  const saved = { notes: "My unfinished thought" };
  retainContestDraft(key, {
    source: saved,
    baseline: saved,
    draft: saved,
    conflicts: [],
    status: "saved",
  });
  assert.equal(readContestDraft(key), null);
});

test("field baseline and divergent drafts survive navigation for later conflict review", () => {
  const key = scope("account:conflict");
  const value = {
    ...state(),
    source: { notes: "A different saved thought" },
    conflicts: ["notes"] as "notes"[],
  };
  retainContestDraft(key, value);
  assert.deepEqual(readContestDraft(key), value);
});

test("late callbacks from an old editor cannot replace a newer retained draft", () => {
  const key = scope("account:remount");
  const old = claimContestDraft(key);
  retainContestDraft(key, state(), old);
  const current = claimContestDraft(key);
  const newer = { ...state(), draft: { notes: "New text after returning" } };
  retainContestDraft(key, newer, current);
  retainContestDraft(key, { ...state(), status: "saved" }, old);
  assert.deepEqual(readContestDraft(key), newer);
});

test("session copies restore failed or interrupted editors and reject malformed cached values", () => {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
  });
  try {
    const key = scope("account:session");
    entries.set(
      "forma.contest-draft.v1:" + key,
      JSON.stringify({
        ...state(),
        status: "saving",
        pending: { notes: "My unfinished thought" },
      }),
    );
    assert.equal(readContestDraft(key)?.status, "unsaved");
    assert.deepEqual(readContestDraft(key)?.baseline, { notes: "Original" });
    const bad = scope("account:malformed");
    entries.set(
      "forma.contest-draft.v1:" + bad,
      JSON.stringify({ ...state(), draft: { arbitrary: "Invalid field" } }),
    );
    assert.equal(readContestDraft(bad), null);
    const max = scope("account:long");
    const value = { ...state(), draft: { notes: "\n".repeat(10000) } };
    entries.set("forma.contest-draft.v1:" + max, JSON.stringify(value));
    assert.equal(
      readContestDraft<{ notes: string }>(max)?.draft.notes.length,
      10000,
    );
  } finally {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
