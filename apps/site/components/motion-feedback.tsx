"use client";
import type { CSSProperties } from "react";
import { FileCode2 } from "lucide-react";
import s from "./motion-feedback.module.css";
export type CodeFlight = {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
};
export function MotionFeedback({
  flight,
  onComplete,
}: {
  flight: CodeFlight;
  onComplete: () => void;
}) {
  return (
    <span
      aria-hidden="true"
      className={s.flight}
      onAnimationEnd={onComplete}
      style={
        {
          left: flight.x,
          top: flight.y,
          "--dx": `${flight.dx}px`,
          "--dy": `${flight.dy}px`,
          "--mx": `${flight.dx * 0.55}px`,
          "--my": `${flight.dy * 0.5 - 55}px`,
        } as CSSProperties
      }
    >
      <FileCode2 size={16} />
      <span>watermelon.cpp</span>
      <i />
    </span>
  );
}
