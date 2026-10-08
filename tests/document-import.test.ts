import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DOCUMENT_IMPORT_ASSETS,
  DOCUMENT_IMPORT_LIMITS,
  boundedExtractedLines,
  boundedRenderSize,
  documentKind,
  imageDimensions,
  ocrTextLines,
  pdfTextLines,
  selectableProblemText,
  validateDocumentBytes,
} from "../public/track-document-helpers.mjs";
import {
  DocumentImportError,
  importPracticeDocument,
} from "../src/lib/document-import";
import {
  parseExtractedTrack,
  type ExtractedTrackLine,
} from "../src/lib/track-studio";

const fixture = (name: string) => resolve("tests/fixtures/documents", name);
const file = (name: string, bytes = new Uint8Array([1])) =>
  new File([bytes], name);

test("format, empty-file, and byte limits reject before starting a worker", async () => {
  assert.deepEqual(
    ["sheet.DOCX", "sheet.pdf", "shot.PNG", "shot.jpg", "shot.jpeg"].map(
      documentKind,
    ),
    ["docx", "pdf", "png", "jpeg", "jpeg"],
  );
  await assert.rejects(
    importPracticeDocument(file("sheet.gif")),
    /Choose a DOCX, PDF, PNG, or JPEG/,
  );
  await assert.rejects(
    importPracticeDocument(new File([], "empty.pdf")),
    /empty/,
  );
  await assert.rejects(
    importPracticeDocument(file("x".repeat(241) + ".pdf")),
    /240 characters/,
  );
  await assert.rejects(
    importPracticeDocument(
      file("big.pdf", new Uint8Array(DOCUMENT_IMPORT_LIMITS.maxFileBytes + 1)),
    ),
    /20 MB/,
  );
  await assert.rejects(
    importPracticeDocument(
      file("big.docx", new Uint8Array(8 * 1024 * 1024 + 1)),
    ),
    /8 MB/,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    importPracticeDocument(file("sheet.pdf"), { signal: aborted.signal }),
    { name: "AbortError" },
  );
});

test("actual PNG/JPEG headers are checked before decoding and oversized dimensions are rejected", async () => {
  for (const [name, kind] of [
    ["screenshot.png", "png"],
    ["screenshot.jpg", "jpeg"],
  ] as const) {
    const bytes = new Uint8Array(await readFile(fixture(name)));
    validateDocumentBytes(bytes, kind);
    assert.deepEqual(imageDimensions(bytes, kind), {
      width: 1900,
      height: 804,
    });
  }
  const png = new Uint8Array(await readFile(fixture("screenshot.png")));
  new DataView(png.buffer).setUint32(16, 10000);
  assert.throws(
    () => imageDimensions(png, "png"),
    /20 megapixels or 8000 pixels/,
  );
  assert.throws(
    () => imageDimensions(new Uint8Array([255, 216, 255, 192, 0]), "jpeg"),
    /dimensions could not be read/,
  );
  assert.throws(
    () => validateDocumentBytes(new Uint8Array([1, 2, 3]), "pdf"),
    /does not match/,
  );
  assert.throws(
    () => validateDocumentBytes(new Uint8Array([1, 2, 3]), "png"),
    /does not match/,
  );
  assert.throws(
    () => validateDocumentBytes(new Uint8Array([1, 2, 3]), "jpeg"),
    /does not match/,
  );
});

test("rendering and extracted content have finite, enforced processing bounds", () => {
  const large = boundedRenderSize(12000, 12000);
  assert.ok(large.width <= 4096 && large.height <= 4096);
  assert.ok(large.width * large.height <= 8_000_000);
  assert.throws(() => boundedRenderSize(Infinity, 1), /invalid dimensions/);
  assert.throws(() => boundedRenderSize(0, 1), /invalid dimensions/);
  assert.throws(
    () =>
      boundedExtractedLines(
        Array.from({ length: 2001 }, () => ({ text: "381A" })),
      ),
    /2000 extracted lines/,
  );
  assert.throws(
    () => boundedExtractedLines([{ text: "a".repeat(250001) }]),
    /250000 extracted characters/,
  );
  assert.throws(
    () =>
      boundedExtractedLines([{ text: "381A", links: ["a".repeat(250001)] }]),
    /250000 extracted characters/,
  );
});

