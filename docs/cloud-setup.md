# Optional durable accounts

Forma keeps working locally when the environment template is unset. No Supabase project was provisioned, connected, purchased, or deployed while implementing this feature. The committed migration and local PostgreSQL regression tests are ready for a project you choose to configure.

Supabase provides conventional email/password Auth and Postgres storage in one service. An application account is separate from the public Codeforces handle: knowing a handle, user ID, or URL never authorizes account reads or writes.

## Setup

1. Use a Supabase project you control, or run its local development stack. Enable email/password sign-in. Keep email confirmation enabled for real accounts. Configure Auth's Site URL and redirect allow-list for your actual Forma origin. Development uses `http://localhost:3001`; the local configuration includes it.
2. Apply `supabase/migrations/20261004101222_durable_workspaces.sql`. The CLI created this migration scaffold. You can review and apply the SQL in the project's SQL Editor, or use the Supabase CLI migration workflow below.
3. Keep `forma_private` **outside the Data API's exposed schemas**. Only `public` is required for the two account RPCs. The migration explicitly grants the authenticated role access to these invoker functions and enables ownership RLS on both backing tables; anonymous users have no access.
4. Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from Settings → API Keys. The key must begin with `sb_publishable_`. Secret and legacy service-role keys are rejected. These two values are public configuration; never put a private key into a `NEXT_PUBLIC_` variable.
5. Restart `npm run dev` or rebuild the production app. In Settings, create/confirm an account, sign in, and explicitly choose whether to copy the personal local notebook. Sample/demo data is excluded. Existing personal records are retained on this device.

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

`GET /api/account` verifies the bearer access token through `auth.getUser(token)` and returns the account's ID/email. Both workspace endpoints repeat that server-side verification before any database query. A fresh scoped Supabase client sends that same user's token to Postgres; no privileged key is used. Responses carry `Cache-Control: private, no-store` and vary by Authorization.

`GET /api/workspace` returns `{revision,data}`; a new account has revision 0 and `data: null`. `POST /api/workspace` accepts only `{data,baseRevision,operationId}`. All workspace fields and relationships pass the same strict backup validation as local records. The operation ID is a UUID retained across retries.

The database commit RPC derives ownership from `auth.uid()`, takes a transaction lock for that owner, and compares the supplied revision before writing. A mismatch returns HTTP 409 with the current workspace. The client merges compatible changes by stable identity; a genuine conflict stops the write and preserves a device recovery copy. Session notes and active sessions participate in this protection. There is no silent whole-workspace last-write-wins update.

The operation ledger stores a SHA-256 digest of the complete request and its original resulting revision. Retrying an identical request acknowledges the original commit without writing it again. Reusing an operation ID with different content is rejected. Replaying an old operation never reverts later revisions. Ledger entries contain identities/digests rather than duplicate notebook payloads; keep them while retries from old devices may arrive.

Account sync uses a per-account Web Lock to coordinate the pending operation across tabs. A browser without the Web Locks API keeps local records usable and reports that cloud sync needs a supported browser; it does not attempt uncoordinated writes. Cancelling sync on logout or switching workspaces preserves the pending operation for a later retry.

Each account has its own IndexedDB cache (`account:<verified account ID>`) and sync metadata. Personal and demo caches remain separate. Signing out or switching accounts closes the current sync context; pending local records remain in the relevant account cache. Export/import and recovery copies remain available. Explicit personal migration preserves IDs, timestamps, notes, reflections, provenance, scheduling and an active session; it only copies into an empty account workspace.

## Capacity and hosting

Forma supports canonical backups up to **64 MiB**, with consistent local persistence/export/import validation. Account API requests allow this payload plus a small JSON envelope. The database has a higher defensive JSONB allocation cap because JSONB adds internal overhead; the supported app payload remains 64 MiB. Records are never truncated to fit.

Some hosts and proxies enforce smaller request limits. Use a Node server/reverse proxy that accepts the supported request size, or configure a smaller account transport limit explicitly before promising large cloud sync. A rejected cloud upload leaves the local record and backup recoverable. The default local Next.js server is used for development; no production proxy configuration or large live cloud transfer was verified.

## Checks and remaining verification

`tests/cloud.test.ts` runs the actual migration in PGlite PostgreSQL with Auth role fixtures. It verifies RLS account isolation, anonymous rejection, compare-and-swap conflicts, ownership reassignment rejection, stable-operation retries and mismatched-operation rejection. Route tests verify strict payload validation, request limits, no-store responses and server Auth verification before every read using deterministic HTTP fixtures.

These tests do not replace a real project acceptance check. After setup, verify two distinct accounts on separate browsers; confirm each sees only its own history, retry a pending write, make conflicting edits, migrate a personal notebook, export/restore, and test logout/offline recovery. Run the database advisors on that configured project. Real email delivery, the hosted Auth service, production database queries, advisor results and multi-device cloud transfers could not be verified without a provisioned service.

## Official documentation consulted

- [JavaScript Auth user verification](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database functions and invoker security](https://supabase.com/docs/guides/database/functions)
- [Explicit Data API grants change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [Current changelog](https://supabase.com/changelog)

The current changelog was reviewed, including the change requiring explicit Data API grants and the PostgreSQL minor-release notice. This implementation uses no affected custom operators or pgcrypto extension functions.
