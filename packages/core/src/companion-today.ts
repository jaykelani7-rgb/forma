import type { Data } from '../../../src/lib/model';
import { practicePlanView, resolvePlanProblem } from '../../../src/lib/practice-plan';
/** Read-only projection of the shared saved planner. The writer owns reconciliation. */
export function companionToday(data: Data, now = new Date()) {
  const view = practicePlanView(data, now);
  const emptyMessage=view.plan?.status==='ended' ? "Today’s plan is ended. You can continue it on the website." : view.completed.length ? "Today’s activities are complete. Your notebook is ready when you return." : data.problems.length || data.tracks?.length ? "Nothing eligible today. Your saved schedules stay in place." : "Add a problem or import your notebook to begin.";
  return { emptyMessage, day: view.plan?.day ?? null, items: [view.primary, ...view.remaining].flatMap(item => {
    if (!item) return [];
    const choice = resolvePlanProblem(data, item);
    return choice ? [{ ...item, title: choice.problem.title, url: choice.problem.url, resume: !!data.session && data.session.problemId === choice.problem.id }] : [];
  }) };
}
