import { parsePracticeSheet } from "./docx-import";

// Parsing the existing DOCX format remains unchanged, but leaves the UI thread.
self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const { file } = event.data;
    const draft = await parsePracticeSheet(
      await file.arrayBuffer(),
      file.name,
      {
        onProgress: (progress) =>
          self.postMessage({ type: "progress", progress }),
      },
    );
    self.postMessage({ type: "draft", draft });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "The DOCX could not be read. Save a fresh .docx and try again.",
      name: error instanceof Error ? error.name : "DocumentImportError",
    });
  }
  self.close();
};
