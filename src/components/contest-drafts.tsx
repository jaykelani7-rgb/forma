"use client";

import { useEffect, useRef, useState } from "react";
import {
  readContestDraft,
  retainContestDraft,
  claimContestDraft,
  type RetainedContestDraft,
  type ContestDraftStatus,
} from "@/lib/contest-draft-store";

const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const keys = <T extends object>(...values: T[]) =>
  [...new Set(values.flatMap((value) => Object.keys(value)))] as (keyof T)[];

export interface ContestDraftPatch<T extends object> {
  apply: (current: T) => T;
  complete: (saved: boolean) => void;
}
export interface ContestDraftController<T extends object> {
  prepare: () => ContestDraftPatch<T> | null;
}

/** Untouched fields follow incoming storage; divergent edits require a choice.
 * Every write checks its field baseline again inside the workspace proposal. */
export function useContestDraft<T extends object>(source: T, scope: string) {
  const [stored, setState] = useState<RetainedContestDraft<T>>(
    () =>
      readContestDraft<T>(scope) ?? {
        source,
        baseline: source,
        draft: source,
        conflicts: [],
        status: "saved",
      },
  );
  const latest = useRef(stored);
  const [lease] = useState(() => claimContestDraft(scope));
  const [reloadProtected, setReloadProtected] = useState(true);
  function setStored(
    update:
      | RetainedContestDraft<T>
      | ((value: RetainedContestDraft<T>) => RetainedContestDraft<T>),
  ) {
    const value =
      typeof update === "function" ? update(latest.current) : update;
    latest.current = value;
    setReloadProtected(retainContestDraft(scope, value, lease));
    setState(value);
  }
  const pending = useRef<Partial<T> | null>(stored.pending ?? null);
  const saving = useRef<Promise<boolean> | null>(null);
  let state = stored;
  if (!equal(state.source, source)) {
    const baseline = { ...state.baseline },
      draft = { ...state.draft };
    const conflicts: (keyof T)[] = [];
    for (const key of keys(source, baseline, draft)) {
      if (equal(draft[key], baseline[key]) || equal(draft[key], source[key])) {
        draft[key] = source[key];
        baseline[key] = source[key];
      } else if (
        pending.current &&
        Object.hasOwn(pending.current, key) &&
        equal(pending.current[key], source[key])
      ) {
        baseline[key] = source[key];
      } else if (!equal(source[key], baseline[key])) conflicts.push(key);
    }
    state = { ...state, source, baseline, draft, conflicts };
    setStored(state);
  }
  latest.current = state;
  const dirty = keys(state.draft, state.baseline).some(
    (key) => !equal(state.draft[key], state.baseline[key]),
  );
  const controller = useRef<ContestDraftController<T> | null>(null);
  if (!controller.current)
    controller.current = {
      prepare() {
        const captured = latest.current;
        if (captured.conflicts.length)
          throw new Error(
            "Another tab changed this draft. Choose saved text or keep your draft before saving.",
          );
        const changed = keys(captured.draft, captured.baseline).filter(
          (key) => !equal(captured.draft[key], captured.baseline[key]),
        );
        if (!changed.length) return null;
        pending.current = Object.fromEntries(
          changed.map((key) => [key, captured.draft[key]]),
        ) as Partial<T>;
        setStored((value) => ({
          ...value,
          status: "saving",
          pending: pending.current!,
        }));
        return {
          apply(current) {
            const conflicts = changed.filter(
              (key) =>
                !equal(current[key], captured.baseline[key]) &&
                !equal(current[key], captured.draft[key]),
            );
            if (conflicts.length) {
              setStored((value) => ({ ...value, conflicts }));
              throw new Error(
                "Another tab changed this draft. Choose saved text or keep your draft before saving.",
              );
            }
            const next = { ...current };
            for (const key of changed) next[key] = captured.draft[key];
            return next;
          },
          complete(saved) {
            pending.current = null;
            if (!saved) {
              setStored((value) => ({
                ...value,
                status: "failed",
                pending: undefined,
              }));
              return;
            }
            setStored((value) => {
              const baseline = { ...value.baseline };
              for (const key of changed) baseline[key] = captured.draft[key];
              return {
                ...value,
                baseline,
                status: "saved",
                pending: undefined,
                conflicts: value.conflicts.filter(
                  (key) => !changed.includes(key),
                ),
              };
            });
          },
        };
      },
    };
  function setDraft(draft: T) {
    setStored((value) => ({ ...value, draft, status: "unsaved" }));
  }
  function useSaved() {
    setStored((value) => {
      const draft = { ...value.draft },
        baseline = { ...value.baseline };
      for (const key of value.conflicts) {
        draft[key] = value.source[key];
        baseline[key] = value.source[key];
      }
      return { ...value, baseline, draft, conflicts: [], status: "saved" };
    });
  }
  function keepDraft() {
    setStored((value) => ({
      ...value,
      baseline: value.source,
      conflicts: [],
      status: "unsaved",
    }));
  }
  async function save(write: (apply: (current: T) => T) => Promise<boolean>) {
    if (saving.current) {
      if (!(await saving.current)) return false;
      return save(write);
    }
    const operation = async () => {
      let patch: ContestDraftPatch<T> | null = null;
      let saved = false;
      try {
        patch = controller.current!.prepare();
        if (!patch) return true;
        saved = await write(patch.apply);
        return saved;
      } catch {
        return false;
      } finally {
        patch?.complete(saved);
      }
    };
    saving.current = operation();
    try {
      return await saving.current;
    } finally {
      saving.current = null;
    }
  }
  const status: ContestDraftStatus =
    state.status === "saving"
      ? "saving"
      : dirty
        ? state.status === "failed"
          ? "failed"
          : "unsaved"
        : "saved";
  return {
    draft: state.draft,
    setDraft,
    dirty,
    conflicts: state.conflicts,
    controller: controller.current,
    save,
    useSaved,
    keepDraft,
    status,
    reloadProtected,
  };
}

