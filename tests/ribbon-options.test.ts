import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PALETTE_SHORTCUT,
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
  assert.equal(validatePreferences(old).paletteShortcut, DEFAULT_PALETTE_SHORTCUT);
  assert.equal(validatePreferences({ ...old, paletteShortcut: null }).paletteShortcut, null);
  assert.throws(() => validatePreferences({ ...old, paletteShortcut: "K" }), /modifier and a key/);
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
