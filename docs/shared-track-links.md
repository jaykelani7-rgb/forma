# Shared Tracks v2: unlisted links

Shared Tracks links publish an explicitly reviewed curriculum snapshot. Anyone possessing an active link can preview it without signing in, then choose **Add to my Forma** to review and import an independent copy. A link is unlisted, not confidential. There is no public directory, search, collaborative editing, view counter or automatic update of imported copies.

Local `.forma-track.json` export remains available without an account or hosted service. The portable file still uses `format: "forma-track"` and `version: 1`; “v2” names this product phase, not a new curriculum-file version. See [Shared Tracks v1](shared-tracks.md) for the file schema, canonical identities, duplicate comparison and import behavior.

## Publish deliberately

Open a saved private track and choose **Share track**. The dialog captures the last durably saved curriculum and shows the exact stage order, repeated memberships, titles, canonical Codeforces URLs, available source ratings, suggested practice times and included text. Descriptions and pattern hints start excluded. **Share description** starts blank; type any public attribution there yourself. Forma never derives attribution from an account, email address or Codeforces handle. Check the full preview before downloading or publishing.

To create a link, sign in and open the track in that account's workspace. A configured share service is required. Acknowledge **I understand anyone with this link can view the snapshot**, then choose **Create share link**. The link appears only after the server confirms persistence. If setup is absent, the dialog explains that link sharing is unavailable and keeps **Download track file** available; it does not show a placeholder link or claim success.

Publication stores a frozen curriculum in a separate table. Editing the original private track does not change it. Publish revised content to create a different snapshot and link; older links remain available until you revoke them. Importing, editing, activating or practising a track never publishes it automatically.

## Public-data boundary

The server rebuilds the v1 allowlist from the submitted file, validates it, normalizes supported identities and serializes it again. It does not accept a client's claim that a payload is already safe. Unknown fields are rejected rather than stored. The database independently checks the approved schema and limits.

The anonymous response contains only `{ file: <approved curriculum> }`. The curriculum includes track title and optional share description, ordered stages and their selected descriptions/times, and ordered problem memberships with titles, supported canonical identities, source ratings and selected hints. Intentional repeated memberships remain separate. Contest and Gym namespaces, and split indices such as A1/A2, remain distinct.

The allowlist excludes account identity, email addresses, handles, authentication data, internal workspace IDs, attempts, submissions, progress, acceptance status, personal notes, reflections, recall cues, mistake labels, schedules, daily plans, contests, drafts, recoveries, source files, local filenames and extracted document evidence. Owner-management identifiers, publication operations and dates are absent from public responses.

Curriculum prose may contain whatever its author typed, including text the author would rather keep private. Optional-text controls and the exact preview support human review; Forma does not detect private information inside prose. Descriptions, hints and attribution are rendered as text. They cannot execute HTML, and publication does not fetch URLs found in prose. Supported problem links open externally on Codeforces; recognizing an identity does not verify that a problem exists or certify its source rating.

## Preview and reviewed import

`/share/[token]` introduces Forma and shows the title, optional description, stage and membership counts, expandable stages, supported difficulty metadata and hints behind their own disclosures. Light, Ink and Large text controls work without initializing a notebook. Merely opening a public preview does not create, reconcile or sync a visitor's personal workspace.

**Add to my Forma** opens the existing Track Studio preview. Local mode requires no account. Before confirmation, the visitor can edit the curriculum, inspect unresolved or duplicate identities and choose whether an equivalent curriculum should open the existing track or be imported as a deliberate separate copy. No curriculum is saved from viewing the link or opening the editor. Activation and starting practice remain explicit actions.

Confirmation allocates fresh local track, stage and membership IDs, reuses underlying problems through the existing identity/profile rules and preserves the recipient's own history and coding/recall schedules. The sender's progress supplies no learning credit. Failed saves retain the reviewed draft and its IDs for a stable retry. Workspace/account changes invalidate older callbacks and close the old workspace's preview.

The link is resolved again immediately before an import save. A revoked or unavailable link blocks that new import while keeping the review available for correction or retry. A completed import is independent: later private edits or revocation cannot update or remove it or its learning history.

## My shared tracks and revocation

