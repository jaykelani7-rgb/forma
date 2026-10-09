# Track Studio

Track Studio extends Forma’s existing practice-sheet editor. Upload a document or image, import a shared track file, paste Codeforces links and explicit IDs, or create a manual plan. All paths use the same editable preview and existing track records. Ordinary practice pages do not load the PDF or OCR engines. [Shared Tracks](shared-tracks.md) documents curriculum-only exports, file validation and deliberate duplicate-copy imports.

## Create and review a track

Open **Tracks → Import practice sheet**, **Paste Codeforces links or IDs**, or **Create manually**. Upload supports `.docx`, `.pdf`, `.png`, `.jpg` and `.jpeg`. Older `.doc`, HEIC and other formats must be exported into a supported format first.

DOCX keeps its existing heading, table, hyperlink and source-order handling. PDF processing reads selectable text and hyperlink annotations first. Scanned pages use OCR, including pages whose only selectable text is a heading or page number. An image has no recoverable document hyperlink unless the link itself is visible in its pixels or provided by a PDF annotation.

### Selectable text and images on the same PDF page

A page can contain both selectable problem rows and additional problem text inside an image. The default import keeps the selectable rows and adds an unresolved **Image text on this PDF page has not been read** coverage warning when that page also contains raster image content. The warning names its page and explains how to recover the unread content. It prevents confirmation until you deliberately resolve it; finding one selectable problem no longer implies that the whole page was read.

To recover image problems, close the preview, deliberately discard that draft, select **Use OCR for all PDF pages**, and import the file again. This option reads every PDF page with OCR. On a page containing both selectable problems and images, recovery keeps the native text and annotation identities, then adds image readings in their page positions. An OCR copy is combined with native text only when its physical position and text or explicit identities agree. This preserves intentional repeated memberships in different positions and preserves the original selectable stage boundaries. Pure selectable pages requested with this option continue to use the existing OCR path.

Differing OCR readings at the same position remain in immutable source evidence, including their confidence, and require review. Additional identities, uncertain overlapping rows and unpositioned OCR readings remain visible candidates. An uncertain OCR heading becomes a reviewable diagnostic instead of silently creating or replacing a selectable stage boundary. The importer does not substitute ambiguous characters or guess a missing identity. If a PDF annotation identifies an image row, its recoverable link stays associated with that row during recovery.

The importer cannot reliably distinguish a decorative image from unread problem text without processing it. A logo therefore produces the same coverage warning, but it does **not** force an OCR download or run. After checking every image on the named page, choose **Exclude from save** for a decorative-only warning. You may instead manually recover the missing entries and explicitly review the warning; typing an ID alone does not acknowledge page coverage. Exclusions remain reversible in the preview. Automatic OCR of scanned pages, processing cancellation, local worker ownership and all existing limits remain in force.

This recovery uses English OCR and page geometry, not a guarantee of complete recognition. Complex columns, rotation, blurry text or missing positions still require comparison with the original PDF and manual stage/order correction. The recovery option applies to all pages, so review any OCR candidates on other pages too.

### Preview and confirmation

The common preview shows stage and problem counts, unresolved entries, duplicate identities, items needing review, excluded candidates and included memberships. Stage summaries and compact rows keep large sheets manageable. Use **Search preview** and **Preview filter** to find a title, ID or source text, or concentrate on unresolved, uncertain, duplicate or excluded rows. Open a row to edit its title, explicit ID, URL, source rating, pattern hint, stage assignment and order. Move controls work by keyboard.

Explicit stage headings provide grouping. Uncertain grouping goes into **Ungrouped**. Titles without a recoverable identity remain visible; entering an ID or supported URL is required before saving. There is no title-based guess, OCR character substitution, inferred rating or statement scraping. Ratings and hints come from explicit source metadata or your edits.

**Recognized ID format** means an identifier was parsed; it does not verify that the problem exists on Codeforces. This flow performs no live existence check. Indices such as `A`, `A1` and `A2` stay distinct. Contest/problemset URLs refer to the same contest namespace; Gym URLs use a separate namespace. Editing an ID preserves a source Gym URL’s namespace, including while the ID is partially typed. Use an explicit URL or a `Gym` prefix when you need to supply that distinction yourself.

Each PDF/OCR/pasted entry can retain its source page or location, immutable extracted text, OCR confidence and review reasons. Open an uncertain row to compare that evidence with the editable values. OCR confidence describes recognition, not problem correctness. Confirm **I reviewed this extracted entry**, deliberately correct its identity, or choose **Exclude from save**. Exclusion leaves the candidate visible in the preview and reversible with **Include in save**. Unresolved or unreviewed included candidates prevent confirmation. Duplicate memberships retain their order and share the matching underlying problem; the preview does not silently delete them.

