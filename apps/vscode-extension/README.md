# Forma Companion for VS Code

This private extension connects a trusted local VS Code workspace to the desktop companion. It does not read source contents, upload source files, compile solutions, or report CPH test results.

## Run locally

From the repository root, install the root development dependencies and run:

```sh
npm run extension:build
code --extensionDevelopmentPath="$PWD/apps/vscode-extension" /path/to/your/practice-folder
```

The standalone equivalent build is `node apps/vscode-extension/scripts/build.mjs`. Start the Forma desktop app, copy its pairing credential, and run **Forma: Pair with Companion** in the VS Code command palette. Choose the local workspace folders Forma may use. The credential lives in VS Code SecretStorage, never workspace settings or a project file. Remove Pairing deletes the credential; revocation at the desktop invalidates existing credentials.

Open a solution file and run **Forma: Attach Codeforces Problem**. Paste its exact problem URL, preserving Gym and indices such as A1/A2. **Start Session**, **Save Thought**, **Pause Session**, **Resume Session**, **Finish and Reflect**, and **Open Prior Memory** are explicit commands. Timer controls require a live desktop connection; offline work duration is not reconstructed. A thought or attachment is kept in the local extension queue until the desktop acknowledges its durable revision. A pending capture is not described as saved to the companion notebook.

The queue keeps stable command IDs and the original capture timestamp, retries with backoff, and caps pending commands at 128 and serialized storage at 1 MiB. The desktop journal retains that capture time separately from its actual receipt time. Captures carry the expected problem and, for known sessions, expected session ID. A context conflict blocks delivery and retains the capture for recovery. Restore the intended problem/session before **Retry Pending Captures**, or export pending captures with **Export Pending Captures for Recovery**. Queue exports contain private notes and local file paths; choose a private destination. Existing malformed queue storage is preserved for export rather than overwritten.

## CPH capability inspected on this machine

The registered installed extension is `divyanshuagrawal.competitive-programming-helper`, version **2026.10.1792170155**. Inspection used its installed `package.json` and bundled `dist/extension.js` without changing either. Older installed copies are not active and are unsupported by this adapter.

The inspected version writes JSON problem metadata to `.<source basename>_<md5(complete source path)>.prob`, in the source directory's `.cph` subfolder or its configured `cph.general.saveLocation`. Imported records have `srcPath`, `url`, `name`, and `tests`. Its activation function returns no supported result API. Its `cph.runTestCases` command handler does not return test results. The adapter independently resolves this documented inspection result; it copies no CPH implementation code.

Enable **Forma Companion: CPH Metadata Enabled** deliberately after pairing. The adapter supports this exact inspected version, watches one exact metadata file for the active selected solution, debounces changes, and reads at most 1 MiB. It validates the complete source path and Codeforces URL, rejects unsupported versions, local-only CPH problems, malformed identity, and symlink escapes. Custom metadata locations must also fall inside an allowed folder. Manual bindings take precedence. It never infers identity from a filename, metadata changes never imply passing tests, and an identified problem never creates a completed attempt.

**Run CPH Tests** only invokes CPH's available command. Inspect CPH itself for results. The companion's local-test state remains unknown.

## Transport and limitations

The desktop owns the single writer. Requests are newline-delimited JSON protocol v1, capped at 64 KiB, authenticated with a pairing credential and identified by stable request/command IDs. The endpoint is a per-user Unix socket on macOS/Linux or a per-user named pipe on Windows. The desktop applies commands before acknowledging its durable local revision. Heartbeats occur at most every 30 seconds when paired and idle. Offline retries use exponential backoff capped at 60 seconds.

Only trusted local file workspaces are supported. SSH, WSL, Dev Containers, Codespaces and virtual workspaces display limited status and do not communicate with an assumed remote localhost. Actual VS Code extension-host and cross-platform behavior still require manual validation; a compiled development extension is not a published or production-validated extension.

## Manual verification gate

1. Launch an Extension Development Host with a disposable practice folder. Confirm no metadata association before pairing and folder selection.
2. Pair, select one folder, attach `https://codeforces.com/contest/100/problem/A1`, and verify the desktop shows the exact problem. Start, pause, resume, finish, and save each learning outcome through a fresh session.
3. Save an untimed thought. Stop the desktop, save another thought, restart, and verify one delivery after reconnect. Confirm queue IDs survive VS Code reload. Timer commands while disconnected must fail clearly without inventing elapsed time.
4. Change the desktop's active problem before retrying an offline thought. Confirm the conflicting capture remains pending and can be exported. Revoke pairing at desktop and verify a rejected credential cannot mutate the notebook.
5. Enable CPH metadata, import a problem with the inspected version, and verify one exact file mapping. Save source and run CPH tests; Forma must not claim tests passed. Check unsupported version and malformed/oversized metadata remain unbound.
6. Open an unselected folder, untrusted workspace, and a remote workspace. Confirm no metadata reads or queued delivery. Check keyboard commands and status text.

API references: [VS Code Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust), [extension host placement](https://code.visualstudio.com/api/advanced-topics/extension-host), and [VS Code API / SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage).
