# Forma Companion implementation status

Updated 20 October 2026. [Original design specification](blueprint.md). Baseline: `3be4cd4`. This milestone is an unsigned, local desktop development build. It is not the complete shipping product in the blueprint.

## Automatic recognition increment

The current increment adds focus-aware, durable associations to the existing CPH detector. Known files restore context without re-confirming bindings or growing the capture journal/outbox; active/paused/reflection-pending sessions retain their own problem. Generation checks, exact metadata watching/retries, binding conflicts, forget/rename and frozen capture targets are implemented. The default remains opt-in. SQLite schema 1 migrates non-destructively to 2.

An optional macOS Chrome MV3 extension, separate scoped browser socket, length-prefixed Native Messaging host, exact origin allowlist and user-level install/uninstall scripts are buildable. Browser proposals freeze their client/file, expire/cancel, and are confirmed/saved through the real paired VS Code path. The real Extension Development Host test passed with the installed CPH version activated, controlled `.prob` fixtures, SQLite, SecretStorage, a simulated lost acknowledgement and the scoped browser delivery path. A live CPH import and a Chrome-loaded native/OS-credential round trip remain manual gates. Setup is in [automatic recognition](automatic-recognition.md).

## What works

- An actual Electron/React desktop app with original layered Fenn SVG artwork, twelve semantic states, Light/Ink/system themes, local Geist/Instrument Serif fonts, reduced motion, and hidden-window animation suspension.
- A small pet-only window and compact contextual cards for binding a Codeforces URL, explicitly timed practice, pause/resume, thoughts, reflection, prior memory and written recall. Hints and past observations require an explicit action. Suggestions can be snoozed; sound and AI are absent.
- A single SQLite writer in a worker thread, WAL/full synchronous commits, runtime-validated canonical notebooks and companion state, immutable command receipts, replay-safe command IDs, local journal, outbox, recovery copies, bounded device captures, and separate interoperable notebook/full companion exports.
- Notes and reflections acknowledge only committed local data. An untimed thought never creates an attempt. Acceptance never chooses the learning outcome. Manual/imported timed linking stays explicit.
- Fifteen-second active timer checkpoints; suspend, screen lock and quit pause practice. Restart keeps the last durable time and pauses. A worker-level wall/monotonic comparison catches clock corrections before reads or writes advance the recovery timestamp.
- A paired local socket with protocol/version negotiation, bounded UTF-8 framing/queues, revocable OS-encrypted credentials, and acknowledgement after durable application. VS Code keeps credentials in SecretStorage and capture retries in workspace state.
- A real thin VS Code extension with explicit allowed folders, focus-aware automatic recognition, durable association lifecycle, Workspace Trust checks, remote-host limited mode, manual file/URL association, optional bounded read-only CPH metadata detection, thoughts and session commands, retry/recovery export, and optional invocation of CPH's own test command.
- Public submission checking reuses Forma's paced adapter and verifies author, exact namespace/index and temporal attribution. Ambiguous overlapping timed windows remain unassigned. Known rejudges update evidence while preserving reflection. Checks run only for an active session or a recent pending verdict, plus explicit refresh. They do not provide account authentication.
- The website consumes extracted canonical identity, shared final reflection writes, and an injected storage/lock sync engine. Its IndexedDB, routes, account endpoints, origin protection, tracks, imports and Contest Lab remain in place. No portable notebook schema change was introduced.

## Delivery phases

| Phase | State | Evidence / remaining work |
| --- | --- | --- |
| 0: baseline and spikes | Partly verified | Installed CPH source inspected; local socket tested; Electron and built-in SQLite ran on this Apple Silicon Mac; unsigned `.app` packages. Actual multi-display/Spaces/fullscreen behavior still needs human testing. |
| 1: shared boundaries | Implemented incrementally | `packages/core`, `contracts`, `sync`, `pet-ui`, `integrations`; web identity/reflection/sync consume the shared implementation. Other pure domain modules remain in their original files and are re-exported progressively. |
| 2: runnable local desktop slice | Implemented | Real SQLite, manual binding, sessions, thoughts, reflections, tray recovery, shortcut, placement/clamping, exports/import, and pet UI. |
| 3: VS Code + platform evidence | Implemented; live integration gate | Real extension bundle and version-specific metadata adapter; socket and evidence boundary tests. Actual Extension Development Host pairing, metadata recognition and browser proposal delivery passed with controlled inputs; the user’s live CPH import/session and newly submitted verdict still need manual verification. |
| 4: account continuity | Pending | Storage-independent sync engine is extracted and web regression-tested. Desktop account sign-in, native bearer API boundary, SQLite account workspaces/checkpoints, account-switch cancellation, schema writer negotiation and managed polling leases are not connected. Local copies continue through explicit canonical notebook export/import. |
| 5: recall and attention | Initial deterministic slice | Shared written-recall scheduling, coding due queries, explicit memory reveal, snooze and quiet badges work. More nuanced resume/revision selection and conflict UI remain. |
| 6: optional intelligence | Deferred | No AI gateway, model dependency or source-code upload exists. Deterministic practice works without AI. |
| 7: refinement/distribution | In progress | Original layered art, bundled fonts, native screenshots, themed/motion checks, and unsigned arm64 packaging. Memory budget, complete native behavior/accessibility testing, signing/notarization, updater, VSIX distribution and Windows/Linux platform QA remain release gates. |

## Capability findings

Registered installed CPH version: **2026.10.1792170155**. Its inspected `activate()` returns no public result API. `cph.runTestCases` returns no verified test-result object. The supported adapter reads only its bounded `.prob` identity schema (`url`, `name`, `srcPath`, tests ignored) and exact source-path mapping. It never edits CPH metadata, owns its listener, or treats save/command completion as a passing test. Other versions require inspection and an explicit compatibility update. The manual URL fallback is always available.

The first desktop uses Electron's built-in `node:sqlite`, avoiding an independently compiled native database module. Packaging was tested on arm64, not inferred from a Node-only unit test. Packaged renderer content cannot make network requests; the host owns Codeforces calls. The renderer has context isolation, sandboxing, no Node integration, sender/main-frame validation, an allowlisted preload API and restricted external links.

The local-only outbox records durable obligations; it does **not** imply cloud delivery. Companion backups include device-local file bindings and private captures; they should be kept private. They exclude pairing credentials. Canonical notebook backups omit companion-only thoughts/bindings. Full companion restore UI, journal archival and recovery browsing are later work; current exports retain these records for recovery.

## Verification

Exact commands, native results and release gates are recorded in [verification.md](verification.md). Visual references are in [screenshots](screenshots). Integration setup and manual checks are in [the extension README](../../apps/vscode-extension/README.md).

## Next milestone

Verify a real local VS Code/CPH-to-Fenn session, then implement desktop account identity and SQLite-backed use of the extracted revisioned sync engine through an explicit native API. Keep web origin validation intact. Resolve same-field conflicts before enabling automatic cross-client writes. Reduce/approve the measured desktop memory cost before calling the companion ready for everyday background use.
