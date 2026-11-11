"use client";
import Link from "next/link";
import { useMemo, useRef, useState, type Ref } from "react";
import { ArrowLeft, ArrowRight, Bookmark, GitCompareArrows, Search } from "lucide-react";
import { attemptComparisonChoices } from "@/lib/attempt-comparison";
import { learningHistory, type LearningRecord } from "@/lib/learning";
import { memoryRecordAnchor } from "@/lib/learning-insights";
import { MISTAKES } from "@/lib/memory-types";
import {
  addDays,
  clockTime,
  dateFromDay,
  DIFFICULTIES,
  localDate,
  OUTCOMES,
  shortDate,
  type Outcome,
  type Problem,
} from "@/lib/model";
import { practiceIdentity } from "@/lib/practice-state";
import { AttemptComparison } from "./attempt-comparison";
import { JournalTakeawayPractice } from "./journal-takeaway-practice";
import { useWorkspace } from "./provider";
import { TakeawayConnection } from "./takeaway-connection";
import { Modal } from "./ui";
import { desktopWorkspace } from "@/lib/desktop-workspace";
import { DesktopJournalThoughts } from "./desktop-journal-thoughts";
import styles from "./ribbon-journal.module.css";

const SOURCES: Record<LearningRecord["source"], string> = {
  timed: "Timed practice",
  codeforces: "Codeforces import",
  linked: "Timed + Codeforces",
  contest: "Contest participation",
};
const dateOptions = {
  all: "Any time",
  week: "Last 7 days",
  month: "Last 30 days",
  lastMonth: "Last month",
  custom: "Custom range",
};
type JournalFilters = {
  query: string;
  outcome: "all" | "pending" | Outcome;
  source: "all" | LearningRecord["source"];
  period: keyof typeof dateOptions;
  from: string;
  to: string;
};
type JournalEntry = {
  record: LearningRecord;
  problem: Problem;
  identity: string;
  day: string;
  outcome: string;
};
const emptyFilters: JournalFilters = {
  query: "",
  outcome: "all",
  source: "all",
  period: "all",
  from: "",
  to: "",
};
const PAGE_SIZE = 30;
const HISTORY_PAGE_SIZE = 8;

function filterDates(filters: JournalFilters, today: string) {
  if (filters.period === "custom")
    return { from: filters.from, to: filters.to };
  if (filters.period === "all") return { from: "", to: "" };
  const now = dateFromDay(today);
  if (filters.period === "lastMonth") {
    const year = now.getFullYear();
    const month = now.getMonth();
    return {
      from: localDate(new Date(year, month - 1, 1)),
      to: localDate(new Date(year, month, 0)),
    };
  }
  return {
    from: localDate(addDays(now, filters.period === "week" ? -6 : -29)),
    to: today,
  };
}

function recordHref({ record, problem }: JournalEntry, from: "/" | "/journal") {
  const anchor = memoryRecordAnchor("practice", record.id);
  return `/problems/${encodeURIComponent(problem.id)}?from=${encodeURIComponent(from)}#${encodeURIComponent(anchor)}`;
}

function EntryDate({
  entry,
  full = false,
}: {
  entry: JournalEntry;
  full?: boolean;
}) {
  const { completedAt } = entry.record;
  return (
    <time dateTime={completedAt}>
      {full
        ? new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(completedAt))
        : shortDate(completedAt)}
    </time>
  );
}

