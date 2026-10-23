# Forma Tutor — personal local development milestone

Tutor adds contextual text conversation and optional recorded voice questions to Fenn. Practice, CPH testing, manual submissions, recognition, Today, verdict follow-up and the standalone website continue independently. There is no account login, notebook sync, public model proxy or automatic source editing/submission.

## Start and configure

From the repository root, use Node 24.13 or newer:

```sh
npm ci
npm run companion:dev
```

The unsigned Apple Silicon app is built by `npm run companion:package` at `dist/companion/mac-arm64/Forma Companion.app`. Quit/reopen an older running build to load Tutor. For local packaging without downloading Electron, use the installed distribution:

```sh
npx electron-builder --projectDir .companion-build --config ../apps/desktop/electron-builder.json --dir --mac --arm64 -c.electronDist="$PWD/node_modules/electron/dist"
```

Recognise/attach a Codeforces problem, then choose **Ask Fenn**. A new installation defaults to **Gemini**. Open **Setup**, choose your provider, and enter its key when you are ready. **Advanced model settings** contains separate text, transcription and speech model IDs. Switching providers explicitly stops active replies/voice and keeps partial answers, conversations and drafts. There is no provider fallback or automatic generation retry.

The host encrypts separate provider keys/models in `tutor-provider.enc` using OS-protected storage. Keys stay outside SQLite, exports, renderer state/bundles and extension messages. An existing flat OpenAI configuration remains selected and is read compatibly; the next explicit Save atomically writes the versioned multi-provider file. Setup fields never display an existing key. Removing a saved key does not unset an environment key. OS encryption is required for saving credentials; local practice remains usable without a key.

For development, launch the desktop process with `GEMINI_API_KEY`, or select OpenAI and use `OPENAI_API_KEY`. These are **host environment** settings, never `NEXT_PUBLIC_` variables. No credentials are required for builds or fixture tests.

| Setting | Gemini default | OpenAI default |
| --- | --- | --- |
| Text model | `gemini-3.8-flash` | `gpt-5.4-mini` |
| Transcription model | `gemini-3.8-flash` | `gpt-transcribe` |
| Speech model | `gemini-3.8-flash-tts` | `gpt-4o-mini-tts` |

Override per provider with `FORMA_GEMINI_MODEL`, `FORMA_GEMINI_TRANSCRIPTION_MODEL`, `FORMA_GEMINI_SPEECH_MODEL`, or corresponding `FORMA_OPENAI_*` variables. `FORMA_TUTOR_PROVIDER=gemini|openai` selects the development default when no saved selection exists. Legacy `FORMA_TUTOR_MODEL`, `FORMA_TUTOR_TRANSCRIPTION_MODEL`, `FORMA_TUTOR_SPEECH_MODEL` remain OpenAI-only fallbacks. Saved model fields take precedence. Model/account availability still requires live acceptance testing.

The host uses fixed official HTTPS endpoints. Gemini streams text through GenerateContent and uses stateless Interactions requests for recorded transcription and speech. OpenAI Responses/file-transcription/speech remain supported. [Verified Gemini schemas, defaults, capabilities, formats and official references](gemini-api.md). No model tools, command execution or automatic submissions are enabled. Request storage is disabled where supported; this is not a claim of provider-side zero retention. Processing follows the selected provider/account's data terms.

This is a personal development credential arrangement. A distributable product funded by an operator-owned key needs a protected server gateway; no shared key or public unauthenticated gateway is shipped here.

## Know what you send

A recognised title/URL is not a statement. Use Chrome's optional **Include statement in Fenn** button on the exact Codeforces problem page, or **Context included → Paste or update statement** in Tutor. Chrome captures relevant statement sections and samples only; it does not collect account panels, navigation, browser history, editorials or authenticated page data. No new Chrome permissions were added. The canonical Contest/Gym identity, full split index, source, capture time and content hash are retained. Partial captures are labelled incomplete; missing requirements are requested instead of reconstructed from a problem code.

