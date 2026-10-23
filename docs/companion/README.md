# Forma Companion

A quiet desktop face for the existing Forma notebook. This first milestone is local-only and unsigned. It preserves the standalone website.

## Run

Use Node.js 24.13 or newer for the desktop build/tools and new SQLite tests. The website's Node 22 support is unchanged (recent Node 22 includes SQLite, but older 22 releases require flags). From the repository root:

```sh
npm ci
npm run companion:dev
```

`companion:dev` builds local assets and opens Electron. `companion:start` reuses the last build. Browser-only visual preview: `npm run companion:preview`, then `http://127.0.0.1:4174/?preview=1`. Preview is explicitly in-memory, has no persistence, and is never used as a fallback inside Electron.

The unsigned Apple Silicon app can be prepared with `npm run companion:package`; it is placed in `dist/companion/mac-arm64/Forma Companion.app`. There is no installer, updater or notarization in this milestone. Nothing is published.

## Forma Tutor

**Ask Fenn** opens optional local conversations with inspectable problem/statement/code context, streamed text, progressive hints, approved learning notes and recorded voice questions. Gemini is the new-install default, with existing OpenAI setup preserved. Add your own provider key in Tutor Setup when ready; practice stays usable without it. See [Tutor setup, privacy, voice and walkthrough](tutor.md).

## Everyday local use

VS Code can now start an installed macOS companion when the paired endpoint is absent or refused, then revalidate the pending editor action. Tutor questions autosave through SQLite and recover after restart. Settings includes independent setup/connection status and versioned local backup/restore with a verified recovery copy before replacement. Launch at login is optional and off by default. See [launch and development paths](local-launch.md), [durable drafts](durable-drafts.md), [setup meanings](setup.md) and [backup formats/recovery](local-backup.md).

## Practice

Click Fenn or press **Control+Option+F** (⌃+⌥+F). Open a solution in paired VS Code, opt in to recognition from CPH, and begin a session when ready. Supported CPH metadata supplies the exact problem without a URL prompt. Pause whenever you want. Save a thought without creating a learning attempt. Finish and choose Independent, Hint, Editorial or Not solved yet; Later leaves the real session awaiting its reflection. A saved reflection uses the website's learning and revisit rules.

Settings lets you add a public Codeforces handle. Checks observe public author/verdict evidence and show freshness. A Codeforces acceptance is distinct from independent learning; no background check silently saves a reflection. No CPH test result is claimed by this version.

Due recall appears as a small offer when you are not actively practising. Memory opens only when you ask. Defer, snooze, hide, choose reduced motion, and change Light/Ink/system appearance from the card. The menu-bar fox recovers a hidden/off-screen window. The shortcut can be changed; occupied shortcuts are rejected before replacing a working one.

## Today and a complete session

1. Build/run with `npm run companion:dev` (or `npm run companion:start` after building). Use the existing local notebook, or choose a supported backup in Settings and review its replacement scope. Restored sessions remain paused.
2. Click Fenn while idle, or **Today with Fenn** in Practice. The shared website planner supplies one title, coding/recall type, reason and planned duration. Other activities stay folded. An empty or completed day is shown honestly.
3. For coding, **Start & open problem** starts a measured session with its plan/track/upsolve context and opens the canonical Codeforces page. Open/import the solution normally in your paired VS Code folder. Forma never attaches Today to an arbitrary current editor file. **Continue current session** returns to the retained context; use Resume explicitly if paused.
4. Use CPH for local tests and submit through your normal Codeforces workflow. Set your public handle before starting if you want automatic verdict follow-up. CPH test execution is not treated as authoritative platform evidence.
5. **Finish & reflect** stops measured time immediately. Save your actual Independent/Hint/Editorial/Not solved yet reflection even while a submission is pending. The saved follow-up can discover submissions made within the original session interval for five more minutes, then follow pending judging for up to fifteen minutes from its first observation. Neither waiting nor offline time adds coding minutes.
6. Open **Codeforces follow-up** in Practice to see saved statuses or **Refresh public verdicts**. An older result remains labelled with its own problem/profile after switching. Accepted never changes your learning outcome. Failure/expiry means unknown; checks cover only the latest 100 public submissions. Final/rejudge corrections are available through explicit refresh after automatic checks stop.
7. For recall, **Try recall** opens the selected approach/complexity activity without showing old notes or starting a timer. **Later · tomorrow** uses the existing planner deferral, retaining coding/recall schedules; snoozing suggestions is a separate setting. Finish/save an open session's reflection before changing activities.

No automatic daily reminder is enabled. Suggestions/verdicts use one quiet slot, respect snooze, and never focus or expand the companion. Background follow-up jobs stay on this device; export/import remains an explicit transfer of the canonical notebook, not live sync.

## Connect VS Code

```sh
npm run extension:build
```

See [VS Code setup](../../apps/vscode-extension/README.md) to launch the local Extension Development Host. In Fenn Settings choose Pair, copy the one-time credential, and run **Forma: Pair with Companion**. Select trusted local folders explicitly. Choose “Recognise problems from CPH” explicitly; it remains off until enabled. The pairing credential is OS-encrypted in the desktop and stored in VS Code SecretStorage, never in a project file. Revoke it from either app.

See [automatic recognition and optional Chrome capture](automatic-recognition.md) for the normal workflow, safe switching, binding recovery and user-level Native Messaging installation.

## Data and continuity

The default Mac notebook is `~/Library/Application Support/Forma Companion/notebook.sqlite`. The socket is in that app directory's private `runtime/` folder. A developer can set `FORMA_COMPANION_DATA_DIR` for an isolated test notebook; packaged normal launches ignore that override.

**Saved locally** means a SQLite transaction completed. Tutor autosaving is debounced by 450 ms; a crash can lose edits not yet committed. This milestone has no desktop account sign-in or live cloud sync. **Export canonical notebook for Forma web** preserves the existing web interchange format. The desktop restore workflow also accepts legacy notebook/companion/Tutor exports with explicit preview limitations.

Versioned local backups separate notebook and companion data. Tutor conversations and unfinished drafts are an explicit choice. Restoring replaces only the displayed scope after creating and verifying a private, recoverable full backup. Pairing, API keys, raw audio, executable paths, login settings, live connections and folder permissions are excluded. Imported paths never grant access. See [backup replacement and recovery](local-backup.md).

See [implementation status](implementation-status.md), [verification](verification.md), [performance decision](adr-001-desktop-runtime.md) and [original artwork](../../packages/pet-ui/ARTWORK.md).
