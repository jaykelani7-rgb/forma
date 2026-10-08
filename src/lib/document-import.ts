import type { TrackImportDraft } from "./tracks-types";
import type { ExtractedTrackLine } from "./track-studio";
import {
  DOCUMENT_IMPORT_ASSETS,
  DOCUMENT_IMPORT_LIMITS,
  documentKind,
} from "../../public/track-document-helpers.mjs";

export { DOCUMENT_IMPORT_LIMITS };
export interface DocumentImportProgress {
  phase: string;
  percent: number;
  page?: number;
  pages?: number;
}
export interface DocumentImportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DocumentImportProgress) => void;
  forceOCR?: boolean;
}
export class DocumentImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentImportError";
  }
}
type WorkerResponse =
  | { type: "progress"; progress: DocumentImportProgress }
  | { type: "draft"; draft: TrackImportDraft }
  | { type: "result"; lines: ExtractedTrackLine[]; fingerprint: string }
  | { type: "error"; message: string; name?: string }
  | {
      type: "engine";
      id: string;
      assetUrl: string;
      module: boolean;
      port: MessagePort;
    }
  | { type: "closeEngine"; id: string }
  | { type: "cancelled" };
const abortError = () =>
  new DOMException("Document import cancelled.", "AbortError");

/** Read a practice sheet locally. The only network reads fetch app-owned engines. */
export async function importPracticeDocument(
  file: File,
  options: DocumentImportOptions = {},
): Promise<TrackImportDraft> {
  if (options.signal?.aborted) throw abortError();
  if (!file.name || file.name.length > 240)
    throw new DocumentImportError(
      "Use a file name of 240 characters or fewer and try again.",
    );
  let kind: ReturnType<typeof documentKind>;
  try {
    kind = documentKind(file.name);
  } catch (error) {
    throw new DocumentImportError(
      error instanceof Error ? error.message : "Unsupported file format.",
    );
  }
  if (!file.size)
    throw new DocumentImportError(
      "This file is empty. Choose a practice sheet with readable content.",
    );
  const maximum =
    kind === "docx" ? 8 * 1024 * 1024 : DOCUMENT_IMPORT_LIMITS.maxFileBytes;
  if (file.size > maximum)
    throw new DocumentImportError(
      `Choose a ${kind === "docx" ? "DOCX smaller than 8 MB" : "file smaller than 20 MB"}. Crop images or split a large practice sheet and try again.`,
    );
  if (typeof Worker === "undefined")
    throw new DocumentImportError(
      "This browser does not support local document workers. Use a current browser or paste the problem links/IDs.",
    );
  options.onProgress?.({ phase: "Reading file", percent: 0 });
  if (options.signal?.aborted) throw abortError();
  const draft = await new Promise<TrackImportDraft>((resolve, reject) => {
    const worker =
      kind === "docx"
        ? new Worker(new URL("./docx-import.worker.ts", import.meta.url))
        : new Worker("/track-document.worker.js");
    let settled = false;
    const engines = new Map<string, Worker>();
    const stopEngines = () => {
      for (const engine of engines.values()) engine.terminate();
      engines.clear();
    };
    let forceStop: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(
      () =>
        stop(
          new DocumentImportError(
            "Processing exceeded 3 minutes. Split the PDF or crop the image, then retry; no rows have been saved.",
          ),
        ),
      DOCUMENT_IMPORT_LIMITS.maxProcessingMs,
    );
    const release = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
    };
    // A cancel message first lets the coordinator explicitly terminate PDF/OCR
    // children, including not-yet-initialized workers. A bounded fallback kills
    // the parent even if the document is stuck in a synchronous operation.
    const stop = (error: Error) => {
      if (settled) return;
      settled = true;
      release();
      stopEngines();
      if (kind === "docx") worker.terminate();
      else {
        forceStop = setTimeout(() => worker.terminate(), 100);
        worker.postMessage({ type: "cancel" });
      }
      reject(error);
    };
    const cancel = () => stop(abortError());
    options.signal?.addEventListener("abort", cancel, { once: true });
    worker.onerror = () =>
      stop(
        new DocumentImportError(
          "The document worker could not run. Reconnect and retry, or use a current browser and paste the problem links/IDs.",
        ),
      );
    worker.onmessage = async (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === "closeEngine") {
        engines.get(event.data.id)?.terminate();
        engines.delete(event.data.id);
        return;
      }
      if (event.data.type === "engine") {
        const response = event.data;
        if (settled) {
          response.port.close();
          return;
        }
        const url = new URL(response.assetUrl, window.location.origin);
        const allowed = [
          `${DOCUMENT_IMPORT_ASSETS.pdf}/pdf.worker.mjs`,
          `${DOCUMENT_IMPORT_ASSETS.ocr}/worker.min.js`,
        ];
        if (
          url.origin !== window.location.origin ||
          !allowed.includes(url.pathname) ||
          url.search ||
          url.hash
        ) {
          response.port.close();
          stop(
            new DocumentImportError(
              "An unexpected document engine was requested. Reload Forma and try again.",
            ),
          );
          return;
        }
        const engine = new Worker("/track-engine.worker.js");
        engines.set(response.id, engine);
        engine.onerror = () =>
          worker.postMessage({
            type: "engineError",
            id: response.id,
            message:
              "A local PDF/OCR engine could not load. Reconnect and retry the import.",
          });
        engine.postMessage(
          {
            type: "initialize",
            assetUrl: url.href,
            module: response.module,
            port: response.port,
          },
          [response.port],
        );
        return;
      }
      if (event.data.type === "cancelled") {
        clearTimeout(forceStop);
        worker.terminate();
        return;
      }
      if (settled) return;
      const response = event.data;
      if (response.type === "progress") {
        try {
          options.onProgress?.(response.progress);
        } catch (error) {
          stop(
            error instanceof Error
              ? error
              : new DocumentImportError(
                  "Import progress could not be displayed.",
                ),
          );
        }
        return;
      }
      if (response.type === "error") {
        settled = true;
        release();
        stopEngines();
        worker.terminate();
        reject(new DocumentImportError(response.message));
        return;
      }
      if (response.type === "draft" || response.type === "result") {
        stopEngines();
        worker.terminate();
        try {
          const result =
            response.type === "draft"
              ? response.draft
              : (await import("./track-studio")).parseExtractedTrack(
                  response.lines,
                  file.name,
                  response.fingerprint,
                );
          if (settled || options.signal?.aborted) return;
          settled = true;
          release();
          resolve(result);
        } catch (error) {
          stop(
            error instanceof Error
              ? error
              : new DocumentImportError(
                  "The extracted preview could not be prepared.",
                ),
          );
        }
      }
    };
    if (options.signal?.aborted) cancel();
    else
      worker.postMessage({
        type: "import",
        file,
        forceOCR: !!options.forceOCR,
      });
  });
  if (options.signal?.aborted) throw abortError();
  options.onProgress?.({ phase: "Preview ready", percent: 100 });
  return draft;
}
