"use client";
import { useEffect, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import {
  createDemo,
  clockTime,
  elapsed,
  OUTCOMES,
  type Outcome,
} from "../../src/lib/model";
import {
  applyCompanionCommand,
  initialCompanionState,
} from "../core/src/companion";
import { RibbonMark } from "./RibbonMark";

function sampleNotebook() {
  const data = createDemo();
  const problem = data.problems.find((p) => p.id === "ribbon")!;
  return applyCompanionCommand(
    data,
    initialCompanionState(),
    {
      id: "rehearsal-attach",
      type: "attach",
      payload: { url: problem.url, title: problem.title },
    },
    Date.now(),
  );
}

/** This component can only write into its disposable copy of the sample notebook. */
export function RibbonRehearsal({
  onExit,
  shortcut,
  shortcutPress = 0,
  focusOnOpen = true,
}: {
  onExit: () => void;
  shortcut?: string;
  shortcutPress?: number;
  focusOnOpen?: boolean;
}) {
  const [book, setBook] = useState(sampleNotebook);
  const [step, setStep] = useState<
    "open" | "ready" | "focus" | "thought" | "saved"
  >("open");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [now, setNow] = useState(Date.now);
  const firstPress = useRef(shortcutPress);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (shortcutPress !== firstPress.current && step === "open")
      setStep("ready");
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
    setBook(
      applyCompanionCommand(
        book.data,
        book.state,
        { id: "rehearsal-start", type: "start", payload: {} },
        stamp,
      ),
    );
    setNow(stamp);
    setStep("focus");
  }
  function pause() {
    setBook(
      applyCompanionCommand(
        book.data,
        book.state,
        { id: "rehearsal-pause", type: "pause", payload: {} },
        Date.now(),
      ),
    );
    setStep("thought");
  }
  function bookmark() {
    if (!note.trim() || !outcome) return;
    const stamp = Date.now();
    const finished = applyCompanionCommand(
      book.data,
      book.state,
      { id: "rehearsal-finish", type: "finish", payload: {} },
      stamp,
    );
    setBook(
      applyCompanionCommand(
        finished.data,
        finished.state,
        {
          id: "rehearsal-reflect",
          type: "reflect",
          payload: { outcome, takeaway: note.trim(), notes: "" },
        },
        stamp,
      ),
    );
    setStep("saved");
  }
  const titles = {
    open: "Meet your ribbon.",
    ready: "Start with one problem.",
    focus: "Take a pause.",
    thought: "Leave a thought.",
    saved: "Your journal bookmark.",
  };
  const saved = book.data.attempts.find(
    (a) => a.id === "companion:rehearsal-start",
  );
  return (
    <section className="ribbon-rehearsal" aria-label="Sample session rehearsal">
      <span className="rs-kicker">REHEARSAL · SAMPLE NOTEBOOK</span>
      <h2 ref={heading} tabIndex={-1}>
        {titles[step]}
      </h2>
      <p>About 45 seconds. Practice here uses a temporary demo notebook.</p>
      <div className="rs-rehearsal-sheet">
        <RibbonMark size={42} />
        <strong>Cut Ribbon</strong>
        <small>Codeforces · 189A</small>
        {step === "focus" && book.data.session && (
          <time>{clockTime(elapsed(book.data.session, now))}</time>
        )}
        {step === "saved" && saved && (
          <div className="rs-bookmark">
            <Bookmark size={21} fill="currentColor" />
            <div>
              <b>{OUTCOMES[saved.outcome]}</b>
              <p>{saved.takeaway}</p>
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
        <button className="rs-primary" onClick={start}>
          Start sample timer
        </button>
      )}
      {step === "focus" && (
        <button className="rs-primary" onClick={pause}>
          Pause sample timer
        </button>
      )}
      {step === "thought" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            bookmark();
          }}
        >
          <label>
            Sample outcome
            <select
              required
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
            >
              <option value="">Choose an outcome</option>
              {Object.entries(OUTCOMES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
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
              onChange={(e) => setNote(e.target.value)}
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
