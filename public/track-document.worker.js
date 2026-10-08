// The UI controller owns the native engine handles before initialization. Engine
// payloads pass directly through MessageChannels; expensive work stays off the UI.
const children = new Set();
const childMap = new Map();
self.Worker = class extends EventTarget {
  constructor(assetUrl, options = {}) {
    super();
    this.id = crypto.randomUUID();
    this.onmessage = this.onerror = null;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event) => {
      if (event.data.type === "error" && !stopped) {
        self.postMessage({
          type: "error",
          message: event.data.message,
          name: "DocumentImportError",
        });
        cleanup();
        self.close();
        return;
      }
      const forwarded =
        event.data.type === "error"
          ? new ErrorEvent("error", { message: event.data.message })
          : new MessageEvent("message", { data: event.data.data });
      if (forwarded.type === "error") this.onerror?.(forwarded);
      else this.onmessage?.(forwarded);
      this.dispatchEvent(forwarded);
    };
    this.port.start();
    children.add(this);
    childMap.set(this.id, this);
    self.postMessage(
      {
        type: "engine",
        id: this.id,
        assetUrl: String(assetUrl),
        module: options.type === "module",
        port: channel.port2,
      },
      [channel.port2],
    );
  }
  postMessage(data, transfer = []) {
    this.port.postMessage(data, transfer);
  }
  terminate() {
    children.delete(this);
    childMap.delete(this.id);
    self.postMessage({ type: "closeEngine", id: this.id });
    this.port.close();
  }
  reportError(message) {
    const event = new ErrorEvent("error", { message });
    this.onerror?.(event);
    this.dispatchEvent(event);
  }
};
let stopped = false;
let pdfLoading = null;
let pdfDocument = null;
let activeRender = null;
let ocrWorker = null;
let latestPercent = 0;
let activePage = 0;
let totalPages = 1;
let helpers;

function progress(phase, percent, page = activePage, pages = totalPages) {
  if (stopped) return;
  latestPercent = Math.max(latestPercent, Math.min(99, Math.round(percent)));
  self.postMessage({
    type: "progress",
    progress: {
      phase,
      percent: latestPercent,
      ...(page ? { page, pages } : {}),
    },
  });
}
function cancelled() {
  if (stopped)
    throw new DOMException("Document import cancelled.", "AbortError");
}
function cleanup() {
  stopped = true;
  activeRender?.cancel();
  for (const child of [...children]) child.terminate();
  // Destroy releases message handlers, loaded page objects, and image buffers.
  // PDF.js 6 destroys a document through its loading task (not its proxy).
  Promise.resolve(pdfLoading?.destroy()).catch(() => {});
  Promise.resolve(ocrWorker?.terminate()).catch(() => {});
  activeRender = pdfDocument = pdfLoading = ocrWorker = null;
}
async function timed(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function assetError() {
  return new Error(
    "The local PDF/OCR assets could not be loaded. Reconnect and retry. If this repeats, restart Forma after running its import-asset preparation step.",
  );
}

async function ensureOCR() {
  cancelled();
  if (ocrWorker) return ocrWorker;
  const { DOCUMENT_IMPORT_ASSETS: assets, DOCUMENT_IMPORT_LIMITS: limits } =
    helpers;
  progress(
    "Loading OCR assets — first use downloads the engine and English language data",
    latestPercent,
  );
  try {
    // importScripts is confined to this app's pinned, generated asset directory.
    self.importScripts(`${assets.ocr}/tesseract.min.js`);
    const Tesseract = self.Tesseract;
    if (!Tesseract) throw assetError();
    ocrWorker = await timed(
      Tesseract.createWorker("eng", 1, {
        workerPath: new URL(`${assets.ocr}/worker.min.js`, self.location.origin)
          .href,
        workerBlobURL: false,
        corePath: new URL(assets.core, self.location.origin).href,
        langPath: new URL(assets.language, self.location.origin).href,
        cachePath: "forma-ocr-eng-best-int-v1",
        // Failure of browser storage must not prevent local OCR. HTTP caching can
        // still avoid a repeat download; offline availability is not promised.
        cacheMethod: "none",
        logger(message) {
          if (message.status === "recognizing text") {
            const before = 10 + ((activePage - 1) / totalPages) * 80;
            progress(
              `Reading text with OCR — page ${activePage} of ${totalPages}`,
              before + ((message.progress ?? 0) / totalPages) * 75,
            );
          } else {
            progress(
              "Loading OCR assets — engine and English language data",
              latestPercent,
            );
          }
        },
        errorHandler() {},
      }),
      limits.maxAssetLoadMs,
      "OCR assets took more than 60 seconds to load. Reconnect and retry the import.",
    );
    cancelled();
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: "1",
      user_defined_dpi: "200",
    });
    return ocrWorker;
  } catch (error) {
    cancelled();
    if (error instanceof Error && /60 seconds/.test(error.message)) throw error;
    throw assetError();
  }
}

