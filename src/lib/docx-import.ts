import { Inflate } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  normalizeCodeforcesIdentity,
  type CodeforcesIdentity,
} from "./codeforces-identity";
import type {
  TrackImportDraft,
  TrackImportEntry,
  TrackImportStage,
} from "./tracks-types";

export const DOCX_IMPORT_LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxZipEntries: 256,
  maxExpandedBytes: 32 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024,
  maxXmlBytes: 4 * 1024 * 1024,
  maxCompressionRatio: 1000,
  maxXmlNodes: 100_000,
  maxXmlDepth: 80,
  maxProblems: 1000,
  maxStages: 100,
} as const;

export interface PracticeSheetProgress {
  phase: string;
  percent: number;
}
export interface PracticeSheetOptions {
  onProgress?: (progress: PracticeSheetProgress) => void;
  signal?: AbortSignal;
}

export class PracticeSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PracticeSheetError";
  }
}
const invalidZip = () =>
  new PracticeSheetError(
    "This DOCX is damaged or uses an unsupported ZIP format. Open it in Word or LibreOffice, save it as a new .docx, and try again.",
  );
const fail = (message: string): never => {
  throw new PracticeSheetError(message);
};
const abort = (options: PracticeSheetOptions) => {
  if (options.signal?.aborted)
    throw new DOMException("Practice-sheet import cancelled.", "AbortError");
};
const yieldControl = async (options: PracticeSheetOptions) => {
  abort(options);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  abort(options);
};
const report = (
  options: PracticeSheetOptions,
  phase: string,
  percent: number,
) => {
  abort(options);
  options.onProgress?.({ phase, percent });
};

interface ZipPart {
  name: string;
  compression: number;
  crc: number;
  size: number;
  originalSize: number;
  dataOffset: number;
}