test("PDF fragments retain source order, annotations, ambiguous links, and unmatched links", () => {
  const item = (str: string, x: number, y: number, hasEOL = false) => ({
    str,
    transform: [1, 0, 0, 12, x, y],
    height: 12,
    width: str.length * 5,
    hasEOL,
  });
  const lines = pdfTextLines(
    [
      item("Stage 1:", 20, 700),
      item("Foundations", 72, 700, true),
      item("Sereja and", 20, 650),
      item("Dima", 78, 650, true),
      item("Unresolved title", 20, 600, true),
    ],
    [
      {
        subtype: "Link",
        url: "https://codeforces.com/contest/381/problem/A",
        rect: [20, 645, 110, 666],
      },
      {
        subtype: "Link",
        url: "https://codeforces.com/contest/279/problem/B",
        rect: [20, 645, 110, 666],
      },
      {
        subtype: "Link",
        url: "https://codeforces.com/gym/102644/problem/A",
        rect: [20, 500, 110, 516],
      },
    ],
    3,
  );
  assert.deepEqual(
    lines.map((line) => line.text),
    [
      "Stage 1: Foundations",
      "Sereja and Dima",
      "Unresolved title",
      "https://codeforces.com/gym/102644/problem/A",
    ],
  );
  assert.equal(lines[1].links!.length, 2);
  assert.equal(lines[0].page, 3);
  assert.match(lines[2].location, /Page 3, line 3/);
});

test("OCR lines retain ambiguous characters and align annotation evidence geometrically without duplicating rows", () => {
  const lines = ocrTextLines(
    {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  text: "38IA - Ambiguous\n",
                  confidence: 42,
                  bbox: { x0: 10, x1: 300, y0: 30, y1: 60 },
                },
                {
                  text: "Title without ID",
                  confidence: 90,
                  bbox: { x0: 10, x1: 300, y0: 80, y1: 110 },
                },
              ],
            },
          ],
        },
      ],
    },
    2,
    "Page",
    [
      {
        subtype: "Link",
        url: "https://codeforces.com/contest/381/problem/A",
        rect: [10, 30, 300, 60],
      },
    ],
    { convertToViewportPoint: (x: number, y: number) => [x, y] },
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "38IA - Ambiguous");
  assert.equal(lines[0].confidence, 42);
  assert.deepEqual(lines[0].links, [
    "https://codeforces.com/contest/381/problem/A",
  ]);
  assert.equal(lines[1].text, "Title without ID");
});

test("selectable headings and page numbers on a scanned PDF do not replace the scanned problem rows", () => {
  assert.equal(
    selectableProblemText(
      [
        { text: "Stage 2: A long selectable section heading", links: [] },
        { text: "2", links: [] },
      ],
      true,
    ),
    false,
  );
  assert.equal(
    selectableProblemText(
      [{ text: "A long document title with no problem identity", links: [] }],
      true,
    ),
    false,
  );
  assert.equal(
    selectableProblemText(
      [{ text: "381A - Sereja and Dima", links: [] }],
      true,
    ),
    true,
  );
  assert.equal(
    selectableProblemText(
      [
        {
          text: "Sereja and Dima",
          links: ["https://codeforces.com/contest/381/problem/A"],
        },
      ],
      false,
    ),
    true,
  );
  assert.equal(
    selectableProblemText(
      [{ text: "A title without a recoverable ID", links: [] }],
      false,
    ),
    true,
  );
  const item = (str: string, y: number) => ({
    str,
    transform: [1, 0, 0, 12, 20, y],
    height: 12,
    width: 100,
    hasEOL: true,
  });
  const lines = pdfTextLines(
    [item("First line", 700), item("Last line", 500)],
    [
      {
        subtype: "Link",
        url: "https://codeforces.com/contest/381/problem/A",
        rect: [20, 600, 120, 616],
      },
    ],
    1,
  );
  assert.deepEqual(
    lines.map((line) => line.text),
    ["First line", "https://codeforces.com/contest/381/problem/A", "Last line"],
  );
});

