# Daily reliability pass — 7 October 2026

This pass started from `84970a9` on `main`. The reported scheduling, premature import/discovery feedback, and missing activation/midnight reconciliation issues were reproduced or confirmed in that implementation. The existing Ink palette, learning provenance, revision checks, recovery copies, and original legacy storage are preserved. Tests use disposable synthetic notebooks; no real practice history was changed.

## Executed checks

- Whole-repository ESLint passed; the final session adjustment also passed its scoped lint check.
- Strict TypeScript passed, including the production build's generated route types.
- **110/110 unit and local integration tests passed.**
- **76 production browser tests passed; two hosted-account tests skipped.** The final complete desktop/mobile run used the rebuilt app with all session recovery changes and completed in 44 seconds.
- `npm run build -- --webpack` passed for all pages and API routes. This uses Next.js's supported Webpack builder. The default Turbopack builder was not retested in this pass; the earlier sandbox limitation is recorded in [verification.md](verification.md).
- `git diff --check` passed.

The first browser run caught a real enlarged-text grid overflow and several overly broad or incorrect selectors in newly added tests. The layout was corrected and the selectors now target the intended controls and errors; the complete final suite passed without weakening those assertions. Local server/browser networking required expanded tool permissions. No application check remains failed.

## Implemented changes

- **Later assisted attempts:** the dialog and scheduling reducer share the distinction between a completed earlier revisit and a deliberate current scheduling choice. A newly imported assisted attempt receives its configured default. Explicit dates and opt-outs remain deliberate, and editing an older reflection cannot overwrite a newer schedule. The browser regression completes a revisit, refreshes to import another attempt, then selects “Used a hint” in the actual dialog.
- **Persistence feedback:** Codeforces connection/import/disconnection, discovery preferences/dismissals, problem forms, revisit controls, timed reflection/discard, preference restoration, and reminder-time feedback wait for the save result. Synchronous action guards prevent duplicate writes; loading lasts through transaction completion. Failed/conflicting form drafts remain available with retry/export/recovery guidance. A failed timed reflection retains its form and session notes instead of falling through to an empty session page. Retries keep their record IDs.
- **Atomic fresh practice:** a fresh problem and its session enter the same workspace revision. Failure cannot save a dangling session or route to an uncommitted session. Normal practice requires an existing problem. Conflicting sessions keep the committed pair and a recovery copy of the full losing proposal.
- **Daily reconciliation:** initial load, workspace activation, cloud application, cross-tab refresh, local midnight, focus, and visibility return reconcile the active local calendar day. Calendar midnight arithmetic handles 23/25-hour DST days; a bounded periodic check also notices clock/timezone changes. Immutable handle/day membership keeps each batch at five, freezes empty batches once history exists, and never refills through later imports. New membership does not rewrite legacy dates, avoiding false conflicts between devices on different local dates. Existing backups migrate their recorded membership.
- **Today hierarchy:** an active session has “Continue session”; otherwise the existing eligibility rules choose the primary practice action. Fresh alternatives and filters sit behind a native keyboard-operable disclosure when a saved recommendation exists. Full collection access remains visible, approach tags stay hidden until requested, and reflections remain nearby. The narrow layout prevents enlarged text from widening the weekly-rhythm grid.

## Test boundaries

The local account suite uses fake IndexedDB, mocked transport/Auth HTTP responses, and the actual SQL migration in PGlite PostgreSQL. It checks account isolation, simultaneous compatible/conflicting edits, uncertain committed-write replay, offline work followed by reconnect, account switching during pending writes, and local edits made during upload. These results do **not** establish hosted Supabase authentication, email delivery, or cross-device behavior.

Catalogue tests invoke the actual exported `/api/catalogue` GET handler with its cache/parser: success, cached and concurrent reads, stale fallback/backoff, unavailable upstream with no fallback, and rejected query parameters. A separate public HTTP check against the built local route returned **200**, **11,425 problems**, and **11,152 rated problems**. The second GET had identical data and fetch timestamp (`2026-10-07T06:40:43.450Z`), confirming cache reuse. Live upstream failure was not forced; stale/unavailable behavior was verified with deterministic handler fixtures.

Browser tests run Chromium desktop and Pixel 7 emulation against the optimized local production build. Real IndexedDB transactions are held and then committed or aborted to verify timing, atomicity, retained drafts, conflict recovery, and suppressed stale completion after workspace switching. Calendar fixtures test an overnight tab, visibility return with suspended timers, and next-day workspace activation. Keyboard disclosure, hidden tags, 320px width with 50% larger text, both themes, and the mobile reflection footer are checked.

## Updated screenshots

Rendered desktop/mobile views were inspected. Today captures show the collapsed secondary discovery choice from the top of the page. Reflection captures show the scrollable form with its Save/Skip footer still reachable. Full-page mobile captures retain the fixed navigation at the original viewport position.

| Screen             | Ink                                          | Light                                          |
| ------------------ | -------------------------------------------- | ---------------------------------------------- |
| Desktop Today      | [Preview](forma-today-focus-desktop-ink.png) | [Preview](forma-today-focus-desktop-light.png) |
| Mobile Today       | [Preview](forma-today-focus-mobile-ink.png)  | [Preview](forma-today-focus-mobile-light.png)  |
| Desktop reflection | [Preview](forma-reflection-desktop-ink.png)  | [Preview](forma-reflection-desktop-light.png)  |
| Mobile reflection  | [Preview](forma-reflection-mobile-ink.png)   | [Preview](forma-reflection-mobile-light.png)   |

## Hosted checks still required

No Supabase service or authorized test-account credentials were configured. No infrastructure was created or deployed. To complete hosted verification, follow [cloud-setup.md](cloud-setup.md), use a disposable configured project with the committed migration, and rebuild after setting the publishable client environment values. Use two authorized throwaway accounts and independent browser contexts:

1. Sign into different accounts, create distinct disposable records, and verify each context sees only its own data. Requests that supply another owner ID must be rejected.
2. Sign both contexts into one test account. Make disjoint edits concurrently; reconnect/sync/reload both and verify both edits survive.
3. Edit the same field concurrently. Verify explicit conflict feedback, the committed value, and an exportable recovery copy of the other proposal.
4. Go offline in one context, edit notes/preferences, make a separate remote edit in the other, then reconnect. Verify merge/retry and durable state after reloading both.
5. Delay a write or its acknowledgement for account A, then switch to B or sign out. Verify no A data or completion message appears in B. Return to A and verify the pending operation retries with the same operation UUID.
6. Compare both durable notebooks after reload. Separately verify confirmation email delivery and a second physical device on the chosen host.

Optional hosted-account browser tests remain gated and must be reported as skipped until this setup exists. Catalogue cache/rate limiting remains process-local. Physical installation, real deployed service-worker upgrades, and closed-app notifications were not verified or added in this pass.
