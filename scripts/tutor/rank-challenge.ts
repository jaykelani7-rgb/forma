import { open, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { readChallengeRankingDataset } from "../../packages/tutor/challenge-ranking";
import { challengeRankingFixtureDataset } from "./challenge-fixtures";
import { compareChallengeRanking, mergeChallengeRankingDatasets } from "./challenge-ranker";

const maxFileBytes = 64 * 1024 * 1024;

async function loadDataset(path: string) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxFileBytes) throw new Error("Choose a regular ranking JSON file up to 64 MB.");
    const bytes = await file.readFile();
    if (bytes.byteLength > maxFileBytes) throw new Error("The ranking JSON file exceeds 64 MB.");
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    const embedded = value && typeof value === "object" && Object.hasOwn(value, "ranking")
      ? (value as { ranking: unknown }).ranking : value;
    return readChallengeRankingDataset(embedded);
  } finally {
    await file.close();
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    fixtures: { type: "boolean" }, dataset: { type: "string", multiple: true },
    label: { type: "string" }, output: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) {
    process.stdout.write([
      "npm run tutor:rank-challenge -- --fixtures",
      "npm run tutor:rank-challenge -- --dataset <export-or-report.json> [--dataset <another.json>]",
      "Optional flags: --label targeted|feedback --output <new-report.json>",
    ].join("\n") + "\n");
    return;
  }
  const paths = values.dataset ?? [];
  if (values.fixtures && paths.length) throw new Error("Choose synthetic fixtures or dataset files for this comparison.");
  if (paths.length > 32) throw new Error("Use up to 32 dataset files per comparison.");
  const datasets = [];
  for (const path of paths) datasets.push(await loadDataset(path));
  const dataset = paths.length
    ? mergeChallengeRankingDatasets(datasets)
    : readChallengeRankingDataset(challengeRankingFixtureDataset());
  const label = values.label ?? (dataset.source === "benchmark" ? "targeted" : "feedback");
  if (label !== "targeted" && label !== "feedback") throw new Error("Choose targeted or feedback for the comparison label.");
  const report = {
    ...compareChallengeRanking(dataset, label),
    input: paths.length ? "dataset" : "synthetic-fixtures",
  };
  if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });

  const { split, methods, training, commonLabeled, searchEffort } = report;
  const positive = label === "targeted" ? "targeted mismatches" : "helpful cases";
  process.stdout.write(`${paths.length ? "Local dataset" : "Synthetic fixtures"} · ${split.developmentProblems} development problems, ${split.holdoutProblems} held-out problems.\n`);
  for (const [name, method] of [["Original order", methods.original], ["Shortest first", methods.shortestFirst], ["Trained ranker", methods.trained]] as const) {
    if (!method) continue;
    const denominator = label === "targeted" && !method.unlabeledFirst ? method.challenges : method.labeledFirst;
    const result = denominator ? `${method.positiveFirst}/${denominator} first cases were ${positive}` : "No scored first cases";
    process.stdout.write(`${name} · ${result} (${method.labeledFirst} labeled, ${method.unlabeledFirst} unlabeled, ${method.noCandidate} without a case).\n`);
  }
  if (split.holdoutChallenges) {
    process.stdout.write(`${report.challengesWithPositiveCase}/${split.holdoutChallenges} held-out challenges had at least one positive case.\n`);
  }
  if (searchEffort) {
    process.stdout.write(`Search effort · ${searchEffort.scoredChallenges} scored challenges, ${searchEffort.unscoredChallenges} with incomplete labels.\n`);
    const mean = (cases: number | null) => cases === null ? "—" : cases.toFixed(2);
    for (const [name, method] of [["Original order", searchEffort.original], ["Shortest first", searchEffort.shortestFirst], ["Trained ranker", searchEffort.trained]] as const) {
      if (!method) continue;
      process.stdout.write(`${name} · ${method.found}/${searchEffort.scoredChallenges} found the intended bug, ${mean(method.meanCasesUntilMismatch)} cases on average when found, ${mean(method.meanCasesAttempted)} cases attempted overall.\n`);
    }
  }
  if (label === "feedback") {
    const percent = (rate: number | null) => rate === null ? "—" : `${Math.round(rate * 100)}%`;
    const ranker = methods.trained ? `, trained ${percent(commonLabeled.trained)}` : "";
    process.stdout.write(`On ${commonLabeled.challenges} challenges with feedback for every method’s first choice, original ${percent(commonLabeled.original)}, shortest ${percent(commonLabeled.shortestFirst)}${ranker}.\n`);
  }
  if (training.status === "insufficient-labels") process.stdout.write(`Trained comparison unavailable. ${training.reasons.join(" ")}\n`);
  if (values.output) process.stdout.write(`Saved comparison to ${values.output}.\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Challenge ranking could not complete."}\n`);
  process.exitCode = 1;
});
