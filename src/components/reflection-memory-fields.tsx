"use client";

import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import {
  MISTAKES,
  type MistakeCategory,
  type ReflectionMemory,
} from "@/lib/memory-types";
import styles from "./reflection-memory-fields.module.css";

export function ReflectionMemoryFields({
  value,
  onChange,
  disabled = false,
  className = "",
  children,
}: {
  value: ReflectionMemory;
  onChange: (value: ReflectionMemory) => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const selected = value.mistakes ?? [];
  const id = useId();
  function toggle(category: MistakeCategory) {
    onChange({
      ...value,
      mistakes: selected.includes(category)
        ? selected.filter((item) => item !== category)
        : [...selected, category],
    });
  }
  return (
    <details className={`${styles.details} ${className}`}>
      <summary>
        Add learning details <span className="optional">optional</span>
      </summary>
      <div className={styles.fields}>
        <p className="small muted">
          Mark only what you noticed. Platform verdicts don’t choose these
          labels.
        </p>
        <fieldset>
          <legend>
            Mistakes you noticed <span className="optional">choose any</span>
          </legend>
          <div className={styles.categories}>
            {Object.entries(MISTAKES).map(([key, label]) => (
              <button
                type="button"
                key={key}
                disabled={disabled}
                aria-pressed={selected.includes(key as MistakeCategory)}
                className={
                  selected.includes(key as MistakeCategory)
                    ? styles.selected
                    : ""
                }
                onClick={() => toggle(key as MistakeCategory)}
              >
                <span className={styles.marker} aria-hidden="true">
                  {selected.includes(key as MistakeCategory) && (
                    <Check size={14} />
                  )}
                </span>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          <span id={`${id}-approach-label`}>What did you try?</span>
          <textarea
            aria-labelledby={`${id}-approach-label`}
            rows={2}
            maxLength={2000}
            value={value.approach ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, approach: event.target.value })
            }
            placeholder="The approach or invariant you tried…"
          />
        </label>
        <label>
          <span id={`${id}-mistake-label`}>Where did you get stuck?</span>
          <textarea
            aria-labelledby={`${id}-mistake-label`}
            rows={2}
            maxLength={2000}
            value={value.mistakeNote ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, mistakeNote: event.target.value })
            }
            placeholder="A short explanation, with or without a mistake label…"
          />
        </label>
        {children}
      </div>
    </details>
  );
}
