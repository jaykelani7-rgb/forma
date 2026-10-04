# Forma

A daily competitive-programming notebook with warm-paper and black-and-ivory **Ink** themes. Practice in Forma or on Codeforces, reflect briefly, and keep a manageable revisit queue.

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

1. Add a problem, or connect a public Codeforces handle in Settings and import activity.
2. Choose 15, 30, or 60 minutes on Today. Short practice favors a familiar revisit; longer practice can offer a revisit followed by a fresh problem. These are session compositions, not solve-time predictions.
3. Pause, hide the timer, and write notes. A saved session survives navigation and reload.
4. Finish with an outcome, an optional difficulty, and a takeaway. Imported attempts support quick reflections without invented solving time.
5. Complete, reschedule, or intentionally practice a revisit. Skip today's recommendation or archive a problem without deleting its history.

Demo, personal, and each verified account use separate workspaces. Demo exploration and restoration cannot replace personal records. The first-use state stays welcoming; returning users see a compact Today view with the next action higher on the page.

| Route           | Purpose                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| `/` or `/today` | Stable daily reflection batch, due revisit, fresh discovery, practice rhythm            |
| `/problems`     | Collection, editing, sourced histories, explicit attempt links                          |
| `/session`      | Persistent timer, notes, reflection                                                     |
| `/revisit`      | Recommended batch, full queue, completion, rescheduling, undo                           |
| `/progress`     | Shared learning outcomes, difficulties, topics, breakthroughs, measured time            |
| `/activity`     | Handle-scoped submissions, grouped attempts, reflections, older history                 |
| `/settings`     | Codeforces, optional account, preferences, appearance, backups, installation, reminders |

## Learning and scheduling

The learning view combines timed sessions and Codeforces reflections while retaining source IDs and handles. Accepted activity remains **reflection pending** until a learning outcome is recorded. Only Forma sessions contribute measured minutes. Submission counts, accepted problems, practice attempts, and timed sessions are distinct metrics.

If a timed session and imported group describe the same attempt, explicitly link them in the problem history and choose which reflection supplies learning credit. Both original records remain intact. There is no automatic linking by time proximity and no cross-handle credit.

Default revisit intervals are tomorrow for an unsolved attempt, three days for editorial assistance, and five days for a hint. Settings can change these defaults from 1–90 days. Deliberate dates remain intact. Completing a revisit clears its schedule without claiming a successful solve; old reflection edits cannot reopen it. Future dates, deferrals, today's skips, and archived problems stay out of automatic suggestions. Intentional early practice remains available.

See [docs/learning-and-scheduling.md](docs/learning-and-scheduling.md) for provenance, scope, linking, practice-day definitions, and scheduling rules.

## Codeforces and fresh discovery

Connecting a public handle requires no Codeforces password or API key. Initial import reads 50 submissions. Manual recent refresh reads at most 150; older pages backfill separately. Coverage segments, unresolved gaps, and historical cursors survive repeated refreshes. Required pages commit together only after every request succeeds. Profile metadata has a separate freshness timestamp and is checked conservatively, at most daily.

Successive submissions for the same handle/problem group within two hours form a group; acceptance closes it. Stable group membership preserves reflections through verdict changes and historical pagination. This grouping never estimates solving duration.

Each handle receives a stable daily batch of at most five reflections. Saving, skipping, or refreshing does not refill it that day. All historical attempts remain accessible in Activity. Switching or disconnecting handles retains their records and keeps learning scopes separate.

Fresh discovery uses a problem catalogue cached for 24 hours, with single-flight loading and a stale-cache fallback after upstream errors. Choose a rating range and optional topic. Known accepted, saved, and temporarily dismissed problems are excluded. Missing ratings and insufficient candidates receive explicit states. Incomplete imported history is disclosed; unseen problems are not claimed to have never been solved. Topic tags stay hidden until requested. Explanations distinguish generic rules from evidence in saved history.

The adapter follows the official [Codeforces API methods](https://codeforces.com/apiHelp/methods) and [request limit](https://codeforces.com/apiHelp). Activity and catalogue share 2.1-second request pacing, bounded timeouts, and transient retries. The limiter and catalogue cache are process-local; multiple server instances require shared coordination. New imports and uncached discovery need a running server with internet access. Automated checks use deterministic API fixtures; live calls are a separate check.

## Persistence, migration, and backups

IndexedDB stores revisioned workspaces. On first successful migration, Forma validates and copies the original schema v1/v2 personal and demo localStorage records, including notes and active timers. The original copies remain untouched, even after success. Missing optional fields receive backward-compatible defaults.

Writes reread the latest revision inside a transaction. Compatible edits merge by stable identity; changing preferences in one tab cannot erase a problem added in another. Same-field conflicts stop the write and retain a recovery copy, including session notes. Cross-tab notifications refresh idle tabs. Save indicators confirm when local writes settle; critical completion messages wait for a successful write.

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

Latest local verification: **90 unit/integration tests passed; 30 desktop/mobile browser tests passed; two configured-account browser tests skipped**. Lint, strict TypeScript, and the production build passed. The final build used `npm run build -- --webpack` because the tool sandbox blocked Turbopack's local processing port. Actual migration SQL was exercised in local PostgreSQL, including ownership, revisions, and retry safety. Both themes and mobile reflection controls were inspected in rendered screenshots. See [docs/verification.md](docs/verification.md) for evidence and remaining live-service limitations.
