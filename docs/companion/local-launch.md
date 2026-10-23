# Opening Fenn from VS Code

`Forma: Open Companion`, `Forma: Open Prior Memory`, and explicit code sharing first ping the existing paired local transport. Background recognition, heartbeats, queued captures and timer commands never start another process. Only a typed `ENOENT` or `ECONNREFUSED` socket failure permits launch. Pairing rejection, file permissions, invalid protocol responses, socket timeouts and unrelated errors stop with their original recovery instructions. No credentials are created or replaced during launch.

Automatic launch currently supports the repository's macOS app. Other platforms explain that Fenn must be started manually. macOS checks these paths in order:

1. `/Applications/Forma Companion.app`
2. `~/Applications/Forma Companion.app`

The first existing candidate must be a real app directory, with bundle identifier `app.forma.companion` and an executable `Contents/MacOS/Forma Companion` within the same bundle. Invalid or unreadable installations fail with recovery instructions. Launch does not search the workspace, `PATH`, Spotlight, browser messages or model responses.

For development, set **Forma Companion: Development Launch Path** (`formaCompanion.developmentLaunchPath`) in VS Code **User Settings**. It accepts a normalized absolute path to this repository's packaged `.app`, or a trusted, self-contained executable launcher. The extension reads only the inspected global user value, even if workspace settings attempt an override. The property is machine scoped. It does not expand `~`, environment variables, arguments or shell commands. Symlink targets and parent aliases must be replaced with their real absolute path. This local path is not part of companion backups.

Build a development app with:

```sh
npm run companion:package
npm run extension:build
```

The app appears at `dist/companion/mac-arm64/Forma Companion.app`. Use its absolute path in User Settings for local inspection. An executable launcher must already know what to start; pointing at the bare Electron binary is insufficient because no arguments or working directory are supplied. Fenn uses macOS `/usr/bin/open -a` with a separate, validated app argument, or directly spawns the configured executable with an empty argument list and no shell. The existing Electron single-instance lock remains the authority for duplicate startup.

Requests in one extension host share an in-flight startup for the same credential. Readiness pings have a 20-second total deadline, a Cancel action and progress messages. Each caller can cancel its pending action; when all callers cancel, late resolution cannot start the app. A process already opened may remain running. A different pairing cannot join an older startup. After readiness, the extension checks the frozen file, problem, document revision, workspace folders, explicit folder permission and pairing again before proceeding. A changed editor gets an actionable retry message; it does not redirect an earlier request. Source sharing also retains its existing source-generation checks and never queues source offline.

Saved captures additionally remember the database recovery epoch observed when they were created. This epoch survives ordinary app restarts and changes after a restore. Before delivery, VS Code pings the host and includes the expected epoch in the command envelope; the host and database writer reject old epochs. A capture with an unknown legacy epoch or a mismatched restored epoch remains queued. **Retry Pending Captures** explicitly asks the user to review those original action/problem targets before adopting the current epoch. It retains the original command ID, so a previously acknowledged command is not applied twice. Reconnection never silently approves delivery into a replaced notebook.

The optional **Launch at login** control uses Electron's supported macOS login-item API for a packaged app. It starts disabled unless the user explicitly enables an OS login item. Merely opening setup does not register one. The control reads the OS state each time instead of mirroring a database preference, so external System Settings changes are reflected. macOS approval requirements and read/write failures are explained. Unpackaged development builds and unsupported platforms report unavailable and do not call the login-item API. The same single-instance lock handles login and manual launches.

API references: [VS Code configuration scopes](https://code.visualstudio.com/api/references/contribution-points#Configuration-scopes), [Electron login items](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows).

## Verification

The deterministic unit suite injects file inspection, process launch, transport and login-item interfaces. It covers running versus stopped hosts, typed failures, concurrent startup, stale pairing, a bounded deadline, cancellation, changed editor context, deterministic target resolution, workspace override exclusion, invalid bundles and actual OS-state reporting. It does not claim that a real login item, installed macOS app startup, provider access or microphone behavior was verified.

```sh
node --import tsx --test tests/companion-launch.test.ts tests/companion-connection.test.ts
npx tsc --noEmit -p apps/vscode-extension/tsconfig.json
npm run extension:build
```

For later manual testing in an isolated installation: stop Fenn, invoke Open Companion from an approved solution, confirm one app opens and the intended context is retained; change files while opening and confirm the old action is rejected; cancel startup; test a deliberately stale pairing and incompatible extension without repeated launches; toggle login startup only when ready to change that Mac's actual login setting, then inspect System Settings and test a real logout/login. None of these personal installation or OS-setting changes are performed by the automated suite.
