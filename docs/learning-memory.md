# Learning Memory and revision

Implemented in the existing Forma notebook, with local verification on 8 October 2026.

## Where to find it

Open **Learning Memory** from a Problems row, a track or stage entry, an Activity record, or Revisit. Completion screens also link to the problem's notebook. The detail page keeps a return link to the originating page and shows acceptance separately from reflected understanding.

The timeline runs oldest to newest. Timed events show measured seconds; imported activity does not estimate duration. Explicitly linked timed/imported sources form one event, with both original records, submissions, reflections and source-selection controls available. Track and stage snapshots survive removal of their original track. Archived Codeforces profiles are shown explicitly without adding their evidence to the connected profile.

**Add learning details** stays collapsed in timed and imported reflections. It provides nine optional mistake labels, an approach prompt and a short explanation of where the attempt got stuck. Existing notes and the takeaway remain useful; verdicts never choose mistake labels. Edit a reflection to change or remove those labels. The summary counts only recorded labels and assistance, with honest empty states.

Revisit offers coding re-solves, approach/invariant explanations, and complexity/edge-case recall. Written checks record their activity and independent/cue/not-yet-recalled assessment. Re-solving uses the existing timed session and reflection workflow. Its preparation shows previously recorded difficulties and the scoped cue; prior solution notes require **Reveal previous notes**. Written checks likewise keep solution notes hidden until requested, with an opaque dialog backdrop.

Progress adds a selectable week or date range. Standalone timed, standalone imported and linked practice events form an additive breakdown. Written checks remain separate. Measured time includes linked timed sessions and excludes estimates for imported activity or recall. Independent-after-assistance evidence requires an earlier recorded hint or editorial and a later independent practice event. Period boundaries use inclusive local calendar dates of the practice event or completed written check.

## Reliability fixes

Both reported findings were reproduced against `bb039ac`. With a sheet-created 381A followed by an imported hint reflection scheduled for 12 October, the previous track and Today still recommended 381A on 7 October. Editing the referenced problem to 189A also produced a proposal rejected by track validation after the provider had exposed it.

`practice-state.ts` now resolves matching identities in the connected profile plus personal notebook scope. A bare unscheduled duplicate cannot override a schedule. Coding decisions use their decision timestamp, or existing reflection/timed/completion evidence for older records. Latest evidence wins; ties prefer a deliberate manual decision, then the later date, then stable problem ID. Bare legacy decisions without evidence use this deterministic tie order. Matching skips, future deferrals and archives apply across the current group. Explicit manual practice remains available.

Timed scheduling derived from an event explicitly linked to an archived handle stays with that handle. Later personal notebook scheduling choices remain personal. Imported reflection edits preserve an applicable manual date or completion across copies unless the user deliberately overrides it; newer applicable practice also keeps ownership of its schedule. Today, stage and track recommendations, post-session next choices, fresh-discovery revisit priorities, and the Revisit list use the shared resolution. Original problem and attempt records are retained rather than destructively merged.

The provider validates proposals before optimistic exposure or queuing writes. Validation failures leave the valid workspace and storage status intact. The generic editor prevents identity reassignment for problems referenced by tracks, recorded practice or an active session. Its draft remains available with instructions to use **Edit track** for replacement. Name, topics, rating and equivalent canonical URL changes remain supported. The track editor creates or reuses the new problem membership while preserving the original history.

## Scheduling rules

Coding reattempt defaults remain unchanged: 1 day for unsolved, 3 for editorial assistance, and 5 for a hint; independent revisits retain the existing spaced schedule. Coding defaults remain configurable in Settings.

Written recall suggests **7 days after independent recall, 3 after needing a cue, and 1 when recall is not yet possible**. Settings → Written recall configures each interval from 1 to 90 days. Each check previews its next date and permits an override or **No further recall**. The latest completed written check sets one shared written-recall date for that scoped problem, regardless of which written activity it used. A null next date closes written recall only. It never clears a separately scheduled coding reattempt.

Both dates appear in the same Revisit list; due written checks can also be chosen on Today. A written due date does not make a future coding date eligible early. Completing a coding revisit does not claim a solve and does not complete written recall.

The revision, its next date and any cue are saved in one workspace revision. A retained draft retries with the same record ID, so repeated submission does not create duplicate checks. Existing dates are not recalculated when defaults change. Saved messages wait for persistence; failed writes retain drafts, and conflicts retain recovery copies in Settings.

## Data and setup

Schema version remains 2. Optional reflection fields are `mistakes`, `approach` and `mistakeNote`; scheduling adds `Problem.reviewUpdatedAt`. `Data.revisions` stores stable IDs, problem/profile provenance, activity, assessment, written response, cue, completion timestamp, next date and optional track-context snapshot. `Settings.recallDays` supplies the configurable defaults. A personal notebook cue can use `Problem.revisionCue`; profile cues remain scoped to their revision records.

Older schema 1/2 notebooks and backups remain accepted, with empty revision collections and 7/3/1 recall defaults. New fields participate in strict validation, exports/imports, transactional local storage, three-way merges, recovery copies and the existing account JSON transport. No historical reflections are fabricated or rewritten to populate Memory. Existing record limits and the 64 MiB workspace/backup capacity remain in force.

Local mode needs no account or additional environment variables. Optional hosted account setup remains in [cloud-setup.md](cloud-setup.md). Local SQL, transport, IndexedDB and account-isolation fixtures do not establish live hosted behavior. New Codeforces imports still require server internet access. This phase adds no OCR, AI coaching, statement scraping or deployment service.

## Verification

The final local run passed:

- `npm run lint` and `npm run typecheck`.
- `npm test`: **188 passed**, with no failures or skips.
- `npm run build -- --webpack`: successful production build.
- `npm run test:browser -- --workers=4`: **136 passed, 2 skipped**, with no failures. The two skipped cases require disposable hosted-account credentials, which were not configured.

Regression coverage exercises the reported future-date duplicate and identity-edit rejection, profile isolation, manual scheduling precedence, archived and removed track context, linked source selection, original notes and measured time, optional reflection edits and clearing, both written activities and all recall outcomes, date overrides and opt-outs, configurable defaults, selected-period summaries, older backups and recovery. Browser checks cover actual failed saves with retained drafts, retry and repeated submission, reload persistence, hidden previous notes, keyboard operation and focus, both themes, Large text, narrow layouts and reduced motion. The existing real-DOCX and workspace workflows also pass.

Local SQL fixtures exercise the existing account ownership, revision and retry rules. Live hosted-account behavior remains unverified in this run; see [cloud-setup.md](cloud-setup.md) for the required environment and separate hosted checks.

## Screenshots

Memory and written recall were captured and visually inspected in both themes, on desktop and mobile, with Large text, long names and reduced motion:

| View | Warm paper | Ink |
| --- | --- | --- |
| Desktop Memory | [Screenshot](forma-memory-desktop-light-large.png) | [Screenshot](forma-memory-desktop-dark-large.png) |
| Mobile Memory | [Screenshot](forma-memory-mobile-light-large.png) | [Screenshot](forma-memory-mobile-dark-large.png) |
| Desktop recall | [Screenshot](forma-recall-desktop-light-large.png) | [Screenshot](forma-recall-desktop-dark-large.png) |
| Mobile recall | [Screenshot](forma-recall-mobile-light-large.png) | [Screenshot](forma-recall-mobile-dark-large.png) |