For Chrome, rebuild with `npm run browser:build`, then reload the unpacked `dist/chrome-extension` in Chrome's Extensions page. This milestone's Chrome version is **0.2.0**, with the existing extension ID/native host retained. Chrome extension reload is a user action. The existing native-host installation and opt-in browser capture are still required; see [automatic recognition](automatic-recognition.md).

To share code, build the VS Code extension with `npm run extension:build`, install/reload **0.3.0**, and run **Forma: Ask About Selected Code**. Choose a selection or the current file explicitly. Existing Workspace Trust, paired credential and approved real folder checks apply before and after collection. Editing or switching during collection rejects the stale snapshot. Fenn offers a local preview with filename, language, line range, capture time and revision; an already open conversation and its draft stay in place; it does not send a model request. Inspect/uncheck the code before Send.

**Context included** shows the original problem, statement, selected code, explicitly selected prior notes, and relevant verdict freshness. Past notes start excluded and remain hidden until you choose to inspect them. Only these selections and up to eight recent completed turns from this problem conversation are sent. Local file/workspace/client IDs and absolute file URIs are stripped from provider context; a filename label is used. Explicitly selected source text itself is sent as reviewed. Never include secrets in code or notes you share.

Each user turn freezes its conversation, problem, workspace, session when present, statement revision, source snapshot and evidence timestamps before dispatch. Switching files does not redirect a draft/answer. Answers identify the shared source's capture time and warn that the current editor may differ. New captures notify the correct conversation immediately. **New statement available** / **New code snapshot available** lets you inspect and explicitly adopt the new snapshot or keep your selection. Context for another conversation has an explicit review action. Recapturing A after B selects the latest A capture even when its content already exists. Draft selections keep their original capture IDs/times. Collapsing Fenn or switching conversations keeps unsent drafts for the running app session; unsent composer drafts are not promised across app termination. Stop reaches the provider request; late chunks cannot restart it. Retry reuses the user turn but explicitly starts a new provider request and may incur another charge. No partial generation is silently retried.

## Text, hints and learning

Choose Discuss my approach, Small hint, Stronger hint, Check selected code, Explain the idea, or Full explanation. Small hints start with one observation/question; stronger hints progress through concepts and reasoning toward pseudocode, while Full explanation explicitly permits a complete explanation. Code checks require complete selected statement context and explicitly included code. Fenn treats comments/statements/notes and its own responses as untrusted content, has no shell/browser/file/submit/notebook-write tools, and cannot turn their embedded instructions into app authority.

Replies render Markdown, fenced code, tables and mathematical notation with raw HTML disabled. Images never fetch external resources. Links are explicit buttons showing their destination; the host permits public HTTPS destinations without credentials or custom ports. KaTeX has trust disabled and bounded macro expansion. No links open automatically. New text follows the scroll only near the bottom; otherwise **Jump to latest reply** preserves reading position. Counterexamples are unexecuted reasoning unless trusted evidence says otherwise. A save event/CPH command does not count as passed tests. Neither a model opinion nor Codeforces Accepted chooses Independent/Hint/Editorial/Unsolved.

Assistance exposure is recorded only after response text is actually visible in the active conversation. Queued/provider-delivered but unseen text does not count as a received hint. The reflection form shows factual assistance context for the exact attempt; you still choose the outcome. **Contest mode** disables problem assistance and stops current text/voice requests while keeping neutral tracking and notes available; it is controlled by you, never inferred from a Codeforces page.

After an answer, **Draft a takeaway** or **Save a useful explanation** opens an editable proposal showing the original destination. Nothing is saved until **Approve and save**. A completed-attempt takeaway uses the existing validated reflection write and preserves outcome, duration and review schedule. Finish/save the reflection first if the target attempt is still open. Untimed conversations can save a thought without inventing an attempt. Approval IDs make retries safe after a lost acknowledgement. **Prepare a recall question** creates an editable composer request; you must still Send it, then review/approve any resulting note.

## Voice

