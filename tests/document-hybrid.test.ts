import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  boundedExtractedLines,
  mixedContentWarning,
  pdfTextLines,
  reconcileHybridPDFLines,
  selectableProblemText,
} from "../public/track-document-helpers.mjs";
import {
  entryNeedsReview,
  parseExtractedTrack,
  trackDraftReview,
  type ExtractedTrackLine,
} from "../src/lib/track-studio";
import { emptyData, validateData } from "../src/lib/model";
import { importTrack } from "../src/lib/tracks";

const native = (text: string, y: number, links: string[] = []) => ({
  text,
  kind: "pdf-text" as const,
  page: 1,
  location: `Page 1, selectable line at ${y}`,
  bounds: [20, y, 400, y + 12],
  links,
});
const ocr = (text: string, y: number, confidence = 94) => ({
  ...native(text, y),
  kind: "ocr" as const,
  location: `Page 1, OCR line at ${y}`,
  confidence,
});
const entries = (draft: ReturnType<typeof parseExtractedTrack>) =>
  draft.stages.flatMap((stage) => stage.entries);

test("a real same-page hybrid PDF retains native memberships and cannot silently confirm its unread image", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: new Uint8Array(
      await readFile(resolve("tests/fixtures/documents/hybrid.pdf")),
    ),
    standardFontDataUrl: `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`,
  });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const operators = await page.getOperatorList();
    assert.ok(operators.fnArray.includes(pdfjs.OPS.paintImageXObject));
    const extracted = pdfTextLines(
      (await page.getTextContent()).items,
      await page.getAnnotations(),
      1,
    );
    assert.equal(selectableProblemText(extracted, true), true);
    const draft = parseExtractedTrack(
      [...extracted, mixedContentWarning(1)] as ExtractedTrackLine[],
      "hybrid.pdf",
      "hybrid-coverage",
    );
    assert.deepEqual(
      draft.stages.map((stage) => stage.title),
      ["Selectable foundations", "Image practice", "Intentional revisit"],
    );
    assert.deepEqual(
      entries(draft).map((entry) => entry.code),
      ["381A", "381A", ""],
    );
    assert.equal(trackDraftReview(draft).unresolvedCount, 1);
    assert.equal(trackDraftReview(draft).reviewRequiredCount, 1);
    const warning = entries(draft).at(-1)!;
    assert.equal(warning.source?.page, 1);
    assert.match(
      warning.source!.reviewReasons![0],
      /Use OCR for all PDF pages/,
    );
    assert.throws(() => importTrack(emptyData(), draft), /unresolved|review/i);
    warning.code = "1791C";
    warning.title = "Manually recovered from the image";
    assert.equal(
      entryNeedsReview(warning),
      true,
      "Typing an ID does not silently acknowledge page coverage",
    );
    warning.reviewed = true;
    assert.equal(entryNeedsReview(warning), false);
    warning.code = "";
    warning.excluded = true;
    assert.equal(trackDraftReview(draft).unresolvedCount, 0);
    assert.equal(trackDraftReview(draft).reviewRequiredCount, 0);
    const saved = importTrack(emptyData(), draft);
    validateData(saved);
    assert.deepEqual(
      saved.trackEntries!.map((entry) => entry.code),
      ["381A", "381A"],
    );
    assert.equal(
      saved.problems.length,
      1,
      "Intentional repeated memberships share one underlying problem",
    );
    page.cleanup();
  } finally {
    await loading.destroy();
  }
});