Choose **Confirm import** only when the included memberships are ready. It saves the track, stages, memberships and any new problems together. After saving, choose a stage, make the track active for Today, or start practice on any entry. Timed sessions, Learning Memory, written recall and Revisit continue to use the existing shared scheduling and profile rules.

## Build or edit your own plan

**Create manually** starts an empty track, which can be saved without stages or entries. **Add stage** creates a stage; open **Edit stage details** to rename it and edit its description, suggested practice time and source notes. Track-level source notes have their own collapsed section. Stages can be moved up or down. Removing a stage moves its candidates to **Ungrouped** so they remain available for correction or explicit exclusion.

Within a stage, choose **Add problem** for an individual row or **Add pasted batch** for links and IDs. Pasted batches support one problem per line and lists of explicit identifiers; ambiguous lines remain candidates for correction. A typed batch must be added or cleared before saving, closing its panel, or removing its stage. Moving a problem between stages retains its membership ID and opens the destination for keyboard continuation.

Open an existing track’s **Edit track** action to use the same editor. Unchanged stages and memberships retain their IDs. Changing membership does not rewrite original attempts, reflections, recall records or historical track/stage snapshots. Replacing an entry’s identity creates or reuses the appropriate problem membership while retaining the old problem’s history. Problems belonging to an unrelated Codeforces profile are not reused as that profile’s evidence. Removing a track likewise preserves its underlying problems and learning history.

Unsaved edits trigger **Discard this draft?** when closing the editor. **Keep editing** preserves them; **Discard draft** explicitly abandons them. Moving from typed pasted text into manual creation also requires this choice. A failed validation or storage write leaves the draft and its IDs intact. Follow the storage notice and Settings recovery guidance, then use **Retry saving track**. Retrying uses the same track and membership IDs rather than creating another import.

## Local processing, assets and limits

Document content is processed on the device in browser workers. No document is uploaded for PDF extraction or OCR. PDF.js and Tesseract are loaded only when that processing is requested. Reading, page processing and preview preparation report progress. **Cancel processing** stops work, terminates the workers and returns to the entry screen without creating records. Workspace/account changes and unmounting also cancel pending work.

The first PDF/OCR use downloads application assets from Forma’s own origin. This includes worker code, the recognition engine and English language data. A failed engine or language download produces retry guidance; reconnect and select the file again, or paste the known identifiers instead. Asset download sizes depend on the engine path and required PDF fonts. Offline document import is not claimed or verified.

| Boundary                        | Limit                                         |
| ------------------------------- | --------------------------------------------- |
| DOCX file                       | 8 MiB                                         |
| PDF, PNG or JPEG file           | 20 MiB                                        |
| PDF pages                       | 40                                            |
| Input image                     | 20 million pixels; no side above 8,000 pixels |
| Rendered PDF/OCR image          | 8 million pixels; no side above 4,096 pixels  |
| Extracted text                  | 250,000 characters and 2,000 lines            |
| Detected problems per track     | 1,000                                         |
| Stages per track                | 100                                           |
| Complete processing operation   | 3 minutes                                     |
| Page rendering or OCR operation | 45 seconds                                    |
| Engine/asset initialization     | 60 seconds                                    |
| Individual source line          | 10,000 characters                             |
| Track/stage source notes        | 5,000 characters each                         |

DOCX retains additional existing ZIP/XML limits, including decompressed sizes and parser depth; see [Tracks and readability](tracks-and-readability.md). Limits produce actionable errors instead of truncating the preview. Corrupt files, content/extension mismatches, encrypted PDFs, oversized sources and unsupported formats save no records. Export an unencrypted PDF, split a large sheet, or crop/resize an image before retrying.

The OCR language is English. Clear printed text is the intended source. Blurry images, handwriting, rotation, complex tables or multiple columns can produce missing or misordered text. Even a confidently recognized ID can be wrong, so source review remains part of the workflow. OCR does not reconstruct a hyperlink absent from the image, fetch full statements, or provide AI coaching.

### Dependency preparation

The pinned engines are `pdfjs-dist@6.4.299`, `tesseract.js@7.0.0`, `tesseract.js-core@7.0.0` and `@tesseract.js-data/eng@1.0.0`. The English package supplies `4.0.0_best_int` data. `npm run prepare:imports` copies assets into the ignored `public/import-assets` directory; it also runs during `postinstall`, `predev` and `prebuild`. A build/install host must obtain the pinned npm packages. Runtime paths are versioned and same-origin:

- `/import-assets/pdfjs-6.4.299`
- `/import-assets/tesseract-7.0.0`
- `/import-assets/core-7.0.0`
- `/import-assets/eng-1.0.0`