test(
  "actual text PDF extraction retains hyperlinks, C1/C2, order, unresolved titles, and conflicts",
  { timeout: 30_000 },
  async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = pdfjs.getDocument({
      data: new Uint8Array(await readFile(fixture("text-links.pdf"))),
      standardFontDataUrl: `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`,
    });
    try {
      const pdf = await loading.promise;
      assert.equal(pdf.numPages, 2);
      const lines: ExtractedTrackLine[] = [];
      for (let page = 1; page <= pdf.numPages; page++) {
        const source = await pdf.getPage(page);
        lines.push(
          ...(pdfTextLines(
            (await source.getTextContent()).items,
            await source.getAnnotations(),
            page,
          ) as ExtractedTrackLine[]),
        );
        source.cleanup();
      }
      const draft = parseExtractedTrack(
        lines,
        "text-links.pdf",
        "text-pdf-fixture",
      );
      assert.deepEqual(
        draft.stages.map((stage) => stage.title),
        ["Foundations", "Variants"],
      );
      const entries = draft.stages.flatMap((stage) => stage.entries);
      assert.deepEqual(
        entries.slice(0, 5).map((entry) => entry.code),
        ["381A", "279B", "1739C1", "1739C2", "381A"],
      );
      assert.equal(entries[0].title, "Sereja and Dima");
      assert.equal(entries[5].code, "");
      assert.equal(
        entries[6].code,
        "",
        "A mismatched printed ID and hyperlink stay unresolved for review",
      );
      assert.equal(entries[0].source?.page, 1);
      assert.equal(entries[6].source?.page, 2);
      assert.ok(entries[6].source?.reviewReasons?.length);
    } finally {
      await loading.destroy();
    }
  },
);

test(
  "a real local OCR worker extracts the controlled screenshot without mocked text or a remote service",
  { timeout: 60_000 },
  async () => {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      langPath: resolve("node_modules/@tesseract.js-data/eng/4.0.0_best_int"),
      cacheMethod: "none",
    });
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: "200",
      });
      const recognized = await worker.recognize(
        fixture("screenshot.png"),
        {},
        { text: true, blocks: true },
      );
      const lines = ocrTextLines(
        recognized.data,
        1,
        "Image",
      ) as ExtractedTrackLine[];
      assert.ok(
        lines.some((line) => line.text === "38IA - Ambiguous printed ID"),
      );
      const draft = parseExtractedTrack(
        lines,
        "screenshot.png",
        "real-ocr-fixture",
      );
      assert.deepEqual(
        draft.stages.map((stage) => stage.title),
        ["Foundations", "Variants"],
      );
      const entries = draft.stages.flatMap((stage) => stage.entries);
      assert.deepEqual(
        entries.map((entry) => entry.code),
        ["381A", "279B", "1739C1", "1739C2", "", ""],
      );
      assert.equal(entries[4].title, "38IA - Ambiguous printed ID");
      assert.ok(
        entries.every(
          (entry) =>
            entry.source?.kind === "ocr" && entry.source.reviewReasons?.length,
        ),
      );
      assert.ok(
        entries.every((entry) => !entry.reviewed),
        "Recognized OCR formats still require human review",
      );
      assert.ok(
        entries.every((entry) => entry.rating === null && !entry.pattern),
      );
    } finally {
      await worker.terminate();
    }
  },
);

test("asset preparation serves exact pinned engines and English data without a runtime CDN", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    DOCUMENT_IMPORT_ASSETS.pdf,
    `/import-assets/pdfjs-${manifest.dependencies["pdfjs-dist"]}`,
  );
  assert.equal(
    DOCUMENT_IMPORT_ASSETS.ocr,
    `/import-assets/tesseract-${manifest.dependencies["tesseract.js"]}`,
  );
  assert.equal(
    DOCUMENT_IMPORT_ASSETS.core,
    `/import-assets/core-${manifest.dependencies["tesseract.js-core"]}`,
  );
  for (const asset of [
    `${DOCUMENT_IMPORT_ASSETS.pdf}/pdf.worker.mjs`,
    `${DOCUMENT_IMPORT_ASSETS.ocr}/worker.min.js`,
    `${DOCUMENT_IMPORT_ASSETS.core}/tesseract-core-relaxedsimd-lstm.wasm`,
    `${DOCUMENT_IMPORT_ASSETS.language}/eng.traineddata.gz`,
  ])
    assert.ok(
      (await readFile(resolve("public", asset.slice(1)))).length > 1000,
    );
});

