# Forma

A personal competitive programming and DSA notebook. Warm paper or midnight black with violet accents, and a complete daily practice loop.

## Run locally

Requires Node.js 20.9 or later.

```sh
npm install
npm run dev
```

Open **http://localhost:3001**. Port 3001 avoids the other app already using port 3000 on this machine.

For production:

```sh
npm run build
npm run start -- --port 3001
```

## Your first session

1. Add a problem on Today or Problems. Names are required; links, IDs, ratings, and topics are optional.
2. Choose 15, 30, or 60 minutes and start. Solve in your editor or on the linked platform.
3. Pause, hide the timer, and write notes whenever you like. Leaving the page or refreshing preserves the session.
4. Finish with an outcome, an optional difficulty, and a one-line takeaway.
5. Revisit and Progress update from that saved attempt.

The clearly marked demo is a separate workspace. Exploring, modifying, or importing demo records never replaces personal records. “Go to my workspace” returns to your own data.

## Routes

| Route | Purpose |
| --- | --- |
| `/` or `/today` | Session suggestion, weekly rhythm, three revisits, a recent breakthrough |
| `/problems` | Searchable, filterable collection; add/edit details and read complete attempt histories |
| `/session` | Timestamp-based timer, persistent notes, quick reflection |
| `/revisit` | Small recommended batch, full queue, rescheduling, retirement with undo |
| `/progress` | Independent/assisted attempts, difficulties, weekly sessions, later independent solves, topic practice |
| `/settings` | Public Codeforces connection, revisit defaults, practice preferences, themes, JSON export/import |
| `/activity` | Handle-scoped public submissions, grouped practice attempts, quick reflections, older activity |

## Review and selection rules

This is a transparent schedule, not AI personalization:

- Still need to understand it: **tomorrow**.
- Editorial-assisted attempts: **3 days**.
- Hint-assisted attempts: **5 days**.
- Change these defaults in Settings (1–90 days). Existing chosen dates remain intact.
- Imported independent solves need no mandatory revisit; choose completion or a later review (7 days suggested). Timed independent revisits still suggest **7, 14, 28, then 30 days**, with a date override or completion available before saving.
- First-time independent solves and retired revisits stay out of the queue unless a later attempt needs help.
- Dates never incur penalties. Reschedule or retire any revisit.

Today prioritizes ready revisits, then unattempted problems, then the least recently attempted problem. CP and Placement preferences narrow the pool using saved topics; shared DSA topics support both. If no topics match, the full collection is used and the interface explains the fallback.

## Data and privacy

The notebook, platform history and reflections stay in this browser's local storage. A small Next.js API adapter reads public Codeforces activity. There is no authentication or device sync. Clearing browser data removes the notebook; export backups periodically. Use one active tab when editing a workspace.

Schema v2 exports include problems, timed attempts, public-profile metadata, platform submissions, imported practice attempts, quick reflections, settings, theme, and the active session. Schema v1 notebooks migrate automatically, preserving notes, timers, manual history, and existing revisit dates. Storage keeps the original personal/demo slot names for compatibility. Download the JSON or copy the displayed JSON into a `.json` file. Import checks the schema, types, limits, dates, IDs, relationships, and external link protocols, then shows a preview and requires confirmation before replacing the current workspace. Files are limited to 5 MB.

Corrupted saved records are preserved. When storage cannot be read or written, the app continues in memory and shows a notice. Mode switching preserves in-memory work; export it before closing the tab. Importing a checked backup with explicit confirmation retries persistence.

## Implementation

- Next.js App Router, React, strict TypeScript, Tailwind CSS, Lucide icons.
- Self-hosted Geist, Geist Mono, and Instrument Serif; font licenses are in `public/fonts`.
- `src/lib/model.ts`: domain types, scheduling, suggestions, demo records, import validation, progress derivation. Change `BRAND` here to rename the product.
- `src/lib/storage.ts`: small persistence adapter, with independent personal/demo keys. Replace this adapter to add a backend.
- `src/components/provider.tsx`: workspace lifecycle, theme, local persistence, sessions, and gentle feedback.
- `src/app/globals.css`: design tokens, deliberate dark theme, responsive shell, readable layout, reduced-motion support.
- Native HTML dialogs contain keyboard focus and restore it when closed. Mobile navigation and main actions have generous touch targets.

## Verification

```sh
npm run lint
npm run typecheck
npm run test
npm run build
```

Twenty-two deterministic tests cover Codeforces deduplication, verdict updates, partial failures, reflection preservation, profile scopes, API pacing and normalization, migration, as well as background-safe timing and recovery, review intervals and retirement, focus-aware selection, demo evidence, import validation and roundtrips, and unavailable/corrupt storage. Browser checks cover public profile preview, Today, activity, quick reflection, date overrides, Revisit, both themes, and mobile layouts. Live requests returned the public tourist profile and 50 submissions; daily reflection tests used isolated demo fixtures. See `docs/verification.md` for the browser checks and screenshots.

## Codeforces workflow and boundaries

1. In Settings, enter a public handle, preview the returned profile, then choose **Connect and import**. No password, API key, or other setup is required.
2. The initial import reads the latest **50 submissions**. Manual refresh reads up to **150**, stopping at a known boundary when possible. Load older activity one page at a time. Coverage and any unfilled gap stay visible; statistics refer to imported records.
3. Up to **five recent imported attempts** enter the daily reflection batch. Today shows at most **three different problems**. Older attempts remain available on Activity without becoming daily tasks. Skipping removes the task from the batch; the reflection remains available later.
4. Reflect independently of the platform verdict. An accepted but unreflected submission never counts as independent understanding. Imported attempts contribute no timed sessions or inferred minutes.
5. Revisit dates follow local calendar days. Event timestamps use UTC ISO strings. Newer reflected attempts control automatic scheduling; editing an older reflection cannot replace that schedule. A deliberately chosen date or opt-out is preserved unless explicitly changed.

Submissions for the same handle and problem group when successive submissions are within **two hours**; acceptance closes an attempt. A later submission starts a separate attempt. Existing group membership stays stable when a pending verdict changes, and older failed submissions may be prepended without changing a saved group's ID. These timestamps define grouping only, never solving duration.

Platform problems use canonical contest/index or alternate problemset/index identities, scoped to their original handle. Manual notebook problems remain separate, with their notes and session histories. Changing or disconnecting a handle retains all imported history; Activity and Progress can inspect saved profiles. Revisit includes the manual notebook and the currently connected profile.

The adapter uses anonymous [user.info and user.status](https://codeforces.com/apiHelp/methods), with fixed upstream URLs and validated query parameters. It follows the [one-request-per-two-seconds limit](https://codeforces.com/apiHelp), pacing starts at 2.1 seconds, using 8-second upstream timeouts and at most one transient retry. Required pages commit atomically after every request succeeds. Refreshes update verdicts in the recent window, and older pages also reconcile matching submissions. There is no continuous or automatic polling.

A running Node/Next.js server with internet access is required for new imports. Saved records, reflections and the queue remain usable offline. The current limiter is process-local, appropriate for this local application; deployment across multiple server processes would require coordinated pacing. Browser storage and backup size limits still apply.