**My shared tracks** at `/tracks/shared` lists the signed-in owner's publication title, date and active/revoked status. Active records offer **View snapshot**, **Copy link** and **Revoke link**. A revocation dialog explains its effect before confirmation. The private original remains intact.

Revocation makes later public resolutions and import checks unavailable. It cannot erase bytes someone has already seen or saved, an exported file, an imported curriculum or a screenshot. An already visible page does not receive a push notification; it revalidates when revisited or returned to the foreground. An import always performs a fresh check before saving. Retrying a previously successful publication operation after revocation returns that same revoked publication and does not reactivate it.

The public route is dynamic, with no-store page/API/CDN headers, noindex/nofollow/noarchive metadata and no-referrer policy. Share previews are not added to a sitemap. The service worker caches only its existing explicit list of fonts, icons and offline fallback resources; it does not cache share pages, API responses or curriculum data. Navigating offline shows the reconnect fallback. Noindex and cache directives reduce indexing and stale delivery; possession of a valid token is what grants access to an active unlisted snapshot.

## Ownership, tokens and retries

Every create, list and revoke route verifies the bearer token with the existing server Auth path. Database helpers derive ownership from `auth.uid()` and reject unauthenticated and anonymous Auth users. Client-supplied owner IDs and query parameters are rejected. Row-level security keeps one authenticated account from selecting another account's publication records. Clients cannot directly write the immutable snapshot table; narrow functions create snapshots or set revocation only for their verified owner.

The database generates each token from two independent cryptographically random version-4 UUIDs, producing 64 lowercase hexadecimal characters with 244 random bits. Tokens are not sequence IDs. Anonymous clients cannot list shares, read the backing table or execute the private resolver directly. The application server's secret-key client can execute the token resolver; that function returns only an active approved curriculum. Keep `forma_private` outside Supabase's exposed schemas and the secret in the server environment.

Publication uses an operation UUID scoped to the verified owner. The database serializes publications for an owner, returns the original successful result on an identical retry and rejects reuse of an operation ID with different content. A dialog busy guard blocks double clicks. The browser retains the operation for a content digest in account-scoped session storage across lost responses, dialog closes and reloads; when session storage is unavailable, the open dialog retains it in memory. After losing that browser session, inspect **My shared tracks** before deliberately publishing the same content again. Separate fresh publication operations may create separate links.

Requests are aborted and completion feedback suppressed after workspace/account changes. A request already accepted by the server may finish for the original owner; it must appear only in that owner's management view. This guard does not cancel a database commit already completed.

## Setup and limits

Use the existing optional Supabase account setup in [cloud-setup.md](cloud-setup.md). Apply these versioned migrations in order:

1. `supabase/migrations/20261004101222_durable_workspaces.sql`
2. `supabase/migrations/20261009062036_shared_track_links.sql`