Voice uses the same conversation, context, policy and Send button as text. Choose the microphone explicitly to start a bounded recording; choose it again to finish/transcribe, or Cancel to discard it. The app never listens in the background. Permission is requested only through this action. macOS packaged builds include the microphone purpose string; denial leaves typing available.

The recording lasts at most 60 seconds/8 MB. Its bytes go to the selected provider’s transcription model only after you finish recording. The result becomes an editable draft and is **not automatically sent to the tutor model**. The transcript stays associated with the conversation where recording began. Cancellation, leaving/hiding the window, provider/conversation changes, playback changes and errors clean up tracks, timers, audio objects and object URLs and ignore late results. Host leases also reject results cancelled during asynchronous permission/storage checks. Empty/unsupported/malformed recordings or replies produce an actionable error; typing remains available. Raw audio is not retained in SQLite or exports.

Enable **Allow spoken replies**, then choose **Read completed reply**. Speech is generated only from a completed response; long code/formulas are referred to naturally rather than read character by character. Text/code remain visible. The voice is AI-generated. Stop speaking/mute cancels pending speech and playback; starting a recording stops Fenn's playback first. Keyboard typing, Send (including Command/Control+Enter), Stop and microphone controls remain available. Voice configuration failure does not remove text assistance.

## Local records and deletion

Tutor uses the existing SQLite worker and database, with an additive, transactional **schema 2 → 3 → 4 → 5** migration. Notebook/session/binding/receipt data is preserved. Conversations, completed/partial turns, archived explicit retries, immutable context and note proposals use separate Tutor tables, not a second notebook or cloud store. Queued/streaming turns recover as interrupted after restart. Schema 4 separates immutable statement content from capture records with monotonic sequence numbers and a transactional per-problem current pointer. Legacy capture selection is seeded deterministically by timestamp and row order. Equal/backwards clocks cannot reorder new captures. Previously sent context stays frozen; retention/deletion clean up capture metadata with content. Legacy turns/archived requests without provider metadata belong to OpenAI. Each new request records provider and requested model; the resolved response model is separate, and retries archive prior provenance.

Local retention defaults to **90 days**, with 30/90/365-day choices in Tutor. Expired inactive conversations are pruned on startup/Tutor access; active generations are protected. Staged unsent code expires after 24 hours; frozen request copies remain with their conversation. Limits: 200 conversations, 200 turns and 200 proposals per conversation, 32 MiB total Tutor records. Export/delete old conversations if a limit is reached. No hidden background generations, summaries, voice processing or idle provider calls occur.

**Export conversation** creates separate `forma-tutor` JSON with the original messages, request snapshots and archived partials, without credentials/raw audio. Canonical and full companion notebook exports do not silently include unapproved chat. Approved thoughts/takeaways are explicit notebook records and follow normal notebook export behavior. Deleting a conversation cascades its turns/retries/proposals and unneeded local statement/code context; approved notebook notes remain. SQLite WAL files, older backups and exports are separate retained copies; deletion is not a claim of forensic disk erasure.

Character budgets are explicit: statement 40,000 serialized, code 24,000, selected notes 6,000, user question 6,000, history 14,000/latest eight completed turns, total request 90,000, answer 24,000. Oversized context/source is rejected honestly. Requests have a 120-second absolute provider deadline, one active text generation, bounded audio/provider concurrency and no blind automatic generation retries. Actual provider token usage, including reported totals, is shown when supplied; costs are not invented. Typed errors distinguish missing/invalid credentials, permissions, configuration, unsupported model/capability, limits/quota, timeout, network, service failure, blocked output, malformed/empty output and user cancellation. HTTP status and structured provider codes determine safe recovery guidance; raw error bodies and request contents never appear in UI or logs. Questions and partial answers remain available, with explicit Retry only. Lost send acknowledgements retain stable request IDs across conversation navigation.

## Walkthrough

