# ADR 001: retain one Electron prototype; resource budget is a release gate

Status: accepted for the local development milestone; release approval pending measurements/optimization.

The blueprint chooses Electron for one coherent first shell and requires investigating >300 MiB idle memory. This Mac's five-minute automated pet-only run measured 428.4 MiB aggregate process working sets and 2.41% of one core. A brief software-rendering comparison still used roughly 477 MiB and increased short-scenario CPU. Those measurements include automation/shared pages and concurrent desktop activity; they establish a real investigation gate rather than a private-memory or battery claim.

The prototype already uses finite semantic SVG reactions, no ambient 60 fps loop, hidden-window animation suspension, background throttling, one renderer/window, one SQLite worker/writer, active-only timer checkpoints, bounded CPH watchers, and reason-scoped submission checks. Source files are never continuously scanned.

Keep Electron 44.9.0 for this runnable slice because it provides verified native windows, OS-backed secrets, paired local transport and built-in SQLite without an extra native addon. Do not maintain a second shell alongside it. Do not call this prototype ready for persistent everyday background use while its resource budget is unresolved.

Next, measure an isolated packaged build with production instrumentation disabled, separate unique/private memory from shared working sets, and trace idle wakeups/compositing/network. Profile the persistent transparent surface, preload/host activity and Chromium helper baseline. Optimize measured causes; do not disable sandbox/security or disguise high use by reporting only the renderer.

If controlled measurements still miss the agreed budget, build a bounded comparison spike against macOS WKWebView/Tauri and a small native shell. Reuse the pure contracts/domain, original SVG art and revisioned notebook boundary; compare packaging, SQLite ownership, Keychain integration, transparent hit testing, accessibility, binary size, startup and total background resource cost. Tauri/native may reduce the bundled Chromium/helper footprint but requires a new host implementation and platform-specific verification. A switch needs an explicit decision based on those measurements, followed by retiring the Electron shell rather than shipping both.
