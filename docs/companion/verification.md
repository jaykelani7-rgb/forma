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
