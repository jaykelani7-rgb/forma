"use client";
import { useState } from "react";
import { RibbonMark } from "./RibbonMark";
import { defaultRibbon, type RibbonOptions } from "./options";

export function RibbonStudio({
  saved = defaultRibbon,
  onSave,
  onRehearse,
  reducedMotion = false,
  savedMessage = "Ribbon appearance saved on this device.",
}: {
  saved?: RibbonOptions;
  onSave: (options: RibbonOptions) => Promise<void>;
  onRehearse: () => void;
  reducedMotion?: boolean;
  savedMessage?: string;
}) {
  const [draft, setDraft] = useState(saved);
  const [focus, setFocus] = useState(false);
  const [override, setOverride] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const tucked = focus && draft.edge !== "free" && override !== false;
  const folded = override ?? (tucked || draft.shape === "fold");
  const dirty =
    draft.shape !== saved.shape ||
    draft.edge !== saved.edge ||
    draft.motion !== saved.motion;
  function change(value: RibbonOptions) {
    setDraft(value);
    setOverride(null);
    setMessage("");
  }
  async function save() {
    setPending(true);
    try {
      await onSave(draft);
      setMessage(savedMessage);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save. Your choices are still here.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="ribbon-studio"
      aria-label="Ribbon personalization"
      data-still={reducedMotion || draft.motion === "still"}
    >
      <span className="rs-kicker">COMPANION</span>
      <h2>Your ribbon</h2>
      <p>Choose its shape and where it rests while you focus.</p>
      <div
        className="rs-stage"
        aria-label="Interactive ribbon preview"
        data-edge={tucked ? draft.edge : "free"}
      >
        <span className="rs-stage-label">
          {focus ? "Focus preview" : "At rest"}
        </span>
        <button
          className="rs-specimen"
          aria-label={folded ? "Unfold preview ribbon" : "Fold preview ribbon"}
          onClick={() => {
            setOverride(!folded);
          }}
        >
          <RibbonMark size={36} />
          {!folded && <span>{focus ? "00:12" : "Ribbon"}</span>}
        </button>
      </div>
      <button
        className="rs-secondary"
        onClick={() => {
          setFocus(!focus);
          setOverride(null);
        }}
      >
        {focus ? "End focus preview" : "Preview focus"}
      </button>
      <fieldset disabled={pending}>
        <legend>Compact shape</legend>
        <div className="rs-choices">
          {(["strip", "fold"] as const).map((shape) => (
            <button
              type="button"
              key={shape}
              aria-pressed={draft.shape === shape}
              onClick={() => change({ ...draft, shape })}
            >
              {shape === "strip" ? "Timer strip" : "Small fold"}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={pending}>
        <legend>Resting place during focus</legend>
        <div className="rs-choices">
          {(["free", "left", "right"] as const).map((edge) => (
            <button
              type="button"
              key={edge}
              aria-pressed={draft.edge === edge}
              onClick={() => change({ ...draft, edge })}
            >
              {edge === "free"
                ? "Stay in place"
                : edge === "left"
                  ? "Left edge"
                  : "Right edge"}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={pending}>
        <legend>Ribbon motion</legend>
        <div className="rs-choices">
          {(["gentle", "still"] as const).map((motion) => (
            <button
              type="button"
              key={motion}
              aria-pressed={draft.motion === motion}
              onClick={() => change({ ...draft, motion })}
            >
              {motion === "gentle" ? "Gentle" : "Still"}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="rs-buttons">
        <button
          className="rs-primary"
          disabled={pending || !dirty}
          onClick={() => void save()}
        >
          {pending ? "Saving…" : "Save appearance"}
        </button>
        <button className="rs-secondary" onClick={onRehearse}>
          Rehearse a session
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
