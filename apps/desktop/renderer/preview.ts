import { applyCompanionCommand, initialCompanionState } from "../../../packages/core/src/companion";
import { companionToday } from "../../../packages/core/src/companion-today";
import { reconcilePracticePlan } from "../../../src/lib/practice-plan";
import { emptyData } from "../../../src/lib/model";
import type { CompanionSnapshot, FormaBridge } from "./api";

/** Opt-in browser-only visual fixture. Nothing here is persisted or connected. */
export function createPreviewBridge(): FormaBridge {
  const now = Date.now();
  const empty = new URLSearchParams(location.search).get("scenario") === "empty";
  let seed = { data: emptyData(), state: initialCompanionState() };
  if (!empty) {
    seed = applyCompanionCommand(seed.data, seed.state, { id: "preview-attach", type: "attach", payload: { url: "https://codeforces.com/problemset/problem/839/C", title: "Journey" } }, now - 13 * 60000);
    seed = applyCompanionCommand(seed.data, seed.state, { id: "preview-start", type: "start", payload: {} }, now - 11 * 60000 - 26000);
    seed = applyCompanionCommand(seed.data, seed.state, { id: "preview-thought", type: "thought", payload: { text: "I think the useful question is what each smaller part needs to remember." } }, now - 3 * 60000);
  }
  seed.data=reconcilePracticePlan(seed.data,new Date(now));
  let snapshot: CompanionSnapshot = { ...seed, revision: 0, savedAt: new Date(now).toISOString(), integration: { connected: false, paired: false, status: "Preview only. No VS Code connection is active." }, preferences: { theme: "light", reducedMotion: false, snoozedUntil: null, shortcut: "Control+Option+F" }, codeforces: { checking: false, checkedAt: null, error: null } };
  const listeners = new Set<(snapshot: CompanionSnapshot) => void>();
  const copy = () => structuredClone({...snapshot,today:companionToday(snapshot.data)});
  const emit = () => listeners.forEach((listener) => listener(copy()));
  return {
    getSnapshot: async () => copy(),
    command: async (command) => { const next = applyCompanionCommand(snapshot.data, snapshot.state, command, Date.now()); snapshot = { ...snapshot, ...next, data:reconcilePracticePlan(next.data), revision: snapshot.revision + 1, savedAt: new Date().toISOString() }; emit(); return copy(); },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    ui: async (action, payload) => {
      if (action === "theme" && (payload === "light" || payload === "ink" || payload === "system")) snapshot.preferences.theme = payload;
      else if (action === "reduced-motion" && typeof payload === "boolean") snapshot.preferences.reducedMotion = payload;
      else if (action === "snooze") snapshot.preferences.snoozedUntil = payload === false ? null : new Date(Date.now() + 3600000).toISOString();
      else if (action === "shortcut" && typeof payload === "string") snapshot.preferences.shortcut = payload;
      else if (action === "today") { snapshot.presentation={expanded:true,panelRequest:{id:(snapshot.presentation?.panelRequest?.id??0)+1,panel:"today"}}; }
      else if (action === "expand" || action === "hitbox") return null;
      else throw new Error("This action needs the desktop app. This browser preview has no integration, file access, or durable storage.");
      emit();
      return structuredClone(snapshot.preferences);
    },
  };
}