async function recognize(bytes, page, label, annotations = [], viewport) {
  const worker = await ensureOCR();
  cancelled();
  progress(
    `Reading text with OCR — page ${page} of ${totalPages}`,
    latestPercent,
  );
  const result = await timed(
    worker.recognize(bytes, {}, { text: true, blocks: true }),
    helpers.DOCUMENT_IMPORT_LIMITS.maxPageMs,
    `OCR for page ${page} exceeded 45 seconds. Crop or simplify that page and try again.`,
  );
  cancelled();
  return helpers.ocrTextLines(result.data, page, label, annotations, viewport);
}

class WorkerCanvasFactory {
  create(width, height) {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(target, width, height) {
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target) {
    target.canvas.width = target.canvas.height = 0;
    target.canvas = target.context = null;
  }
}
class WorkerFilterFactory {
  addFilter() {
    return "none";
  }
  addHCMFilter() {
    return "none";
  }
  addAlphaFilter() {
    return "none";
  }
  addLuminosityFilter() {
    return "none";
  }
  addKnockoutFilter() {
    return "none";
  }
  destroy() {}
}

async function readPDFText(page) {
  const reader = page.streamTextContent().getReader();
  const items = [];
  let characters = 0;
  try {
    while (true) {
      cancelled();
      const chunk = await reader.read();
      if (chunk.done) break;
      for (const item of chunk.value.items) {
        characters += (item.str ?? "").length;
        if (characters > helpers.DOCUMENT_IMPORT_LIMITS.maxCharacters) {
          await reader.cancel("Extracted text limit reached");
          throw new Error(
            "This PDF page contains more than 250000 extracted characters. Split it into smaller practice sheets; no rows have been saved.",
          );
        }
        items.push(item);
      }
    }
    return { items };
  } finally {
    reader.releaseLock();
  }
}

async function extractPDF(bytes, forceOCR) {
  const { DOCUMENT_IMPORT_ASSETS: assets, DOCUMENT_IMPORT_LIMITS: limits } =
    helpers;
  progress("Loading PDF reader", 5);
  let pdfjs;
  try {
    pdfjs = await timed(
      import(`${assets.pdf}/pdf.mjs`),
      limits.maxAssetLoadMs,
      "The PDF reader took more than 60 seconds to load. Reconnect and retry.",
    );
  } catch {
    throw assetError();
  }
  cancelled();
  // Pass a real worker port explicitly. PDF.js's default browser constructor
  // refers to window, which does not exist inside this coordinator worker.
  const native = new self.Worker(`${assets.pdf}/pdf.worker.mjs`, {
    type: "module",
  });
  const worker = new pdfjs.PDFWorker({ port: native });
  pdfLoading = pdfjs.getDocument({
    data: bytes,
    worker,
    useWorkerFetch: true,
    cMapUrl: `${self.location.origin}${assets.pdf}/cmaps/`,
    standardFontDataUrl: `${self.location.origin}${assets.pdf}/standard_fonts/`,
    wasmUrl: `${self.location.origin}${assets.pdf}/wasm/`,
    // Glyph paths render without a document/FontFace DOM dependency.
    disableFontFace: true,
    useSystemFonts: false,
    CanvasFactory: WorkerCanvasFactory,
    FilterFactory: WorkerFilterFactory,
    isEvalSupported: false,
    enableXfa: false,
    maxImageSize: limits.maxImagePixels,
    canvasMaxAreaInBytes: limits.maxRenderedPixels * 4,
    stopAtErrors: true,
    verbosity: 0,
  });
  pdfLoading.onPassword = () => {
    pdfLoading?.destroy().catch(() => {});
    self.postMessage({
      type: "error",
      message:
        "This PDF is password protected. Export an unencrypted PDF and try again.",
      name: "DocumentImportError",
    });
    cleanup();
    self.close();
  };
  try {
    pdfDocument = await timed(
      pdfLoading.promise,
      limits.maxAssetLoadMs,
      "The PDF could not be opened within 60 seconds. Export a simpler PDF and try again.",
    );
  } catch (error) {
    cancelled();
    if (error?.name === "PasswordException")
      throw new Error(
        "This PDF is password protected. Export an unencrypted PDF and try again.",
      );
    if (error instanceof Error && /60 seconds/.test(error.message)) throw error;
    throw new Error(
      "This PDF is damaged or unreadable. Open it in a PDF reader, export a fresh PDF, and try again.",
    );
  }
  totalPages = pdfDocument.numPages;
  if (totalPages > limits.maxPages)
    throw new Error(
      `This PDF has ${totalPages} pages. The limit is ${limits.maxPages}; split it into smaller practice sheets and try again.`,
    );
  const result = [];
  for (activePage = 1; activePage <= totalPages; activePage++) {
    cancelled();
    progress(
      `Processing page ${activePage} of ${totalPages}`,
      10 + ((activePage - 1) / totalPages) * 80,
    );
    const page = await timed(
      pdfDocument.getPage(activePage),
      limits.maxPageMs,
      `Page ${activePage} took more than 45 seconds to open. Export a simpler PDF and try again.`,
    );
    try {
      const [text, annotations] = await timed(
        Promise.all([
          readPDFText(page),
          page.getAnnotations({ intent: "display" }),
        ]),
        limits.maxPageMs,
        `Text on page ${activePage} took more than 45 seconds to read. Export a simpler PDF and try again.`,
      );
      cancelled();
      const extracted = helpers.pdfTextLines(
        text.items,
        annotations,
        activePage,
      );
      // Use one source per page. A few characters (e.g. a page number on a scan)
      // do not establish a usable text layer. Never combine text + OCR rows.
      let operators;
      try {
        operators = await timed(
          page.getOperatorList(),
          limits.maxPageMs,
          `Page ${activePage} took more than 45 seconds to inspect. Export a simpler PDF and try again.`,
        );
      } catch (error) {
        if (/Image exceeded maximum allowed size/.test(error?.message ?? ""))
          throw new Error(
            `An image on PDF page ${activePage} exceeds the 20 megapixel import limit. Reduce the scanned image resolution or crop that page, then export the PDF again.`,
          );
        throw error;
      }
      const imageOps = [
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintImageMaskXObject,
      ];
      const hasImages = operators.fnArray.some((operation) =>
        imageOps.includes(operation),
      );
      const readableText = helpers.selectableProblemText(extracted, hasImages);
      if (readableText && !forceOCR) result.push(...extracted);
      else {
        if (typeof OffscreenCanvas === "undefined")
          throw new Error(
            "This browser cannot render scanned PDFs locally. Use a current browser or export the page as PNG/JPEG.",
          );
        const base = page.getViewport({ scale: 1 });
        const size = helpers.boundedRenderSize(base.width, base.height);
        const canvas = new OffscreenCanvas(size.width, size.height);
        try {
          activeRender = page.render({
            canvas,
            canvasContext: canvas.getContext("2d"),
            viewport: page.getViewport({ scale: size.scale }),
            background: "rgb(255,255,255)",
          });
          await timed(
            activeRender.promise,
            limits.maxPageMs,
            `Page ${activePage} took more than 45 seconds to render. Crop or simplify it and try again.`,
          );
          cancelled();
          const blob = await canvas.convertToBlob({ type: "image/png" });
          const recognized = await recognize(
            new Uint8Array(await blob.arrayBuffer()),
            activePage,
            "Page",
            annotations,
            page.getViewport({ scale: size.scale }),
          );
          result.push(...recognized);
        } finally {
          activeRender = null;
          canvas.width = canvas.height = 0;
        }
      }
      helpers.boundedExtractedLines(result);
      progress(
        `Finished page ${activePage} of ${totalPages}`,
        10 + (activePage / totalPages) * 80,
      );
    } finally {
      page.cleanup();
    }
  }
  return result;
}

self.onmessage = async (event) => {
  if (event.data?.type === "engineError") {
    childMap.get(event.data.id)?.reportError(event.data.message);
    return;
  }
  if (event.data?.type === "cancel") {
    cleanup();
    self.postMessage({ type: "cancelled" });
    self.close();
    return;
  }
  if (event.data?.type !== "import") return;
  const { file, forceOCR } = event.data;
  try {
    helpers = await import("./track-document-helpers.mjs");
    progress("Reading file", 0);
    const bytes = new Uint8Array(await file.arrayBuffer());
    cancelled();
    const kind = helpers.documentKind(file.name);
    helpers.validateDocumentBytes(bytes, kind);
    const fingerprint = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    let lines;
    if (kind === "pdf") lines = await extractPDF(bytes, forceOCR);
    else {
      helpers.imageDimensions(bytes, kind);
      activePage = totalPages = 1;
      if (
        typeof OffscreenCanvas === "undefined" ||
        typeof createImageBitmap !== "function"
      )
        throw new Error(
          "This browser cannot prepare images locally. Use a current browser or paste the problem links/IDs.",
        );
      let bitmap;
      try {
        bitmap = await createImageBitmap(
          new Blob([bytes], {
            type: kind === "png" ? "image/png" : "image/jpeg",
          }),
        );
      } catch {
        throw new Error(
          "This image is damaged or unreadable. Export a fresh PNG or JPEG and try again.",
        );
      }
      try {
        const size = helpers.boundedRenderSize(bitmap.width, bitmap.height, 1);
        const canvas = new OffscreenCanvas(size.width, size.height);
        try {
          const context = canvas.getContext("2d");
          context.fillStyle = "white";
          context.fillRect(0, 0, size.width, size.height);
          context.drawImage(bitmap, 0, 0, size.width, size.height);
          const image = new Uint8Array(
            await (
              await canvas.convertToBlob({ type: "image/png" })
            ).arrayBuffer(),
          );
          lines = await recognize(image, 1, "Image");
        } finally {
          canvas.width = canvas.height = 0;
        }
      } finally {
        bitmap.close();
      }
    }
    cancelled();
    helpers.boundedExtractedLines(lines);
    if (!lines.length)
      throw new Error(
        "No readable text was found. Upload a sharper, upright image, crop to the problem list, or paste the links/IDs manually.",
      );
    progress("Preparing editable preview", 95);
    self.postMessage({ type: "result", lines, fingerprint });
    cleanup();
    self.close();
  } catch (error) {
    if (!stopped)
      self.postMessage({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "This document could not be processed. Export a fresh file or paste the problem IDs manually.",
        name: error?.name ?? "DocumentImportError",
      });
    cleanup();
    self.close();
  }
};