1. Recognise the problem in your approved VS Code practice folder. Open Ask Fenn; capture/paste its statement and inspect Context included.
2. Choose Gemini (or your existing OpenAI setup), and configure your own key when ready. Choose Discuss my approach, type your reasoning, then Send.
3. Choose Small hint for one nudge. Use Stronger hint deliberately; request Full explanation when you want the full approach.
4. Select relevant code in VS Code, run Forma: Ask About Selected Code, inspect the frozen preview and choose Check selected code → Send.
5. Record a voice follow-up. Review/edit the transcript, then Send. Optionally enable and read a completed spoken reply.
6. Finish your normal practice/reflection. Draft a takeaway, review its exact text and original destination, then approve it. Your learning outcome remains your choice.

## Verification and honest limits

Use `npm test`, `npm run lint`, `npm run typecheck`, root/extension typechecks, the web/desktop/extension/Chrome builds and browser regressions. `npm run tutor:verify` runs real Electron/SQLite/IPC with disposable context/code fixtures and no provider credentials or microphone use. `npm run extension:verify` uses actual isolated VS Code and installed supported CPH. `npm run companion:verify` preserves the earlier desktop flow.

`npm run tutor:evaluate -- --fixtures` validates five checked-in quality rubrics (small-hint disclosure, correct approach, missing statement, false counterexample, explicit full explanation). It makes no model calls and is not proof of model quality. A separate charged live evaluation requires explicit `FORMA_TUTOR_LIVE_EVAL=1`, the selected provider’s host environment key, and `npm run tutor:evaluate`; it records actual responses, usage, heuristic findings and a required human rubric review in `dist/tutor-evaluation/live-results.json`. Do not paste a key into this repository or chat.

For this implementation the user chose to configure Gemini and test the live workflow later. No paid/provider calls or personal app installation were performed in this task. **Live model generation, actual microphone/STT/TTS and installed Chrome reload/capture were not validated.** Provider tests inject transport; renderer voice tests use fake devices/audio; native tests exercise real storage/IPC/setup/preview boundaries. No simulated answer is presented as a live Tutor answer. Quality, model access, real speech accuracy/device permissions and their observed failures still need the explicit live run. No statements or code from the user's real practice files were uploaded during verification.

## Deferred live acceptance checklist

Perform this only when you choose to install the new build and configure your own key; none of these provider/device acceptance steps were run for this milestone.

1. Choose Gemini in Setup, save your own key locally, and confirm the text/transcription/speech model settings. Reopen the app and confirm provider selection persists. Existing OpenAI configuration should remain available separately.
2. Capture the exact Codeforces statement and explicitly share a small relevant selection from VS Code. Inspect filenames, capture times and statement completeness; send a discussion or small hint. Check readable streamed text/math/code, actual usage and a helpful answer against the original statement.
3. Stop a stream, confirm the partial answer remains, then explicitly Retry if desired. Switch providers during another stream and confirm the old partial keeps its provider/model label and the unsent follow-up draft survives. Retry can create another charge.
4. Record a short question. Check the unmistakable microphone indicator and duration; finish, review/edit the transcript, then explicitly Send. Test denied permission and cancellation during recording/transcription. Neither cancellation nor a late response should send a message or replace a different conversation's draft.
5. Enable spoken replies and read a completed answer. Check real WAV playback, volume, pronunciation and latency; cancel playback and start another recording. Text must remain usable if voice fails. Confirm long code/formulas are referred to rather than painfully recited.
6. Capture statement A, then B, then A again. Keep an older draft selection, inspect the new-capture notice and adopt only when desired. Earlier answers must retain their original source/time. Repeat with another explicitly shared code snapshot and another problem/workspace.
7. Review an editable thought/takeaway and approve only its original problem/session destination. Confirm independent practice, CPH tests, manual submission, Today and reflection still behave normally. Do not treat model advice as test or verdict evidence.

Record observed model-quality, transcription and audio failures against the original teaching rubrics; deterministic transport/device fixtures do not establish live performance.

Durable unsent composers now use schema 5 on the same writer. See [draft commit/recovery guarantees](durable-drafts.md) and [versioned Tutor-inclusive backup/restore](local-backup.md).