function RecentJournal({ entries }: { entries: JournalEntry[] }) {
  return (
    <section className="ribbon-journal" aria-label="Recent practice">
      <header className="ribbon-journal-head">
        <h2>Recent practice</h2>
        <Link href="/journal" className="text-link">
          View journal <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </header>
      {entries.length ? (
        <ul className="ribbon-entries">
          {entries.slice(0, 3).map((entry) => (
            <li key={entry.record.id}>
              <Link href={recordHref(entry, "/")}>
                <Bookmark
                  size={17}
                  fill={entry.record.reflectedAt ? "currentColor" : "none"}
                  aria-hidden="true"
                />
                <div className="ribbon-entry-title">
                  <strong>{entry.problem.title}</strong>
                </div>
                <span className="ribbon-entry-date">
                  <EntryDate entry={entry} />
                </span>
                <span className="ribbon-entry-outcome">{entry.outcome}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ribbon-journal-empty">
          Saved practice and imported attempts will appear here.
        </p>
      )}
    </section>
  );
}

function JournalEntryDetail({
  entry,
  otherAttempts,
  headingRef,
  onBack,
  onCompare,
  takeawaySource,
}: {
  entry: JournalEntry;
  otherAttempts: JournalEntry[];
  headingRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
  onCompare?: () => void;
  takeawaySource?: JournalEntry;
}) {
  const { record, problem, outcome } = entry;
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);
  const notes = [
    ["One thing to remember", record.takeaway],
    ["What you tried", record.approach],
    ["Where you got stuck", record.mistakeNote],
    ["Session notes", record.notes],
  ].filter(([, value]) => value?.trim());
  return (
    <section
      className={styles.detail}
      id="journal-entry-detail"
      aria-label="Journal entry detail"
    >
      <button className={`text-link ${styles.back}`} onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" /> Back to entries
      </button>
      <p className={styles.detailKicker}>Selected entry</p>
      <h2 ref={headingRef} tabIndex={-1}>
        {problem.title}
      </h2>
      <p className={styles.meta}>
        <EntryDate entry={entry} full /> · {SOURCES[record.source]}
        {record.handle && ` · ${record.handle}`}
      </p>
      <p className={styles.badges}>
        <span className={styles.outcome}>{outcome}</span>
        {record.accepted === true && (
          <span className={styles.outcome}>Platform accepted</span>
        )}
        {record.elapsedMs !== null && (
          <span className={styles.meta}>
            {clockTime(record.elapsedMs)} measured
          </span>
        )}
      </p>
      <div className={styles.reflection}>
        <h3>Reflection</h3>
        {record.difficulty && (
          <p className={styles.meta}>
            Difficulty: {DIFFICULTIES[record.difficulty]}
          </p>
        )}
        {!!record.mistakes?.length && (
          <ul className={styles.badges} aria-label="Recorded mistakes">
            {record.mistakes.map((mistake) => (
              <li className={styles.outcome} key={mistake}>
                {MISTAKES[mistake]}
              </li>
            ))}
          </ul>
        )}
        {notes.length ? (
          <dl className={styles.notes}>
            {notes.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.meta}>
            {record.outcome
              ? "Outcome saved without written notes."
              : "No reflection has been saved for this attempt."}
          </p>
        )}
        <div className={styles.reflectionActions}>
          <Link href={recordHref(entry, "/journal")} className="text-link">
            Open original record <ArrowRight size={15} aria-hidden="true" />
          </Link>
          {onCompare && (
            <button type="button" className="text-link" onClick={onCompare}>
              <GitCompareArrows size={15} aria-hidden="true" /> Compare attempts
            </button>
          )}
        </div>
        {record.takeaway.trim() && (
          <JournalTakeawayPractice sourceRecordId={record.id} />
        )}
      </div>
      {record.takeawayPractice && (
        <div className={styles.takeawayConnection}>
          <TakeawayConnection
            context={record.takeawayPractice}
            headingLevel={3}
            action={takeawaySource && (
              <Link href={recordHref(takeawaySource, "/journal")} className="text-link">
                View earlier reflection <ArrowRight size={15} aria-hidden="true" />
              </Link>
            )}
          />
        </div>
      )}
      <section
        className={styles.history}
        aria-labelledby="journal-history-title"
      >
        <h3 id="journal-history-title">Other attempts on this problem</h3>
        {otherAttempts.length ? (
          <>
            <ol>
              {otherAttempts.slice(0, historyLimit).map((attempt) => {
                const difference =
                  Date.parse(attempt.record.completedAt) -
                  Date.parse(record.completedAt);
                const position =
                  difference > 0
                    ? "Later attempt"
                    : difference < 0
                      ? "Earlier attempt"
                      : "Same time";
                return (
                  <li key={attempt.record.id}>
                    <Link href={recordHref(attempt, "/journal")}>
                      <div>
                        <strong>
                          {position} · {attempt.outcome}
                        </strong>
                        <span className={styles.meta}>
                          <EntryDate entry={attempt} full /> ·{" "}
                          {SOURCES[attempt.record.source]}
                        </span>
                      </div>
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ol>
            {otherAttempts.length > historyLimit && (
              <button
                className="text-link"
                onClick={() =>
                  setHistoryLimit(historyLimit + HISTORY_PAGE_SIZE)
                }
              >
                Show more attempts
              </button>
            )}
          </>
        ) : (
          <p className={styles.meta}>
            This is the only saved attempt on this problem.
          </p>
        )}
      </section>
    </section>
  );
}

function JournalBrowser({
  entries,
  today,
}: {
  entries: JournalEntry[];
  today: string;
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const entryButton = useRef<HTMLButtonElement | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement | null>(null);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const needle = filters.query.trim().toLocaleLowerCase();
  const { from, to } = filterDates(filters, today);
  const invalidDates = Boolean(from && to && from > to);
  const isFiltered =
    !!needle ||
    filters.outcome !== "all" ||
    filters.source !== "all" ||
    filters.period !== "all";
  const matches = useMemo(() => {
    if (invalidDates) return [];
    return entries.filter(({ record, problem, day, outcome }) => {
      if (
        filters.outcome !== "all" &&
        (record.outcome ?? "pending") !== filters.outcome
      )
        return false;
      if (filters.source !== "all" && record.source !== filters.source)
        return false;
      if ((from && day < from) || (to && day > to)) return false;
      return (
        !needle ||
        [
          problem.title,
          problem.problemCode,
          record.takeaway,
          record.approach,
          record.mistakeNote,
          record.notes,
          outcome,
        ].some((value) => value?.toLocaleLowerCase().includes(needle))
      );
    });
  }, [
    entries,
    filters.outcome,
    filters.source,
    from,
    invalidDates,
    needle,
    to,
  ]);
  const visible = matches.slice(0, limit);
  const selected =
    visible.find(({ record }) => record.id === selectedId) ?? visible[0];
  const { history, problems, entryById } = useMemo(
    () => ({
      history: entries.map(({ record }) => record),
      problems: new Map(entries.map(({ problem }) => [problem.id, problem])),
      entryById: new Map(entries.map((entry) => [entry.record.id, entry])),
    }),
    [entries],
  );
  const comparisonChoices = selected
    ? attemptComparisonChoices(selected.record, history, problems)
    : [];
  const otherAttempts = selected
    ? entries.filter(
        (entry) =>
          entry.identity === selected.identity &&
          entry.record.id !== selected.record.id,
      )
    : [];

  function updateFilters(update: Partial<JournalFilters>) {
    setFilters((current) => ({ ...current, ...update }));
    setLimit(PAGE_SIZE);
    setSelectedId(null);
    setComparisonId(null);
    entryButton.current = null;
  }

  const takeawaySource = selected?.record.takeawayPractice
    ? entryById.get(selected.record.takeawayPractice.sourceRecordId)
    : undefined;

  return (
    <section className="ribbon-journal" aria-label="Practice journal">
      <header className="ribbon-journal-head">
        <h1>Journal</h1>
      </header>
      <div className={styles.filters} role="group" aria-label="Journal filters">
        <label className={`ribbon-search ${styles.search}`}>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={filters.query}
            aria-label="Search journal"
            placeholder="Search problems, reflections, or outcomes"
            onChange={(event) => updateFilters({ query: event.target.value })}
          />
        </label>
        <div className={styles.controls}>
          <div>
            <label htmlFor="journal-outcome">Outcome</label>
            <select
              id="journal-outcome"
              value={filters.outcome}
              onChange={(event) =>
                updateFilters({
                  outcome: event.target.value as JournalFilters["outcome"],
                })
              }
            >
              <option value="all">All outcomes</option>
              {Object.entries(OUTCOMES).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
              <option value="pending">Reflection pending</option>
            </select>
          </div>
          <div>
            <label htmlFor="journal-source">Source</label>
            <select
              id="journal-source"
              value={filters.source}
              onChange={(event) =>
                updateFilters({
                  source: event.target.value as JournalFilters["source"],
                })
              }
            >
              <option value="all">All sources</option>
              {Object.entries(SOURCES).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="journal-date">Date</label>
            <select
              id="journal-date"
              value={filters.period}
              onChange={(event) =>
                updateFilters({
                  period: event.target.value as JournalFilters["period"],
                })
              }
            >
              {Object.entries(dateOptions).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="button secondary"
            disabled={!isFiltered}
            onClick={() => updateFilters(emptyFilters)}
          >
            Clear filters
          </button>
        </div>
        {filters.period === "custom" && (
          <div className={styles.customDates}>
            <label>
              From date
              <input
                type="date"
                value={filters.from}
                onChange={(event) =>
                  updateFilters({ from: event.target.value })
                }
              />
            </label>
            <label>
              To date
              <input
                type="date"
                value={filters.to}
                onChange={(event) => updateFilters({ to: event.target.value })}
              />
            </label>
          </div>
        )}
        {invalidDates && (
          <p role="alert" className={styles.meta}>
            Choose an end date on or after the start date.
          </p>
        )}
      </div>
      <div className={styles.layout}>
        <section
          aria-labelledby="journal-results-title"
          className={styles.results}
        >
          <h2
            id="journal-results-title"
            ref={resultsHeading}
            tabIndex={-1}
            className={styles.resultsTitle}
            aria-live="polite"
          >
            {matches.length} {matches.length === 1 ? "entry" : "entries"}
          </h2>
          {visible.length ? (
            <ul className={styles.entries}>
              {visible.map((entry) => (
                <li key={entry.record.id}>
                  <button
                    className={styles.entry}
                    type="button"
                    aria-label={`View entry: ${entry.problem.title}, ${shortDate(entry.record.completedAt)}, ${entry.outcome}`}
                    aria-pressed={entry.record.id === selected?.record.id}
                    aria-controls="journal-entry-detail"
                    onClick={(event) => {
                      setSelectedId(entry.record.id);
                      setComparisonId(null);
                      entryButton.current = event.currentTarget;
                      if (window.matchMedia("(max-width: 1000px)").matches) {
                        requestAnimationFrame(() =>
                          detailHeading.current?.focus(),
                        );
                      }
                    }}
                  >
                    <Bookmark
                      size={17}
                      fill={entry.record.reflectedAt ? "currentColor" : "none"}
                      aria-hidden="true"
                    />
                    <span className={styles.entryCopy}>
                      <strong>{entry.problem.title}</strong>
                      <span className={styles.meta}>
                        <EntryDate entry={entry} /> ·{" "}
                        {SOURCES[entry.record.source]}
                      </span>
                      {entry.record.takeaway && (
                        <span className={styles.preview}>
                          {entry.record.takeaway}
                        </span>
                      )}
                      <span className={styles.outcome}>{entry.outcome}</span>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ribbon-journal-empty">
              {isFiltered
                ? "No entries match these filters."
                : "Saved practice and imported attempts will appear here."}
            </p>
          )}
          {matches.length > visible.length && (
            <button
              className="button secondary"
              onClick={() => setLimit(limit + PAGE_SIZE)}
            >
              Show more entries
            </button>
          )}
        </section>
        {selected && (
          <JournalEntryDetail
            key={selected.record.id}
            entry={selected}
            otherAttempts={otherAttempts}
            headingRef={detailHeading}
            onCompare={comparisonChoices.length
              ? () => setComparisonId(selected.record.id)
              : undefined}
            takeawaySource={takeawaySource}
            onBack={() =>
              (entryButton.current?.isConnected
                ? entryButton.current
                : resultsHeading.current
              )?.focus()
            }
          />
        )}
      </div>
      {selected && comparisonId === selected.record.id && comparisonChoices.length > 0 && (
        <Modal
          title="Then / Now"
          className={styles.comparisonDialog}
          onClose={() => setComparisonId(null)}
        >
          <AttemptComparison
            selected={selected.record}
            choices={comparisonChoices}
            problemTitle={selected.problem.title}
            showHeading={false}
            renderRecordLink={(record) => {
              const entry = entryById.get(record.id);
              return entry && (
                <Link href={recordHref(entry, "/journal")} className="text-link">
                  Open original attempt <ArrowRight size={15} aria-hidden="true" />
                </Link>
              );
            }}
          />
        </Modal>
      )}
    </section>
  );
}

export function RibbonJournal({ recent = false }: { recent?: boolean }) {
  const { savedData, localDay, workspaceKey } = useWorkspace();
  const entries = useMemo(() => {
    const problems = new Map(
      savedData.problems.map((problem) => [problem.id, problem]),
    );
    return learningHistory(savedData).flatMap((record) => {
      const problem = problems.get(record.problemId);
      if (!problem) return [];
      return [
        {
          record,
          problem,
          identity: practiceIdentity(problem),
          day: localDate(new Date(record.completedAt)),
          outcome: record.outcome
            ? OUTCOMES[record.outcome]
            : "Reflection pending",
        },
      ];
    });
  }, [savedData]);
  return recent ? (
    <RecentJournal entries={entries} />
  ) : (<>
    <JournalBrowser
      key={workspaceKey}
      entries={entries}
      today={localDay || localDate()}
    />
    {desktopWorkspace() && <DesktopJournalThoughts />}
  </>);
}