export function ContestDraftFeedback({
  label,
  status,
  reloadProtected,
}: {
  label: string;
  status: "unsaved" | "saving" | "saved" | "failed";
  reloadProtected: boolean;
}) {
  const messages = {
    unsaved: "Unsaved · draft kept in this tab",
    saving: "Saving…",
    saved: "Saved",
    failed: "Save failed · draft kept in this tab. Restore saving and retry.",
  };
  return (
    <p className="small muted" data-draft-feedback={label}>
      {messages[status]}
      {!reloadProtected &&
        status !== "saved" &&
        ". Browser reload protection is unavailable."}
    </p>
  );
}

export function useContestAutosave(
  draft: unknown,
  dirty: boolean,
  blocked: boolean,
  save: () => Promise<boolean>,
) {
  const write = useRef(save);
  useEffect(() => {
    write.current = save;
  }, [save]);
  const serialized = JSON.stringify(draft);
  useEffect(() => {
    if (!dirty || blocked) return;
    const timer = setTimeout(() => void write.current(), 600);
    return () => clearTimeout(timer);
  }, [serialized, dirty, blocked]);
}

export function ContestDraftConflict({
  label,
  conflicted,
  disabled,
  useSaved,
  keepDraft,
}: {
  label: string;
  conflicted: boolean;
  disabled: boolean;
  useSaved: () => void;
  keepDraft: () => void;
}) {
  return conflicted ? (
    <div>
      <p role="alert">
        Another tab changed your {label}. Your draft is kept here. Choose which
        text to use before saving.
      </p>
      <div>
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={useSaved}
        >
          Use saved {label}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={disabled}
          onClick={keepDraft}
        >
          Keep my {label}
        </button>
      </div>
    </div>
  ) : null;
}
