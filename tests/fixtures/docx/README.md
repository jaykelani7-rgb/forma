# DOCX import fixtures

`two-pointers-100.docx` is an unchanged copy of the user-supplied
`CF_100_Two_Pointers_Practice_Sheet.docx`. It is used only as an acceptance
fixture; it is never imported into a personal workspace by the tests.

`two-pointers-100.expected.json` independently records the source's five
stages and all 100 problem links, names, ratings, and main-pattern hints, in
document order. The expected metadata was extracted read-only with Python's
standard ZIP/XML libraries, separately from the application parser.

Smaller malformed and synthetic documents are generated in
`tests/docx-import.test.ts` so the limits, hyperlink relationships, split runs,
ambiguous IDs, and cancellation cases remain easy to inspect.
