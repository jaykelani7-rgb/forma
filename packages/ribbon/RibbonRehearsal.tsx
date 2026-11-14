"use client";
import { useState } from "react";
import { createDemo, elapsed } from "../../src/lib/model";
import {
  applyCompanionCommand,
  initialCompanionState,
} from "../core/src/companion";
import { RibbonRehearsalPanel, type RibbonRehearsalControls } from "./RibbonRehearsalPanel";

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
export function RibbonRehearsal(props: RibbonRehearsalControls) {
  const [book, setBook] = useState(sampleNotebook);
  const saved = book.data.attempts.find((attempt) => attempt.id === "companion:rehearsal-start");

  function run(type: "start" | "pause", stamp: number) {
    setBook((current) => applyCompanionCommand(
      current.data, current.state, { id: `rehearsal-${type}`, type, payload: {} }, stamp,
    ));
  }

  return <RibbonRehearsalPanel
    {...props}
    bookmark={saved}
    onStart={(stamp) => run("start", stamp)}
    onPause={(stamp) => run("pause", stamp)}
    readElapsed={(now) => book.data.session ? elapsed(book.data.session, now) : 0}
    onBookmark={(outcome, takeaway) => {
      const stamp = Date.now();
      setBook((current) => {
        const finished = applyCompanionCommand(
          current.data, current.state, { id: "rehearsal-finish", type: "finish", payload: {} }, stamp,
        );
        return applyCompanionCommand(finished.data, finished.state, {
          id: "rehearsal-reflect", type: "reflect", payload: { outcome, takeaway, notes: "" },
        }, stamp);
      });
    }}
  />;
}
