# Verification record

For the **7 October 2026 reliability pass**, see [reliability-pass.md](reliability-pass.md) for current results, updated screenshots, and exact remaining hosted-account checks.

The following record covers the earlier improvement phase verified locally on **4 October 2026**. Browser tests use isolated workspaces and deterministic Codeforces/catalogue fixtures; the user's personal history is not a test fixture and was not replaced.

## Executed checks

- ESLint passed for the whole repository.
- Strict TypeScript and Next.js route type generation passed.
- **90/90 unit and integration tests passed.**
- The optimized production build passed, including account, workspace, catalogue, Codeforces, and manifest routes.
- **30 production browser tests passed** in Chromium desktop and Pixel 7 emulation; **two configured-account tests skipped** because a service and two test-account access tokens were absent.
- Eight rendered screenshots capture desktop/mobile Today and quick reflection in both Ink and light themes. Finite entry animations were disabled during capture so images show the final opacity. Five mobile navigation items share one row with at least 44px targets. Save/Skip remain visible while reflection content scrolls. No horizontal overflow was found in the tested views.

Commands and CI are in the root README and `.github/workflows/ci.yml`. The browser suite runs against a production build on port 3002. It uses fixtures rather than depending on a live Codeforces outage or catalogue response.

The final production build used `npm run build -- --webpack`. The tool sandbox denied the local port used by Turbopack's PostCSS processing even after requesting expanded permissions; Next.js's supported Webpack build completed successfully. The default build script and CI retain Turbopack.

## Reliability regressions

- Two stale IndexedDB clients retain both a newly added problem and another tab's preference edit. Concurrent edits to the same session notes keep the committed version and a recovery copy of the other version. Browser cases exercise cross-tab updates and conflict recovery.
- Original localStorage source records survive migration. Schema v1/v2 validation preserves IDs, notes, timestamps, review dates, and active-session state. Personal, demo, and account caches remain separate.
- Browser fixtures exercise a synchronous initial IndexedDB failure and restore an exported backup through the actual UI, then reload durable notes/history while checking the original legacy copy remains intact. A held real IndexedDB transaction aborts the first of two queued note edits; the latest draft stays visible/exportable and the original disk copy stays unchanged.
- A realistic backup with 140 large-note sessions exceeds the old 5 MB limit and roundtrips exactly. The shared supported limit is 64 MiB; validation and relationship checks remain strict. A 10,000-attempt, multi-year learning fixture verifies counts and source provenance without inferring elapsed time from submissions.
- Browser workflow adds and edits a problem; writes notes; pauses, reloads, and recovers a session; saves a reflection; exports an actual download; previews and restores it; and verifies saved preferences/theme after reload. Tests wait for confirmed durable saves before asserting recovery.
- Recent refreshes cannot discard unresolved Codeforces gaps or move the independent historical cursor backwards. Fixtures cover more new submissions than the refresh window, repeated refresh, moving head activity during pagination, pending verdict updates, partial failure, atomic retry, and gap closure by fetched identity ranges.
- Daily reflection batches stay capped at five per handle/day. Refresh, save, and skip preserve membership; historical unreflected attempts remain accessible. Strict validation rejects invalid merged batch relationships.
- Future revisits, deferrals, skips, and archives stay out of automatic suggestions. Explicit completion differs from rescheduling and suppressing a recommendation. Older reflection edits cannot resurrect a completed review; genuinely later practice can schedule another.

## Learning and discovery

- Imported-only progress displays real reflected outcomes, difficulties, topic practice, and latest reflection. Accepted-but-unreflected activity stays pending and adds no independent credit or measured minutes.
- A later independent timed solve after imported assistance produces a breakthrough. Cross-handle activity does not. Explicit links prevent duplicate credit and preserve original records, notes, minutes, and provenance; unlinking restores separate credit.
- Browser tests save an imported reflection, check its revisit schedule, link related attempts in the detail view, inspect imported-only progress, and verify an independent timed breakthrough. Deliberate future review dates stay stable.
- Discovery fixtures cover stable selection, range/topic filters, topic aliases, saved/accepted exclusions, distinct dismissals, missing ratings, insufficient candidates, stale catalogue fallback, and incomplete history notices. Tags are hidden until requested. Session composition differs across 15/30/60 minutes without promising solve times.
- Shared upstream pacing and request restrictions are tested with a deterministic clock/HTTP adapter. The official Codeforces API introduction and method documentation were consulted before implementation.