test("hybrid recovery combines only physical OCR overlaps and preserves stages, exact native links, and intentional repeats", () => {
  const link = "https://codeforces.com/contest/381/problem/A";
  const selectable = [
    native("Stage 1: Selectable foundations", 700),
    native("381A - Sereja and Dima", 650, [link]),
    native("Stage 2: Image practice", 600),
    native("Stage 3: Intentional revisit", 500),
    native("381A - Repeated membership", 450, [link]),
  ];
  const merged = reconcileHybridPDFLines(selectable, [
    ocr("Stage 1: Selectable foundations", 702),
    ocr("381A - Sereja and Dima", 652),
    ocr("Stage 2: Image practice", 602),
    ocr("1791C - Prepend and Append", 550),
    ocr("Stage 3: Intentional revisit", 502),
    ocr("381A - Repeated membership", 452),
  ]);
  const draft = parseExtractedTrack(merged, "hybrid.pdf", "hybrid-recovered");
  assert.deepEqual(
    draft.stages.map((stage) => stage.title),
    ["Selectable foundations", "Image practice", "Intentional revisit"],
  );
  assert.deepEqual(
    draft.stages.map((stage) => stage.entries.map((entry) => entry.code)),
    [["381A"], ["1791C"], ["381A"]],
  );
  assert.deepEqual(
    entries(draft).map((entry) => entry.source?.kind),
    ["pdf-text", "ocr", "pdf-text"],
  );
  assert.equal(
    entries(draft)[0].url,
    "https://codeforces.com/problemset/problem/381/A",
  );
  assert.deepEqual(merged[1].links, [link]);
  assert.equal(entries(draft)[0].source?.text, "381A - Sereja and Dima");
  assert.equal(trackDraftReview(draft).reviewRequiredCount, 1);
  entries(draft)[1].reviewed = true;
  const saved = importTrack(emptyData(), draft);
  validateData(saved);
  assert.equal(saved.trackEntries!.length, 3);
  assert.equal(saved.problems.length, 2);
  assert.equal(saved.trackEntries![1].source?.page, 1);
});

test("same-position OCR disagreements remain source evidence and ambiguous extra identities remain reviewable rows", () => {
  const selectable = [native("381A - Sereja and Dima", 650)];
  const merged = reconcileHybridPDFLines(selectable, [
    ocr("381A - Sereja and Dirna", 650, 81),
    ocr("381A and 279B", 650, 74),
  ]);
  const draft = parseExtractedTrack(
    merged,
    "hybrid.pdf",
    "hybrid-disagreement",
  );
  assert.equal(entries(draft).length, 2);
  const exact = entries(draft).find((entry) => entry.code === "381A")!;
  assert.equal(exact.title, "Sereja and Dima");
  assert.match(
    exact.source!.text,
    /OCR at the same location \(81% confidence\): 381A - Sereja and Dirna/,
  );
  assert.equal(entryNeedsReview(exact), true);
  const ambiguous = entries(draft).find((entry) => !entry.code)!;
  assert.equal(ambiguous.source?.text, "381A and 279B");
  assert.ok(
    ambiguous.source?.reviewReasons?.some((reason) =>
      reason.includes("uncertain association"),
    ),
  );
  assert.equal(trackDraftReview(draft).unresolvedCount, 1);
  assert.equal(
    selectable[0].text,
    "381A - Sereja and Dima",
    "Reconciliation leaves its input unchanged",
  );
});

test("image-only annotation evidence combines with its OCR title without adding an annotation-only duplicate", () => {
  const link = "https://codeforces.com/gym/102644/problem/A";
  const merged = reconcileHybridPDFLines(
    [{ ...native(link, 550, [link]), annotationOnly: true }],
    [ocr("102644A - Image title", 551)],
  );
  const draft = parseExtractedTrack(merged, "hybrid.pdf", "hybrid-annotation");
  assert.equal(entries(draft).length, 1);
  assert.equal(entries(draft)[0].url, link);
  assert.equal(entries(draft)[0].title, "Image title");
  assert.equal(entries(draft)[0].source?.kind, "ocr");
});

