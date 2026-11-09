import { canonicalProblemIdentity, normalizeCodeforcesIdentity } from "../../../packages/core/src/codeforces-identity";
import { learningHistory, type LearningRecord } from "../../../src/lib/learning";
import { MISTAKES } from "../../../src/lib/memory-types";
import { DIFFICULTIES, OUTCOMES, type Problem } from "../../../src/lib/model";
import type { CompanionSnapshot } from "./api";

export interface CommandPaletteResult {
  id: string;
  kind: "problem" | "thread" | "thought" | "reflection";
  problemId: string;
  problemTitle: string;
  title: string;
  detail: string;
  date: string;
}

export interface CommandPaletteRecord extends CommandPaletteResult {
  problem: Problem;
  sections: { label: string; text: string }[];
  reflection?: LearningRecord;
}

type IndexedRecord = {
  record: CommandPaletteRecord;
  identity?: string;
  title: string;
  problemTitle: string;
  searchable: string;
  date: number;
};

type IndexedProblem = { problem: Problem; identity?: string; title: string; searchable: string };

type CommandPaletteIndex = {
  recent: IndexedRecord[];
  records: ReadonlyMap<string, CommandPaletteRecord>;
  history: readonly LearningRecord[];
  problems: ReadonlyMap<string, Problem>;
};

const MAX_RESULTS = 8;
const MAX_QUERY_LENGTH = 240;
const FILLER = new Set(["a", "an", "about", "all", "for", "find", "i", "me", "my", "show", "the", "to", "where", "with"]);

function normalize(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/\p{Mark}/gu, "").replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function queryTerms(phrase: string) {
  const words = phrase.split(" ").filter(Boolean);
  const meaningful = words.filter(word => !FILLER.has(word));
  return [...new Set(meaningful.length ? meaningful : words)];
}

export function matchesPaletteQuery(searchable: string, query: string): boolean {
  const terms = queryTerms(normalize(query.slice(0, MAX_QUERY_LENGTH)));
  const index = normalize(searchable);
  return terms.every(term => index.includes(term));
}

function excerpt(value: string) {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 150) return oneLine;
  const firstLine = Array.from(oneLine.slice(0, 302));
  return firstLine.length <= 150 ? oneLine : `${firstLine.slice(0, 150).join("").trimEnd()}…`;
}

function indexProblem(problem: Problem): IndexedProblem {
  const identity = canonicalProblemIdentity(problem);
  const code = identity?.split(":").slice(1).join("") ?? problem.problemCode;
  return {
    problem, identity, title: normalize(problem.title),
    searchable: normalize([problem.title, problem.platform, problem.problemCode, code, identity, ...problem.tags].join(" ")),
  };
}