// Preflight every directory entry before inflating any content. No ZIP paths are
// ever written to disk, and only the few OOXML parts used below are decompressed.
function inspectZip(bytes: Uint8Array): Map<string, ZipPart> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 65_557);
    at--
  ) {
    if (
      view.getUint32(at, true) === 0x06054b50 &&
      at + 22 + view.getUint16(at + 20, true) === bytes.length
    ) {
      end = at;
      break;
    }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw invalidZip();
  const count = view.getUint16(end + 10, true);
  const length = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (
    count !== view.getUint16(end + 8, true) ||
    count === 0xffff ||
    length === 0xffffffff ||
    offset === 0xffffffff
  )
    throw invalidZip();
  if (!count || count > DOCX_IMPORT_LIMITS.maxZipEntries)
    fail(
      `This document has too many ZIP entries. The limit is ${DOCX_IMPORT_LIMITS.maxZipEntries}; remove embedded media or save a simpler DOCX.`,
    );
  if (offset + length !== end || offset > end) throw invalidZip();
  const result = new Map<string, ZipPart>();
  const ranges: { from: number; to: number }[] = [];
  let at = offset,
    expanded = 0;
  const decode = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50)
      throw invalidZip();
    const flags = view.getUint16(at + 8, true),
      compression = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true),
      size = view.getUint32(at + 20, true),
      originalSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true),
      extraLength = view.getUint16(at + 30, true),
      commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (flags & 0x2041)
      fail(
        "Encrypted DOCX files are not supported. Save an unencrypted .docx and try again.",
      );
    if (
      ![0, 8].includes(compression) ||
      size === 0xffffffff ||
      originalSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      view.getUint16(at + 34, true)
    )
      throw invalidZip();
    if (at + 46 + nameLength + extraLength + commentLength > end)
      throw invalidZip();
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = decode.decode(nameBytes);
    if (
      !name ||
      name.length > 500 ||
      /[\u0000-\u001f\\]/.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((segment) => segment === ".." || segment === ".") ||
      result.has(name)
    )
      throw invalidZip();
    expanded += originalSize;
    if (
      originalSize > DOCX_IMPORT_LIMITS.maxEntryBytes ||
      expanded > DOCX_IMPORT_LIMITS.maxExpandedBytes ||
      originalSize / Math.max(size, 1) > DOCX_IMPORT_LIMITS.maxCompressionRatio
    )
      fail(
        "This DOCX expands beyond the safe import limit. Remove large embedded objects or save a smaller document.",
      );
    if (
      localOffset + 30 > offset ||
      view.getUint32(localOffset, true) !== 0x04034b50 ||
      view.getUint16(localOffset + 6, true) !== flags ||
      view.getUint16(localOffset + 8, true) !== compression
    )
      throw invalidZip();
    const localNameLength = view.getUint16(localOffset + 26, true),
      localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (
      localNameLength !== nameLength ||
      dataOffset + size > offset ||
      decode.decode(
        bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
      ) !== name
    )
      throw invalidZip();
    if (
      !(flags & 8) &&
      (view.getUint32(localOffset + 14, true) !== crc ||
        view.getUint32(localOffset + 18, true) !== size ||
        view.getUint32(localOffset + 22, true) !== originalSize)
    )
      throw invalidZip();
    ranges.push({ from: localOffset, to: dataOffset + size });
    result.set(name, {
      name,
      compression,
      crc,
      size,
      originalSize,
      dataOffset,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== end) throw invalidZip();
  ranges.sort((a, b) => a.from - b.from);
  if (ranges.some((range, index) => index && range.from < ranges[index - 1].to))
    throw invalidZip();
  return result;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

async function readPart(
  bytes: Uint8Array,
  part: ZipPart,
  options: PracticeSheetOptions,
): Promise<string> {
  if (part.originalSize > DOCX_IMPORT_LIMITS.maxXmlBytes)
    fail(
      "A document XML part exceeds the 4 MB limit. Split this practice sheet into smaller DOCX files.",
    );
  const chunks: Uint8Array[] = [];
  let length = 0,
    crc = 0xffffffff,
    finished = false;
  const collect = (chunk: Uint8Array, final: boolean) => {
    abort(options);
    length += chunk.length;
    if (length > part.originalSize || length > DOCX_IMPORT_LIMITS.maxXmlBytes)
      fail(
        "This document contains an oversized compressed XML part. Save a smaller DOCX and try again.",
      );
    for (const value of chunk)
      crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
    chunks.push(chunk.slice());
    finished = final;
  };
  if (part.compression === 0)
    collect(bytes.subarray(part.dataOffset, part.dataOffset + part.size), true);
  else {
    const inflater = new Inflate(collect);
    for (let offset = 0; offset < part.size; offset += 4096) {
      const end = Math.min(offset + 4096, part.size);
      inflater.push(
        bytes.subarray(part.dataOffset + offset, part.dataOffset + end),
        end === part.size,
      );
      await yieldControl(options);
    }
  }
  if (
    !finished ||
    length !== part.originalSize ||
    (crc ^ 0xffffffff) >>> 0 !== part.crc
  )
    throw invalidZip();
  const content = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(content);
}

interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}
const localName = (value: string) => value.split(":").at(-1) ?? value;
const attr = (node: XmlNode, name: string) =>
  Object.entries(node.attributes).find(
    ([key]) => localName(key) === name,
  )?.[1] ?? "";
const children = (node: XmlNode, name: string) =>
  node.children.filter((child) => localName(child.name) === name);
const firstChild = (node: XmlNode, name: string) => children(node, name)[0];

function parseXml(xml: string, partName: string): XmlNode[] {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
    fail(
      "This document contains XML entity declarations, which are not supported. Save a plain .docx without external XML definitions.",
    );
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml))
    fail(
      "This document contains invalid XML characters. Save a new .docx and try again.",
    );
  if (/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[0-9a-fA-F]+);)/.test(xml))
    fail(
      "This document contains undefined XML entities. Save a new .docx and try again.",
    );
  const valid = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (valid !== true)
    fail(
      `The document XML is malformed (${partName}). Save a new .docx and try again.`,
    );
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: true,
  });
  const parsed: unknown = parser.parse(xml);
  let count = 0;
  const convert = (items: unknown, depth: number): XmlNode[] => {
    if (!Array.isArray(items)) return [];
    if (depth > DOCX_IMPORT_LIMITS.maxXmlDepth)
      fail("This document's XML is nested too deeply. Save a simpler DOCX.");
    return items.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (typeof record["#text"] === "string")
        return [
          {
            name: "#text",
            attributes: {},
            children: [],
            text: record["#text"],
          },
        ];
      const name = Object.keys(record).find(
        (key) => key !== ":@" && !key.startsWith("?"),
      );
      if (!name) return [];
      if (++count > DOCX_IMPORT_LIMITS.maxXmlNodes)
        fail(
          "This document has too many XML elements. Split it into smaller DOCX files.",
        );
      const attributes: Record<string, string> = {};
      const rawAttributes = record[":@"];
      if (rawAttributes && typeof rawAttributes === "object")
        for (const [key, value] of Object.entries(rawAttributes)) {
          if (typeof value === "string") attributes[key] = value;
        }
      return [
        {
          name,
          attributes,
          text: "",
          children: convert(record[name], depth + 1),
        },
      ];
    });
  };
  return convert(parsed, 0);
}

