# Local backup and replacement

The desktop uses the existing SQLite writer and canonical notebook model. **Settings → Local backup & restore** exports a versioned `forma-local-backup`, version 2. There is no additional database, cloud upload or account sync.

## Contents and compatibility

| Choice | Included | Kept outside this scope on restore |
| --- | --- | --- |
| Notebook only | Canonical problems, attempts, notebook settings, learning links, revisions, tracks, plans, contests and the unfinished session | Companion thoughts/evidence and Tutor history, provided their notebook references remain valid |
| Full companion | The notebook plus companion thoughts, platform evidence and selected problem | This device’s app preferences, credentials, folder permissions, login settings and executable configuration |
| Include Tutor, explicitly checked | All local Tutor conversations, submitted/partial turns, previous request provenance, proposals, durable drafts, available statement captures/code snapshots and Tutor preferences | Provider keys and ephemeral audio; neither is part of the backup |

Current measured session time is included and the exported session is paused. Imported historical `runningSince` values never create hours of offline practice. Frozen code file URIs, workspace IDs and timestamps remain provenance labels; restoring them does not read or execute a file or authorize a folder. Companion file bindings are removed from portable exports. API keys, pairing secrets, raw audio, live connections, machine launch paths and OS login settings are excluded. Device command journals, outbox delivery state and old internal recovery rows are not portable authority.

The separate **Export canonical notebook for Forma web** action retains the existing interoperable notebook format. The versioned local envelope is intended for desktop restore. Supported legacy input formats are explicitly migrated:

- Canonical Forma schema 1 or 2 → notebook replacement, using the existing notebook validator/migrations.
- `forma-companion`, version 1 → notebook and companion learning state; device bindings, journals, preferences and recovery history are not activated/imported. This legacy format did not include Tutor.
- `forma-tutor`, version 1 → Tutor-only replacement using the matching problems already in the notebook. Submitted immutable context and proposals survive; this format never contained unsent drafts or available capture/code stores.

Legacy limitations are shown before confirmation. Unsupported versions are rejected. Missing conversation/problem, capture/content or proposal/turn references are rejected. A draft may retain an already expired reference ID; a present reference to another problem/workspace is rejected. Its question survives with a review warning, without adopting the latest snapshot. Existing Tutor retention still applies after restore; old conversations and one-day code shares can expire. Keep the original chosen file for archival recovery.

## Validation and review

Files are limited to 64 MiB, depth 32 and two million parsed nodes. Strict envelope and Tutor/companion schemas reject unknown fields, malformed records, duplicate IDs, unsafe links, invalid immutable hashes, unsupported enums and references. Canonical notebook records reuse the established validator. Native limits also apply: 200 conversations, 200 turns/proposals per conversation, 6,000 characters per draft, 20 selected notes, and 32 MiB of Tutor storage. Imported counters have bounded headroom for future saves.

The preview lists counts and the exact replacement scope. This is replacement, not merge. A notebook replacement is rejected if retained companion/Tutor records would become orphaned; use a matching full backup, or explicitly export/delete those conversations first. Plans are reconciled using the existing planner projection. No learning outcome, attempt or elapsed time is invented.

## Recoverable replacement

Confirmation first flushes pending composer edits, then fences integration work. Before cancelling any persisted Tutor request or replacing data, the writer exports a full companion copy including Tutor/drafts. The host writes it exclusively with private permissions, flushes the file and directory, rereads it and verifies its SHA-256 and schema. If this fails, SQLite replacement does not start. A failed attempt can be retried with the same unexpired preview. Previews expire after ten minutes.

Recovery files live in `recovery-backups/` under the selected app-data directory. The success message shows the exact path. That file can be chosen in the same restore workflow. Keep it somewhere private. To avoid silent deletion, the folder refuses another restore at 20 files or 512 MiB; move older backups to safe storage before continuing.

After verification, active Tutor/voice work is stopped, prior editor/browser work is invalidated and replacement runs in one writer transaction. Any insertion, validation or quota failure rolls the transaction back. A new draft recovery epoch rejects delayed autosaves and submissions from the previous state. Integration commands carry the observed epoch and the writer checks it atomically; captures from an earlier restore require explicit review in VS Code. Local command receipts remain a replay fence. Renderer caches are refreshed only after commit. Timers resume paused; queued/streaming answers become interrupted. There is no automatic Send, Retry, transcription, model request, playback or code submission after recovery.

## Inspection and later manual checks

Use a temporary profile for inspection:

```sh
npm run companion:build
npm run extension:build
FORMA_COMPANION_DATA_DIR="$(mktemp -d /tmp/forma-inspect.XXXXXX)" npm run companion:start
```

Automated native recovery with disposable data and chosen-file dialogs:

```sh
npm run local:verify
```

Later, export notebook-only and full backups with/without Tutor, review their counts, restore in a disposable installed profile, and inspect the recovery file. Try a malformed file and an unwritable/full recovery folder; replacement should not occur. Restore a question with an expired code share and confirm it asks for context review. Keep actual Gemini/microphone testing and login-item changes separate and explicit.
