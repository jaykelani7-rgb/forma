# Everyday local reliability milestone

VS Code launch-on-demand, optional packaged macOS login startup, SQLite schema-5 Tutor drafts, independent setup observations and versioned local replacement/restore are implemented. Automatic launch uses paired connection errors, validated user/machine paths, one coalesced bounded startup and editor revalidation. Drafts use committed revisions and a recovery epoch. Restore verifies a full recovery file before one writer transaction, and fences previous callbacks/queued commands. Real installed startup/login changes, provider access and microphone behavior remain manual validation. See [launch](local-launch.md), [drafts](durable-drafts.md), [setup](setup.md) and [backup/recovery](local-backup.md).

# Forma Companion implementation status

Updated 20 October 2026. [Original design specification](blueprint.md). Baseline: `3be4cd4`. This milestone is an unsigned, local desktop development build. It is not the complete shipping product in the blueprint.

## Forma Tutor increment

Local contextual text conversations now support real host-only Gemini and OpenAI adapters. New installations default to Gemini; saved OpenAI setup and historical provenance remain compatible. Streaming/Stop/explicit Retry, safe Markdown/math, selected-code sharing, scoped statement capture, explicit context adoption, user-approved learning notes, contest mode and recorded voice are implemented. The existing SQLite writer migrates transactionally through schema 3 and 4 to 5, separating immutable statement content from current capture selection. Provider errors are typed and sanitized; provider switching cancels active work without losing partial answers or drafts. No account sync, public proxy, embedded operator key, source execution or automatic learning outcome was introduced. The user chose to configure a provider key later; live model quality and actual microphone/STT/TTS remain unverified, distinct from injected transport/audio tests.

The real VS Code registered action reached a local Tutor preview through paired transport/SQLite. The isolated real Electron app verified Gemini-default setup, encrypted independent provider keys, A→B→A statement recapture, explicit context adoption, preserved drafts, contest mode, restart and deletion with no renderer errors or provider calls. This milestone did not install or replace the user’s personal apps. Compiled-renderer fixtures exercise text streaming, cancellation, context removal, safe output, visible-answer exposure and voice races. Full setup/retention/budgets, provider sources and an end-to-end walkthrough are in [Tutor](tutor.md).

## Verdict follow-up and Today increment

Durable companion-side follow-ups now retain the timed session ID, canonical Contest/Gym identity (including split indices), public handle, original start/finish interval, immutable discovery deadline and separately bounded pending deadline. Finishing freezes attribution immediately; reflection may be saved before judging completes. Discovery lasts five minutes after Finish, pending evidence is checked for up to fifteen minutes from its first observation, and refresh remains explicit after the automatic windows close. An earlier final verdict does not stop discovery of newer submissions within the same timed interval. Restart retains deadlines and pauses coding time. Unassigned evidence, transient failures and expired checks never become invented attempts or wrong answers. Verified rejudges preserve the user's learning outcome.

Today is a read-only projection of `src/lib/practice-plan.ts`, reconciled by the SQLite writer on mutations, startup/import and local date/timezone changes. It uses the shared planned-session workflow for fresh track entries and upsolves. Resume selects the existing context without starting its timer; written recall preserves its selected activity and records no coding time. Later calls the existing activity decision API. The pet opens a compact Today glance when no session is open; remaining activities stay folded. No new automatic daily reminder is enabled.

Recognition and verdicts share one quiet attention slot. Routine recognition stays quiet during coding, results never expand/focus the window, and saved follow-up status remains accessible in Practice after a bubble expires. Existing final results do not replay on restart. Light/Ink, reduced motion, explicit prior-memory reveal and suggestion snooze remain available.

Limits: checks use the latest 100 public submissions and never claim a complete history scan. One batch checks at most four distinct handles through one paced adapter; identical in-flight requests are coalesced. Older completed attempts without a recorded Finish instant are not retroactively given new discovery windows. An older unfinished non-reflection session can acquire its follow-up on startup. Device-local follow-ups are in SQLite/full companion exports; ordinary notebook export/import preserves the canonical planner, measured attempts and reflections, but does not transfer background follow-up jobs. Full companion restore UI and journal archival remain future work. No live submission was made during verification.

## Automatic recognition increment

The current increment adds focus-aware, durable associations to the existing CPH detector. Known files restore context without re-confirming bindings or growing the capture journal/outbox; active/paused/reflection-pending sessions retain their own problem. Generation checks, exact metadata watching/retries, binding conflicts, forget/rename and frozen capture targets are implemented. The default remains opt-in. SQLite schema 1 migrates non-destructively through 2 to the current 5.

An optional macOS Chrome MV3 extension, separate scoped browser socket, length-prefixed Native Messaging host, exact origin allowlist and user-level install/uninstall scripts are buildable. Browser proposals freeze their client/file, expire/cancel, and are confirmed/saved through the real paired VS Code path. The real Extension Development Host test passed with the installed CPH version activated, controlled `.prob` fixtures, SQLite, SecretStorage, a simulated lost acknowledgement and the scoped browser delivery path. A live CPH import and a Chrome-loaded native/OS-credential round trip remain manual gates. Setup is in [automatic recognition](automatic-recognition.md).

## What works