const plainText = (node: XmlNode): string =>
  node.name === "#text" ? node.text : node.children.map(plainText).join("");
function visibleText(node: XmlNode): string {
  const name = localName(node.name);
  if (name === "del" || name === "instrText") return "";
  if (name === "t") return plainText(node);
  if (name === "tab") return "\t";
  if (name === "br" || name === "cr") return "\n";
  return node.children.map(visibleText).join("");
}
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const cellText = (node: XmlNode) =>
  clean(children(node, "p").map(visibleText).join("\n") || visibleText(node));
function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((child) => [
    ...(localName(child.name) === name ? [child] : []),
    ...descendants(child, name),
  ]);
}
interface SheetLink {
  target: string;
  text: string;
}
function linksIn(
  node: XmlNode,
  relationships: Map<string, string>,
): SheetLink[] {
  const links: SheetLink[] = [];
  const instructions: string[] = [];
  const visit = (current: XmlNode) => {
    const name = localName(current.name);
    if (name === "del") return;
    if (name === "hyperlink") {
      const target = relationships.get(attr(current, "id"));
      if (target) links.push({ target, text: clean(visibleText(current)) });
    } else if (name === "fldSimple" || name === "instrText") {
      const instruction =
        name === "fldSimple" ? attr(current, "instr") : plainText(current);
      if (name === "instrText") instructions.push(instruction);
      const target = instruction.match(/\bHYPERLINK\s+(?:"([^"]+)"|(\S+))/i);
      if (target)
        links.push({
          target: target[1] ?? target[2],
          text: name === "fldSimple" ? clean(visibleText(current)) : "",
        });
    }
    current.children.forEach(visit);
  };
  visit(node);
  // Word may split one complex-field instruction over several instrText runs.
  // Joining these runs recovers its URL without treating the instruction as HTML.
  for (const target of instructions
    .join("")
    .matchAll(/\bHYPERLINK\s+(?:"([^"]+)"|(\S+))/gi)) {
    const url = target[1] ?? target[2];
    if (!links.some((link) => link.target === url))
      links.push({ target: url, text: clean(visibleText(node)) });
  }
  return links;
}

