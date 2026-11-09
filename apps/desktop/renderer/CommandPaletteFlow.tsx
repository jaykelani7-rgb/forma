import { useMemo, useState } from "react";
import { normalizeCodeforcesIdentity } from "../../../packages/core/src/codeforces-identity";
import { AttemptComparison } from "../../../src/components/attempt-comparison";
import { attemptComparisonChoices } from "../../../src/lib/attempt-comparison";
import type { LearningRecord } from "../../../src/lib/learning";
import type { CompanionSnapshot } from "./api";
import { CommandPalette, type PaletteOption, type PalettePreview, type PaletteSection } from "./CommandPalette";
import { buildCommandPaletteIndex, getCommandPaletteRecord, matchesPaletteQuery, searchCommandPalette } from "./command-palette-search";

export type PaletteCommand = {
  id: string;
  title: string;
  detail?: string;
  meta?: string;
  keywords: string;
  run: () => void;
};

const kindLabels = {
  problem: "Problem",
  thread: "Saved thread",
  thought: "Saved thought",
  reflection: "Reflection",
} as const;

const formatDate = (date: string) => new Date(date).toLocaleDateString(undefined, { dateStyle: "medium" });

export function CommandPaletteFlow({
  snapshot, commands, shortcutLabel, onClose, onOpenDesk, onOpenProblem,
}: {
  snapshot: CompanionSnapshot;
  commands: readonly PaletteCommand[];
  shortcutLabel?: string;
  onClose: () => void;
  onOpenDesk: () => void;
  onOpenProblem: (url: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [recordId, setRecordId] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const index = useMemo(() => buildCommandPaletteIndex(snapshot), [snapshot]);
  const matches = useMemo(() => searchCommandPalette(index, query), [index, query]);
  const record = recordId === null ? undefined : getCommandPaletteRecord(index, recordId);
  const reflection = record?.reflection;
  const comparisonChoices = reflection ? attemptComparisonChoices(reflection, index.history, index.problems) : [];
  const comparing = compare && !!reflection && comparisonChoices.length > 0;
  const linkedProblem = record && normalizeCodeforcesIdentity(record.problem.url);
  const currentDesk = !!record && record.problemId === snapshot.state.problemId;
  function savedCode(attempt: LearningRecord) {
    if (!attempt.timedAttemptId) return [];
    return (snapshot.state.desk ?? []).filter(item => item.kind === "code" && item.problemId === attempt.problemId
      && item.sessionId === attempt.timedAttemptId);
  }
  const preview: PalettePreview | null = record && comparing ? {
    title: "Then / Now",
    eyebrow: "Practice comparison",
    sections: [],
    backLabel: "Back to reflection",
    body: <AttemptComparison key={reflection.id} selected={reflection} choices={comparisonChoices}
      problemTitle={record.problemTitle} compact showHeading={false} codeForAttempt={savedCode}/>,
  } : record ? {
    title: record.title,
    eyebrow: kindLabels[record.kind],
    meta: [record.kind !== "problem" ? record.problemTitle : "", formatDate(record.date)].filter(Boolean).join(" · "),
    sections: record.sections,
    actions: [
      ...(comparisonChoices.length ? [{ id: "compare", label: "Compare attempts" }] : []),
      ...(currentDesk ? [{ id: "desk", label: "Open problem desk" }] : []),
      ...(linkedProblem ? [{ id: "codeforces", label: "Open on Codeforces" }] : []),
    ],
  } : null;
  const sections: PaletteSection[] = [
    {
      title: "Actions",
      options: commands.filter(command => matchesPaletteQuery(`${command.title} ${command.keywords}`, query))
        .map(({ id, title, detail, meta }) => ({ id, kind: "action" as const, title, detail, meta })),
    },
    {
      title: query.trim() ? "Notebook matches" : "Recent notebook",
      options: matches.map(result => ({
        id: result.id, kind: result.kind, title: result.title, detail: result.detail,
        meta: [result.kind === "problem" ? "" : result.problemTitle, formatDate(result.date)].filter(Boolean).join(" · "),
      })),
    },
  ].filter(section => section.options.length > 0);

  function choose(option: PaletteOption) {
    if (option.kind === "action") commands.find(command => command.id === option.id)?.run();
    else {
      setCompare(false);
      setRecordId(option.id);
    }
  }

  return <CommandPalette query={query} onQueryChange={value => { setCompare(false); setRecordId(null); setQuery(value); }}
    sections={sections} preview={preview} shortcutLabel={shortcutLabel} onChoose={choose}
    onBack={() => { if (comparing) setCompare(false); else setRecordId(null); }} onClose={onClose}
    onPreviewAction={id => {
      if (id === "compare" && comparisonChoices.length) setCompare(true);
      if (id === "desk" && currentDesk) onOpenDesk();
      if (id === "codeforces" && linkedProblem) onOpenProblem(linkedProblem.url);
    }}/>;
}