The integration follows the official [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/api.js.html) and [worker example](https://github.com/mozilla/pdf.js/blob/master/examples/webpack/main.mjs), plus Tesseract’s [local asset setup](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) and [worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).

## Records, compatibility and account setup

Schema version remains **2**. Track and stage source notes and membership source evidence are optional record extensions. Review flags and exclusion choices belong to the editable preview. Older notebooks and backups remain accepted without fabricating evidence. Exclusion is a preview choice: explicitly excluded candidates are omitted at confirmation. Saved memberships retain their source evidence and are considered reviewed when reopening the editor.

Track changes use the existing strict proposal validation before optimistic exposure, revisioned IndexedDB storage, export/import validation, compatible merges and recovery copies. Empty stage lists are now valid. Canonical identity resolution derives legacy Gym keys from explicit Gym URLs without rewriting existing records or assigning their history to contest problems. The shared coding schedule, separate written-recall schedule and account/profile boundaries continue to apply.

The existing 64 MiB workspace/backup capacity and global record limits remain in force. This phase requires no additional account credentials, hosted setup or SQL migration. Optional account configuration remains in [Cloud setup](cloud-setup.md). Local SQL and account-isolation fixtures do not establish live hosted behavior.

## Verification

At the original Track Studio phase, verified locally on **8 October 2026**: **221 unit/integration tests passed**, including real local Tesseract recognition, and **166 desktop/mobile browser tests passed**. Lint, strict type checking and the Webpack production build passed. Two hosted-account browser cases were skipped because disposable test credentials are absent. The pre-phase baseline was 188 unit/integration and 136 browser checks; those existing workflows remain covered. See the later [integration review](integration-review.md) for the hybrid-page fix and [Shared Tracks verification](shared-tracks.md#verification) for the current complete regression results.

The existing supplied DOCX fixture retains **100 problems in five ordered stages of 20**. New controlled fixtures cover selectable PDF text and annotations, scanned and mixed PDFs, images, ambiguous identifiers, missing links, duplicate candidates and stage boundaries. See [document fixture notes](../tests/fixtures/documents/README.md) for their provenance. Real OCR extraction is exercised with a controlled printed image; mocked OCR alone does not establish recognition.

The same-page hybrid regression uses selectable `381A`, raster `1791C`, three selectable stage headings and a second intentional `381A` membership. Before the fix, the real browser worker returned both `381A` memberships and no warning while silently omitting `1791C`. The default path now reports the unread-image coverage warning without requesting OCR assets. Deliberate OCR recovery returns `381A`, `1791C`, `381A` in the three original stages, with native evidence for the two selectable rows and OCR evidence for the recovered image row. A decorative-image control verifies the warning without automatic recognition. Focused checks also cover overlapping disagreements, missing positions, Gym annotations, preserved repeats and evidence limits; the existing real selectable/scanned/mixed/image fixtures remain part of verification.

Workflow checks cover upload → review → correction → save → start practice, manual/empty-track creation, pasted batches, stage editing, history-preserving replacement/removal, retained failed saves and retries, cancellation, reload persistence, source evidence and backup compatibility. Browser OCR checks use the actual local engines for scanned, mixed, heading-overlay and forced-OCR PDFs as well as PNG/JPEG images. Download failure and retry, zero remaining worker targets after cancellation, encrypted/corrupt documents, oversized scans and page limits are exercised. Safe metadata edits to Gym records retain their namespace while identity reassignment remains locked. Hosted-account cases remain unavailable without disposable configured accounts.

## Screenshots

Track Studio captures were inspected in the warm light and black/ivory Ink themes with Large text and long names. Keyboard dialogs, reduced motion and 360-pixel/200% reflow were also checked. The fixed actions remain reachable while the preview scrolls:

| View            | Warm light                                                 | Ink                                                       |
| --------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| Desktop Studio  | [Screenshot](forma-studio-desktop-light-large.png)         | [Screenshot](forma-studio-desktop-dark-large.png)         |
| Mobile Studio   | [Screenshot](forma-studio-mobile-light-large.png)          | [Screenshot](forma-studio-mobile-dark-large.png)          |
| Desktop entries | [Screenshot](forma-studio-desktop-light-large-entries.png) | [Screenshot](forma-studio-desktop-dark-large-entries.png) |
| Mobile entries  | [Screenshot](forma-studio-mobile-light-large-entries.png)  | [Screenshot](forma-studio-mobile-dark-large-entries.png)  |
| Desktop actions | [Screenshot](forma-studio-desktop-light-large-footer.png)  | [Screenshot](forma-studio-desktop-dark-large-footer.png)  |
| Mobile actions  | [Screenshot](forma-studio-mobile-light-large-footer.png)   | [Screenshot](forma-studio-mobile-dark-large-footer.png)   |
