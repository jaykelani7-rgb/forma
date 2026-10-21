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

Recognise/attach a Codeforces problem, then choose **Ask Fenn** from Practice or the Today glance. Open **Setup** inside Tutor and enter your own OpenAI API key. It is encrypted through the OS secret store in the host's `tutor-provider.enc`, excluded from SQLite, conversations, notebook exports, renderer bundles and extension messages. Removing the saved key does not unset a separately supplied environment key. OS encryption must be available to save credentials; an unavailable key/store leaves local practice and saved conversations usable.

Development alternative: launch the app from an environment containing `OPENAI_API_KEY`. Optional configuration:

| Variable / Setup field | Initial value | Purpose |
| --- | --- | --- |
| `FORMA_TUTOR_MODEL` / Text model | `gpt-5.4-mini` | Responses API text generation |
| `FORMA_TUTOR_TRANSCRIPTION_MODEL` / Transcription model | `gpt-transcribe` | Recorded-audio transcription |
| `FORMA_TUTOR_SPEECH_MODEL` / Speech model | `gpt-4o-mini-tts` | Optional completed-reply speech |

These are configurable model IDs, not assumptions about the newest model. Actual model/account availability is checked by the provider when you send. This milestone uses OpenAI's [Responses streaming API](https://developers.openai.com/api/docs/guides/streaming-responses), [recorded-file transcription](https://developers.openai.com/api/docs/guides/speech-to-text) and [text-to-speech API](https://developers.openai.com/api/docs/guides/text-to-speech). [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) was selected as a configurable coding-capable starting model. The host uses direct HTTPS with fixed OpenAI endpoints, no model tools, `store:false`, bounded generation and explicit cancellation. It does not claim provider-side zero retention; processing follows your OpenAI account's applicable data controls.

This is a personal development credential arrangement. A distributable product funded by an operator-owned key needs a protected server gateway; no shared key or public unauthenticated gateway is shipped here.

## Know what you send

A recognised title/URL is not a statement. Use Chrome's optional **Include statement in Fenn** button on the exact Codeforces problem page, or **Context included → Paste or update statement** in Tutor. Chrome captures relevant statement sections and samples only; it does not collect account panels, navigation, browser history, editorials or authenticated page data. No new Chrome permissions were added. The canonical Contest/Gym identity, full split index, source, capture time and content hash are retained. Partial captures are labelled incomplete; missing requirements are requested instead of reconstructed from a problem code.

For Chrome, rebuild with `npm run browser:build`, then reload the unpacked `dist/chrome-extension` in Chrome's Extensions page. This milestone's Chrome version is **0.2.0**, with the existing extension ID/native host retained. Chrome extension reload is a user action. The existing native-host installation and opt-in browser capture are still required; see [automatic recognition](automatic-recognition.md).

To share code, build the VS Code extension with `npm run extension:build`, install/reload **0.3.0**, and run **Forma: Ask About Selected Code**. Choose a selection or the current file explicitly. Existing Workspace Trust, paired credential and approved real folder checks apply before and after collection. Editing or switching during collection rejects the stale snapshot. A local preview opens in Fenn with filename, language, line range, capture time and revision; it does not send a model request. Inspect/uncheck the code before Send.

**Context included** shows the original problem, statement, selected code, explicitly selected prior notes, and relevant verdict freshness. Past notes start excluded and remain hidden until you choose to inspect them. Only these selections and up to eight recent completed turns from this problem conversation are sent. Local file/workspace/client IDs and absolute file URIs are stripped from provider context; a filename label is used. Explicitly selected source text itself is sent as reviewed. Never include secrets in code or notes you share.

Each user turn freezes its conversation, problem, workspace, session when present, statement revision, source snapshot and evidence timestamps before dispatch. Switching files does not redirect a draft/answer. Answers identify the shared source's capture time and warn that the current editor may differ. Refresh context deliberately when you want newer material. Stop reaches the provider request; late chunks cannot restart it. Retry reuses the user turn but explicitly starts a new provider request and may incur another charge. No partial generation is silently retried.

## Text, hints and learning

Choose Discuss my approach, Small hint, Stronger hint, Check selected code, Explain the idea, or Full explanation. Small hints start with one observation/question; stronger hints progress through concepts and reasoning toward pseudocode, while Full explanation explicitly permits a complete explanation. Code checks require complete selected statement context and explicitly included code. Fenn treats comments/statements/notes and its own responses as untrusted content, has no shell/browser/file/submit/notebook-write tools, and cannot turn their embedded instructions into app authority.

All output is rendered as safe text and fenced code, never executed HTML or automatically opened links. Counterexamples are unexecuted reasoning unless trusted evidence says otherwise. A save event/CPH command does not count as passed tests. Neither a model opinion nor Codeforces Accepted chooses Independent/Hint/Editorial/Unsolved.

Assistance exposure is recorded only after response text is actually visible in the active conversation. Queued/provider-delivered but unseen text does not count as a received hint. The reflection form shows factual assistance context for the exact attempt; you still choose the outcome. **Contest mode** disables problem assistance and stops current text/voice requests while keeping neutral tracking and notes available; it is controlled by you, never inferred from a Codeforces page.

