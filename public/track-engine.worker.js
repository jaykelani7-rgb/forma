// Engine messages travel directly between workers. The UI owns the native
// worker handle, so it can stop the engine even if a coordinator is unresponsive.
self.onmessage = async (event) => {
  if (event.data?.type !== "initialize") return;
  const { assetUrl, port, module } = event.data;
  self.onmessage = null;
  let ready = false;
  const pending = [];
  self.postMessage = (data, transfer = []) => {
    // PDF.js 6 may finish an operator-list promise with partial operators before
    // rejecting its stream. Surface its explicit image-cap error instead of
    // treating the removed scan as a blank page and losing the source rows.
    if (
      module &&
      /Image exceeded maximum allowed size/.test(data?.reason?.message ?? "")
    ) {
      port.postMessage({
        type: "error",
        message:
          "An image in this PDF exceeds the 20 megapixel import limit. Reduce the scan resolution or crop that page, then export the PDF again.",
      });
      return;
    }
    port.postMessage({ type: "message", data }, transfer);
  };
  const deliver = (data) =>
    self.dispatchEvent(new MessageEvent("message", { data }));
  port.onmessage = (message) => {
    if (ready) deliver(message.data);
    else pending.push(message.data);
  };
  port.start();
  try {
    if (module) await import(assetUrl);
    else self.importScripts(assetUrl);
    ready = true;
    for (const data of pending) deliver(data);
    pending.length = 0;
  } catch {
    port.postMessage({
      type: "error",
      message:
        "A local PDF/OCR engine could not load. Reconnect and retry the import.",
    });
  }
};
