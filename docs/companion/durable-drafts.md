# Durable Tutor drafts

Tutor keeps one unsent composer per local conversation, separately from submitted user turns. The SQLite worker stores the problem and workspace association, question, assistance mode, explicitly selected statement capture and code snapshot IDs, selected note IDs, a revision and update time. No raw microphone audio, API keys, live connection state, or new folder permission is stored in a draft.

The additive schema-5 migration creates `tutor_drafts` and `tutor_draft_state` in the existing database transaction. Previous conversations, immutable request context and learning records remain intact. Opening Tutor restores the current problem/workspace conversation, or the remembered conversation when no problem is available. It does not start a timer, send a provider request, regenerate an interrupted turn, play audio or transcribe an old recording.

## Saving and crash recovery

Edits are coalesced for 450 ms. A conversation has one serialized autosave chain; each write supplies the expected database revision and the recovery epoch. “Draft saved locally” appears only after the worker returns from a committed transaction. “Saving draft…” includes the debounce and commit time. Storage errors retain the composer text and show “Draft not saved”. Save acknowledgements lost after commit are reconciled against the exact saved content.

Ordinary conversation navigation, collapsing Tutor, page hiding and the host's bounded shutdown handshake flush pending edits where possible. An abrupt process or OS crash can lose edits still inside the 450 ms debounce or an unfinished database operation. There is no claim of zero-loss keystroke persistence. Previously committed text recovers on the next launch.

A stale write cannot replace a newer draft. Conversation deletion cascades its draft and future writes require the conversation still to exist. Restoring a backup rotates the database recovery epoch; writes and Send operations from the previous state are rejected even if conversation IDs are unchanged. The renderer drops its old composer cache after recovery.

## Frozen selection and retention

The draft contains references, rather than duplicate retained source snapshots. Reopening it resolves exactly those capture IDs, never the newest capture. A missing statement, expired code share or deleted note leaves the question intact and shows a review warning. The user can remove unavailable references or explicitly inspect and adopt new context. The question is not silently paired with another source revision.

Draft references do not extend snapshot retention. Shared code retains the existing one-day limit. Conversation and statement retention follow Tutor's configured retention policy. Draft text is limited to 6,000 characters, at most 20 distinct note references, one draft per conversation and at most 200 conversations. Draft bytes participate in Tutor's existing 32 MiB quota. A quota or validation failure rolls back the draft update.

## Sending and acknowledgement loss

Send first commits the exact composer revision and pauses autosaving for that conversation while dispatch settles. The worker inserts the durable user turn and consumes that draft revision in one transaction. If a newer revision was already committed, it remains a separate unfinished question. Edits typed while Send is pending also remain and resume autosaving after dispatch.

Turn and provider-request IDs make repeated acknowledgements idempotent. A lost Send acknowledgement leaves the committed question in its user turn; reloading does not generate another request. On app recovery, queued or streaming answers become interrupted and require an explicit Retry. A dispatch or persistence failure keeps the question in the unsent draft or durable turn. Retry is a deliberate user action and can cause another provider charge.

## Backup boundary

The versioned companion backup makes Tutor conversations and durable drafts an explicit choice. Drafts include their selected reference IDs and association metadata; the selected backup scope contains the corresponding available immutable context. A reference already expired remains a review requirement. Restoring does not reauthorize a folder or execute a machine-specific file path.

The legacy `forma-tutor` conversation export contains submitted turns and learning proposals only. It does not include the unsent composer. Use the versioned companion backup with Tutor and drafts selected when preserving unfinished questions.

## Verification and later manual checks

`tests/tutor-drafts.test.ts` covers restart recovery, stale saves, conversation deletion, atomic consumption, acknowledgement replay, concurrent edits, failed preparation, expired references, epoch fencing, bounds and commit rollback, serialized saves and lost save acknowledgements followed by newer edits. Recovery tests hold manual-capture and proposal acknowledgements across a restore that reuses conversation IDs; neither callback can select old context or approve a note in the restored notebook. The compiled renderer's Tutor browser tests cover recovering saved text/mode after reload and explicit review of expired code.

After installation, type a question and wait for “Draft saved locally”, quit and reopen Fenn, and confirm the same question, mode and exact context selection. Repeat while switching between problems. Type a second question while Send is pending and confirm it remains. Test an abrupt quit only with disposable text to observe the documented debounce window. No provider configuration, live request or microphone permission is required to verify local recovery.