test("cancelling active PDF work asks the coordinator to release children and terminates the parent", async (t) => {
  const instances: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    messages: unknown[] = [];
    constructor(readonly url: string | URL) {
      instances.push(this);
    }
    postMessage(message: { type: string }) {
      this.messages.push(message);
      if (message.type === "cancel")
        this.onmessage?.({ data: { type: "cancelled" } } as MessageEvent);
    }
    terminate() {
      this.terminated = true;
    }
  }
  const previousWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  t.after(() => {
    globalThis.Worker = previousWorker;
  });
  const controller = new AbortController();
  const pending = importPracticeDocument(file("text.pdf"), {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(instances.length, 1);
  assert.equal(instances[0].url, "/track-document.worker.js");
  assert.equal((instances[0].messages[1] as { type: string }).type, "cancel");
  assert.equal(instances[0].terminated, true);
});

test("processing timeout is actionable and terminates a stalled worker rather than producing an empty draft", async (t) => {
  const instances: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    constructor() {
      instances.push(this);
    }
    postMessage() {}
    terminate() {
      this.terminated = true;
    }
  }
  const previousWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  t.after(() => {
    globalThis.Worker = previousWorker;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = importPracticeDocument(file("slow.pdf"));
  t.mock.timers.tick(DOCUMENT_IMPORT_LIMITS.maxProcessingMs);
  await assert.rejects(pending, /Processing exceeded 3 minutes/);
  t.mock.timers.tick(100);
  assert.equal(instances[0].terminated, true);
});

test("the import controller owns and terminates native engine handles while their initialization is still pending", async (t) => {
  const instances: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    messages: unknown[] = [];
    constructor(readonly url: string | URL) {
      instances.push(this);
    }
    postMessage(message: { type: string }) {
      this.messages.push(message);
      if (message.type === "cancel")
        this.onmessage?.({ data: { type: "cancelled" } } as MessageEvent);
    }
    terminate() {
      this.terminated = true;
    }
  }
  const previousWorker = globalThis.Worker;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://localhost:3002" } },
  });
  t.after(() => {
    globalThis.Worker = previousWorker;
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const channel = new MessageChannel();
  t.after(() => {
    channel.port1.close();
    channel.port2.close();
  });
  const controller = new AbortController();
  const pending = importPracticeDocument(file("scanned.pdf"), {
    signal: controller.signal,
  });
  instances[0].onmessage?.({
    data: {
      type: "engine",
      id: "engine-1",
      assetUrl: `${DOCUMENT_IMPORT_ASSETS.ocr}/worker.min.js`,
      module: false,
      port: channel.port2,
    },
  } as MessageEvent);
  assert.equal(instances.length, 2);
  assert.equal(instances[1].url, "/track-engine.worker.js");
  assert.equal(
    (instances[1].messages[0] as { type: string }).type,
    "initialize",
  );
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(
    instances[1].terminated,
    true,
    "OCR is terminated before it finishes loading its assets",
  );
  assert.equal(instances[0].terminated, true);
});

test("worker errors preserve actionable feedback and never return or persist a partial draft", async (t) => {
  const instances: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    constructor() {
      instances.push(this);
    }
    postMessage() {}
    terminate() {
      this.terminated = true;
    }
  }
  const previousWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  t.after(() => {
    globalThis.Worker = previousWorker;
  });
  const pending = importPracticeDocument(file("encrypted.pdf"));
  instances[0].onmessage?.({
    data: {
      type: "error",
      message:
        "This PDF is password protected. Export an unencrypted PDF and try again.",
    },
  } as MessageEvent);
  await assert.rejects(pending, DocumentImportError);
  assert.equal(instances[0].terminated, true);
});
