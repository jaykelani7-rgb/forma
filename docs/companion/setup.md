# Setup and connection

Open **Companion settings → Setup & connection**. The summary covers local notebook availability and the current editor connection. Expand **Connection details** to inspect each independent signal. Refresh reads host state; it does not contact a model, request microphone access or change permissions.

| Status | What it means |
| --- | --- |
| Companion storage ready | The database writer successfully read the local notebook. It is not a claim about cloud sync. |
| VS Code paired | This device has a pairing credential. It may have no current editor connection. |
| VS Code connected | An authenticated editor connection is active now. |
| Practice folder observed | The connected editor reports approved practice-folder eligibility. When that signal cannot be read, status remains **Not observable**. Disconnecting does not imply permissions were revoked. |
| Chrome not verified | Capture is enabled, but no authenticated statement capture was observed. A native host being installed does not prove the Chrome extension works. |
| Chrome capture received | A statement arrived through the authenticated native connection at the displayed time. It records past success, not Chrome’s current health. |
| Provider key configured | The selected provider has a credential available locally. Access, quota and model compatibility remain unverified. This screen makes no provider calls. |
| Launch at login | The setting is read from the operating system, with changes available only in a supported, packaged build. It defaults off. Development builds do not modify login items. |

Pairing, folder permission and CPH recognition remain explicit VS Code actions. Use **Forma: Pair with Companion**, **Forma: Select Allowed Folders** and **Forma: Recognise Problems from CPH**. Replacing or revoking pairing uses the existing recovery flow. Basic local practice works without Chrome or Tutor.

**Configure Tutor** opens the existing provider settings. A configured key is deliberately never shown as verified access. Configure and test credentials later by choosing your own request in Tutor; no connection test runs automatically.

## Backup review

**Local backup & restore → Choose what to export** separates notebook records from full companion records. Tutor conversations, immutable provenance and durable composer drafts are an explicit full-companion export choice. Secrets, raw audio, pairing credentials, launch paths and live connection state are excluded.

Choosing a restore file first parses and validates it. The review shows record counts, compatibility warnings and the exact data scope that will be replaced. Data outside that scope remains. Check the confirmation only after reviewing those statements, then choose **Create recovery backup & restore**. If the recovery backup cannot be created and verified, replacement must abort. The resulting recovery-backup path is displayed after success. Restored timers remain paused, and drafts are never automatically sent.

The setup screen itself does not grant folder permissions, execute stored file paths, perform provider requests, or install optional integrations.

## Later manual checks

- With a packaged app, compare Launch at login against macOS Login Items, change it explicitly and confirm only one companion instance starts on sign-in.
- Observe paired-but-disconnected VS Code, reconnect it, then confirm a reported practice folder becomes visible without treating disconnection as revoked approval.
- Enable the optional Chrome integration and receive a statement capture. Confirm the screen distinguishes installation from observed capture.
- Add a provider key later and confirm the screen says configured, without claiming access was tested.
- Export each desired scope, inspect the restore preview and verify a recovery backup is created before replacement.
