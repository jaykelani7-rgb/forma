# Shared Tracks v1

Shared Tracks lets a person download a practice curriculum and send the file to someone else. A recipient imports the file through Track Studio, reviews and edits it, and confirms a new local track. Forma does not publish the file or create a public link. There are no automatic updates between the sender’s and recipient’s tracks.

## Sharing a track

Open a saved track and choose **Share track**. The dialog shows the stage and membership counts, download name, and every title, URL, rating, suggested practice time and optional text included in the file.

Descriptions and pattern hints start excluded. **Include descriptions** includes stage descriptions; **Include pattern hints** includes the track’s pattern hints. The optional **Share description** field starts blank and includes only text explicitly entered for this download; clearing it excludes that text. Forma does not add an author or account identity. Check the exact content preview before choosing **Download track file**. Exporting does not change the track, its activation, its learning history, or its schedules.

User-authored curriculum text can contain whatever its author typed. The exclusion controls and complete preview help the author review that text; they do not attempt to detect private information inside prose. Descriptions and hints are rendered as plain text.

## Importing a file

Choose **Import shared track** in Tracks or Track Studio, then select a `.forma-track.json` file. The preview shows ordered stages and problems, descriptions and optional hints, duplicates, unresolved identities and the number of memberships already represented in the recipient’s current workspace/profile.

Edit the title, curriculum description, stage details, problem identity or metadata in the existing editor before choosing **Confirm import**. Nothing is added merely by selecting or previewing a file. The sender’s progress is absent from the file. Matching recipient practice history, platform evidence and deliberate schedules can apply to imported memberships. Imported titles, ratings and hints are track metadata and do not replace the recipient’s saved problem or personal learning records.

Saving a shared track does not activate it or start practice, including when it is the recipient’s first track. Choose **Make this my active track** explicitly, or open a stage and choose a problem to practise. Practice, reflections, Learning Memory and Progress then use the same records as other tracks.

If equivalent curriculum already exists, **Open existing track** opens that local track. **Import a separate copy** explicitly creates another track with fresh track, stage and membership IDs while reusing eligible underlying problems and history. It never merges or replaces an existing track. A changed title, stage order, membership order, intentional repeat, identity, source rating, description or hint makes changed curriculum a separate import candidate. Formatting differences, canonical URL aliases and an optional export timestamp do not create a new curriculum identity.

## File format

The file uses a curriculum-only allowlist. It is distinct from a full Forma workspace backup.

```json
{
  "format": "forma-track",
  "version": 1,
  "track": {
    "title": "Two-pointer foundations",
    "shareDescription": "An optional description selected for sharing.",
    "stages": [
      {
        "title": "Foundation",
        "description": "An optional stage description.",
        "suggestedTime": "20 minutes",
        "problems": [
          {
            "title": "Sereja and Dima",
            "code": "381A",
            "url": "https://codeforces.com/problemset/problem/381/A",
            "rating": 800,
            "hint": "An optional, explicitly included pattern hint."
          }
        ]
      }
    ]
  }
}
```

`shareDescription`, stage `description`, and problem `hint` are optional. A missing source rating is represented as `null`. Supported URLs are normalized to canonical Codeforces contest or Gym problem URLs. A, A1 and A2 remain distinct identities; Gym and contest namespaces remain distinct. Repeated memberships retain their position and reuse the same eligible underlying problem.

The download excludes workspace/account details, handles, email addresses, credentials, attempts, submissions, acceptance status, reflections, mistake labels, personal notes, recall cues, coding/recall schedules, daily plans, contests and drafts, recovery copies, local record IDs, raw source evidence and local filenames. The export does not serialize or remove fields from a full workspace object: it builds the curriculum allowlist explicitly.

The parser accepts an optional valid top-level `exportedAt` timestamp for interoperability, ignores it when identifying curriculum, and does not emit it in Forma downloads. Other unknown fields are rejected. Fingerprint comparison trims leading/trailing whitespace and normalizes Unicode to NFC while preserving meaningful inner whitespace. Omitting descriptions or hints changes the curriculum being shared and therefore its duplicate identity. The local normalized fingerprint is an import-duplicate aid, not an authenticity signature. Exact normalized curriculum is also compared, so a matching hash alone cannot identify a duplicate.

## Validation and save behavior

| Limit                                  | Value                                 |
| -------------------------------------- | ------------------------------------- |
| File size                              | 5 MiB                                 |
| Ordered stages                         | 100                                   |
| Problem memberships, including repeats | 1,000                                 |
| Track, stage and problem titles        | 240 characters; required and nonempty |
| Share and stage descriptions           | 5,000 characters                      |
| Suggested practice time                | 240 characters                        |
| Pattern hint                           | 2,000 characters                      |
| Problem ID                             | 60 characters                         |
| Problem URL                            | 2,000 characters                      |
| Source rating                          | Integer from 0 to 10,000, or `null`   |

