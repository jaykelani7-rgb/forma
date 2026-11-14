import type { SamplePractice } from "./companion-sample";

export type WorkspaceView =
  | "Today"
  | "Practice"
  | "Tracks"
  | "Contests"
  | "Journal";
export type WorkspacePlan = {
  activeTrack: boolean;
  stage: number;
  contestDraft: string;
  contestNote: string | null;
  priority: "normal" | "high";
  queued: boolean;
  startedAtRevision: number | null;
};
export const emptyWorkspacePlan: WorkspacePlan = {
  activeTrack: false,
  stage: 0,
  contestDraft: "",
  contestNote: null,
  priority: "normal",
  queued: false,
  startedAtRevision: null,
};
export function upsolveReflection(
  plan: WorkspacePlan,
  practice: SamplePractice | null,
) {
  return plan.queued &&
    plan.startedAtRevision !== null &&
    practice &&
    practice.reflectionRevision > plan.startedAtRevision
    ? practice.reflection
    : null;
}
export function upsolveComplete(
  plan: WorkspacePlan,
  practice: SamplePractice | null,
) {
  const reflection = upsolveReflection(plan, practice);
  return !!reflection && reflection.outcome !== "Not solved yet";
}