test("uncertain OCR headings and table headers cannot disappear as metadata or invent native stage boundaries", () => {
  const merged = reconcileHybridPDFLines(
    [
      native("Stage 1: Foundations", 700),
      native("381A - Sereja and Dima", 650),
    ],
    [
      ocr("Stage 7: Foundatlons", 700),
      {
        ...ocr("Problem | ID", 650),
        reviewReasons: ["Uncertain image table reading"],
      },
    ],
  );
  const draft = parseExtractedTrack(merged, "hybrid.pdf", "hybrid-headings");
  assert.deepEqual(
    draft.stages.map((stage) => stage.title),
    ["Foundations"],
  );
  assert.ok(
    entries(draft).some(
      (entry) => entry.source?.text === "Stage 7: Foundatlons" && !entry.code,
    ),
  );
  assert.ok(
    entries(draft).some(
      (entry) => entry.source?.text === "Problem | ID" && !entry.code,
    ),
  );
  assert.equal(trackDraftReview(draft).unresolvedCount, 2);
});

test("a differing equivalent OCR heading preserves the native boundary and raw alternate reading", () => {
  const merged = reconcileHybridPDFLines(
    [
      native("Stage 1: Foundations", 700),
      native("381A - Sereja and Dima", 650),
    ],
    [ocr("Stage 1 - Foundations", 700)],
  );
  const draft = parseExtractedTrack(
    merged,
    "hybrid.pdf",
    "hybrid-native-heading",
  );
  assert.deepEqual(
    draft.stages.map((stage) => stage.title),
    ["Foundations"],
  );
  assert.deepEqual(
    entries(draft).map((entry) => entry.code),
    ["", "381A"],
  );
  assert.match(
    entries(draft)[0].source!.text,
    /OCR at the same location \(94% confidence\): Stage 1 - Foundations/,
  );
  assert.ok(
    entries(draft)[0].source?.reviewReasons?.some((reason) =>
      reason.includes("selectable stage heading is retained"),
    ),
  );
  assert.equal(trackDraftReview(draft).unresolvedCount, 1);
});

test("OCR fallback text without positions stays visible without deduplicating identities or inventing stage boundaries", () => {
  const merged = reconcileHybridPDFLines(
    [
      native("Stage 1: Foundations", 700),
      native("381A - Sereja and Dima", 650),
    ],
    [
      {
        text: "Stage 2: Unpositioned scan",
        kind: "ocr",
        page: 1,
        location: "Page 1, OCR line 1",
      },
      {
        text: "381A - Unpositioned duplicate",
        kind: "ocr",
        page: 1,
        location: "Page 1, OCR line 2",
      },
    ],
  );
  const draft = parseExtractedTrack(
    merged,
    "hybrid.pdf",
    "hybrid-no-positions",
  );
  assert.deepEqual(
    draft.stages.map((stage) => stage.title),
    ["Foundations"],
  );
  assert.deepEqual(
    entries(draft).map((entry) => entry.code),
    ["381A", "", "381A"],
  );
  assert.ok(
    entries(draft)[1].source?.reviewReasons?.some((reason) =>
      reason.includes("no recoverable page position"),
    ),
  );
  assert.equal(trackDraftReview(draft).reviewRequiredCount, 2);
});

test("hybrid overlap evidence participates in character and per-source limits instead of being truncated", () => {
  assert.throws(
    () =>
      boundedExtractedLines([
        {
          ...native("381A", 650),
          ocrAlternatives: [{ text: "x".repeat(250001) }],
        },
      ]),
    /250000 extracted characters/,
  );
  assert.throws(
    () =>
      parseExtractedTrack(
        [
          {
            ...native("381A", 650),
            ocrAlternatives: [{ text: "x".repeat(250001) }],
          },
        ],
        "hybrid.pdf",
        "hybrid-large",
      ),
    /250,000 text characters/,
  );
  assert.throws(
    () =>
      parseExtractedTrack(
        [
          {
            ...native("381A", 650),
            ocrAlternatives: [{ text: "x".repeat(10000) }],
          },
        ],
        "hybrid.pdf",
        "hybrid-long-row",
      ),
    /10,000 characters/,
  );
});
