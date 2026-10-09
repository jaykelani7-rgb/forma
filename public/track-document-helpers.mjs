/** Shared by the extraction worker and focused tests; no engine is loaded here. */
export const DOCUMENT_IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxPages: 40,
  maxImagePixels: 20_000_000,
  maxImageDimension: 8000,
  maxRenderedPixels: 8_000_000,
  maxRenderedDimension: 4096,
  maxCharacters: 250_000,
  maxLines: 2000,
  maxProblems: 1000,
  maxStages: 100,
  maxProcessingMs: 180_000,
  maxPageMs: 45_000,
  maxAssetLoadMs: 60_000,
});

export const DOCUMENT_IMPORT_ASSETS = Object.freeze({
  pdf: "/import-assets/pdfjs-6.4.299",
  ocr: "/import-assets/tesseract-7.0.0",
  core: "/import-assets/core-7.0.0",
  language: "/import-assets/eng-1.0.0",
});

export function documentKind(name) {
  if (/\.docx$/i.test(name)) return "docx";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.png$/i.test(name)) return "png";
  if (/\.jpe?g$/i.test(name)) return "jpeg";
  throw new Error(
    "Choose a DOCX, PDF, PNG, or JPEG practice sheet. Convert other formats to one of these and try again.",
  );
}

export function validateDocumentBytes(bytes, kind) {
  const matches =
    kind === "pdf"
      ? new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-")
      : kind === "png"
        ? bytes.length >= 24 &&
          [137, 80, 78, 71, 13, 10, 26, 10].every(
            (byte, i) => bytes[i] === byte,
          )
        : kind === "jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes[0] === 80 && bytes[1] === 75;
  if (!matches)
    throw new Error(
      "The file content does not match its extension. Export a fresh PDF, PNG, JPEG, or DOCX and try again.",
    );
}

export function imageDimensions(bytes, kind) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (kind === "png") {
    if (bytes.length < 24)
      throw new Error("This PNG is damaged. Export a fresh PNG and try again.");
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) continue;
      while (at < bytes.length && bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > bytes.length) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (length < 8) break;
        height = view.getUint16(at + 3);
        width = view.getUint16(at + 5);
        break;
      }
      at += length;
    }
  }
  if (!width || !height)
    throw new Error(
      "The image dimensions could not be read. Export a fresh PNG or JPEG and try again.",
    );
  const limits = DOCUMENT_IMPORT_LIMITS;
  if (
    width > limits.maxImageDimension ||
    height > limits.maxImageDimension ||
    width * height > limits.maxImagePixels
  )
    throw new Error(
      "This image exceeds 20 megapixels or 8000 pixels on one side. Resize it or crop the practice sheet and try again.",
    );
  return { width, height };
}

