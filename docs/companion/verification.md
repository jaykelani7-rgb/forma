# Automatic recognition verification — 20 October 2026

| Check | Result |
| --- | --- |
| Complete `npm test` | 426 passing tests, including recognition lifecycle, strict scoped browser transport, CPH fixtures/retries, stale generations, active/paused/reflection session locks, manual/browser conflicts, rename/forget, candidate expiry/cancellation, duplicate targets, schema migration, desktop draft targets across problem/session changes, and original web regressions. |
| Root and extension strict typechecks; lint | Passed. |
| Web, companion, VS Code and Chrome/native-host builds | Passed. The web build used normal local process access after a sandboxed Turbopack compile stalled. Local socket tests used normal local socket access. No test was skipped to hide a sandbox failure. |
| Real macOS VS Code Extension Development Host | Passed in a separate temporary profile. Actual extension activation, SecretStorage, editor events, exact-file watchers, the installed CPH **2026.10.1792170155** activated, paired socket, and real SQLite all ran. Two controlled `.prob` fixtures created durable bindings, returning to the first file restored context, a simulated lost recognition ACK recovered, a scoped browser proposal reached the frozen editor and received a durable acknowledgement, and a delayed mismatched thought retained its original target in the recovery queue. |
| Real Electron renderer/host | Passed the existing durable thought/session/reflection and pairing/revocation smoke plus a recognition socket fixture. The compact recognition bubble was visible, `presentation.expanded` stayed false, `BrowserWindow.isFocused()` stayed false, the actual thought form retained its text and rejected a save after a context switch, and no renderer errors were reported. [Ink screenshot](screenshots/recognition-ink.png) was inspected. |
| Chrome/native-host source boundary | Manifest key/derived extension ID checked; only `activeTab`, `scripting`, `nativeMessaging`; no host permissions. Framing tests cover split UTF-8, malformed lengths and truncation. Wrong origin, unscoped actions, unknown fields, bad canonical URLs, expired/cancelled proposals, stale or withdrawn targets and false saved acknowledgements are rejected. |

The CPH metadata and browser page payloads in these automated runs were controlled fixtures. This is evidence of a real VS Code/SQLite/socket path, not a claim that two live problems were imported through CPH or that Chrome loaded the unpacked extension. Chrome → actual native process → OS-encrypted browser credential → Fenn → VS Code still needs a user-level installed round trip. Actual CPH import, installed-app restart/fullscreen focus behavior and normal judging/submission remain manual gates. The test profile did not change the user's normal folder permissions or opt them into recognition.

Reproduce using [automatic-recognition setup](automatic-recognition.md). `npm run extension:verify` requires macOS VS Code and the exact installed CPH version; it does not download a replacement or change the compatibility gate. `npm run companion:verify` uses a disposable notebook. Their generated results remain under the printed temporary directory and `dist/companion-verification/`, respectively. Browser installers are supplied but were not run against the user's Chrome profile.

This increment does not claim new long-run resource measurements, live Codeforces verdicts, AI, desktop cloud sync, notarization or extension publishing. Earlier measurements and gates remain below.

---

# Companion verification — 19 October 2026

Environment: macOS 26.6 / Apple Silicon (`darwin arm64`), Node 24.13.1, Electron 44.9.0. Verification used isolated temporary SQLite notebooks, not the user's existing web notebook.

## Completed