- An actual Electron/React desktop app with original layered Fenn SVG artwork, twelve semantic states, Light/Ink/system themes, local Geist/Instrument Serif fonts, reduced motion, and hidden-window animation suspension.
- A small pet-only window and compact contextual cards for binding a Codeforces URL, explicitly timed practice, pause/resume, thoughts, reflection, prior memory and written recall. Hints and past observations require an explicit action. Suggestions can be snoozed; Tutor and spoken output are explicit optional actions.
- A single SQLite writer in a worker thread, WAL/full synchronous commits, runtime-validated canonical notebooks and companion state, immutable command receipts, replay-safe command IDs, local journal, outbox, recovery copies, bounded device captures, and separate interoperable notebook/full companion exports.
- Notes and reflections acknowledge only committed local data. An untimed thought never creates an attempt. Acceptance never chooses the learning outcome. Manual/imported timed linking stays explicit.
- Fifteen-second active timer checkpoints; suspend, screen lock and quit pause practice. Restart keeps the last durable time and pauses. A worker-level wall/monotonic comparison catches clock corrections before reads or writes advance the recovery timestamp.
- A paired local socket with protocol/version negotiation, bounded UTF-8 framing/queues, revocable OS-encrypted credentials, and acknowledgement after durable application. VS Code keeps credentials in SecretStorage and capture retries in workspace state.
- A real thin VS Code extension with explicit allowed folders, focus-aware automatic recognition, durable association lifecycle, Workspace Trust checks, remote-host limited mode, manual file/URL association, optional bounded read-only CPH metadata detection, thoughts and session commands, retry/recovery export, and optional invocation of CPH's own test command.
- Public submission checking reuses Forma's paced adapter and verifies author, exact namespace/index and temporal attribution. Ambiguous overlapping timed windows remain unassigned. Known rejudges update evidence while preserving reflection. Checks run for retained active discovery/pending follow-ups, plus explicit refresh, independently of the selected problem. They do not provide account authentication.
- The website consumes extracted canonical identity, shared final reflection writes, and an injected storage/lock sync engine. Its IndexedDB, routes, account endpoints, origin protection, tracks, imports and Contest Lab remain in place. No portable notebook schema change was introduced.

## Delivery phases

| Phase | State | Evidence / remaining work |
| --- | --- | --- |
| 0: baseline and spikes | Partly verified | Installed CPH source inspected; local socket tested; Electron and built-in SQLite ran on this Apple Silicon Mac; unsigned `.app` packages. Actual multi-display/Spaces/fullscreen behavior still needs human testing. |
| 1: shared boundaries | Implemented incrementally | `packages/core`, `contracts`, `sync`, `pet-ui`, `integrations`; web identity/reflection/sync consume the shared implementation. Other pure domain modules remain in their original files and are re-exported progressively. |
| 2: runnable local desktop slice | Implemented | Real SQLite, manual binding, sessions, thoughts, reflections, tray recovery, shortcut, placement/clamping, exports/import, and pet UI. |
| 3: VS Code + platform evidence | Implemented; live integration gate | Real extension bundle and version-specific metadata adapter; socket and evidence boundary tests. Actual Extension Development Host pairing, metadata recognition and browser proposal delivery passed with controlled inputs; the user’s live CPH import/session and newly submitted verdict still need manual verification. |
| 4: account continuity | Pending | Storage-independent sync engine is extracted and web regression-tested. Desktop account sign-in, native bearer API boundary, SQLite account workspaces/checkpoints, account-switch cancellation, schema writer negotiation and managed polling leases are not connected. Local copies continue through explicit canonical notebook export/import. |
| 5: recall and attention | Local planner/verdict milestone implemented | Shared Today activities, track/upsolve session context, explicit recall, retained bounded verdict follow-up and one quiet attention slot. Native and deterministic verification recorded below. |
| 6: optional Tutor | Personal development integration implemented | Real configurable host-only text/audio adapter and local conversations. Setup-later choice leaves live model/speech quality unverified. Deterministic practice works without credentials. |
| 7: refinement/distribution | In progress | Original layered art, bundled fonts, native screenshots, themed/motion checks, and unsigned arm64 packaging. Memory budget, complete native behavior/accessibility testing, signing/notarization, updater, VSIX distribution and Windows/Linux platform QA remain release gates. |

## Capability findings

Registered installed CPH version: **2026.10.1792170155**. Its inspected `activate()` returns no public result API. `cph.runTestCases` returns no verified test-result object. The supported adapter reads only its bounded `.prob` identity schema (`url`, `name`, `srcPath`, tests ignored) and exact source-path mapping. It never edits CPH metadata, owns its listener, or treats save/command completion as a passing test. Other versions require inspection and an explicit compatibility update. The manual URL fallback is always available.

The first desktop uses Electron's built-in `node:sqlite`, avoiding an independently compiled native database module. Packaging was tested on arm64, not inferred from a Node-only unit test. Packaged renderer content cannot make network requests; the host owns Codeforces calls. The renderer has context isolation, sandboxing, no Node integration, sender/main-frame validation, an allowlisted preload API and restricted external links.

The local-only outbox records durable obligations; it does **not** imply cloud delivery. Legacy companion exports include device-local file bindings and private captures; keep them private. Versioned local backups exclude imported binding authority, credentials and machine configuration. Canonical notebook backups omit companion-only thoughts/bindings. Versioned local backup/restore is implemented with explicit replacement scopes and pre-restore recovery files. Machine bindings, journals and credentials are not imported as portable authority. Legacy companion export remains supported with limitations shown in its restore preview. See local-backup.md.

## Verification

Exact commands, native results and release gates are recorded in [verification.md](verification.md). Visual references are in [screenshots](screenshots). Integration setup and manual checks are in [the extension README](../../apps/vscode-extension/README.md).

## Next milestone

Verify a real local VS Code/CPH-to-Fenn session, then implement desktop account identity and SQLite-backed use of the extracted revisioned sync engine through an explicit native API. Keep web origin validation intact. Resolve same-field conflicts before enabling automatic cross-client writes. Reduce/approve the measured desktop memory cost before calling the companion ready for everyday background use.
