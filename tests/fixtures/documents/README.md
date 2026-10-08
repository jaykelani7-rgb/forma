# Local import fixtures

These original, controlled fixtures exercise document extraction without using a remote service. All documents and images were generated locally from the text and links in `generate-fixtures.py`. They contain no copied Codeforces problem statements.

- `text-links.pdf`: two selectable-text pages with explicit stage headings, hyperlink-only titles for 381A and 279B, separate 1739C1/C2 entries, a duplicate 381A, a title without identity, and a printed ID that conflicts with its hyperlink.
- `scanned.pdf`: one image-only PDF page containing two stages and 381A, 279B, 1739C1, and 1739C2.
- `mixed.pdf`: selectable-text page 1 with 381A/279B and scanned page 2 with 1739C1/C2. The scanned page also has a tiny selectable page number, which must not suppress OCR.
- `scan-with-heading.pdf`: a scanned C1/C2 list below a long selectable stage heading. The heading must not cause the scanned rows to disappear.
- `screenshot.png` and `screenshot.jpg`: the same upright printed list with four recoverable IDs, the ambiguous literal `38IA`, and a title without an ID. No `I` to `1` substitution is allowed.
- `scan-source.png` and `mixed-scan-source.png`: original rasters used in the PDFs.
- `encrypted.pdf`: a password-protected file for an actionable rejection; its fixture password is `fixture-password`.
- `corrupt.pdf`: intentionally malformed PDF bytes.
- `corrupt.png`: a truncated image with a valid header, for a helpful decoding error before OCR starts.
- `too-many-pages.pdf`: 41 pages, exceeding the import page bound.
- `oversized-scan.pdf`: a 25 megapixel PDF image that must be rejected before OCR with instructions to reduce scan resolution.

The fixture generation script requires Pillow and ReportLab; these are authoring tools only. Checked-in fixtures run without Python. It uses Forma's existing Geist Mono font. `tests/document-import.test.ts` runs real PDF.js extraction and an actual local Tesseract worker with the pinned English language data, and verifies candidate order and unresolved OCR characters. Browser tests exercise the app's worker pipeline and review workflow.
