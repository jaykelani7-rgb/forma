# My Practice Plan

Today keeps a small saved plan with one next action. Set **Today I have…** to the time you want to make room for, then start coding or written recall. The full revision backlog and manual problem choice remain available. Fresh discovery stays in a disclosure below the plan.

## Optional preferences

**Practice preferences** on Today and **My Practice Plan** in Settings offer a usual 5–180 minute budget, preferred weekdays, active track, optional target date and activity mix. Defaults use the existing session intention, all seven days and mixed revision. A notebook without history or a track can begin by adding a problem or choosing a fresh alternative.

The target date is context only. It supplies no readiness estimate or placement promise. Usual preference changes apply to newly created plans. An existing day's allocation changes through the explicit Today availability control; today's override does not change the usual preference. On a non-preferred day, automatic planning stays quiet unless a session is unfinished. Applying availability deliberately makes room for practice that day.

## Selection and stable ties

`src/lib/practice-plan.ts` is the shared candidate and plan service. It uses the existing canonical identity, shared coding/recall schedules, focus and track progression helpers. Today and its replacement choices use that same service.

The normal order is:

1. An unfinished Forma session, including a paused or overnight session.
2. Eligible coding upsolves, due coding reattempts and due written recall, ordered by their separate applicable dates.
3. The next eligible active-track problem, using existing stage and membership order.
4. Other eligible saved collection problems.

Within equal activity precedence and date, coding precedes written recall. Upsolve candidates precede other coding choices at that tie; high-priority upsolves precede normal-priority upsolves, then canonical identity and candidate key break ties lexicographically. Existing focus filtering applies when matching topics exist; otherwise the full eligible collection remains available. Collection fallback excludes finished active-track work and avoids treating imported-only submissions as new notebook coding problems without timed attempts. Future upsolve dates also suppress generic library/track coding for that identity while written recall remains independently scheduled.

**Mix in due revision** follows that order. **Make room for my track** keeps the strongest first activity, then puts the next eligible track problem ahead of additional revisions if time remains. Neither setting promises track work on a short day.

The automatic plan selects at most three pending activities and each canonical identity once. Personal and matching imported Codeforces records do not become accidental duplicates. Gym and contest namespaces and split indices remain distinct. If coding and recall are both due for one identity, Today explains that relationship and leaves the other activity in the backlog. A deliberate alternative can select the other activity; coding and recall schedules stay separate.

Archives, today's skips and future deferrals apply across matching records in the current profile. Future coding dates do not become due because recall is ready. Track work follows existing progression rules; an empty or completed track contributes no next-track candidate. Manual problem choice remains available.

## Honest time allocation

A daily budget is reserved practice time. Each activity gets an editable 5–180 minute timebox. New coding allocations start from the existing default session intention; written recall starts from ten minutes. Automatic selection clips allocations to the remaining budget and stops when less than five minutes remain, instead of filling a short day with every overdue item.

A sheet's suggested time is labeled source guidance. It does not become measured duration or a prediction of solving time. An explicitly edited timebox can exceed the remaining allocation; Today explains this and exposes the timebox editor before starting. An unfinished session keeps its actual timer, target and notes when availability changes.

Only saved Forma timed attempts supply measured historical duration. Imported submissions, quick reflections and written recall acquire no invented minutes. Allocated minutes stay separate from measured practice. A timebox can finish without a solve: an unfinished attempt is valid participation, with its actual outcome in the saved reflection.

## Lifecycle and completion evidence

A plan stores its local day, profile, budget, stable item IDs, existing problem/activity references, selected explanations and evidence. It does not copy learning history. Reloading keeps selected activities in place.

**Adjust this suggestion** exposes timebox editing, eligible replacement, today's skip and future deferral. Replaced or stale selections remain with a reason. Skip and defer produce no attempt or learning result; deferral retains the original coding and written-recall dates. A short plan is not automatically refilled after a deliberate skip.

**End today's plan** changes lifecycle only. Pending choices and completed evidence remain; an unfinished session stays available to resume. Continuing with an optional extra is explicit. Existing pending choices reopen; otherwise the service selects one eligible extra and makes room for a new editable allocation, up to the 180-minute daily limit. Continuing alone never starts a timer or records an outcome.

Starting planned coding resolves the current item, creates any needed fresh track problem and binds the session to its plan in one validated write. Completion follows a matching saved timed attempt, a saved quick reflection after selection, or a matching written-recall record. A bare imported acceptance does not create plan completion or claim an independent solve. Planning controls cannot create completion evidence.

Practice saved elsewhere, schedule edits, track-order or membership changes, archives, skips, deferrals and profile changes revalidate pending items. Stale selections keep a visible explanation; eligible replacements use the same service. Upsolve priority is saved with each selection. Changed automatic priority/order leaves an explained stale selection and current replacement; deliberate, started and ended choices stay attached to their original selection. Completed evidence and deliberate choices are retained. If a manual coding session starts for a default recall suggestion of the same identity, the plan explains that written recall remains independently due in the backlog.

If a personal timed event is deliberately linked to a different profile later, its original plan completion reference remains as explained stale evidence. It no longer adds participation to the former profile. A real saved record, identity, activity, date and later link provenance must validate; an unrelated later-day record cannot complete an older unbound plan through a backup.

## Local days, timezones and profiles

Plans use the app's local `YYYY-MM-DD` day and lowercase Codeforces handle, or personal scope. Midnight starts a new plan with the usual budget. A timer is never stopped or reset at midnight. The next day resumes any still-open session first. One saved overnight attempt may supply evidence to both plans that referenced its session; the original attempt and measured duration are never copied. An unbound older pending plan cannot be completed retrospectively by unrelated later-day practice.

