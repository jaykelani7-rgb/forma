# Automatic problem recognition

Implemented 20 October 2026 on the existing Electron/SQLite milestone. No source text is read or uploaded. CPH still owns compilation and test results; submissions remain manual. Measured time and learning outcomes require explicit actions.

## CPH workflow

1. Quit an older running Fenn from its menu-bar menu, then run `npm run companion:dev` from the repository root. This builds the current local development app, preserving the existing notebook. SQLite schema 1 migrates to 2 without rewriting notebook records, receipts, thoughts or outbox captures; older desktop builds refuse to write schema 2.
2. Run `npm run extension:build`. Launch the development extension with `code --extensionDevelopmentPath="$PWD/apps/vscode-extension" /path/to/practice`. Pair once from Fenn Settings using **Forma: Pair with Companion**, and select the local practice folders Forma may use.
3. Choose **Recognise problems from CPH** during setup or run **Forma: Recognise Problems from CPH** later. The existing `cphMetadataEnabled` preference remains false by default. Existing consent is respected; users who have not opted in are not enabled by an update.
4. Import a Codeforces problem into CPH as usual and open its solution. Fenn quietly shows its title and “Recognised from CPH”. No URL prompt appears. Choose Start only when you want measured practice.
5. Open another known solution to restore its problem. This updates the focus projection without re-confirming the association or appending a capture journal/outbox entry. An open, paused, or reflection-pending session retains its problem. **Keep current** dismisses the offer. **Finish current & switch** opens the real reflection; switching occurs only after you explicitly save an outcome. Leaving the reflection unfinished preserves the session and candidate.

The active metadata file is watched exactly, including a permitted configured CPH save location. Writes are debounced 300 ms, then missing/partial records get up to three retries (100/300/700 ms). Atomic replacement is observed through the parent directory’s exact filename pattern. Source-file generation, active URI, workspace, pairing, trust and folder permissions are checked before applying reads. Focus-only changes preserve the frozen file generation; background windows and heartbeat messages cannot select a problem.

Recognition stops reading CPH when disabled, unpaired, untrusted or outside allowed folders. Unsupported/missing metadata produces one quiet status hint per reason per extension activation. Use Chrome capture below, or **Advanced: Attach Codeforces Problem** in setup. Filename guesses, title guesses, clipboard monitoring and directory scans are absent.

## Exact CPH compatibility

Supported installed extension: `divyanshuagrawal.competitive-programming-helper`, **2026.10.1792170155**, inspected again on 20 October 2026. No version range was broadened. The inspected package and bundled implementation use `.cph/.<basename>_<md5(complete source path)>.prob` by default, or the configured `cph.general.saveLocation` directory. Records supply `srcPath`, original `url`, `name`, and `tests`. `tests` is ignored as evidence.

The adapter requires the exact source mapping and canonical Codeforces URL, preserves Gym and split indices, bounds reads to 1 MiB, and bounds transmitted titles to 240 characters. It checks lexical and real folder boundaries and refuses metadata symlink escapes. Controlled fixtures are checked in under `tests/fixtures/cph/2026.10.1792170155/`; they are schema examples, not claims of a live import or judge result.

## Optional Chrome workflow — no URL entry

This development target supports **macOS Google Chrome**. CPH recognition does not depend on it.

```sh
npm run browser:build
npm run browser:install
```

The installer registers only the current user’s `app.forma.problem_capture` Native Messaging host. In Chrome’s Extensions page, enable Developer mode, choose **Load unpacked**, and select `dist/chrome-extension`. Its fixed development ID is `nejfmeebpmifjnbjcjcpplcigkeedbdc`. Enable **Chrome capture** in Fenn Settings. This creates a separate OS-encrypted proposal credential; the VS Code credential is never given to Chrome or page scripts.

Open your eligible solution in paired VS Code, then open the Codeforces problem in Chrome. Click the Forma toolbar icon and **Use in Forma**. The popup shows the filename before one confirmation; a selector appears only when several distinct eligible files are plausible. Choose **Connect to …**. The proposal goes through the native host and desktop to that exact VS Code client/file, which rechecks permission and acknowledges only the durable binding. Fenn can offer Start or a safe session switch. No URL needs to be copied.

Only the clicked page’s canonical URL and bounded problem title are captured. The manifest uses `activeTab`, `scripting` (for that page’s title) and `nativeMessaging`; it has no host permissions, content scripts, browsing-history access or continuous tab following. The native manifest and executable both check the exact registered extension origin. Native Messaging uses separate length-prefixed UTF-8 framing, with 64 KiB limits. The separate browser socket accepts only proposal, confirmation, cancellation and status messages. It has no timer, reflection, shell or arbitrary-file operation.

A proposal expires after one minute. Candidate leases expire after 75 seconds without a current paired client; known focus, not heartbeat order, supplies target plausibility. Confirmation freezes the proposal, client, file and file generation. Changed/withdrawn targets, cancelled proposals and late deliveries are rejected before writing. Repeated confirmations and lost acknowledgements reuse the existing proposal/binding rather than choosing a newer editor. Browser replies contain filename labels and opaque target IDs, not source paths or notes.

