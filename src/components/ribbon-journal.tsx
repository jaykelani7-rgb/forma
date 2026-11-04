"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Bookmark, Search } from "lucide-react";
import { learningHistory } from "@/lib/learning";
import { memoryRecordAnchor } from "@/lib/learning-insights";
import { OUTCOMES, shortDate } from "@/lib/model";
import { useWorkspace } from "./provider";

export function RibbonJournal({ recent = false }: { recent?: boolean }) {
  const { savedData } = useWorkspace();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const entries = useMemo(() => {
    const problems = new Map(savedData.problems.map((p) => [p.id, p]));
    return learningHistory(savedData).flatMap((record) => {
      const problem = problems.get(record.problemId);
      if (!problem) return [];
      const outcome = record.outcome
        ? OUTCOMES[record.outcome]
        : "Reflection pending";
      return [{ record, problem, outcome }];
    });
  }, [savedData]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? entries.filter(({ record, problem, outcome }) =>
        [problem.title, problem.problemCode, record.takeaway, outcome].some(
          (text) => text.toLocaleLowerCase().includes(needle),
        ),
      )
    : entries;
  const visible = matches.slice(0, recent ? 3 : limit);
  return (
    <section
      className="ribbon-journal"
      aria-label={recent ? "Recent practice" : "Practice journal"}
    >
      <header className="ribbon-journal-head">
        {recent ? <h2>Recent practice</h2> : <h1>Journal</h1>}
        {recent && (
          <Link href="/journal" className="text-link">
            View journal <ArrowRight size={15} />
          </Link>
        )}
      </header>
      {!recent && (
        <label className="ribbon-search">
          <Search size={18} />
          <input
            type="search"
            value={query}
            aria-label="Search journal"
            placeholder="Search problems, reflections, or outcomes"
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(30);
            }}
          />
        </label>
      )}
      {visible.length ? (
        <ul className="ribbon-entries">
          {visible.map(({ record, problem, outcome }) => (
            <li key={record.id}>
              <Link
                href={`/problems/${encodeURIComponent(problem.id)}?from=${recent ? "%2F" : "%2Fjournal"}#${encodeURIComponent(memoryRecordAnchor("practice", record.id))}`}
              >
                <Bookmark
                  size={17}
                  fill={record.reflectedAt ? "currentColor" : "none"}
                  aria-hidden="true"
                />
                <div className="ribbon-entry-title">
                  <strong>{problem.title}</strong>
                  {!recent && record.takeaway && <p>{record.takeaway}</p>}
                </div>
                <span className="ribbon-entry-date">
                  {shortDate(record.completedAt)}
                </span>
                <span className="ribbon-entry-outcome">{outcome}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ribbon-journal-empty">
          {needle
            ? "No entries match your search."
            : "Your first practice session will appear here once you save a reflection."}
        </p>
      )}
      {!recent && matches.length > visible.length && (
        <button
          className="button secondary"
          onClick={() => setLimit(limit + 30)}
        >
          Show more entries
        </button>
      )}
    </section>
  );
}
