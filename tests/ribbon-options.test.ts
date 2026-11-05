import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPreferences,
  validatePreferences,
} from "../apps/desktop/main/preferences";
import { defaultRibbon } from "../packages/ribbon/options";
test("old device preferences gain Ribbon defaults and malformed new fields are rejected", () => {
  const old = {
    theme: "ink",
    reducedMotion: false,
    snoozedUntil: null,
    shortcut: "Control+Option+F",
  };
  assert.deepEqual(validatePreferences(old).ribbon, defaultRibbon);
  assert.deepEqual(
    validatePreferences({
      ...old,
      ribbon: { shape: "fold", edge: "right", motion: "still" },
    }).ribbon,
    { shape: "fold", edge: "right", motion: "still" },
  );
  assert.throws(() =>
    validatePreferences({
      ...defaultPreferences(),
      ribbon: { shape: "unknown", edge: "free", motion: "gentle" },
    }),
  );
});
