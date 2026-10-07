# Forma

A daily competitive-programming notebook with a clean light appearance and black-and-ivory **Ink**. Import a DOCX practice sheet into Tracks, practice in Forma or on Codeforces, reflect briefly, and keep a manageable revisit queue. Comfortable and Large text preferences apply across the app and work alongside browser zoom.

## Run locally

Requires Node.js 22 or later. CI uses Node.js 22.

```sh
npm ci
npm run dev
```

Open [localhost:3001](http://localhost:3001). For production:

```sh
npm run build
npm run start -- --port 3001
```

Local mode needs no account or environment variables. Optional account setup is documented in [docs/cloud-setup.md](docs/cloud-setup.md); the service was not provisioned or deployed during development.

## Daily workflow

1. Add a problem, import a DOCX sheet in Tracks, or connect a public Codeforces handle in Settings and import activity.
2. Today gives an active session priority, then an appropriate due revisit, then unfinished work from your active track. Fresh alternatives and discovery filters remain available below it. Choose 15, 30, or 60 minutes; these intentions do not predict solving time.
3. Pause, hide the timer, and write notes. A saved session survives navigation and reload.
4. Finish with an outcome, an optional difficulty, and a takeaway. Imported attempts support quick reflections without invented solving time.
5. Complete, reschedule, or intentionally practice a revisit. Skip today's recommendation or archive a problem without deleting its history.

Demo, personal, and each verified account use separate workspaces. Demo exploration and restoration cannot replace personal records. The first-use state stays welcoming; returning users see a compact Today view with the next action higher on the page.

| Route           | Purpose                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| `/` or `/today` | Stable daily reflection batch, due revisit, fresh discovery, practice rhythm            |
| `/problems`     | Collection, editing, sourced histories, explicit attempt links                          |
| `/tracks`       | DOCX preview/import, active track, unlocked stages, shared learning progress            |
| `/session`      | Persistent timer, notes, reflection                                                     |
| `/revisit`      | Recommended batch, full queue, completion, rescheduling, undo                           |
| `/progress`     | Shared learning outcomes, difficulties, topics, breakthroughs, measured time            |
| `/activity`     | Handle-scoped submissions, grouped attempts, reflections, older history                 |
| `/settings`     | Codeforces, optional account, preferences, appearance, backups, installation, reminders |

## Practice sheets and Tracks

Choose **Tracks → Import practice sheet** and upload a `.docx` containing Codeforces links or explicit problem IDs. Parsing takes place in your browser. The editable preview lets you correct identifiers, titles, ratings, hints and stage assignments, rename/reorder/remove stages, and reorder/remove problems. Counts disclose unresolved identities and duplicate memberships. Cancelling the preview creates no records. Confirmation saves the track, its stages/memberships and any new problems in one revision; a failed save retains the preview and supports a safe retry with the same IDs.

The supplied two-pointers sheet was verified against the real file: **100 problems in five ordered stages of 20, zero unresolved identities and zero duplicates**. Source titles, ratings, pattern hints, descriptions and suggested practice times are preserved. The sheet provides links and titles; **Open on Codeforces** opens full statements externally. Hints stay hidden until requested. PDF, OCR and older `.doc` imports are not supported. DOCX uploads are limited to 8 MiB with additional ZIP/XML resource limits.

All stages are unlocked. Set a track as active to use it on Today, or start any stage problem explicitly. After saving a focused reflection, choose **Next problem** or **Return to stage**; the next timer starts only when requested. Tracks reuse canonical Codeforces problems and the existing reflection/revisit history. Acceptance on the current connected handle and independent solving are separate dimensions. Independent reflections complete the track's learning progress; assisted and unsolved work still needs revision. Future revisit dates, skips, deferrals and archives remain respected by automatic selection.

Re-importing the same file offers the existing track or a deliberate copy; copies share problem history. Removing a track preserves its underlying problems, attempts, notes and revisit dates. Older backups receive empty track collections and Comfortable text defaults. See [docs/tracks-and-readability.md](docs/tracks-and-readability.md) for source acceptance, resource boundaries and verification.

## Learning and scheduling

The learning view combines timed sessions and Codeforces reflections while retaining source IDs and handles. Accepted activity remains **reflection pending** until a learning outcome is recorded. Only Forma sessions contribute measured minutes. Submission counts, accepted problems, practice attempts, and timed sessions are distinct metrics.

If a timed session and imported group describe the same attempt, explicitly link them in the problem history and choose which reflection supplies learning credit. Both original records remain intact. There is no automatic linking by time proximity and no cross-handle credit.

Default revisit intervals are tomorrow for an unsolved attempt, three days for editorial assistance, and five days for a hint. Settings can change these defaults from 1–90 days. Deliberate dates and opt-outs remain intact. Completing a revisit clears its schedule without claiming a successful solve; old reflection edits cannot reopen it, while a genuinely later assisted attempt receives its default. Future dates, deferrals, today's skips, and archived problems stay out of automatic suggestions. Intentional early practice remains available.

See [docs/learning-and-scheduling.md](docs/learning-and-scheduling.md) for provenance, scope, linking, practice-day definitions, and scheduling rules.

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

Next.js App Router, React, strict TypeScript, Tailwind CSS, Lucide icons, and self-hosted Geist/Geist Mono/Instrument Serif. Font licenses are in `public/fonts`.

- `src/lib/model.ts`: domain types, strict validation, timer, base scheduling.
- `src/lib/concurrency.ts` and `storage.ts`: capacity, three-way merge, transactional revisions, recovery.
- `src/lib/codeforces*.ts`: import boundaries, grouping, reflection batches, profile freshness.
- `src/lib/learning.ts`: derived sourced history and explicit linking.
- `src/lib/docx-import.ts`, `tracks*.ts` and `today-practice.ts`: bounded DOCX parsing, track membership/progress and daily priorities.
- `src/lib/catalogue.ts` and `discovery.ts`: catalogue and transparent selection rules.
- `src/lib/cloud-*.ts` and `supabase/migrations`: optional verified account transport and durable storage.
- `src/lib/reminders.ts`, manifest, and `public/sw.js`: daily access and safe offline behavior.

```sh
npm run lint
npx next typegen
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser suite starts the production server on port 3002 and uses isolated fixtures, leaving the normal personal workspace untouched. CI runs these checks on pushes and pull requests.

Latest local verification, **7 October 2026**: **160 unit/integration tests passed; 104 desktop/mobile browser tests passed; two hosted-account browser tests skipped** because disposable test credentials are absent. Lint, strict TypeScript, and the supported Webpack production build passed. The real DOCX, editable/cancellable previews, failed-save recovery, shared track history, focused practice, reflections, progress and reload were exercised end to end. Both themes, actual text contrast, keyboard dialogs, saved Large text, long names and narrow/reflow layouts were checked. Actual migration SQL was exercised in local PostgreSQL, including ownership, revisions and retry safety; these local fixtures do not establish hosted account behavior. See [docs/tracks-and-readability.md](docs/tracks-and-readability.md) for current results, screenshots and boundaries. [docs/reliability-pass.md](docs/reliability-pass.md) and [docs/verification.md](docs/verification.md) preserve earlier verification.