function explicitIdentities(value: string): CodeforcesIdentity[] {
  const matches = value.matchAll(
    /(?:^|[^\p{L}\p{N}])((?:(?:CF|Codeforces)\s*)?\d{1,9}\s*[-\/]?\s*[A-Za-z]\d*)(?=$|[^\p{L}\p{N}])/gu,
  );
  return [...matches]
    .map((match) => normalizeCodeforcesIdentity(match[1]))
    .filter((identity): identity is CodeforcesIdentity => !!identity);
}
const uniqueIdentities = (values: CodeforcesIdentity[]) => [
  ...new Map(values.map((identity) => [identity.key, identity])).values(),
];
function rowIdentity(
  links: SheetLink[],
  values: string[],
): CodeforcesIdentity | null {
  const linked = uniqueIdentities(
    links
      .map((link) => normalizeCodeforcesIdentity(link.target))
      .filter((identity): identity is CodeforcesIdentity => !!identity),
  );
  if (linked.length) return linked.length === 1 ? linked[0] : null;
  const explicit = uniqueIdentities(values.flatMap(explicitIdentities));
  return explicit.length === 1 ? explicit[0] : null;
}
function titleWithoutCode(
  value: string,
  identity: CodeforcesIdentity | null,
): string {
  const title = clean(value).replace(/^\d+[.)]\s*/, "");
  const prefix = title.match(
    /^((?:(?:CF|Codeforces)\s*)?\d{1,9}\s*[-\/]?\s*[A-Za-z]\d*)\s*(?:[—–:-]\s*|\s+)(.+)$/i,
  );
  return prefix && normalizeCodeforcesIdentity(prefix[1])?.key === identity?.key
    ? prefix[2]
    : title;
}
function bounded(value: string, maximum: number, label: string) {
  if (value.length > maximum)
    fail(
      `A ${label} is longer than the ${maximum}-character import limit. Shorten it in the document and try again.`,
    );
  return value;
}
function makeEntry(
  title: string,
  identity: CodeforcesIdentity | null,
  rating: string,
  pattern: string,
): TrackImportEntry {
  const numeric = /^\d{1,5}$/.test(rating.trim())
    ? Number(rating.trim())
    : null;
  return {
    id: crypto.randomUUID(),
    title: bounded(
      titleWithoutCode(title, identity) || identity?.code || "Untitled problem",
      240,
      "problem title",
    ),
    code: identity?.code ?? "",
    url: identity?.url ?? "",
    rating: numeric !== null && numeric <= 10000 ? numeric : null,
    pattern: bounded(clean(pattern), 2000, "pattern hint"),
  };
}
interface Timing {
  start: number;
  end: number;
  text: string;
}
function extractTimings(node: XmlNode): Timing[] {
  return descendants(node, "tc").flatMap((cell) => {
    const lines = children(cell, "p")
      .map(visibleText)
      .map(clean)
      .filter(Boolean);
    const range = lines.join(" ").match(/(?:^|\s)(\d+)\s*[–—-]\s*(\d+)/);
    const time = lines
      .join(" ")
      .match(
        /(\d+(?:\s*[–—-]\s*\d+)?\s*(?:min(?:ute)?s?|hours?|hrs?)\b.*)/i,
      )?.[1];
    return range && time
      ? [
          {
            start: Number(range[1]),
            end: Number(range[2]),
            text: bounded(time, 240, "suggested practice time"),
          },
        ]
      : [];
  });
}

