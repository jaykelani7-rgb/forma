"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import { clockTime, OUTCOMES, type Outcome } from "../core/src/practice-presentation";
import { RibbonMark } from "./RibbonMark";

const titles = {
  open: "Meet your ribbon.",
  ready: "Start with one problem.",
  focus: "Take a pause.",
  thought: "Leave a thought.",
  saved: "Your journal bookmark.",
};

export type RibbonRehearsalControls = {
  onExit: () => void;
  shortcut?: string;
  shortcutPress?: number;
  focusOnOpen?: boolean;
};

export type RehearsalBookmark = { outcome: Outcome; takeaway: string };

type Props = RibbonRehearsalControls & {
  bookmark?: RehearsalBookmark;
  onStart: (now: number) => void;
  onPause?: (now: number) => void;
  onBookmark: (outcome: Outcome, takeaway: string) => void;
  readElapsed: (now: number) => number;
};

export function RibbonRehearsalPanel({
  onExit,
  shortcut,
  shortcutPress = 0,
  focusOnOpen = true,
  bookmark,
  onStart,
  onPause,
  onBookmark,
  readElapsed,
}: Props) {
  const [step, setStep] = useState<keyof typeof titles>("open");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [now, setNow] = useState(0);
  const firstPress = useRef(shortcutPress);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (shortcutPress !== firstPress.current && step === "open") setStep("ready");
  }, [shortcutPress, step]);
  useEffect(() => {
    if (step !== "open" || focusOnOpen) heading.current?.focus({ preventScroll: true });
  }, [focusOnOpen, step]);
  useEffect(() => {
    if (step !== "focus") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [step]);

  function start() {
    const stamp = Date.now();
    onStart(stamp);
    setNow(stamp);
    setStep("focus");
  }

  function pause() {
    onPause?.(Date.now());
    setStep("thought");
  }

  return (
    <section className="ribbon-rehearsal" aria-label="Sample session rehearsal">
      <span className="rs-kicker">REHEARSAL · SAMPLE NOTEBOOK</span>
      <h2 ref={heading} tabIndex={-1}>{titles[step]}</h2>
      <p>About 45 seconds. Practice here uses a temporary demo notebook.</p>
      <div className="rs-rehearsal-sheet">
        <RibbonMark size={42} />
        <strong>Cut Ribbon</strong>
        <small>Codeforces · 189A</small>
        {step === "focus" && <time>{clockTime(readElapsed(now))}</time>}
        {step === "saved" && bookmark && (
          <div className="rs-bookmark">
            <Bookmark size={21} fill="currentColor" />
            <div>
              <b>{OUTCOMES[bookmark.outcome]}</b>
              <p>{bookmark.takeaway}</p>
            </div>
          </div>
        )}
      </div>
      {step === "open" && (
        <>
          <p>
            {shortcut
              ? `Press ${shortcut} or use the button to open the sample ribbon.`
              : "Focus the button and press Enter, or click to unfold the sample ribbon."}
          </p>
          <button className="rs-primary" onClick={() => setStep("ready")}>
            Open sample ribbon
          </button>
        </>
      )}
      {step === "ready" && (
        <button className="rs-primary" onClick={start}>Start sample timer</button>
      )}
      {step === "focus" && (
        <button className="rs-primary" onClick={pause}>Pause sample timer</button>
      )}
      {step === "thought" && (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!outcome || !note.trim()) return;
          onBookmark(outcome, note.trim());
          setStep("saved");
        }}>
          <label>
            Sample outcome
            <select required value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)}>
              <option value="">Choose an outcome</option>
              {Object.entries(OUTCOMES).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            One thought for next time
            <textarea
              required
              maxLength={300}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What would you try first?"
            />
          </label>
          <button className="rs-primary" disabled={!outcome || !note.trim()}>
            Bookmark sample thought
          </button>
        </form>
      )}
      <button className="rs-secondary rs-exit" onClick={onExit}>
        {step === "saved" ? "Finish rehearsal" : "Leave rehearsal"}
      </button>
    </section>
  );
}
