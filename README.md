# Forma

A daily competitive-programming notebook with a clean light appearance and black-and-ivory **Ink**. Contest Lab adds chosen practice contests, accurate submission evidence, optional reviews and deliberate upsolves. My Practice Plan keeps a small, explainable plan on Today from your availability, saved schedules and active track. Use Track Studio to upload a DOCX, PDF or image, paste Codeforces links/IDs, or build a manual track. Practice in Forma or on Codeforces, and use Learning Memory to revisit recorded approaches, mistakes and takeaways. Timed re-solves and written recall share a manageable revisit list. Comfortable and Large text preferences apply across the app and work alongside browser zoom.

## Run locally

Requires Node.js 22 or later. CI uses Node.js 22.

```sh
npm ci
npm run dev
```

Open [localhost:3001](http://localhost:3001). For production:

```sh
npm run build -- --webpack
npm run start -- --port 3001
```

Local mode needs no account or environment variables. Optional account setup is documented in [docs/cloud-setup.md](docs/cloud-setup.md); the service was not provisioned or deployed during development.

## Daily workflow

1. Add a problem, create a track in Track Studio from a document/image, pasted Codeforces links/IDs or a manual plan, or connect a public Codeforces handle in Settings and import activity.
2. Choose **Today I have…** or keep your usual optional budget. Today saves a small plan with an unfinished session first, due coding/written recall, then eligible track work. Explanations link to evidence. Edit a timebox, deliberately replace/skip/defer a suggestion, or choose a problem manually. Allocations do not predict solving time; fresh alternatives stay below the main plan.
3. Pause, hide the timer, and write notes. A saved session survives navigation and reload.
4. Finish with an outcome, an optional difficulty, and a takeaway. Imported attempts support quick reflections without invented solving time.
5. Saved activity updates the plan; an unfinished attempt counts as participation with its actual outcome. End today's plan without creating a learning result, or explicitly continue with an optional extra. The full revision backlog remains available. Archives, skips and deferrals preserve history.
6. Open Learning Memory from Problems, Tracks, Activity or Revisit. Optional mistake details stay collapsed in reflections. Explain an invariant or recall complexity and edge cases without counting the check as a new solve or timed session; Progress adds dated observations about explicitly recorded mistakes, later independent attempts, limited topic coverage and recall evidence, with supporting counts and history links.

Demo, personal, and each verified account use separate workspaces. Demo exploration and restoration cannot replace personal records. The first-use state stays welcoming; returning users see a compact Today view with the next action higher on the page.

| Route                                   | Purpose                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/` or `/today`                         | Saved My Practice Plan, availability, explainable next action, optional discovery and rhythm   |
| `/problems`                             | Collection, editing, sourced histories, explicit attempt links                                 |
| `/problems/[problemId]`                 | Learning Memory, original source records, editable reflections and revision checks             |
| `/tracks`                               | Track Studio upload/paste/manual preview, active track, stages and shared learning progress    |
| `/contests` and `/contests/[contestId]` | Create/resume practice contests, window-scoped evidence, reviews and upsolve queue             |
| `/session`                              | Persistent timer, notes, reflection                                                            |
| `/revisit`                              | Recommended batch, full queue, completion, rescheduling, undo                                  |
| `/progress`                             | Shared learning outcomes, dated evidence-based observations, topics and measured time          |
| `/activity`                             | Handle-scoped submissions, grouped attempts, reflections, older history                        |
| `/settings`                             | Practice Plan preferences, Codeforces/account, appearance, backups, installation and reminders |

## Contest Lab

Create a contest from saved library/track problems or the existing Codeforces catalogue. Review and edit the set before starting; hints stay hidden by default. Persisted deadlines survive reload and tab closure. Self-reported status, Codeforces acceptance and later learning remain separate. Optional reviews and an explicit upsolve queue feed the existing timed workflow and daily planner without replacing deliberate coding or recall dates. See [docs/contest-lab.md](docs/contest-lab.md) for timing, attribution, recovery, verification and limitations.

## My Practice Plan

Optional preferences cover your usual 5–180 minute budget, preferred practice days, active track, target date and room for track work versus due revision. Today's availability override keeps the usual preference unchanged. A target date supplies context and no readiness promise. Saved selections survive reload, use at most three pending activities and avoid selecting coding and recall for the same identity by default. Coding and recall keep independent due dates; the full backlog remains accessible.

Pending choices are revalidated when actual practice, schedules, memberships or workspace revisions change. A stale item keeps a visible explanation. Saved attempts, quick reflections and written recall supply completion evidence; planning controls never fabricate a solve or learning result. Failed writes keep drafts recoverable and Today uses the last durable records for completion until retry succeeds. A calm fifteen-minute return offer is based on recorded practice history, with no penalty for missed days.

See [docs/practice-plan.md](docs/practice-plan.md) for selection priorities and stable ties, honest time allocation, lifecycle and extras, overnight sessions, timezone/profile boundaries, recovery, Progress observations and limitations.

## Practice sheets and Tracks

Choose **Tracks → Import practice sheet**, **Paste Codeforces links or IDs**, or **Create manually**. DOCX, selectable-text PDFs, scanned/mixed PDFs and PNG/JPEG images all lead to the same editable preview. PDF text and hyperlink annotations are read first; scanned pages and images use local OCR, with an explicit all-page OCR option. Workers keep document processing off ordinary practice pages, and **Cancel processing** stops work without saving records. PDF/OCR engines are loaded only when requested. Their first use downloads application-owned assets from Forma’s origin; failed downloads can be retried. Offline document import is not claimed.

The preview shows unresolved, duplicate, review-required, excluded and included counts. Search and filter large tracks, collapse stages and open compact rows only when editing is needed. Correct titles, IDs, URLs, source ratings/hints, stage assignments and order; edit stage descriptions, suggested times and source notes. Add an individual problem, pasted batch or stage, and save an empty track if you want to plan later. Keyboard move controls remain available. Removing a stage moves its candidates to **Ungrouped**; explicit exclusion keeps candidates visible until confirmation. OCR source text, page/location, confidence and review reasons remain available for checking. Recognized ID format does not verify problem existence, and titles alone never supply an identity.

The supplied two-pointers DOCX fixture retains **100 problems in five ordered stages of 20, zero unresolved identities and zero duplicates**. Source titles, ratings, pattern hints, descriptions and suggested practice times remain intact. Full statements open externally through **Open on Codeforces**. DOCX uploads are limited to 8 MiB; PDFs/images to 20 MiB, PDFs to 40 pages and input images to 20 million pixels/8,000 pixels per side. Additional processing, extraction and parser limits are documented in [docs/track-studio.md](docs/track-studio.md). Older `.doc`, HEIC and other formats require conversion. English OCR works best with clear printed text; ambiguous characters and missing links need your review rather than guessed corrections.

All stages are unlocked. Set a track as active to use it on Today, or start any stage problem explicitly. After saving a focused reflection, choose **Next problem** or **Return to stage**; the next timer starts only when requested. Tracks reuse appropriate canonical Codeforces problems while keeping profile evidence separate. Contest and Gym namespaces, as well as split indices such as A1/A2, remain distinct. Existing shared coding dates and separate written-recall dates continue to apply. Acceptance on the current connected handle and independent learning progress remain separate.

Edit existing tracks in the same Studio. Unchanged stages and memberships keep stable IDs. Identity replacement reuses or creates the appropriate membership without assigning the previous problem’s history to it; removing memberships/tracks preserves underlying attempts, reflections, recall records and historical context snapshots. Unsaved edits require explicit discard. Failed validation or storage writes retain the draft for a safe retry with the same IDs. Re-importing the same file offers the existing track or a deliberate copy. Optional source notes/evidence extend schema 2 without changing account setup or SQL migrations. See [docs/track-studio.md](docs/track-studio.md) for workflows, dependency assets, limits and verification; [docs/tracks-and-readability.md](docs/tracks-and-readability.md) preserves the original DOCX acceptance results.

## Learning and scheduling

The learning view combines timed sessions and Codeforces reflections while retaining source IDs and handles. Accepted activity remains **reflection pending** until a learning outcome is recorded. Only Forma sessions contribute measured minutes. Submission counts, accepted problems, practice attempts, and timed sessions are distinct metrics.

If a timed session and imported group describe the same attempt, explicitly link them in the problem history and choose which reflection supplies learning credit. Both original records remain intact. There is no automatic linking by time proximity and no cross-handle credit.

Default revisit intervals are tomorrow for an unsolved attempt, three days for editorial assistance, and five days for a hint. Settings can change these defaults from 1–90 days. Deliberate dates and opt-outs remain intact. Completing a revisit clears its schedule without claiming a successful solve; old reflection edits cannot reopen it, while a genuinely later assisted attempt receives its default. Future dates, deferrals, today's skips, and archived problems stay out of automatic suggestions. Intentional early practice remains available.

See [docs/learning-and-scheduling.md](docs/learning-and-scheduling.md) for provenance, scope, linking, practice-day definitions, and scheduling rules.

Written recall suggests 7 days after independent recall, 3 after a cue and 1 when you cannot recall yet. Settings can change these intervals. Each save permits a date override or no further recall; the latest written check sets its next date while preserving a separate coding reattempt. Matching track and imported records share scoped schedule resolution, so an unscheduled copy cannot bypass a future revisit. Recorded identities cannot be casually reassigned in the generic editor. See [docs/learning-memory.md](docs/learning-memory.md) for the reliability fixes, data changes, scheduling rules and verification.

## Codeforces and fresh discovery

Connecting a public handle requires no Codeforces password or API key. Initial import reads 50 submissions. Manual recent refresh reads at most 150; older pages backfill separately. Coverage segments, unresolved gaps, and historical cursors survive repeated refreshes. Required pages commit together only after every request succeeds. Profile metadata has a separate freshness timestamp and is checked conservatively, at most daily.

Successive submissions for the same handle/problem group within two hours form a group; acceptance closes it. Stable group membership preserves reflections through verdict changes and historical pagination. This grouping never estimates solving duration.

Each handle receives a stable daily batch of at most five reflections. Loading, switching workspaces, cloud updates, local midnight, and visibility return reconcile that day's immutable membership. Saving, skipping, or importing more activity does not refill it that day. Timezone and DST changes use the local calendar. All historical attempts remain accessible in Activity. Switching or disconnecting handles retains their records and keeps learning scopes separate.

Fresh discovery uses a problem catalogue cached for 24 hours, with single-flight loading and a stale-cache fallback after upstream errors. Choose a rating range and optional topic. Known accepted, saved, and temporarily dismissed problems are excluded. Missing ratings and insufficient candidates receive explicit states. Incomplete imported history is disclosed; unseen problems are not claimed to have never been solved. Topic tags stay hidden until requested. Explanations distinguish generic rules from evidence in saved history.

The adapter follows the official [Codeforces API methods](https://codeforces.com/apiHelp/methods) and [request limit](https://codeforces.com/apiHelp). Activity and catalogue share 2.1-second request pacing, bounded timeouts, and transient retries. The limiter and catalogue cache are process-local; multiple server instances require shared coordination. New imports and uncached discovery need a running server with internet access. Automated checks use deterministic API fixtures; live calls are a separate check.

## Persistence, migration, and backups

IndexedDB stores revisioned workspaces. On first successful migration, Forma validates and copies the original schema v1/v2 personal and demo localStorage records, including notes and active timers. The original copies remain untouched, even after success. Missing optional fields receive backward-compatible defaults.

Writes reread the latest revision inside a transaction. Compatible edits merge by stable identity; changing preferences in one tab cannot erase a problem added in another. Same-field conflicts stop the write and retain a recovery copy, including session notes. Cross-tab notifications refresh idle tabs. Save indicators and completion messages wait for a successful write; failed forms retain their drafts and recovery guidance. Fresh problem creation and session start share one atomic revision. Workspace changes suppress stale completion feedback.

Persistence, export, and import share strict validation and a **64 MiB canonical JSON capacity**. Every successfully produced backup is accepted by the importer within that capacity. Existing per-record/count limits still apply; records are never truncated. Imports preview their contents, require explicit replacement confirmation, reject a concurrently changed workspace, and preserve a copy before replacement. Settings exposes recovery backups.

Storage-full, corrupt, or unavailable storage leaves originals intact and shows a recovery notice. Unsaved in-memory work remains available through workspace switching while the tab stays open; export it before closing. Clearing browser data removes device records. An optional account adds durable remote storage but does not replace backups.

Account reads and writes verify the session server-side and enforce ownership in Postgres. Sync uses revisions, stable operation IDs, compatible merges, recoverable conflicts, and separate account caches. Personal migration is an explicit copy into an empty account; demo data is excluded. See [docs/cloud-setup.md](docs/cloud-setup.md) for setup, security, transport capacity, and service checks still required.

## Installation and reminders

The manifest, icons, and service worker support installation in compatible browsers. An already loaded tab can continue local practice offline; a cold offline launch shows a deliberate reconnect page. Shared caches contain only allowlisted public fonts, icons, and that fallback page. API responses and credentials are never cached there. Updates wait for safe explicit activation and never reload an active page.

Reminders are opt-in, gentle, and **in-app only**. They appear on Today at the chosen local time while Forma is open and stay quiet during practice or after activity that day. No closed-app notification service is configured. See [docs/installation.md](docs/installation.md).

## Implementation and verification

Next.js App Router, React, strict TypeScript, Tailwind CSS, Lucide icons, and self-hosted Geist/Geist Mono/Instrument Serif. Font licenses are in `public/fonts`. Pinned PDF/OCR assets are prepared by `npm run prepare:imports`, also run automatically during installation, development startup and production builds; see [Track Studio dependency notes](docs/track-studio.md#dependency-preparation).

- `src/lib/model.ts`: domain types, strict validation, timer, base scheduling.
- `src/lib/concurrency.ts` and `storage.ts`: capacity, three-way merge, transactional revisions, recovery.
- `src/lib/codeforces*.ts`: import boundaries, grouping, reflection batches, profile freshness.
- `src/lib/learning.ts`: derived sourced history and explicit linking.
- `src/lib/memory*.ts`, `practice-state.ts` and `workspace-proposal.ts`: scoped learning evidence, written revision, shared scheduling and pre-exposure validation.
- `src/lib/document-import.ts`, `docx-import.ts`, `track-studio.ts`, `tracks*.ts` and `public/track-document*`: bounded local extraction/OCR, editable previews, track membership/progress and daily priorities.
- `src/lib/catalogue.ts` and `discovery.ts`: catalogue and transparent selection rules.
- `src/lib/practice-plan*.ts`: optional preferences, deterministic shared planning, saved selections and atomic planned session starts.
- `src/lib/learning-insights.ts`: transparent observations, supporting records and profile-scoped history links.
- `src/lib/cloud-*.ts` and `supabase/migrations`: optional verified account transport and durable storage.
- `src/lib/reminders.ts`, manifest, and `public/sw.js`: daily access and safe offline behavior.

```sh
npm run lint
npx next typegen
npm run typecheck
npm test
npm run build -- --webpack
npx playwright install chromium
npm run test:browser
```

The browser suite starts the production server on port 3002 and uses isolated fixtures, leaving the normal personal workspace untouched. CI runs these checks on pushes and pull requests.

Latest integration review verification, **8–9 October 2026**: **339 unit/integration tests and 256 desktop/mobile browser checks passed; two hosted-account checks skipped** for absent disposable credentials. Lint, strict TypeScript and the Webpack production build passed. Real PDF/OCR fixtures verify hybrid-page coverage and deliberate recovery. Browser regressions cover corrected upsolve outcomes, shared contest learning, priority-aware daily planning, retained drafts through navigation and failed saves, profile/workspace isolation and conflicting tabs. Revised active-contest screenshots were inspected in Light and Ink on desktop and mobile with Large text and long titles. See [docs/integration-review.md](docs/integration-review.md) for reproduced failures, resulting behavior, exact checks, screenshots and remaining limitations. Hosted cross-device operation remains unverified. No deployment was performed.

Prior My Practice Plan verification, **8 October 2026**: **274 unit/integration tests and 200 distinct desktop/mobile browser checks passed; two hosted-account checks skipped** for absent disposable credentials. The browser result combines the full regression run and a focused rerun of two corrected retry-button test selectors against the same final production build. Availability, real timed/recall completion, reload, Memory/Progress evidence, overnight sessions, cross-tab changes, failed saves and retries were exercised. See [docs/practice-plan.md](docs/practice-plan.md) for exact checks, screenshots, selection/lifecycle rules and limitations.

Prior Track Studio verification, **8 October 2026**: **221 unit/integration tests passed; 166 desktop/mobile browser tests passed; two hosted-account browser tests skipped** because disposable test credentials are absent. Lint, strict TypeScript and the Webpack production build passed. Real local OCR covered selectable, scanned, mixed and heading-overlay PDFs, forced OCR, PNG and JPEG. The existing 100-problem DOCX kept its five ordered stages. Upload/review/correction/save/practice, manual and pasted tracks, retained failed saves, retries, cancellation, worker cleanup, document errors and reload persistence were exercised. Track edits preserve original practice, reflections, written recall and source evidence, including separate Gym identities and unrelated profile history. Both themes, Large text, keyboard dialogs, reduced motion, long titles and narrow/200% reflow were checked, with inspected screenshots. Actual migration SQL was exercised in local PostgreSQL; these fixtures do not establish hosted account behavior. See [docs/track-studio.md](docs/track-studio.md) for formats, limits, English OCR and asset requirements, workflow details and screenshots. [docs/learning-memory.md](docs/learning-memory.md), [docs/tracks-and-readability.md](docs/tracks-and-readability.md), [docs/reliability-pass.md](docs/reliability-pass.md) and [docs/verification.md](docs/verification.md) preserve earlier verification.