After an answer, **Draft a takeaway** or **Save a useful explanation** opens an editable proposal showing the original destination. Nothing is saved until **Approve and save**. A completed-attempt takeaway uses the existing validated reflection write and preserves outcome, duration and review schedule. Finish/save the reflection first if the target attempt is still open. Untimed conversations can save a thought without inventing an attempt. Approval IDs make retries safe after a lost acknowledgement. **Prepare a recall question** creates an editable composer request; you must still Send it, then review/approve any resulting note.

## Voice

Voice uses the same conversation, context, policy and Send button as text. Choose the microphone explicitly to start a bounded recording; choose it again to finish/transcribe, or Cancel to discard it. The app never listens in the background. Permission is requested only through this action. macOS packaged builds include the microphone purpose string; denial leaves typing available.

The recording lasts at most 60 seconds/8 MB. Its bytes go to the configured OpenAI transcription model only after you finish recording. The result becomes an editable draft and is **not automatically sent to the tutor model**. The transcript stays associated with the conversation where recording began. Cancellation, leaving/hiding the window, playback changes and errors clean up tracks/resources and ignore late results. Raw audio is not retained in SQLite or exports.

Enable **Allow spoken replies**, then choose **Read completed reply**. Speech is generated only from a completed response; long code/formulas are referred to naturally rather than read character by character. Text/code remain visible. The voice is AI-generated. Stop speaking/mute cancels pending speech and playback; starting a recording stops Fenn's playback first. Keyboard typing, Send (including Command/Control+Enter), Stop and microphone controls remain available. Voice configuration failure does not remove text assistance.

## Local records and deletion

Tutor uses the existing SQLite worker and database, with an additive, transactional **schema 2 → 3** migration. Notebook/session/binding/receipt data is preserved. Conversations, completed/partial turns, archived explicit retries, immutable context and note proposals use separate Tutor tables, not a second notebook or cloud store. Queued/streaming turns recover as interrupted after restart.

Local retention defaults to **90 days**, with 30/90/365-day choices in Tutor. Expired inactive conversations are pruned on startup/Tutor access; active generations are protected. Staged unsent code expires after 24 hours; frozen request copies remain with their conversation. Limits: 200 conversations, 200 turns and 200 proposals per conversation, 32 MiB total Tutor records. Export/delete old conversations if a limit is reached. No hidden background generations, summaries, voice processing or idle provider calls occur.

**Export conversation** creates separate `forma-tutor` JSON with the original messages, request snapshots and archived partials, without credentials/raw audio. Canonical and full companion notebook exports do not silently include unapproved chat. Approved thoughts/takeaways are explicit notebook records and follow normal notebook export behavior. Deleting a conversation cascades its turns/retries/proposals and unneeded local statement/code context; approved notebook notes remain. SQLite WAL files, older backups and exports are separate retained copies; deletion is not a claim of forensic disk erasure.

Character budgets are explicit: statement 40,000 serialized, code 24,000, selected notes 6,000, user question 6,000, history 14,000/latest eight completed turns, total request 90,000, answer 24,000. Oversized context/source is rejected honestly. Requests have a 120-second absolute provider deadline, one active text generation, bounded audio/provider concurrency and no blind automatic generation retries. Actual token usage is shown when provided; exact costs are not invented.

## Walkthrough

1. Recognise the problem in your approved VS Code practice folder. Open Ask Fenn; capture/paste its statement and inspect Context included.
2. Configure your own API key when ready. Choose Discuss my approach, type your reasoning, then Send.
3. Choose Small hint for one nudge. Use Stronger hint deliberately; request Full explanation when you want the full approach.
4. Select relevant code in VS Code, run Forma: Ask About Selected Code, inspect the frozen preview and choose Check selected code → Send.
5. Record a voice follow-up. Review/edit the transcript, then Send. Optionally enable and read a completed spoken reply.
6. Finish your normal practice/reflection. Draft a takeaway, review its exact text and original destination, then approve it. Your learning outcome remains your choice.

## Verification and honest limits

Use `npm test`, `npm run lint`, `npm run typecheck`, root/extension typechecks, the web/desktop/extension/Chrome builds and browser regressions. `npm run tutor:verify` runs real Electron/SQLite/IPC with disposable context/code fixtures and no provider credentials or microphone use. `npm run extension:verify` uses actual isolated VS Code and installed supported CPH. `npm run companion:verify` preserves the earlier desktop flow.

`npm run tutor:evaluate -- --fixtures` validates five checked-in quality rubrics (small-hint disclosure, correct approach, missing statement, false counterexample, explicit full explanation). It makes no model calls and is not proof of model quality. A separate charged live evaluation requires `FORMA_TUTOR_LIVE_EVAL=1 OPENAI_API_KEY=... npm run tutor:evaluate`; it records actual responses, usage, heuristic findings and a required human rubric review in `dist/tutor-evaluation/live-results.json`. Do not paste a key into this repository or chat.

For this implementation the user chose to configure a key later. **Live model generation, actual microphone/STT/TTS and installed Chrome reload/capture were not validated.** Provider tests inject transport; renderer voice tests use fake devices/audio; native tests exercise real storage/IPC/setup/preview boundaries. No simulated answer is presented as a live Tutor answer. Quality, model access, real speech accuracy/device permissions and their observed failures still need the explicit live run. No statements or code from the user's real practice files were uploaded during verification.
