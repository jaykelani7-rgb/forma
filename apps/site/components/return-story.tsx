"use client";

import {
  ArrowRight,
  Check,
  FileCode2,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { sampleCode } from "./companion-sample";
import s from "./return-story.module.css";

export const exampleReturnThought =
  "Check the smallest even weight before trusting the pattern.";
export const storySteps = ["Select", "Keep", "Step away", "Return"];

export function ReturnStory({
  phase,
  draft,
  thought,
  playing,
  reducedMotion,
  onDraft,
  onAdvance,
  onPlay,
  onPause,
  onReplay,
  onContinue,
}: {
  phase: number;
  draft: string;
  thought: string;
  playing: boolean;
  reducedMotion: boolean;
  onDraft: (value: string) => void;
  onAdvance: () => void;
  onPlay: () => void;
  onPause: () => void;
  onReplay: () => void;
  onContinue: () => void;
}) {
  const active = Math.min(phase, 3);
  return (
    <section
      className={s.story}
      aria-label="Keep the thread story"
      data-phase={phase}
    >
      <div className={s.topline}>
        <span>ONE PROBLEM. AN UNBROKEN THREAD.</span>
        {!reducedMotion && phase < 4 && (
          <button
            onClick={playing ? onPause : onPlay}
            disabled={!playing && phase === 1 && !draft.trim()}
            aria-label={playing ? "Pause the story" : "Play the story"}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
            {playing ? "Pause" : "Play"}
          </button>
        )}
        {phase === 4 && (
          <button onClick={onReplay} aria-label="Replay the story">
            <RotateCcw size={13} /> Replay
          </button>
        )}
      </div>
      <ol className={s.steps} aria-label="Story progress">
        {storySteps.map((label, index) => (
          <li
            key={label}
            aria-current={index === active ? "step" : undefined}
            data-done={index < active || phase === 4}
          >
            <span>
              {index < active || phase === 4 ? (
                <Check size={10} />
              ) : (
                `0${index + 1}`
              )}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <div className={s.editor}>
        <header>
          <FileCode2 size={15} />
          <span>watermelon.cpp</span>
          <small>EXAMPLE EDITOR</small>
        </header>
        <div className={s.problem}>
          <span>Codeforces / 4A</span>
          <strong>Two positive parts. Both even.</strong>
        </div>
        <pre aria-label="Story code selection" data-selected={phase > 0}>
          {sampleCode
            .split("\n")
            .slice(6, 11)
            .map((line, index) => (
              <span key={index}>
                <i>{index + 7}</i>
                <code>{line.trimStart() || " "}</code>
              </span>
            ))}
        </pre>
        <div className={s.editorFooter}>
          <span>C++</span>
          <span>
            {phase > 0
              ? "Lines 7–11 selected"
              : "A first idea, ready to question"}
          </span>
        </div>
      </div>
      <div className={s.beat}>
        <span className={s.seam} aria-hidden="true" />
        <div role="status" aria-live="polite" className={s.caption}>
          <strong>
            {
              [
                "Start with the part you’re thinking about.",
                "Give your next thought a place to stay.",
                "Kept beside this problem. Take a breath.",
                "A quiet Ribbon. Your place is kept.",
                "Right where your thinking left off.",
              ][phase]
            }
          </strong>
          <p>
            {
              [
                "Select a few lines. Forma keeps the context beside your code.",
                "Use this example, or make the thought your own.",
                "Your code and thought are together in the companion. Try folding it away.",
                "In this sample, return whenever you’re ready. Nothing to reconstruct.",
                "The same code. The same words. A next step you can build on.",
              ][phase]
            }
          </p>
        </div>
        {phase === 1 && (
          <label className={s.note}>
            A thought to come back to
            <textarea
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              maxLength={300}
              rows={2}
            />
          </label>
        )}
        {phase >= 2 && (
          <blockquote className={s.bookmark} data-folded={phase === 3}>
            <span>
              {phase === 3
                ? "HELD IN YOUR RIBBON"
                : phase === 4
                  ? "YOUR THOUGHT, RETURNED"
                  : "THOUGHT ATTACHED"}
            </span>
            {phase !== 3 && <p>{thought}</p>}
          </blockquote>
        )}
        <button
          className={s.next}
          onClick={phase === 4 ? onContinue : onAdvance}
          disabled={phase === 1 && !draft.trim()}
        >
          {
            [
              "Select these lines",
              "Keep this thought",
              "Fold the Ribbon",
              "Return to the problem",
              "Continue with this problem",
            ][phase]
          }
          <ArrowRight size={16} />
        </button>
      </div>
      <p className={s.disclosure}>
        Interactive sample · stays in this page until reset or reload.
      </p>
    </section>
  );
}