| Check | Result |
| --- | --- |
| `npm test` | 403 tests passed after the domain/host review fixes. Includes the original web tests plus canonical binding, hostile schemas, duplicate command replay, transaction rollback, reopening SQLite, timestamp provenance, checkpoint recovery, wall-clock changes, journal growth, verdict rejudges, profile isolation, ambiguous offline windows, socket authentication/receipt, and injected sync conflicts/lost acknowledgements. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed without warnings after cleanup. |
| `npm run build -- --webpack` | Passed: all existing web routes built. |
| `npm run extension:build` | Passed: bundled `apps/vscode-extension/dist/extension.js`. Separate extension strict TypeScript check passed. |
| `npm run companion:build` | Passed: packaged local React renderer, preload, main and database worker. Production CSP disables renderer network requests. |
| `npm run companion:package` | Passed: unsigned arm64 `.app`, original icon, built-in SQLite; no database addon rebuild required. |
| Packaged executable smoke | Launched successfully with temporary data, captured its actual renderer, read SQLite, and exited cleanly. |
| Selected existing browser regressions | 17/17 desktop tests in `workspace.spec.ts`, `memory.spec.ts`, `tracks.spec.ts` passed. Covers add/edit, paused reload, reflection, backup restore, concurrent tabs, themes/readability, actual document import preview/correction, track sessions, and written recall. |
| Native Electron flow | Real preload IPC: attach → 20 durable thoughts → start → pause → finish → explicit Hint reflection. Exactly one retained attempt; no renderer errors. Light/Ink and collapsed/expanded screenshots captured. |
| Native pairing | OS-backed encryption available. A real paired socket ping acknowledged; after revocation the same credential was rejected. Secrets were not logged/exported. |
| Native recovery icon | A capability probe confirmed SVG bytes produce an empty `nativeImage` on this runtime. The shipped tray uses a checked, non-empty original PNG template image. |
| Renderer review | All twelve states at 80/96/112 logical pixels in Light and Ink (72 renders) inspected. Both themes reviewed at 2× display scale. Light/Ink motion galleries were recorded and initial/mid/settled frames inspected; see [animation verification](animation-verification.md). Keyboard Tab/Enter opened Attach and focused its URL field; reduced motion computed no animation. Missing desktop bridge displayed an explicit connection error. |

Tests needing local socket listeners and real Electron windows were run outside the restricted command sandbox. A sandbox-only socket `EPERM` was resolved by using native local test access; it was not treated as a product failure or hidden with a skipped test.

## Measurements

These are development measurements, not release guarantees. Aggregate working sets include shared Chromium pages and are a conservative sum, not unique private physical memory. Other desktop/build activity continued during the automated idle run; repeat under controlled conditions before release.

| Scenario | Observed | Blueprint target |
| --- | --- | --- |
| Local card open, 10 trials, renderer paint included | p95 **87.4 ms** | <150 ms |
| Preload → durable note ACK, small notebook, 20 trials | p95 **2.8 ms** | <200 ms |
| SQLite durable capture, 1,000 problems / 3,000 attempts / 3,221,019-byte notebook, 30 trials | p95 **25.8 ms** | <200 ms for representative notebook |
| Five-minute pet-only run after practice, no connected handle | **2.41%** of one core, **428.4 MiB** aggregate working set | <1% CPU; aim 250 MiB, investigate >300 |
| Short software-rendering spike | ~477 MiB; did not improve resource cost | Compare before changing shell/rendering policy |

The CPU and memory targets are **not met**. [ADR 001](adr-001-desktop-runtime.md) records the evidence and next decision. No idle Codeforces poll occurs without a connected handle and active session/recent pending verdict. Packaged renderer CSP prohibits direct network requests. A dedicated process/network trace and battery measurement remain pending.

Reproduce native smoke/measurements with:

```sh
npm run companion:build
npm run companion:verify
FORMA_IDLE_MEASURE_MS=300000 npm run companion:verify
node --import tsx scripts/companion/benchmark-store.ts
```

Native screenshots/results are written to `dist/companion-verification/`. The checked-in gallery and UI references are in `docs/companion/screenshots/`. The desktop verification script can compare software rendering with `FORMA_MEASURE_SOFTWARE=1` and can select a separate result directory using `FORMA_NATIVE_OUTPUT`.

## Remaining real-world gates