export function boundedRenderSize(width, height, preferredScale = 2) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width * height))
    throw new Error(
      "This page has invalid dimensions. Export a fresh PDF and try again.",
    );
  const limits = DOCUMENT_IMPORT_LIMITS;
  const scale = Math.min(
    preferredScale,
    limits.maxRenderedDimension / Math.max(width, height),
    Math.sqrt(limits.maxRenderedPixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}

function overlaps(line, rect) {
  const [x1, y1, x2, y2] = rect;
  const left = Math.min(x1, x2),
    right = Math.max(x1, x2),
    bottom = Math.min(y1, y2),
    top = Math.max(y1, y2);
  return (
    Math.min(line.right, right) >= Math.max(line.left, left) - 2 &&
    line.y >= bottom - line.height &&
    line.y <= top + line.height
  );
}

/** Preserve the PDF's text-item order. Join fragments on a baseline, not whole pages. */
export function pdfTextLines(items, annotations, page) {
  const rows = [];
  let current = null;
  for (const item of items) {
    if (typeof item.str !== "string" || !item.str.trim()) {
      if (item.hasEOL) current = null;
      continue;
    }
    const x = item.transform?.[4] ?? 0,
      y = item.transform?.[5] ?? 0;
    const height = Math.abs(item.height || item.transform?.[3] || 12);
    if (
      !current ||
      Math.abs(current.y - y) > Math.max(2, height * 0.3) ||
      x < current.left - 3
    ) {
      current = {
        text: item.str,
        left: x,
        right: x + (item.width ?? 0),
        y,
        height,
        links: [],
      };
      rows.push(current);
    } else {
      const gap = x - current.right;
      current.text += `${gap > Math.max(1, height * 0.08) && !/\s$/.test(current.text) ? " " : ""}${item.str}`;
      current.right = Math.max(current.right, x + (item.width ?? 0));
      current.height = Math.max(current.height, height);
    }
    if (item.hasEOL) current = null;
  }
  for (const annotation of annotations) {
    const url = annotation.url ?? annotation.unsafeUrl;
    if (
      annotation.subtype !== "Link" ||
      typeof url !== "string" ||
      url.length > 2000 ||
      !Array.isArray(annotation.rect)
    )
      continue;
    const matches = rows.filter((row) => overlaps(row, annotation.rect));
    // An unmatched hyperlink is itself evidence and must stay in the preview.
    if (!matches.length) {
      const row = {
        text: url,
        links: [url],
        left: annotation.rect[0],
        right: annotation.rect[2],
        y: Math.max(annotation.rect[1], annotation.rect[3]),
        height: 12,
        annotationOnly: true,
      };
      // A link drawn over an image has no text item. Place it beside the nearest
      // following baseline instead of moving it after every later page row.
      const at = rows.findIndex(
        (existing) =>
          existing.y < row.y - row.height ||
          (Math.abs(existing.y - row.y) <= row.height &&
            existing.left > row.left),
      );
      rows.splice(at < 0 ? rows.length : at, 0, row);
    } else
      for (const row of matches)
        if (!row.links.includes(url)) row.links.push(url);
  }
  return rows.map((row, index) => ({
    text: row.text.trim(),
    kind: "pdf-text",
    page,
    location: `Page ${page}, line ${index + 1}`,
    links: row.links,
    bounds: [
      row.left,
      row.y - row.height * 0.25,
      row.right,
      row.y + row.height,
    ],
    ...(row.annotationOnly ? { annotationOnly: true } : {}),
  }));
}

/** No character substitution is performed on OCR text, even when it resembles an ID. */
export function ocrTextLines(
  data,
  page,
  label = "Page",
  annotations = [],
  viewport,
) {
  const lines =
    data.blocks?.flatMap(
      (block) =>
        block.paragraphs?.flatMap((paragraph) => paragraph.lines ?? []) ?? [],
    ) ?? [];
  const source = lines.length
    ? lines
    : String(data.text ?? "")
        .split(/\r?\n/)
        .map((text) => ({ text, confidence: data.confidence }));
  const selected = source.filter(
    (line) => typeof line.text === "string" && line.text.trim(),
  );
  const result = selected.map((line, index) => ({
    text: line.text.trim(),
    kind: "ocr",
    page,
    location: `${label} ${page}, line ${index + 1}`,
    confidence: Number.isFinite(line.confidence)
      ? Math.max(0, Math.min(100, line.confidence))
      : undefined,
    ...(line.bbox && viewport?.convertToPdfPoint
      ? {
          bounds: [
            ...viewport.convertToPdfPoint(line.bbox.x0, line.bbox.y1),
            ...viewport.convertToPdfPoint(line.bbox.x1, line.bbox.y0),
          ],
        }
      : {}),
  }));
  for (const annotation of annotations) {
    const url = annotation.url ?? annotation.unsafeUrl;
    if (
      annotation.subtype !== "Link" ||
      typeof url !== "string" ||
      url.length > 2000 ||
      !Array.isArray(annotation.rect)
    )
      continue;
    const rect = viewport?.convertToViewportPoint
      ? [
          ...viewport.convertToViewportPoint(
            annotation.rect[0],
            annotation.rect[1],
          ),
          ...viewport.convertToViewportPoint(
            annotation.rect[2],
            annotation.rect[3],
          ),
        ]
      : null;
    const matches = rect
      ? selected
          .map((line, i) => {
            const box = line.bbox;
            if (!box) return -1;
            return Math.min(box.x1, Math.max(rect[0], rect[2])) >=
              Math.max(box.x0, Math.min(rect[0], rect[2])) - 3 &&
              Math.min(box.y1, Math.max(rect[1], rect[3])) >=
                Math.max(box.y0, Math.min(rect[1], rect[3])) - 3
              ? i
              : -1;
          })
          .filter((i) => i >= 0)
      : [];
    if (!matches.length)
      result.push({
        text: url,
        kind: "ocr",
        page,
        location: `Page ${page}, hyperlink annotation`,
        links: [url],
        bounds: annotation.rect,
        annotationOnly: true,
      });
    else
      for (const i of matches) {
        result[i].links ??= [];
        if (!result[i].links.includes(url)) result[i].links.push(url);
      }
  }
  return result;
}

/** A raster may be a logo or an additional problem. Do not guess its content or
 * force expensive OCR; require an explicit coverage decision in the preview. */
export function mixedContentWarning(page) {
  return {
    text: "Image text on this PDF page has not been read.",
    kind: "pdf-text",
    page,
    location: `Page ${page}, mixed selectable text and image content`,
    reviewReasons: [
      "Mixed-content page: image text was not extracted. Re-import with ‘Use OCR for all PDF pages’ to recover image problems. Exclude this warning only after checking every image on this page, including possible decorative images.",
    ],
  };
}

function rect(line) {
  const values = line.bounds;
  if (
    !Array.isArray(values) ||
    values.length !== 4 ||
    !values.every(Number.isFinite)
  )
    return null;
  return [
    Math.min(values[0], values[2]),
    Math.min(values[1], values[3]),
    Math.max(values[0], values[2]),
    Math.max(values[1], values[3]),
  ];
}
function sameLocation(first, second) {
  const a = rect(first),
    b = rect(second);
  if (!a || !b) return false;
  const width = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const shorter = Math.min(a[2] - a[0], b[2] - b[0]);
  return (
    width > Math.max(1, shorter * 0.5) &&
    Math.min(a[3], b[3]) >= Math.max(a[1], b[1]) - 4
  );
}
function identityTokens(line) {
  const values = new Set();
  for (const text of [line.text, ...(line.links ?? [])]) {
    for (const match of text.matchAll(
      /(?:^|[^\p{L}\p{N}])((?:Gym\s*)?\d{1,9}[\s/-]*[A-Za-z]\d*)(?=$|[^\p{L}\p{N}])/giu,
    ))
      values.add(match[1].replace(/[\s/-]/g, "").toUpperCase());
    for (const match of text.matchAll(
      /codeforces\.com\/(?:problemset\/problem\/(\d+)\/([A-Za-z]\d*)|(?:contest|gym)\/(\d+)\/problem\/([A-Za-z]\d*))/gi,
    ))
      values.add(
        `${match[1] ?? match[3]}${match[2] ?? match[4]}`.toUpperCase(),
      );
  }
  return values;
}
const comparable = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Keep native text authoritative. Remove an OCR copy only at the same physical
 * location with equivalent text/identity; never deduplicate by identity alone. */
export function reconcileHybridPDFLines(selectable, recognized) {
  const native = [...selectable];
  const additions = [];
  for (const original of recognized) {
    const nearby = native.filter((line) => sameLocation(line, original));
    const identities = identityTokens(original);
    const matching = nearby.find((line) => {
      const known = identityTokens(line);
      return (
        comparable(line.text) === comparable(original.text) ||
        (identities.size > 0 &&
          [...identities].every((identity) => known.has(identity)))
      );
    });
    if (matching && !matching.annotationOnly) {
      if (matching.text.trim() !== original.text.trim()) {
        const at = native.indexOf(matching);
        native[at] = {
          ...matching,
          ocrAlternatives: [
            ...(matching.ocrAlternatives ?? []),
            { text: original.text, confidence: original.confidence },
          ],
          reviewReasons: [
            ...new Set([
              ...(matching.reviewReasons ?? []),
              "Same-position OCR differs from selectable text. Both readings are kept in source evidence; check for missed or ambiguous problem text before saving.",
            ]),
          ],
        };
      }
      continue;
    }
    let line = original;
    if (matching?.annotationOnly) {
      native.splice(native.indexOf(matching), 1);
      line = {
        ...line,
        links: [...new Set([...(line.links ?? []), ...(matching.links ?? [])])],
      };
    } else if (nearby.length || !rect(original)) {
      line = {
        ...line,
        reviewReasons: [
          ...(line.reviewReasons ?? []),
          nearby.length
            ? "OCR overlaps selectable text with an uncertain association. Compare both source rows before excluding an overlap or splitting identities."
            : "OCR has no recoverable page position. Its association with selectable text and stages is uncertain; compare both readings before saving.",
        ],
      };
    }
    additions.push(line);
  }
  for (const line of additions) {
    const box = rect(line);
    const at = box
      ? native.findIndex((existing) => {
          const bounds = rect(existing);
          return bounds && bounds[1] < box[1] - 4;
        })
      : -1;
    native.splice(at < 0 ? native.length : at, 0, line);
  }
  return native;
}

export function boundedExtractedLines(lines) {
  if (lines.length > DOCUMENT_IMPORT_LIMITS.maxLines)
    throw new Error(
      "This document contains more than 2000 extracted lines. Split it into smaller practice sheets; no rows have been saved.",
    );
  if (
    lines.reduce(
      (sum, line) =>
        sum +
        line.text.length +
        (line.links ?? []).join("").length +
        (line.ocrAlternatives ?? []).reduce(
          (total, value) => total + value.text.length,
          0,
        ),
      0,
    ) > DOCUMENT_IMPORT_LIMITS.maxCharacters
  )
    throw new Error(
      "This document contains more than 250000 extracted characters. Split it into smaller practice sheets; no rows have been saved.",
    );
  return lines;
}

export function selectableProblemText(lines, hasImages) {
  const body = lines.filter(
    (line) =>
      !/^\s*(?:Stage\s+\d+\s*(?:[:.\-–—].*)?|Page\s+\d+(?:\s+of\s+\d+)?|\d+)\s*$/i.test(
        line.text,
      ),
  );
  const evidence = body.some(
    (line) =>
      /(?:\b\d{1,9}\s*[A-Z]\d*\b|codeforces\.com\/(?:contest|gym|problemset))/i.test(
        line.text,
      ) ||
      line.links?.some((url) =>
        /^https?:\/\/(?:www\.)?codeforces\.com\/(?:contest|gym|problemset)\//i.test(
          url,
        ),
      ),
  );
  // A scanned list sometimes has a selectable heading or page number. These
  // establish no body content. Images without any recoverable identity need OCR
  // rather than discarding the scanned problems under that tiny text layer.
  return (
    evidence ||
    (!hasImages &&
      body.reduce(
        (sum, line) => sum + line.text.replace(/\s/g, "").length,
        0,
      ) >= 12)
  );
}
