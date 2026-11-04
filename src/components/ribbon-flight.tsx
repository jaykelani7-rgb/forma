"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { RibbonMark } from "../../packages/ribbon/RibbonMark";

/** The artwork folds into the session timer after a successful navigation. */
export function RibbonFlight({ path }: { path: string }) {
  const overlay = useRef<HTMLSpanElement>(null);
  const launch = useRef<{ x: number; y: number; at: number } | null>(null);

  useEffect(() => {
    if (path !== "/") return;
    function remember(event: MouseEvent) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      const button =
        event.target instanceof Element
          ? event.target.closest("[data-ribbon-launch] .button.primary")
          : null;
      const rect = button?.closest(".ribbon-hero")?.getBoundingClientRect();
      if (rect)
        launch.current = {
          x: rect.left + rect.width * 0.77,
          y: rect.top + rect.height * (innerWidth <= 760 ? 0.81 : 0.34),
          at: performance.now(),
        };
    }
    document.addEventListener("click", remember, true);
    return () => document.removeEventListener("click", remember, true);
  }, [path]);

  useLayoutEffect(() => {
    const start = launch.current;
    launch.current = null;
    if (
      !start ||
      path !== "/session" ||
      performance.now() - start.at > 6000 ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const target = document
      .querySelector(".ribbon-timer-mark")
      ?.getBoundingClientRect();
    const node = overlay.current;
    if (
      !target ||
      !node?.animate ||
      target.top > innerHeight ||
      target.bottom < 0
    )
      return;
    const x = target.x + target.width / 2 - 20;
    const y = target.y + target.height / 2 - 14;
    const animation = node.animate(
      [
        {
          transform: `translate(${start.x - 20}px, ${start.y - 14}px) rotate(-12deg) scale(2.1)`,
          opacity: 0.9,
        },
        {
          transform: `translate(${(start.x + x) / 2}px, ${(start.y + y) / 2 - 18}px) rotateY(60deg) scale(1.25)`,
          opacity: 1,
        },
        {
          transform: `translate(${x}px, ${y}px) rotateY(0deg) scale(.7)`,
          opacity: 0,
        },
      ],
      { duration: 520, easing: "cubic-bezier(.22,.72,.28,1)" },
    );
    return () => animation.cancel();
  }, [path]);

  return (
    <span className="ribbon-flight" ref={overlay} aria-hidden="true">
      <RibbonMark />
    </span>
  );
}