## Accounts and sync

- The actual committed migration ran in PGlite PostgreSQL with authenticated and anonymous role fixtures. Tests execute its invoker functions and RLS policies, checking ownership isolation, rejected ownership reassignment, revision conflicts, duplicate operation replay, and mismatched operation IDs.
- Route fixtures verify server-side `auth.getUser(token)` on every read/write, strict payloads, body limits, rejected supplied owner IDs, and private no-store responses. No privileged service key is used.
- Sync tests verify retry after uncertain acknowledgement, edits made during that retry, pending operation persistence, compatible merges against the correct base, separate account caches, coordinated concurrent sync, and cancelled uploads. Cloud status cannot claim synced while a pending operation or error remains.
- Fifteen deferred lifecycle regressions protect pending, failed, and newly committed notes during cloud reloads. Stale account keys, activation generations, and aborted operations cannot repaint a changed workspace. Storage failures keep the readable draft exportable. Explicit migration rechecks the intended empty account before copying.
- Optional browser account tests are read-only and gated by a configured service plus two tokens. Trace capture is disabled for that authenticated check. They were **skipped**, so they are not evidence of a live connection.

## Daily access and visual checks

- Real Chromium service-worker registration and offline navigation passed. A cold offline launch returns the reconnect page; reconnecting restores navigation. The public cache contains only allowlisted resources. API, authenticated, mutation, and cross-origin requests bypass it.
- A documented waiting-worker fixture checks that activation is disabled during an active session, becomes available after its reflection is durably saved, and does not navigate/reload the completed page. Saved notes remain intact. The fixture tests the application guard; it does not claim a real deployed version upgrade.
- Reminder browser tests verify disabled-by-default settings, persistence, in-app appearance after the configured local time, dismissal for the day, and suppression during/after practice.
- Ink uses black/charcoal surfaces, ivory primary actions, muted sage success, ochre review, and soft red errors. The light palette is preserved. On the Ink surface, measured token contrast ratios are 16.02:1 for primary text, 7.66:1 for muted text, 14.16:1 for primary-button text, 9.19:1 for success, 8.12:1 for review, and 8.44:1 for error. Labels/icons accompany status colors.
- Native dialogs retain focus containment and visible focus styling. Desktop/mobile footer geometry and navigation targets are asserted by the browser suite. Reduced-motion styles remain available.

| Screen             | Ink                                         | Light                                         |
| ------------------ | ------------------------------------------- | --------------------------------------------- |
| Desktop Today      | [Preview](forma-today-desktop-ink.png)      | [Preview](forma-today-desktop-light.png)      |
| Mobile Today       | [Preview](forma-today-mobile-ink.png)       | [Preview](forma-today-mobile-light.png)       |
| Desktop reflection | [Preview](forma-reflection-desktop-ink.png) | [Preview](forma-reflection-desktop-light.png) |
| Mobile reflection  | [Preview](forma-reflection-mobile-ink.png)  | [Preview](forma-reflection-mobile-light.png)  |

## Required setup and unverified behavior

No Supabase project was provisioned, purchased, connected, or publicly deployed. Apply the migration and configure the publishable environment values using [cloud-setup.md](cloud-setup.md), then verify real account sign-in, confirmation email delivery, database advisors, cross-device sync, and large transfers through the chosen production host. Local SQL/Auth fixtures do not establish that these hosted operations work.

A separate live request through the local catalogue route returned **11,425 problems**, including 11,152 with ratings. A second request returned the identical cached catalogue and fetch timestamp. This was a public read and did not alter the personal workspace. Automated API tests still use deterministic fixtures. The previous activity phase separately verified the public tourist profile and 50 submissions; neither public API check establishes account ownership. Catalogue caching/rate limiting are process-local and need shared coordination for multiple server instances.

Device installation was not performed. Cold offline launch deliberately offers reconnection rather than the full workspace. Reminders require the app to be open; closed-app/background notifications are not implemented. See [installation.md](installation.md).

Account setup and website hosting are separate from publishing the source repository.
