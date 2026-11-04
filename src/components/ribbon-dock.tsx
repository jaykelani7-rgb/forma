"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { clockTime, elapsed } from "@/lib/model";
import { pauseSession, useWorkspace } from "./provider";
import { RibbonMark } from "../../packages/ribbon/RibbonMark";

export function RibbonDock() {
  const { data, update, storagePending, storageError } = useWorkspace();
  const session = data.session;
  const [now, setNow] = useState(() => Date.now());
  const running =
    !!session && session.runningSince !== null && session.timerVisible;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!session) return null;
  const reflecting = session.phase === "reflection";
  const paused = session.runningSince === null;
  function toggle() {
    if (!session) return;
    const id = session.id;
    void update((current) => {
      const s = current.session;
      if (
        !s ||
        s.id !== id ||
        s.phase !== "focus" ||
        (s.runningSince === null) !== paused
      )
        return current;
      return {
        ...current,
        session: paused ? { ...s, runningSince: Date.now() } : pauseSession(s),
      };
    });
  }
  return (
    <aside className="ribbon-dock" aria-label="Current session">
      <Link
        href="/session"
        aria-label={
          reflecting ? "Return to reflection" : "Open current session"
        }
      >
        <RibbonMark size={29} />
        <span>
          {reflecting
            ? "Reflect"
            : session.timerVisible
              ? clockTime(elapsed(session, now))
              : paused
                ? "Paused"
                : "In session"}
        </span>
      </Link>
      {!reflecting && (
        <button
          onClick={toggle}
          disabled={storagePending || !!storageError}
          aria-label={paused ? "Resume current timer" : "Pause current timer"}
        >
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
      )}
    </aside>
  );
}
