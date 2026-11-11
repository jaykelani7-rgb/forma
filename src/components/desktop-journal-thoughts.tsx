import Link from "next/link";
import { useEffect, useState } from "react";
import type { CompanionThought } from "../../packages/core/src/companion";
import { desktopWorkspace } from "@/lib/desktop-workspace";
import { shortDate } from "@/lib/model";
import { useWorkspace } from "./provider";

export function DesktopJournalThoughts() {
  const { savedData, mode } = useWorkspace();
  const [thoughts, setThoughts] = useState<CompanionThought[]>([]);
  useEffect(() => {
    const bridge = desktopWorkspace();
    if (!bridge || mode !== "personal") return;
    let generation = 0;
    async function refresh() {
      const request = ++generation;
      try {
        const notes = await bridge!.thoughts();
        if (request === generation) setThoughts(notes);
      } catch { /* Keep the readable notes until the next notebook change. */ }
    }
    const unsubscribe = bridge.onChange(() => void refresh());
    void refresh();
    return () => { generation++; unsubscribe(); };
  }, [mode]);
  if (mode !== "personal" || !thoughts.length) return null;
  const problems = new Map(savedData.problems.map(problem => [problem.id, problem.title]));
  return <details className="desktop-journal-thoughts" open>
    <summary>Thoughts from the Ribbon</summary>
    <ul>
      {[...thoughts].reverse().map(thought => <li key={thought.id}>
        <div><Link href={`/problems/${encodeURIComponent(thought.problemId)}?from=%2Fjournal`}>{problems.get(thought.problemId) ?? "Practice thought"}</Link>
          <time dateTime={thought.createdAt}>{shortDate(thought.createdAt)}</time></div>
        <p>{thought.text}</p>
      </li>)}
    </ul>
  </details>;
}
