"use client";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  FileCode2,
  BookOpen,
  LockKeyhole,
} from "lucide-react";
import type { TourScene } from "./companion-sample";
import s from "./practice-guide.module.css";
export const practiceSteps: {
  label: string;
  title: string;
  description: string;
  scene: TourScene;
  next: string;
}[] = [
  {
    label: "Select code",
    title: "Start with a question in your code.",
    description:
      "This solution checks whether a weight is even. Pin the highlighted lines to keep them with the problem.",
    scene: "desk",
    next: "Keep a thought",
  },
  {
    label: "Keep a thought",
    title: "Give your next session a starting point.",
    description:
      "Write what you think might work, or what you want to test. Your own words will follow you into idea review.",
    scene: "desk",
    next: "Question your idea",
  },
  {
    label: "Question it",
    title: "Find the assumption worth testing.",
    description:
      "Outline your thought, choose an assumption, and explore the prepared Watermelon challenge. Keep or edit a useful next step.",
    scene: "idea",
    next: "Reflect on the attempt",
  },
  {
    label: "Reflect",
    title: "Keep the part you learned.",
    description:
      "Choose how the attempt went and write a takeaway in your own words. It becomes part of this sample notebook.",
    scene: "reflect",
    next: "Try a recall",
  },
  {
    label: "Recall",
    title: "See what stayed with you.",
    description:
      "Explain the condition before opening your memory. Then choose how recall felt and keep the attempt.",
    scene: "recall",
    next: "Journey complete",
  },
];
export function PracticeGuide({
  step,
  completed,
  onStep,
}: {
  step: number;
  completed: boolean[];
  onStep: (step: number) => void;
}) {
  return (
    <div className={s.guide}>
      <nav aria-label="Your practice journey" className={s.steps}>
        {practiceSteps.map((item, index) => (
          <button
            key={item.label}
            aria-current={step === index ? "step" : undefined}
            onClick={() => onStep(index)}
          >
            <span>
              {completed[index] ? <Check size={14} /> : `0${index + 1}`}
            </span>
            <strong>{item.label}</strong>
            {completed[index] && <small className={s.srOnly}> completed</small>}
          </button>
        ))}
      </nav>
      <div className={s.heading}>
        <div>
          <span>ONE PROBLEM · YOUR OWN THINKING</span>
          <h2 id="journey-title" tabIndex={-1}>
            {practiceSteps[step].title}
          </h2>
        </div>
        <p>{practiceSteps[step].description}</p>
      </div>
    </div>
  );
}
export function PracticeTrail({
  codePinned,
  thought,
  takeaway,
  concealed,
}: {
  codePinned: boolean;
  thought?: string;
  takeaway?: string;
  concealed: boolean;
}) {
  return (
    <aside className={s.trail} aria-label="Your practice thread">
      <span className={s.eyebrow}>THE THREAD YOU’RE BUILDING</span>
      <div>
        <FileCode2 size={16} />
        <span>
          <strong>
            {codePinned ? "Code connected" : "Start with your code"}
          </strong>
          <small>
            {codePinned
              ? "watermelon.cpp · lines 7–11"
              : "Pin a selection from the sample editor."}
          </small>
        </span>
        {codePinned && <Check size={15} />}
      </div>
      {concealed ? (
        <p className={s.closed}>
          <LockKeyhole size={15} /> Your earlier thinking stays closed until you
          open your memory.
        </p>
      ) : (
        <>
          <div>
            <BookOpen size={16} />
            <span>
              <strong>
                {thought ? "Your thought" : "A thought to return to"}
              </strong>
              <small>
                {thought ||
                  "Your words will appear here when you save a thread."}
              </small>
            </span>
          </div>
          {takeaway && (
            <blockquote>
              <span>YOUR TAKEAWAY</span>
              {takeaway}
            </blockquote>
          )}
        </>
      )}
    </aside>
  );
}
export function BoundaryCase() {
  const [weight, setWeight] = useState(2);
  return (
    <section className={s.boundary} aria-label="Explore the boundary case">
      <span className={s.eyebrow}>MAKE THE CONDITION VISIBLE</span>
      <h3>Even is only the beginning.</h3>
      <div role="group" aria-label="Illustrated weight">
        {[2, 8, 12].map((value) => (
          <button
            key={value}
            aria-pressed={weight === value}
            onClick={() => setWeight(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className={s.pieces} key={weight} data-valid={weight > 2}>
        <span>
          {weight === 2 ? 1 : 2}
          <small>{weight === 2 ? "odd" : "even"}</small>
        </span>
        <i>+</i>
        <span>
          {weight === 2 ? 1 : weight - 2}
          <small>{weight === 2 ? "odd" : "even"}</small>
        </span>
      </div>
      <p role="status">
        {weight === 2
          ? "1 + 1 uses odd parts. Two positive even parts need at least 4 in total."
          : `2 + ${weight - 2} works: both parts are positive and even.`}
      </p>
      <small>Illustrated example · code is not executed</small>
    </section>
  );
}
export function ContinuePractice({
  step,
  ready,
  onNext,
}: {
  step: number;
  ready: boolean;
  onNext: () => void;
}) {
  return (
    <div className={s.continue}>
      <span>
        {ready
          ? "Keep going with the same problem."
          : "Complete this step to keep the thread."}
      </span>
      <button type="button" disabled={!ready} onClick={onNext}>
        Continue to {practiceSteps[step + 1].label.toLowerCase()}{" "}
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
