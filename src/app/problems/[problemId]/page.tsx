import { LearningMemory } from "@/components/learning-memory";

export default async function ProblemMemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ problemId: string }>;
  searchParams: Promise<{
    from?: string | string[];
    revision?: string | string[];
    profile?: string | string[];
  }>;
}) {
  const { problemId: segment } = await params;
  let problemId = segment;
  try {
    problemId = decodeURIComponent(segment);
  } catch {
    // A malformed link can use the normal missing-problem state.
  }
  const query = await searchParams;
  return (
    <LearningMemory
      key={`${problemId}:${query.revision ?? ""}:${query.profile ?? "default"}`}
      problemId={problemId}
      from={typeof query.from === "string" ? query.from : undefined}
      initialRevision={
        typeof query.revision === "string" ? query.revision : undefined
      }
      profile={
        Array.isArray(query.profile) ? query.profile.join(",") : query.profile
      }
    />
  );
}
