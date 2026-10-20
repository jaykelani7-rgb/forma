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

## Practice

Click Fenn or press **Control+Option+F** (⌃+⌥+F). Open a solution in paired VS Code, opt in to recognition from CPH, and begin a session when ready. Supported CPH metadata supplies the exact problem without a URL prompt. Pause whenever you want. Save a thought without creating a learning attempt. Finish and choose Independent, Hint, Editorial or Not solved yet; Later leaves the real session awaiting its reflection. A saved reflection uses the website's learning and revisit rules.

Settings lets you add a public Codeforces handle. Checks observe public author/verdict evidence and show freshness. A Codeforces acceptance is distinct from independent learning; no background check silently saves a reflection. No CPH test result is claimed by this version.

Due recall appears as a small offer when you are not actively practising. Memory opens only when you ask. Defer, snooze, hide, choose reduced motion, and change Light/Ink/system appearance from the card. The menu-bar fox recovers a hidden/off-screen window. The shortcut can be changed; occupied shortcuts are rejected before replacing a working one.

## Connect VS Code

```sh
npm run extension:build
```

See [VS Code setup](../../apps/vscode-extension/README.md) to launch the local Extension Development Host. In Fenn Settings choose Pair, copy the one-time credential, and run **Forma: Pair with Companion**. Select trusted local folders explicitly. Choose “Recognise problems from CPH” explicitly; it remains off until enabled. The pairing credential is OS-encrypted in the desktop and stored in VS Code SecretStorage, never in a project file. Revoke it from either app.

See [automatic recognition and optional Chrome capture](automatic-recognition.md) for the normal workflow, safe switching, binding recovery and user-level Native Messaging installation.

## Data and continuity

The default Mac notebook is `~/Library/Application Support/Forma Companion/notebook.sqlite`. The socket is in that app directory's private `runtime/` folder. A developer can set `FORMA_COMPANION_DATA_DIR` for an isolated test notebook; packaged normal launches ignore that override.

**Saved locally** means a SQLite transaction completed. This milestone has no desktop account sign-in or live cloud sync. Export an interoperable notebook and import it in Forma's existing Settings to continue there; export/import in the opposite direction is also available when both notebooks have no open session. Conflicting imports retain the current notebook and a recovery copy. Separate local copies do not continuously synchronize.

Use **Export full companion backup** for local thoughts, file bindings, original command journal, pending outbox and recovery copies. That backup is distinct from the website's canonical backup and contains private device paths. Keep it private. Pairing secrets are excluded. There is no full companion restore screen yet; retain these recovery exports until that follow-up is implemented.

See [implementation status](implementation-status.md), [verification](verification.md), [performance decision](adr-001-desktop-runtime.md) and [original artwork](../../packages/pet-ui/ARTWORK.md).