- End-to-end human use of the actual VS Code Extension Development Host, selected folders, installed CPH, disconnect/reconnect, and real newly submitted Codeforces verdict/rejudge. The current boundary tests use explicitly labelled payload fixtures, not claimed live verdicts.
- Dragging, transparent pixel click-through, keyboard focus retention while coding, shortcut collisions, hidden recovery, monitor removal/scaling, Spaces, fullscreen and VoiceOver on the actual target OS. Clamping/state invariants and renderer keyboard behavior are tested; these do not substitute for native pointer/accessibility checks.
- Full companion backup restore/recovery browser, disk-full/corruption/fault-injection matrix, larger canonical-capacity benchmarks, and crash-after-commit OS kill testing.
- Desktop account authorization, SQLite account isolation/sync checkpoints, web/desktop cross-device conflicts and old-client writer negotiation.
- Controlled idle/battery/network traces, startup cold/warm targets, signed/notarized distribution, extension packaging/publishing, Windows/Linux/remote-host transport support.
- Full existing browser suite, beyond the 17 targeted regressions, should run in CI; only the listed desktop workflows were executed for this milestone.

## 20 October 2026 — file switching regressions (Forma VS Code 0.2.1)

The reported mismatch was reproduced from the code and installed notebook: both `1968B.cpp` and `B_Prefiquence.cpp` were valid bindings of contest 1968B, while the renderer selected the last confirmed binding instead of the actual editor. A pending earlier `forget-binding` request for the personal file was also found; it was preserved for the normal receipt-checked delivery/recovery flow.

| Boundary | Result |
| --- | --- |
| Same problem, own/generated files | Tested during ready, running, paused, and reflection states; actual focused filename follows switches, including after dismissal/close. Bindings, confirmation times, journal counts, and existing sessions stay unchanged. |
| Keep current and repeat Chrome | Four explicit confirmations re-offer the candidate without duplicate associations or session reassignment. |
| Stale/closed targets | Old dismissals cannot hide newer offers; closing/changing a confirmed target rejects it; withdrawn generations cannot be revived by late focus, metadata, or heartbeat messages. |
| Conflict and focus | CPH resolution uses the proposed metadata even after VS Code blurs; background file changes do not claim active focus. |
| Existing safeguards | Frozen drafts, rename/forget receipts, unsupported CPH versions, bounded retries/symlinks, denied folders, cancellation/expiry, lost acknowledgements, duplicate windows, and socket credential separation remain covered. |
| Real VS Code extension host | Four bindings, three generated-tab close/own-file return cycles, correct File linked status, no created source files, scoped browser delivery, and retained mismatched capture passed in an isolated profile with exact installed CPH. Metadata inputs were controlled fixtures. |
| Real Electron UI | Filename visibly returned to `1968B.cpp` after the generated-file switches; quiet recognition did not focus the app; mismatched draft text was retained; no renderer errors. Screenshot: `dist/companion-verification/native-active-own-file.png`. |

All **443 tests passed**, with no skips. Type checks, lint, desktop/VS Code/browser builds, unsigned local arm64 packaging, and the real extension/Electron checks passed. Socket tests needed normal local access; their initial sandbox `EPERM` was resolved by rerunning with socket access. This is coverage of the listed cases, not a claim that all possible OS/browser states have been exhausted.

Installed-profile follow-up: the normal VS Code window showed **Forma · File linked** on `1968B.cpp`, and the rebuilt Fenn showed **Confirmed file · 1968B.cpp** for Prefiquence. The user completed Chrome’s required extension reload/foreground-focus steps and confirmed the capture worked; native-host authentication used the existing OS-encrypted browser credential. The notebook confirmed a browser binding for contest 1968B and no open session. The earlier queued forget was allowed to finish under its original receipt; the subsequent explicit browser confirmation restored the intended own-file association. No source files were created or edited by this validation.

The popup additionally has seven tests covering repeat capture after saved/expired/rejected/cancelled proposals, native errors, cancel during an in-flight confirmation, and cancel during status polling. A late reply cannot overwrite cancelled UI or poll an undefined proposal ID. Expired confirmation returns expired rather than a false different-target error. The native UI check verifies the recognition bubble actually dismisses after eight seconds despite repeated snapshot broadcasts. Manual association ACKs retain their binding receipt for safe deferred lifecycle operations; this was also checked in the real VS Code host.