export function buildCommandPaletteIndex(snapshot: Pick<CompanionSnapshot, "data" | "state">): CommandPaletteIndex {
  const handle = snapshot.state.handle?.toLowerCase();
  const problems = new Map(snapshot.data.problems.filter(problem => !problem.cfHandle || problem.cfHandle.toLowerCase() === handle)
    .map(problem => [problem.id, indexProblem(problem)]));
  const records = new Map<string, CommandPaletteRecord>();
  const recent: IndexedRecord[] = [];
  const add = (indexed: IndexedProblem, item: Omit<CommandPaletteRecord, "problem" | "problemId" | "problemTitle">, aliases: string) => {
    const { problem, identity } = indexed;
    const record = { ...item, problem, problemId: problem.id, problemTitle: problem.title };
    records.set(item.id, record);
    recent.push({
      record, identity, date: Date.parse(item.date),
      title: normalize(item.title), problemTitle: indexed.title,
      searchable: `${indexed.searchable} ${normalize([item.title, aliases, ...item.sections.map(section => section.text)].join(" "))}`,
    });
  };

  for (const indexed of problems.values()) {
    const { problem } = indexed;
    const sections = [{ label: "Platform", text: problem.platform }];
    if (problem.problemCode) sections.push({ label: "Problem code", text: problem.problemCode });
    if (problem.tags.length) sections.push({ label: "Topics", text: problem.tags.join(", ") });
    add(indexed, { id: `problem:${problem.id}`, kind: "problem", title: problem.title,
      detail: [problem.platform, problem.problemCode].filter(Boolean).join(" · "), date: problem.createdAt, sections }, "problem problems");
  }

  const notes = [
    ...snapshot.state.thoughts.map(thought => ({ ...thought, kind: "thought" as const })),
    ...(snapshot.state.desk ?? []).flatMap(item => item.kind === "thread" ? [{ ...item, kind: "thread" as const }] : []),
  ];
  for (const note of notes) {
    const problem = problems.get(note.problemId);
    if (!problem || !note.text.trim()) continue;
    const title = note.kind === "thread" ? "Saved thread" : "Saved thought";
    add(problem, { id: `${note.kind}:${note.id}`, kind: note.kind, title, detail: excerpt(note.text), date: note.createdAt,
      sections: [{ label: note.kind === "thread" ? "Next step" : "Thought", text: note.text }] }, "note notes next step");
  }

  const history = learningHistory(snapshot.data, { handle: snapshot.state.handle });
  for (const reflection of history) {
    const problem = problems.get(reflection.problemId);
    if (!problem || !reflection.reflectedAt || !reflection.outcome) continue;
    const outcome = OUTCOMES[reflection.outcome];
    const sections = [
      { label: "Outcome", text: outcome },
      { label: "Approach", text: reflection.approach ?? "" },
      { label: "Takeaway", text: reflection.takeaway },
      { label: "Notes", text: reflection.notes },
      { label: "What went wrong", text: reflection.mistakeNote ?? "" },
      { label: "Mistakes", text: reflection.mistakes?.map(mistake => MISTAKES[mistake]).join(", ") ?? "" },
      { label: "Difficulty", text: reflection.difficulty ? DIFFICULTIES[reflection.difficulty] : "" },
    ].filter(section => section.text.trim());
    const aliases = reflection.outcome === "hint" ? "hints" : "";
    add(problem, { id: `reflection:${reflection.id}`, kind: "reflection", title: outcome,
      detail: excerpt(reflection.takeaway || reflection.approach || reflection.notes || reflection.mistakeNote || ""),
      date: reflection.reflectedAt, sections, reflection }, `reflection reflections attempt attempts note notes ${aliases}`);
  }

  recent.sort((a, b) => b.date - a.date || a.record.id.localeCompare(b.record.id));
  return { recent, records, history, problems: new Map([...problems].map(([id, { problem }]) => [id, problem])) };
}

export function getCommandPaletteRecord(index: CommandPaletteIndex, id: string): CommandPaletteRecord | undefined {
  return index.records.get(id);
}

export function searchCommandPalette(index: CommandPaletteIndex, query: string): CommandPaletteResult[] {
  const rawQuery = query.slice(0, MAX_QUERY_LENGTH);
  const phrase = normalize(rawQuery);
  if (!phrase) return index.recent.slice(0, MAX_RESULTS).map(item => item.record);
  const terms = queryTerms(phrase);
  const identity = normalizeCodeforcesIdentity(rawQuery);
  const alternateIdentity = identity && /^\d/.test(phrase) ? identity.key.replace(/^contest:/, "gym:") : null;
  const requestedOutcome = Object.values(OUTCOMES).find(outcome => phrase.includes(normalize(outcome)));
  const wantsNotes = terms.includes("note") || terms.includes("notes");
  const best: { record: CommandPaletteRecord; score: number }[] = [];

  // The pre-sorted date order breaks ties without sorting all matches on every keystroke.
  for (const item of index.recent) {
    if (requestedOutcome && (item.record.kind !== "reflection" || item.record.title !== requestedOutcome)) continue;
    const sameIdentity = !!identity && identity.key === item.identity;
    if (identity) {
      if (!sameIdentity && item.identity !== alternateIdentity) continue;
    } else if (!terms.every(term => item.searchable.includes(term))) continue;
    let score = sameIdentity ? 100 : 0;
    if (item.title === phrase) score += 32;
    else if (item.title.startsWith(phrase)) score += 24;
    else if (item.title.includes(phrase)) score += 16;
    if (item.problemTitle.includes(phrase)) score += 8;
    if (item.record.kind === "problem") score += 4;
    if (wantsNotes && (item.record.kind === "thread" || item.record.kind === "thought")) score += 8;
    if (item.searchable.includes(phrase)) score += 2;
    const ahead = best.findIndex(result => result.score < score);
    if (ahead >= 0) best.splice(ahead, 0, { record: item.record, score });
    else if (best.length < MAX_RESULTS) best.push({ record: item.record, score });
    if (best.length > MAX_RESULTS) best.pop();
  }
  return best.map(item => item.record);
}