interface TableColumns {
  problem: number;
  code: number;
  rating: number;
  pattern: number;
  order: number;
}
function tableColumns(cells: string[]): TableColumns | null {
  const normalized = cells.map((cell) => clean(cell).toLowerCase());
  const problem = normalized.findIndex((cell) =>
    /^(?:problem(?: name| title)?|title|name)$/.test(cell),
  );
  if (problem < 0) return null;
  return {
    problem,
    code: normalized.findIndex((cell) =>
      /^(?:id|code|problem (?:id|code))$/.test(cell),
    ),
    rating: normalized.findIndex((cell) =>
      /^(?:rating|difficulty)$/.test(cell),
    ),
    pattern: normalized.findIndex((cell) =>
      /^(?:main pattern|pattern|hint|topic)$/.test(cell),
    ),
    order: normalized.findIndex((cell) =>
      /^(?:#|no\.?|number|order)$/.test(cell),
    ),
  };
}

/** Parse locally into an editable draft. This function never reads or writes a workspace. */
export async function parsePracticeSheet(
  input: ArrayBuffer | Uint8Array,
  sourceName: string,
  options: PracticeSheetOptions = {},
): Promise<TrackImportDraft> {
  report(options, "Checking document", 0);
  if (!/\.docx$/i.test(sourceName))
    fail(
      "Choose a .docx practice sheet. PDF, images, and older .doc files are not supported.",
    );
  bounded(sourceName, 240, "file name");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > DOCX_IMPORT_LIMITS.maxFileBytes)
    fail(
      "Choose a DOCX smaller than 8 MB. Remove embedded images or split a large sheet into smaller documents.",
    );
  if (bytes.length < 22) throw invalidZip();
  try {
    const parts = inspectZip(bytes);
    const required = ["[Content_Types].xml", "word/document.xml"];
    if (required.some((name) => !parts.has(name)))
      fail(
        "This file is not a Word DOCX document. Save the practice sheet as .docx and try again.",
      );
    await yieldControl(options);
    report(options, "Reading document links", 10);
    const sourceHash = await crypto.subtle.digest(
      "SHA-256",
      bytes.slice().buffer,
    );
    abort(options);
    const sourceFingerprint = Array.from(new Uint8Array(sourceHash), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    const selected = [
      "[Content_Types].xml",
      "word/_rels/document.xml.rels",
      "word/styles.xml",
      "word/document.xml",
    ].filter((name) => parts.has(name));
    const xml = new Map<string, XmlNode[]>();
    for (let index = 0; index < selected.length; index++) {
      const name = selected[index];
      const text = await readPart(bytes, parts.get(name)!, options);
      await yieldControl(options);
      xml.set(name, parseXml(text, name));
      report(
        options,
        "Reading document structure",
        15 + Math.round(((index + 1) / selected.length) * 35),
      );
      await yieldControl(options);
    }
    const types = xml
      .get("[Content_Types].xml")
      ?.find((node) => localName(node.name) === "Types");
    const mainType =
      types &&
      children(types, "Override").find(
        (node) => attr(node, "PartName") === "/word/document.xml",
      );
    if (
      !mainType ||
      attr(mainType, "ContentType") !==
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    )
      fail(
        "Only regular .docx documents are supported. Save the sheet without macros or encryption and try again.",
      );
    const root = xml
      .get("word/document.xml")
      ?.find((node) => localName(node.name) === "document");
    const body = root && firstChild(root, "body");
    if (!body)
      throw new PracticeSheetError(
        "The DOCX does not contain a readable document body. Save a new .docx and try again.",
      );
    const relationships = new Map<string, string>();
    const relationshipRoot = xml
      .get("word/_rels/document.xml.rels")
      ?.find((node) => localName(node.name) === "Relationships");
    for (const relationship of relationshipRoot
      ? children(relationshipRoot, "Relationship")
      : []) {
      if (
        attr(relationship, "Type").endsWith("/hyperlink") &&
        attr(relationship, "TargetMode") === "External"
      ) {
        const id = attr(relationship, "Id");
        if (relationships.has(id))
          fail(
            "This DOCX contains duplicate hyperlink relationship IDs. Save a new .docx and try again.",
          );
        relationships.set(id, attr(relationship, "Target"));
      }
    }
    const headingStyles = new Set<string>();
    const styles = xml
      .get("word/styles.xml")
      ?.find((node) => localName(node.name) === "styles");
    for (const style of styles ? children(styles, "style") : []) {
      const styleId = attr(style, "styleId"),
        name = attr(firstChild(style, "name") ?? style, "val");
      if (
        /stage|heading[\s_-]*[123]/i.test(`${styleId} ${name}`) ||
        descendants(style, "outlineLvl").some(
          (node) => Number(attr(node, "val")) < 3,
        )
      )
        headingStyles.add(styleId);
    }
    const stages: TrackImportStage[] = [];
    const timings: Timing[] = [];
    let title = "",
      current: TrackImportStage | undefined,
      totalEntries = 0;
    const getStage = () => {
      if (!current) {
        current = {
          id: crypto.randomUUID(),
          title: "Practice",
          description: "",
          suggestedTime: "",
          entries: [],
        };
        stages.push(current);
      }
      return current;
    };
    const append = (entry: TrackImportEntry, order?: number) => {
      if (++totalEntries > DOCX_IMPORT_LIMITS.maxProblems)
        fail(
          `This sheet contains more than ${DOCX_IMPORT_LIMITS.maxProblems} problems. Split it into smaller tracks.`,
        );
      const stage = getStage();
      if (!stage.suggestedTime) {
        const timing = timings.find(
          (item) =>
            (order ?? totalEntries) >= item.start &&
            (order ?? totalEntries) <= item.end,
        );
        if (timing) stage.suggestedTime = timing.text;
      }
      stage.entries.push(entry);
    };
    for (let blockIndex = 0; blockIndex < body.children.length; blockIndex++) {
      const block = body.children[blockIndex],
        name = localName(block.name);
      if (name === "p") {
        const text = clean(visibleText(block));
        if (!text) continue;
        const style = attr(
          firstChild(firstChild(block, "pPr") ?? block, "pStyle") ?? block,
          "val",
        );
        const explicitStage = text.match(
          /^Stage\s*(?:\d+|[IVX]+)\s*[:.\-–—]\s*(.+)$/i,
        );
        const stageHeading =
          explicitStage ||
          ((/stageheading|heading[123]/i.test(style) ||
            headingStyles.has(style)) &&
            title);
        if (stageHeading) {
          if (stages.length >= DOCX_IMPORT_LIMITS.maxStages)
            fail(
              `This sheet contains more than ${DOCX_IMPORT_LIMITS.maxStages} stages. Split it into smaller tracks.`,
            );
          current = {
            id: crypto.randomUUID(),
            title: bounded(explicitStage?.[1] ?? text, 240, "stage title"),
            description: "",
            suggestedTime: "",
            entries: [],
          };
          stages.push(current);
        } else {
          const links = linksIn(block, relationships);
          const linked = links.filter((link) =>
            normalizeCodeforcesIdentity(link.target),
          );
          if (linked.length > 1) {
            for (const link of linked)
              append(
                makeEntry(
                  link.text || text,
                  normalizeCodeforcesIdentity(link.target),
                  "",
                  "",
                ),
              );
          } else {
            const identity = rowIdentity(links, [text]);
            if (identity || /^\d+[.)]\s*\S/.test(text))
              append(
                makeEntry(
                  linked[0]?.text || text,
                  identity,
                  text.match(/\brating\s*[:\-]?\s*(\d+)/i)?.[1] ?? "",
                  "",
                ),
              );
            else if (!title) title = bounded(text, 240, "track title");
            else if (current && !current.entries.length) {
              if (
                /\b(?:suggested|practice time|before hints|minutes?|min)\b/i.test(
                  text,
                ) &&
                /\d/.test(text)
              )
                current.suggestedTime = bounded(
                  text,
                  240,
                  "suggested practice time",
                );
              else
                current.description = bounded(
                  [current.description, text].filter(Boolean).join("\n"),
                  5000,
                  "stage description",
                );
            }
          }
        }
      } else if (name === "tbl") {
        timings.push(...extractTimings(block));
        let columns: TableColumns | null = null;
        for (const row of children(block, "tr")) {
          const cells = children(row, "tc"),
            values = cells.map(cellText);
          const header = tableColumns(values);
          if (header) {
            columns = header;
            continue;
          }
          if (columns) {
            const problem = cells[columns.problem];
            if (!problem || !values[columns.problem]) continue;
            const links = linksIn(problem, relationships);
            const identity = rowIdentity(links, [
              values[columns.code] ?? "",
              values[columns.problem],
            ]);
            const order = Number(values[columns.order]);
            append(
              makeEntry(
                values[columns.problem],
                identity,
                values[columns.rating] ?? "",
                values[columns.pattern] ?? "",
              ),
              Number.isFinite(order) && order > 0 ? order : undefined,
            );
          } else {
            for (let index = 0; index < cells.length; index++) {
              const links = linksIn(cells[index], relationships),
                identity = rowIdentity(links, [values[index]]);
              if (
                identity ||
                links.some((link) => normalizeCodeforcesIdentity(link.target))
              )
                append(makeEntry(values[index], identity, "", ""));
            }
          }
        }
      }
      if (blockIndex % 4 === 0) {
        report(
          options,
          "Building stages and problems",
          55 + Math.round(((blockIndex + 1) / body.children.length) * 40),
        );
        await yieldControl(options);
      }
    }
    if (!totalEntries)
      fail(
        "No problem entries were found. Use a table with a Problem column, embedded Codeforces links, or explicit IDs such as 381A. Titles alone cannot identify a problem.",
      );
    report(options, "Preview ready", 100);
    return {
      id: crypto.randomUUID(),
      title: title || sourceName.replace(/\.docx$/i, ""),
      sourceName,
      sourceFingerprint,
      stages,
    };
  } catch (error) {
    if (
      error instanceof PracticeSheetError ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw error;
    throw invalidZip();
  }
}

export function analyzePracticeSheet(draft: TrackImportDraft) {
  const entries = draft.stages.flatMap((stage) => stage.entries);
  const identities = entries
    .map(
      (entry) =>
        normalizeCodeforcesIdentity({ url: entry.url, code: entry.code })?.key,
    )
    .filter((key): key is string => !!key);
  return {
    problemCount: entries.length,
    stageCount: draft.stages.length,
    unresolvedCount: entries.length - identities.length,
    duplicateCount: identities.length - new Set(identities).size,
  };
}
