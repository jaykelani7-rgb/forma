# Optional durable accounts

Forma keeps working locally when the environment template is unset. No Supabase project was provisioned, connected, purchased, or deployed while implementing this feature. The committed migration and local PostgreSQL regression tests are ready for a project you choose to configure.

Supabase provides conventional email/password Auth and Postgres storage in one service. An application account is separate from the public Codeforces handle: knowing a handle, user ID, or URL never authorizes account reads or writes.

## Setup

1. Use a Supabase project you control, or run its local development stack. Enable email/password sign-in. Keep email confirmation enabled for real accounts. Configure Auth's Site URL and redirect allow-list for your actual Forma origin. Development uses `http://localhost:3001`; the local configuration includes it.
2. Apply the committed migrations in order: `supabase/migrations/20261004101222_durable_workspaces.sql`, then `supabase/migrations/20261009062036_shared_track_links.sql` if enabling Shared Tracks links. You can review and apply the SQL in the project's SQL Editor, or use the Supabase CLI migration workflow below. Existing projects that have the first migration need only the second; do not rerun the first migration over existing tables.
3. Keep `forma_private` **outside the Data API's exposed schemas**. Only `public` is required for the account and share RPCs. The migrations explicitly grant function access and enforce ownership. Anonymous Data API users have no access to the backing tables or share enumeration.
4. Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from Settings → API Keys. The key must begin with `sb_publishable_`. Secret and legacy service-role keys are rejected. These two values are public configuration; never put a private key into a `NEXT_PUBLIC_` variable.
5. Restart `npm run dev` or rebuild the production app. In Settings, create/confirm an account, sign in, and explicitly choose whether to copy the personal local notebook. Sample/demo data is excluded. Existing personal records are retained on this device.

For hosted Shared Tracks links, also set `SUPABASE_SECRET_KEY` to an `sb_secret_` key from the same project's Settings → API Keys, in the server environment only. Never name this variable with a `NEXT_PUBLIC_` prefix. Legacy service-role JWTs are not accepted by this configuration. Leave it unset if you want account sync without link publishing. Restart or rebuild after changing server configuration. No secret is required for local file export or local practice.

The share resolver uses this server-only key for one token-scoped RPC that returns approved curriculum only. Owner publication, listing and revocation still verify Auth server-side and use the user's scoped token; they do not authorize with the secret key or a supplied owner ID. The separate `forma_private.shared_tracks` table does not add fields to private workspace backups or change their schema. See [Shared Tracks links](shared-track-links.md) for permissions, immutable snapshots, limits and revocation behavior.

CLI commands, after reviewing the intended project:

```sh
npx supabase --help
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
npx supabase db advisors --linked --type all
```

For a local Supabase stack (Docker required):

```sh
npx supabase start
npx supabase db push --local
npx supabase db advisors --local --type all
```

The repository includes `supabase/config.toml`; do not initialize over it with `--force`. The local stack is optional and was not started during implementation. Set the environment values to that stack's public URL/publishable key when using it.

## Storage and conflict behavior

`GET /api/account` verifies the bearer access token through `auth.getUser(token)` and returns the account's ID/email. Both workspace endpoints repeat that server-side verification before any database query. A fresh scoped Supabase client sends that same user's token to Postgres; account transport uses no privileged key. Responses carry `Cache-Control: private, no-store` and vary by Authorization. The optional public-share resolver described above is a separate server-only path and cannot read private workspace snapshots through its RPC.

`GET /api/workspace` returns `{revision,data}`; a new account has revision 0 and `data: null`. `POST /api/workspace` accepts only `{data,baseRevision,operationId}`. All workspace fields and relationships pass the same strict backup validation as local records. The operation ID is a UUID retained across retries.

The database commit RPC derives ownership from `auth.uid()`, takes a transaction lock for that owner, and compares the supplied revision before writing. A mismatch returns HTTP 409 with the current workspace. The client merges compatible changes by stable identity; a genuine conflict stops the write and preserves a device recovery copy. Session notes and active sessions participate in this protection. There is no silent whole-workspace last-write-wins update.

The operation ledger stores a SHA-256 digest of the complete request and its original resulting revision. Retrying an identical request acknowledges the original commit without writing it again. Reusing an operation ID with different content is rejected. Replaying an old operation never reverts later revisions. Ledger entries contain identities/digests rather than duplicate notebook payloads; keep them while retries from old devices may arrive.

Account sync uses a per-account Web Lock to coordinate the pending operation across tabs. A browser without the Web Locks API keeps local records usable and reports that cloud sync needs a supported browser; it does not attempt uncoordinated writes. Cancelling sync on logout or switching workspaces preserves the pending operation for a later retry.

Each account has its own IndexedDB cache (`account:<verified account ID>`) and sync metadata. Personal and demo caches remain separate. Signing out or switching accounts closes the current sync context; pending local records remain in the relevant account cache. Export/import and recovery copies remain available. Explicit personal migration preserves IDs, timestamps, notes, reflections, provenance, scheduling and an active session; it only copies into an empty account workspace.

## Capacity and hosting

Forma supports canonical backups up to **64 MiB**, with consistent local persistence/export/import validation. Account API requests allow this payload plus a small JSON envelope. The database has a higher defensive JSONB allocation cap because JSONB adds internal overhead; the supported app payload remains 64 MiB. Records are never truncated to fit.

Some hosts and proxies enforce smaller request limits. Use a Node server/reverse proxy that accepts the supported request size, or configure a smaller account transport limit explicitly before promising large cloud sync. Preserve the browser-facing HTTP `Host` and protocol; write-origin checks use that host rather than Next's internal listening hostname and reject a different browser origin. A rejected cloud upload leaves the local record and backup recoverable. The default local Next.js server is used for development; no production proxy configuration or large live cloud transfer was verified.

## Checks and remaining verification

`tests/cloud.test.ts` runs the actual migration in PGlite PostgreSQL with Auth role fixtures. It verifies RLS account isolation, anonymous rejection, compare-and-swap conflicts, ownership reassignment rejection, stable-operation retries and mismatched-operation rejection. Route tests verify strict payload validation, request limits, no-store responses and server Auth verification before every read using deterministic HTTP fixtures.

`tests/share-links.test.ts` applies both migrations to PGlite PostgreSQL with separate owner, second-account, anonymous and service roles. `npm run test:share-links` builds a separate app and exercises the actual share routes against a loopback-only HTTP Auth/RPC fixture backed by those migrations. These checks cover SQL permissions, ownership, immutable publication, operation retries, quotas and revocation without contacting a real Supabase service. Fixture Auth responses do not verify hosted Auth, email delivery or a deployment's secret-key configuration.

These tests do not replace a real project acceptance check. After setup, verify two distinct accounts on separate browsers; confirm each sees only its own history, retry a pending write, make conflicting edits, migrate a personal notebook, export/restore, and test logout/offline recovery. Run the database advisors on that configured project. Real email delivery, the hosted Auth service, production database queries, advisor results and multi-device cloud transfers could not be verified without a provisioned service.

## Official documentation consulted

- [JavaScript Auth user verification](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database functions and invoker security](https://supabase.com/docs/guides/database/functions)
- [Explicit Data API grants change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [Current changelog](https://supabase.com/changelog)

The current changelog was reviewed, including the change requiring explicit Data API grants and the PostgreSQL minor-release notice. This implementation uses no affected custom operators or pgcrypto extension functions.
