# Tracks and readability phase

Implemented in the existing Forma repository. The product retains its Ink
appearance and gains a readable light appearance, a persisted Comfortable /
Large text preference, and a Tracks destination for structured DOCX practice.

## Supplied document acceptance

The real `CF_100_Two_Pointers_Practice_Sheet.docx` is available and was parsed
read-only. An unchanged acceptance copy is stored at
`tests/fixtures/docx/two-pointers-100.docx`.

| Stage         | Problems | Suggested practice time            |
| ------------- | -------: | ---------------------------------- |
| Foundation    |       20 | 15–25 min before hints             |
| Core Patterns |       20 | 30–45 min before hints             |
| Intermediate  |       20 | 30–45 min before hints             |
| Advanced      |       20 | 45–75 min; revisit after editorial |
| Mastery       |       20 | 45–75 min; revisit after editorial |

**100 problems, five ordered stages, zero unresolved identities, zero
duplicates.** All titles, ratings, Codeforces links, main-pattern hints, and
stage objectives match independently extracted source metadata. The source
contains links and titles; full statements are opened on Codeforces.

## Import boundaries

The supported format is `.docx`. PDF, image OCR, older `.doc` documents,
encrypted documents, and macro-enabled documents are unsupported. Parsing
occurs in the browser; document bytes are not uploaded to a parsing service.
No workspace records change until preview confirmation.

Embedded supported Codeforces URLs provide identity first, with explicit IDs
as fallback. Equivalent URL forms normalize consistently; C1 and C2 remain
distinct. Ambiguous or title-only table entries remain unresolved for manual
correction. Source ratings and hints are retained separately from catalogue
metadata. Pattern hints remain hidden until requested during practice.

The parser enforces an 8 MiB file limit, 256 ZIP entries, 32 MiB total declared
expansion, 8 MiB per ZIP entry, 4 MiB per parsed XML part, a 1000:1 compression
ratio limit, 100,000 XML elements, 80 levels of nesting, 1,000 problems, and
100 stages per import. It validates matching ZIP directory/local headers,
actual streamed output, and CRCs for extracted parts. Imported content is
plain text; XML entity definitions and malformed XML are rejected.

The narrowly scoped OOXML parser uses
[fflate 0.8.3](https://github.com/101arrowz/fflate) for bounded ZIP inflation and
[fast-xml-parser 5.11.2](https://github.com/NaturalIntelligence/fast-xml-parser)
for validated XML parsing with preserved document order.

## Verification

- Final checks on **7 October 2026**: **160 unit/integration tests passed**;
  **104 Chromium desktop/mobile browser tests passed; two hosted-account
  browser checks skipped** because disposable account credentials are absent.
  Full lint, strict TypeScript, and the supported Webpack production build passed.
- Parser: **19 tests passed**, including the real document and exact metadata,
  split text runs, hyperlink and field relationships, C1/C2, explicit fallback,
  duplicates, unresolved entries, progress/cancellation, malformed formats,
  encryption/macros, path traversal, CRC corruption, and resource limits.
- Track domain, Today, and transactional storage: **31 new tests passed**.
  These cover canonical reuse/shared membership, independent versus accepted
  progress, current-handle isolation, stable retry IDs with corrected previews,
  backward-compatible backups, account cache isolation, compatible/conflicting
  tab edits, removal without losing history, and scheduling/priority rules.
- Tracks: **16 desktop/mobile browser cases passed**. The supplied file's
  journey previews and cancels without writing, confirms all 100 entries,
  opens Foundation, records independent reflections, starts the next problem
  only on request, returns to the stage, checks progress, and reloads. Separate
  cases correct unresolved C1/C2 IDs, reorder/remove entries and stages, choose
  a deliberate copy, abort a storage transaction then edit/retry the retained
  preview, reveal hints, save assisted work and its revisit, edit/remove a track,
  and cancel parsing or reject malformed/unsupported files.
- Readability: **12 desktop/mobile browser cases passed**, auditing Today,
  Problems, Activity, Progress, Revisit, Settings, Tracks, track and stage views
  in both appearances at Comfortable and Large sizes. Visible HTML text is
  checked at normal-text 4.5:1 / large-text 3:1 contrast thresholds; hover,
  selected, error and keyboard-focus states are exercised. Focus outlines are
  checked at 3:1 contrast and at least 2px. Tests cover preference reload,
  independent theme changes, long names, keyboard dialog cycling/return,
  focused sessions and reflection controls. Desktop reflow uses 200% CSS zoom
  at a 640px viewport; mobile uses a 320px viewport with Large text. This is a
  reflow test, not an automated native browser-zoom setting.

The shared scale uses relative units: body/inputs/controls 16px, support text
15px, metadata 14px, and decorative labels 12px at Comfortable. Large sets the
root size to 125%; it works alongside browser zoom. The old small overrides
were replaced in their source rules. Mobile navigation wraps into two rows,
with reserved bottom space; the desktop sidebar scrolls when needed. Native
dialogs keep keyboard focus within available controls and restore it to the opener.

Screenshots were visually inspected for light/Ink on desktop/mobile, including
long-title Today views, the real Foundation stage, Large text controls, and
stage footers/takeaways. Examples:

- `docs/forma-real-sheet-desktop-light.png` and `forma-real-sheet-mobile-light.png`
- `docs/forma-readable-today-{desktop,mobile}-{light,ink}.png`
- `docs/forma-readable-settings-large-{desktop,mobile}-{light,ink}.png`
- `docs/forma-tracks-{desktop,mobile}-ink-large-footer.png`

Use `npm run build -- --webpack` to reproduce the production build used here.
The browser suite runs against production on port 3002. Normal local use remains
on port 3001. Tracks and text-size preferences require no account configuration.

Browser tests use isolated synthetic workspaces and mocked public API
responses. Personal practice history is never changed. Hosted account checks
require configured disposable account credentials. Optional hosted sync still
requires the setup in `docs/cloud-setup.md`; local database/transport fixtures
do not establish behavior on a provisioned service.