Set `NEXT_PUBLIC_SUPABASE_URL` and an `sb_publishable_` `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the same project, plus an `sb_secret_` `SUPABASE_SECRET_KEY` in the server environment only. Restart or rebuild after configuration changes. Account workspace transport continues to use verified user tokens, with its existing revision/conflict/recovery behavior. Leaving the secret unset disables links while retaining local file export and independently configured account sync. No new workspace-backup schema is required; hosted publication records are stored separately.

| Limit                 | Behavior                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Curriculum file       | At most 5 MiB of serialized UTF-8 JSON; request/response envelopes have an additional bounded 4 KiB allowance                                      |
| Curriculum records    | At most 100 stages and 1,000 problem memberships, including repeats                                                                                |
| Titles                | Required, at most 240 characters                                                                                                                   |
| Descriptions          | At most 5,000 characters for share description or a stage description                                                                              |
| Suggested time / hint | At most 240 / 2,000 characters                                                                                                                     |
| Problem code / URL    | At most 60 / 2,000 characters; publishing requires a resolved, canonical supported Codeforces identity                                             |
| Source rating         | Integer from 0 through 10,000, or null                                                                                                             |
| New publications      | At most 10 per owner in a rolling hour and 100 total records per account, including revoked records; successful-operation replays remain available |
| Management list       | At most 100 owner records; no anonymous listing endpoint                                                                                           |
| Burst protection      | Per application process: 1,200 total share requests per minute, plus 120 per IP and 120 per verified owner; at most 2,048 current buckets          |
| Network waits         | Server provider requests time out after 20 seconds; browser share requests after 25 seconds                                                        |

The SQL publication quota is durable across application processes. The HTTP burst limiter is process-local; deployments with multiple instances need shared upstream rate limiting. A reverse proxy must replace untrusted inbound forwarding headers before passing a reliable `X-Forwarded-For` address. Without that configuration, forwarded addresses can be spoofed or requests can share one bucket; the global process ceiling still applies. Preserve the browser-facing HTTP `Host` and protocol: origin checks use that host rather than Next's internal listening hostname, and do not authorize from an arbitrary forwarded host. Configure hosts and proxies to preserve no-store headers and accept the documented request size; a server build alone does not establish those production properties.

## Verification

The implementation includes local checks at three layers:

- Unit and route tests check the v1 allowlist on the server, private-field rejection, format/URL/size errors, missing setup, no-store responses, bounded burst limiting and authorization before management.
- `tests/share-links.test.ts` applies the actual committed migrations in PGlite PostgreSQL with fixture Auth functions and distinct authenticated, second-account, anonymous and service roles. It exercises ownership RLS, direct-access denial, immutable writes, operation retries/mismatches, quotas, revised snapshots and revocation.
- `npm run test:share-links` builds an isolated production app in `.next-share-links` and runs desktop/mobile browser checks at port 3003 against a loopback-only Auth/RPC fixture at port 54399 backed by those same migrations. The test service is never imported by production routes. It uses disposable accounts and synthetic curricula, including the existing 100-problem, five-stage DOCX fixture. No real personal track is published.

Verified locally on **19 October 2026**:

- **368 unit/integration tests passed**, including the actual PostgreSQL migration, v1 file-format and storage regressions, direct database validation, quotas, RLS ownership and browser-facing origin checks.
- **278 ordinary desktop/mobile browser checks passed; two live hosted-account checks were skipped** because disposable hosted credentials are absent. The run used four workers and zero retries. Shared Tracks v1, real PDF/OCR imports, contest learning, upsolves, practice planning, draft retention and workspace isolation remain covered.
- **24 link-specific desktop/mobile browser checks passed** with two workers and zero retries against the isolated production build and local PostgreSQL fixture. Together the two suites passed **302 browser checks**.
- Full lint, strict TypeScript checking, the ordinary Webpack production build and the isolated publishing-fixture Webpack production build passed. Browser static assets were checked for the fixture server secret and did not contain it.
- The complete flow exercised review → publication → anonymous preview → isolated local import/edit/save → deliberate activation → timed practice/reflection → Memory/Progress → owner revocation. Subsequent access failed while the imported copy and its learning records remained available. The real 100-problem, five-stage fixture retained curriculum order and metadata through publication and import.
- Tests also exercised lost-response retries, double confirmation, real IndexedDB transaction failure with retained IDs, a delayed publication across a real cross-tab account switch, private edits versus new publications, real service-worker/offline/history revocation behavior, unsupported and unsafe responses, literal shared text, missing-configuration file-export fallback, keyboard disclosures, long titles, reduced motion and 360-pixel/200% reflow.

Four public-preview screenshots were visually inspected with Large text:

| View    | Light                                                | Ink                                                |
| ------- | ---------------------------------------------------- | -------------------------------------------------- |
| Desktop | [Preview](forma-link-public-desktop-light-large.png) | [Preview](forma-link-public-desktop-ink-large.png) |
| Mobile  | [Preview](forma-link-public-mobile-light-large.png)  | [Preview](forma-link-public-mobile-ink-large.png)  |

The workflow pass found and corrected valid-browser-origin rejection caused by Next's internal hostname, and stabilized the accessible label on a nonempty imported share description. Fixture-only corrections covered cross-origin test headers, canonical timestamps and waiting for completed sync/save operations before comparing durable records.

Local fixtures do not establish a configured Supabase project's Auth behavior, production PostgREST grants, production proxy/CDN behavior, advisor results or cross-device hosted delivery. With a disposable hosted project, apply both migrations, run database advisors, and verify two real accounts, anonymous access, retries, account switching, revocation and independent imports against the deployed origin before describing hosted acceptance as complete. No deployment or real personal-track publication was performed.