Each plan records its creation timezone offset for completion-date attribution. Existing reconciliation checks detect timezone or clock changes. Selections for an already saved local day stay stable, and Today explains an offset change. Moving into a different local day selects that day's plan. Local-calendar handling supports daylight-saving changes without assuming a 24-hour day; it does not reconstruct travel or an intended home timezone.

An imported unfinished session belonging to a previously connected handle keeps its original scope until finished or closed. Other archived-profile evidence cannot become current-profile credit. Switching handles retains separate plans and histories. Personal, demo and verified-account workspaces keep their existing isolation.

## Recovery and compatibility

Optional preferences and plans extend schema version 2. Backups without these fields remain valid; helper defaults and a plan are derived on use. New exports retain references and explanations alongside original history. No account setup or SQL migration is added.

Plan writes use existing validation before workspace updates, IndexedDB revisions, compatible merging, recoverable conflicts, account transport and backup limits. Idle tabs apply current revisions and revalidate plans; cloud updates use the same reconciliation path.

During pending or failed writes, Today presents completion and its next action from the last durable workspace. Availability/preference drafts remain available with explicit retry and recovery guidance. A failed reflection cannot advance the displayed plan. Retrying the retained proposal does not rerun a replacement or invent completion; duplicate submissions cannot create a second session or activity record. Same-item conflicts retain the newer workspace and save the alternative proposal as a recovery copy.

Limits are 5,000 saved day/profile plans per workspace and 100 decisions/messages per plan, alongside the existing 64 MiB validated workspace capacity. Limits fail explicitly and preserve records; no history is silently truncated.

## Returning after a break

After at least seven local days since the latest applicable actual coding, contest participation or written-recall activity, Today can offer **Welcome back. Start with one short session?** It shows the last recorded date and lets you choose fifteen minutes or continue normally. Editing old reflection notes does not count as a new coding session. An actual contest start counts as participation; unattended expiry does not invent activity on its later deadline date. The offer does not infer inactivity from app visits, reset progress, penalize missed days or conclude that learning outside Forma stopped. Sparse or absent history produces no inactivity claim.

## Useful observations in Progress

Progress extends the existing period summaries. **Useful observations** shows dates, supporting record counts and links to exact saved history:

- Repeated mistake labels explicitly recorded on at least two reflected coding events in the selected range.
- Independent attempts in the range after an earlier assisted event for the same identity. Earlier assistance can precede the range and is shown separately.
- Saved topic tags with zero or one coding events in the range. This describes recorded coverage, not demonstrated understanding; current saved tags can change grouping.
- Due coding and written recall as of today, plus recall outcomes in the selected range. Current due dates are separate scheduling evidence, not measurements confined to the history range.

Linked timed/imported events count once and retain both originals. Acceptance, self-reported independence, coding practice and written recall remain distinct. Sparse evidence has an honest empty state: zero recorded practice does not imply weak performance. Observation links can open a read-only historical-profile view without changing the connected profile. Viewing an observation never silently changes today's plan.

## Verification and limitations

Executed locally on **8 October 2026**:

- **274 unit/integration tests passed**, including real IndexedDB abort/retry, account transport fixtures and local PostgreSQL ownership checks.
- **200 distinct desktop/mobile browser checks passed; two hosted-account checks skipped** for absent disposable credentials. Verification used a fresh production server with no automatic retries. The full run passed 198 checks; two new preference-retry checks passed on a focused rerun after their test selector was corrected to the displayed retry label. No application code changed between these runs.
- Lint, strict TypeScript and the Webpack production build passed. The default Turbopack build was not the build used for these checks.
- The complete availability → plan → timed activity → reflection/recall → plan → reload → Memory/Progress workflow was exercised. So were actual midnight sessions, cross-tab completion/rescheduling, failed starts and preferences, retained drafts, stable IDs, and explicit plan decisions without fabricated learning.
- Desktop/mobile screenshots were inspected in Light and Ink with Large text. Keyboard focus, reduced motion, long titles, 360 px/200% reflow and content above fixed navigation were checked.

Focused coverage lives in `tests/practice-plan.test.ts`, `tests/practice-plan-storage.test.ts`, `tests/practice-plan-session.test.ts`, `tests/learning-insights.test.ts` and the two practice-plan/insights browser specs. All browser fixtures use isolated workspaces and leave the normal personal workspace untouched.

| Screen                  | Light                                                     | Ink                                                      |
| ----------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Today, desktop Large    | [Screenshot](forma-plan-desktop-large-light.png)          | [Screenshot](forma-plan-desktop-large-ink.png)           |
| Today, mobile Large     | [Screenshot](forma-plan-mobile-large-light.png)           | [Screenshot](forma-plan-mobile-large-ink.png)            |
| Progress, desktop Large | [Screenshot](forma-plan-progress-desktop-light-large.png) | [Screenshot](forma-plan-progress-desktop-dark-large.png) |
| Progress, mobile Large  | [Screenshot](forma-plan-progress-mobile-light-large.png)  | [Screenshot](forma-plan-progress-mobile-dark-large.png)  |

Hosted-account end-to-end checks require disposable test credentials; local checks do not establish hosted operation. Planning uses recorded data and deterministic rules, without AI, weakness scores, mastery percentages or readiness predictions. Fresh discovery still needs its existing catalogue connection. This phase adds no notification service, leaderboard, Contest Lab or deployment.