The parser checks format/version, JSON types, fields, limits, structure, required titles, ratings and safe destinations before presenting a draft. Unsafe protocols, arbitrary hosts, credentialed URLs and custom ports are rejected. A supported but unresolved or conflicting problem identity remains editable and must be corrected or explicitly excluded before saving. Import does not fetch URLs in the file, run scripts, render HTML, or upload the file.

A future/unsupported version produces a clear error. A full workspace backup is directed to Settings → Restore. A failed file selection leaves the saved notebook unchanged. The file input is shown before a preview is created; replacing an edited draft requires explicitly discarding it. An aborted save retains edits and permits retry; the atomic save contains the track, its stages, memberships and any new underlying problems together. Rapid confirmation cannot create duplicate records. Closing an edited preview or choosing **Open existing track** asks before discarding edits; the existing page-unload warning also applies. Existing workspace recovery behavior remains in place.

Captured workspace/profile guards prevent a prepared import from writing into a different scope. Changing workspace or connected Codeforces profile closes the old preview and aborts its pending file read. Reselect the file and reapply any unsaved edits in the new scope.

New shared metadata is optional on saved tracks. Workspace schema version 2 is unchanged; no database migration is required. Older tracks and workspace backups remain supported, and the existing account JSON transport preserves the optional metadata. A normal full workspace backup retains a local imported curriculum along with its private learning history. That backup is private and is never accepted as a shared-track file.

## Verification

Verified on **9 October 2026** against a clean production build:

- Baseline at `cec16388544a1ae3ddb02e454d0af9b25bcec36c`: **339 unit/integration tests passed; 256 desktop/mobile browser checks passed; two hosted-account checks skipped**.
- Final complete suites: **358 unit/integration tests passed; 276 desktop/mobile browser checks passed; two hosted-account checks skipped**. The browser run used four workers and zero retries.
- The focused Shared Tracks browser suite also passed **20/20 cases** on the final production build.
- Full lint, strict TypeScript checking and a clean Webpack production build passed.
- The existing real PDF/OCR, contest-learning, upsolve, retained-draft, recovery and profile-isolation checks remain covered by the complete suites.

The new storage checks exercise transaction failure, stable retry IDs, concurrent imports, private account-cache isolation, older/full backups and the actual account JSON read/write functions with an isolated transport fixture. They do not establish live hosted or cross-device behavior.

The browser regression file is `tests/browser/shared-tracks.spec.ts`. It checks actual downloaded JSON and sender immutability; export choices and exact text preview; import into an isolated second browser workspace; recipient history, schedules and current/archive scope; contest/Gym and split-index identity; intentional repeated memberships; local ID regeneration; explicit activation; practice → reflection → Memory → Progress continuity; equivalent/open/copy and changed files; rejection of malicious, malformed, future, oversized and private-backup files; editable-preview retention; retry and duplicate-click atomicity; and the existing actual 100-problem, five-stage DOCX fixture.

Eight Large-text screenshots were generated and visually inspected:

| View           | Light                                                  | Ink                                                  |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Desktop export | [Preview](forma-shared-export-desktop-light-large.png) | [Preview](forma-shared-export-desktop-ink-large.png) |
| Mobile export  | [Preview](forma-shared-export-mobile-light-large.png)  | [Preview](forma-shared-export-mobile-ink-large.png)  |
| Desktop import | [Preview](forma-shared-import-desktop-light-large.png) | [Preview](forma-shared-import-desktop-ink-large.png) |
| Mobile import  | [Preview](forma-shared-import-mobile-light-large.png)  | [Preview](forma-shared-import-mobile-ink-large.png)  |

The same checks cover keyboard opening/closing and focus return, a narrow 360-pixel viewport, 200% text reflow and reduced motion. The real 100-problem, five-stage DOCX fixture was exported, downloaded and imported into an isolated second workspace with its stage and membership order, titles, ratings and canonical identities preserved.

## Remaining limits

Sharing produces a file that the user sends themselves. Public links, hosting, collaboration, automatic updates and curriculum merging are outside this phase. Import validation does not verify authorship or whether a Codeforces problem currently exists. Unsupported or conflicting identities require correction or exclusion in the preview. User-authored prose still needs the sender's review for private information.

Two live hosted-account browser checks were skipped because disposable authenticated test credentials are absent. Hosted cross-device behavior remains unverified; local file sharing needs no account. No deployment was performed.