The installer points at this checkout’s built native host and Electron runtime; rebuild/reinstall after moving the checkout or runtime. It does not sign, notarize or publish an extension. Chrome capture needs Fenn running with OS credential storage available.

```sh
npm run browser:uninstall
```

Uninstall removes this user’s native registration and launcher. Also remove the unpacked extension in Chrome and turn off Chrome capture in Fenn. Disabling the browser capability cancels proposals while leaving CPH recognition available. Notebook records are preserved.

## Binding lifecycle and recovery

- Manual and browser confirmations take precedence over conflicting automatic metadata. Fenn offers an explicit resolution; **Forma: Rebind This File from CPH** also shows the proposed title before replacing the association.
- **Forma: Forget This File Association** preserves practice history and thoughts and suppresses automatic recognition for that URI until an explicit manual/browser/CPH rebind. It does not delete your solution.
- VS Code’s known rename event transfers the association only if the new path is still permitted and does not already have a conflicting mapping. Pending capture targets follow that known permitted relationship. Arbitrary file reuse or moves outside selected folders need an explicit resolution.
- Removing a folder stops its observations and blocks its queued captures for recovery. Unpairing stops observation/delivery and preserves captures. Deleting a solution withdraws the candidate; it does not erase the historical binding or notebook.
- Focus events are not durable queued commands. On reconnect the current editor is reconciled afresh. Durable notes and completed-session reflection captures retain their original target, session ID, occurrence time and stable retry ID through dialogs and outages. Uncertain timer acknowledgements require an explicit retry rather than starting time automatically on reconnect. Legacy queued attachments that could replay obsolete focus are retained and blocked for export; they are not silently rewritten or replayed.
- “Recognised” follows a host binding acknowledgement. Pending captures are shown as “waiting to save”; disconnected recognition is not claimed as saved. Mismatched captures stay blocked and exportable through **Forma: Export Pending Captures for Recovery**.

Desktop thought/reflection/recall drafts also freeze their original problem and session, with a visible draft title. A context mismatch leaves the text intact instead of saving it against the newly recognised problem.

Prior thoughts and solution memories are shown only when explicitly opened. Recognition never reveals them during a fresh attempt or recall.

## Verification and remaining gates

Run:

```sh
npm test
npm run lint
npm run typecheck
npx tsc --project apps/vscode-extension/tsconfig.json --noEmit
npm run build
npm run companion:build
npm run extension:build
npm run browser:build
npm run extension:verify
```

`extension:verify` uses the installed macOS VS Code and exact supported CPH version in a separate temporary profile, with fixture solutions, its own SQLite notebook/socket and a test-only seed API available only in VS Code’s ExtensionMode.Test. It does not pair or grant access to the user’s normal profile. Results distinguish real extension-host execution from controlled metadata and browser payloads. See [verification](verification.md).

Installed-profile follow-up on 20 October: Long Long was imported through the real Competitive Companion/CPH button; normal CPH metadata for both Long Long and Prefiquence was inspected in the approved practice folder. The installed Chrome → native process → OS-encrypted credential → Fenn → VS Code round trip passed with user-assisted extension reload and actual foreground focus, linking the locally created `1968B.cpp`. Both the VS Code status and Fenn filename were checked. Remaining manual gates include full installed-app restart/Spaces/fullscreen behavior and newly submitted verdict/rejudge handling. Automated fixture runs remain distinct from these live checks and do not claim Codeforces submissions or signed distribution.

Protocol references: [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

## Same-problem file switching and 0.2.1 corrections

Several local solutions may deliberately refer to one problem. Fenn now displays the **actual active solution URI**, separately from the saved problem association and the current timed session. It no longer chooses the most recently confirmed file. Returning from `B_Prefiquence.cpp` to an already linked `1968B.cpp` updates the filename without another confirmation, notebook capture, or timer change. With no eligible active file it says so, rather than displaying a different saved file as current. “Keep current” keeps an open session; a subsequent explicit Chrome confirmation can offer the switch again.

VS Code reports **File linked**, **Linked · session kept**, **Association needs a choice**, or **No problem linked** according to the host acknowledgement. A transport connection alone is not reported as a file connection. Closing a proposed file or changing its generation rejects the pending browser delivery; late observations cannot resurrect a withdrawn generation. CPH conflict resolution retains its frozen metadata target while clicking Fenn blurs VS Code. Dismissals carry the offer ID, so a late dismissal cannot hide a different offer. The recognised bubble's eight-second timeout follows the offer identity, rather than resetting on every snapshot update.

Forma's browser button links an **existing** permitted solution and does not create source files. Competitive Companion's separate **Parse task** button imports through CPH and may create files such as `B_Prefiquence.cpp`. Choose Forma's **Use in Forma**, confirm `1968B.cpp`, then continue in that file. A CPH local-only `.prob` record whose URL is a disk path supplies no Codeforces identity; it needs this explicit confirmation once. Existing private code and CPH testcases remain in place.
