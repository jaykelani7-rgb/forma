import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  analyzePracticeSheet,
  DOCX_IMPORT_LIMITS,
  parsePracticeSheet,
  PracticeSheetError,
} from "../src/lib/docx-import";
import type { TrackImportEntry } from "../src/lib/tracks-types";

const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
const paragraph = (value: string) => `<w:p>${text(value)}</w:p>`;
const stage = (value: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${text(value)}</w:p>`;
const cell = (value: string) => `<w:tc><w:p>${value}</w:p></w:tc>`;
const row = (values: string[]) => `<w:tr>${values.map(cell).join("")}</w:tr>`;
const header = row(["#", "Problem", "Rating", "Main pattern"].map(text));
const link = (id: string, title: string) =>
  `<w:hyperlink r:id="${id}">${text(title)}</w:hyperlink>`;
const table = (rows: string[]) => `<w:tbl>${header}${rows.join("")}</w:tbl>`;
const doc = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`;
function sheet(
  body: string,
  links: Record<string, string> = {},
  extra: Record<string, string> = {},
  level: 0 | 6 = 6,
) {
  const parts: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "word/document.xml": strToU8(doc(body)),
    "word/_rels/document.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Object.entries(
        links,
      )
        .map(
          ([id, target]) =>
            `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="${target.replaceAll("&", "&amp;")}"/>`,
        )
        .join("")}</Relationships>`,
    ),
  };
  for (const [name, value] of Object.entries(extra))
    parts[name] = strToU8(value);
  return zipSync(parts, { level });
}
const parse = (bytes: Uint8Array) => parsePracticeSheet(bytes, "practice.docx");
const simple = () =>
  sheet(
    paragraph("My practice") +
      stage("Foundation") +
      table([
        row([
          text("1"),
          text("381A — Sereja and Dima"),
          text("800"),
          text("Opposite ends"),
        ]),
      ]),
  );
function directory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= 0; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50)
      return { view, offset: view.getUint32(offset + 16, true), end: offset };
  }
  throw new Error("Fixture has no ZIP directory");
}
function partHeader(bytes: Uint8Array, name: string) {
  const { view, offset, end } = directory(bytes);
  for (let at = offset; at < end; ) {
    const nameLength = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true);
    if (
      new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + nameLength),
      ) === name
    ) {
      const local = view.getUint32(at + 42, true);
      return {
        view,
        central: at,
        local,
        data:
          local +
          30 +
          view.getUint16(local + 26, true) +
          view.getUint16(local + 28, true),
      };
    }
    at += 46 + nameLength + extra + comment;
  }
  throw new Error("Fixture part not found");
}

test("real supplied DOCX extracts all 100 links, five ordered stages, and exact source metadata", async () => {
  const bytes = readFileSync(
    new URL("./fixtures/docx/two-pointers-100.docx", import.meta.url),
  );
  const expected: { title: string; entries: Omit<TrackImportEntry, "id">[] }[] =
    JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/docx/two-pointers-100.expected.json",
          import.meta.url,
        ),
        "utf-8",
      ),
    );
  const draft = await parsePracticeSheet(
    bytes,
    "CF_100_Two_Pointers_Practice_Sheet.docx",
  );
  assert.equal(draft.title, "CODEFORCES TWO POINTERS");
  assert.equal(
    draft.sourceFingerprint,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.deepEqual(analyzePracticeSheet(draft), {
    problemCount: 100,
    stageCount: 5,
    unresolvedCount: 0,
    duplicateCount: 0,
  });
  assert.deepEqual(
    draft.stages.map((value) => value.title),
    ["Foundation", "Core Patterns", "Intermediate", "Advanced", "Mastery"],
  );
  assert.deepEqual(
    draft.stages.map((value) => value.entries.length),
    [20, 20, 20, 20, 20],
  );
  assert.deepEqual(
    draft.stages.map((value) => value.suggestedTime),
    [
      "15–25 min before hints",
      "30–45 min before hints",
      "30–45 min before hints",
      "45–75 min; revisit after editorial",
      "45–75 min; revisit after editorial",
    ],
  );
  for (let index = 0; index < expected.length; index++) {
    assert.deepEqual(
      draft.stages[index].entries.map((entry) => ({
        title: entry.title,
        code: entry.code,
        url: entry.url,
        rating: entry.rating,
        pattern: entry.pattern,
      })),
      expected[index].entries,
    );
    assert.ok(draft.stages[index].description.length > 70);
  }
  const ids = [
    draft.id,
    ...draft.stages.map((value) => value.id),
    ...draft.stages.flatMap((value) => value.entries.map((entry) => entry.id)),
  ];
  assert.equal(
    new Set(ids).size,
    106,
    "Every preview record has its own stable ID",
  );
});

test("split hyperlink runs retain titles, entities, C1/C2 distinctions, and normalize equivalent URLs", async () => {
  const split = `<w:hyperlink r:id="one">${text("1739C1 — A &amp; ")}${text("B")}</w:hyperlink>`;
  const draft = await parse(
    sheet(
      paragraph("Split runs") +
        stage("Core Patterns") +
        table([
          row([text("1"), split, text("1400"), text("Window &lt; invariant")]),
          row([
            text("2"),
            link("two", "1739C2 — A and B, hard"),
            text("1800"),
            text("Counting"),
          ]),
        ]),
      {
        one: "http://www.codeforces.com/contest/1739/problem/c1/?locale=en#problem",
        two: "https://codeforces.com/problemset/problem/1739/C2",
      },
    ),
  );
  assert.deepEqual(
    draft.stages[0].entries.map(({ title, code, url, rating, pattern }) => ({
      title,
      code,
      url,
      rating,
      pattern,
    })),
    [
      {
        title: "A & B",
        code: "1739C1",
        url: "https://codeforces.com/problemset/problem/1739/C1",
        rating: 1400,
        pattern: "Window < invariant",
      },
      {
        title: "A and B, hard",
        code: "1739C2",
        url: "https://codeforces.com/problemset/problem/1739/C2",
        rating: 1800,
        pattern: "Counting",
      },
    ],
  );
});

test("embedded URLs win over conflicting explicit codes without rewriting source titles", async () => {
  const draft = await parse(
    sheet(
      paragraph("Sheet") +
        table([
          row([
            text("1"),
            link("one", "381A — Source title"),
            text("900"),
            text("Source hint"),
          ]),
        ]),
      { one: "https://codeforces.com/contest/279/problem/B" },
    ),
  );
  assert.equal(draft.stages[0].entries[0].code, "279B");
  assert.equal(draft.stages[0].entries[0].title, "381A — Source title");
  assert.equal(draft.stages[0].entries[0].rating, 900);
});

test("explicit ID columns resolve fallback; title-only and ambiguous entries remain editable unresolved entries", async () => {
  const explicitHeader = row(
    ["Problem ID", "Problem", "Rating", "Main pattern"].map(text),
  );
  const draft = await parse(
    sheet(
      paragraph("No title guesses") +
        `<w:tbl>${explicitHeader}${row([text("CF 381A"), text("Sereja and Dima"), text("800"), text("Two pointers")])}${row([text(""), text("Books"), text("1400"), text("Window")])}${row([text(""), text("1739C1 or 1739C2 — ambiguous"), text("?"), text("")])}</w:tbl>`,
    ),
  );
  assert.deepEqual(
    draft.stages[0].entries.map((entry) => entry.code),
    ["381A", "", ""],
  );
  assert.equal(draft.stages[0].entries[1].url, "");
  assert.equal(draft.stages[0].entries[2].rating, null);
  assert.equal(analyzePracticeSheet(draft).unresolvedCount, 2);
});

test("duplicates are counted by Codeforces identity and remain in source order for a deliberate preview choice", async () => {
  const draft = await parse(
    sheet(
      paragraph("Duplicates") +
        table([
          row([
            text("1"),
            link("one", "381A — First title"),
            text("800"),
            text(""),
          ]),
          row([
            text("2"),
            link("two", "381A — Second title"),
            text("900"),
            text(""),
          ]),
        ]),
      {
        one: "https://codeforces.com/contest/381/problem/A",
        two: "http://codeforces.com/problemset/problem/381/A",
      },
    ),
  );
  assert.equal(analyzePracticeSheet(draft).duplicateCount, 1);
  assert.deepEqual(
    draft.stages[0].entries.map((entry) => entry.title),
    ["First title", "Second title"],
  );
  assert.notEqual(draft.stages[0].entries[0].id, draft.stages[0].entries[1].id);
});

test("multiple differing URLs in one problem cell are unresolved instead of silently choosing a URL", async () => {
  const draft = await parse(
    sheet(
      paragraph("Ambiguous links") +
        table([
          row([
            text("1"),
            link("one", "first") + link("two", "second"),
            text("1200"),
            text(""),
          ]),
        ]),
      {
        one: "https://codeforces.com/contest/381/problem/A",
        two: "https://codeforces.com/contest/381/problem/B",
      },
    ),
  );
  assert.equal(draft.stages[0].entries[0].code, "");
  assert.equal(analyzePracticeSheet(draft).unresolvedCount, 1);
});

test("paragraphs and field hyperlinks preserve document order around stage tables", async () => {
  const field = `<w:p><w:fldSimple w:instr=' HYPERLINK "https://codeforces.com/contest/1739/problem/C2" '>${text("1739C2 — Field link")}</w:fldSimple></w:p>`;
  const draft = await parse(
    sheet(
      paragraph("Mixed layout") +
        stage("First stage") +
        paragraph("An objective in ordinary prose.") +
        `<w:p>${link("one", "381A — First link")}</w:p>` +
        table([
          row([text("2"), text("279B — Books"), text("1400"), text("Window")]),
        ]) +
        stage("Second stage") +
        field,
      { one: "https://codeforces.com/problemset/problem/381/A" },
    ),
  );
  assert.deepEqual(
    draft.stages.map((value) => value.entries.map((entry) => entry.code)),
    [["381A", "279B"], ["1739C2"]],
  );
  assert.equal(draft.stages[0].description, "An objective in ordinary prose.");
});

test("custom heading styles and source time paragraphs form stages without importing non-problem summary tables", async () => {
  const custom = `<w:p><w:pPr><w:pStyle w:val="SkillSection"/></w:pPr>${text("Foundation")}</w:p>`;
  const styles = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="SkillSection"><w:name w:val="Skill section"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`;
  const draft = await parse(
    sheet(
      paragraph("Custom headings") +
        `<w:tbl>${row([text("Study slowly"), text("Enjoy practice")])}</w:tbl>` +
        custom +
        paragraph("Suggested practice time: 20–30 minutes") +
        table([
          row([
            text("1"),
            text("381A — Sereja and Dima"),
            text("800"),
            text("Ends"),
          ]),
        ]),
      {},
      { "word/styles.xml": styles },
    ),
  );
  assert.equal(draft.stages.length, 1);
  assert.equal(draft.stages[0].title, "Foundation");
  assert.equal(
    draft.stages[0].suggestedTime,
    "Suggested practice time: 20–30 minutes",
  );
  assert.equal(analyzePracticeSheet(draft).problemCount, 1);
});

test("complex field instructions split across runs recover their embedded URL", async () => {
  const field = `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPER</w:instrText></w:r><w:r><w:instrText>LINK "https://codeforces.com/contest/1739/problem/C1" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${text("Field title without a code")}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
  const draft = await parse(
    sheet(paragraph("Field sheet") + stage("First stage") + field),
  );
  assert.equal(draft.stages[0].entries[0].code, "1739C1");
  assert.equal(draft.stages[0].entries[0].title, "Field title without a code");
});

test("progress is visible, monotonic, cancellable, and parsing has no workspace side effects", async () => {
  const steps: number[] = [];
  const draft = await parsePracticeSheet(simple(), "practice.docx", {
    onProgress: ({ percent }) => steps.push(percent),
  });
  assert.equal(steps[0], 0);
  assert.equal(steps.at(-1), 100);
  assert.deepEqual(
    [...steps].sort((a, b) => a - b),
    steps,
  );
  assert.equal(analyzePracticeSheet(draft).problemCount, 1);
  const controller = new AbortController();
  await assert.rejects(
    parsePracticeSheet(simple(), "practice.docx", {
      signal: controller.signal,
      onProgress: ({ percent }) => {
        if (percent >= 10) controller.abort();
      },
    }),
    { name: "AbortError" },
  );
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    parsePracticeSheet(simple(), "practice.docx", {
      signal: alreadyAborted.signal,
    }),
    { name: "AbortError" },
  );
});

test("reparsing the same file preserves its fingerprint while independent previews receive distinct IDs", async () => {
  const bytes = simple();
  const first = await parsePracticeSheet(bytes, "first.docx"),
    second = await parsePracticeSheet(bytes, "renamed.docx");
  assert.equal(first.sourceFingerprint, second.sourceFingerprint);
  assert.notEqual(first.id, second.id);
  assert.notEqual(
    first.stages[0].entries[0].id,
    second.stages[0].entries[0].id,
  );
});

test("unsupported file types, oversized uploads, empty sheets, and renamed non-DOCX ZIPs have actionable errors", async () => {
  await assert.rejects(
    parsePracticeSheet(simple(), "practice.pdf"),
    /Choose a \.docx.*PDF/,
  );
  await assert.rejects(
    parse(new Uint8Array(DOCX_IMPORT_LIMITS.maxFileBytes + 1)),
    /smaller than 8 MB/,
  );
  await assert.rejects(
    parse(sheet(paragraph("No identifiable problems"))),
    /No problem entries.*Titles alone/,
  );
  await assert.rejects(
    parse(zipSync({ "example.txt": strToU8("hello") })),
    /not a Word DOCX/,
  );
});

test("malformed ZIPs, inconsistent local headers, CRC corruption, and path traversal are rejected", async () => {
  await assert.rejects(parse(simple().slice(0, -5)), PracticeSheetError);
  const headers = simple().slice(),
    part = partHeader(headers, "word/document.xml");
  part.view.setUint16(part.local + 8, 0, true);
  await assert.rejects(parse(headers), /damaged/);
  const corrupt = sheet(
      paragraph("Title") + paragraph("381A — Problem"),
      {},
      {},
      0,
    ),
    headerInfo = partHeader(corrupt, "word/document.xml");
  corrupt[headerInfo.data + 5] ^= 1;
  await assert.rejects(parse(corrupt), /damaged/);
  await assert.rejects(
    parse(
      sheet(
        paragraph("Title") + paragraph("381A — Problem"),
        {},
        { "../danger.xml": "<root/>" },
      ),
    ),
    /damaged/,
  );
});

test("encrypted and macro-enabled documents are rejected before content is accepted", async () => {
  const encrypted = simple().slice(),
    info = partHeader(encrypted, "word/document.xml");
  info.view.setUint16(
    info.central + 8,
    info.view.getUint16(info.central + 8, true) | 1,
    true,
  );
  await assert.rejects(parse(encrypted), /Encrypted DOCX/);
  const macros = sheet(
    paragraph("Title") + paragraph("381A — Problem"),
    {},
    {
      "[Content_Types].xml": contentTypes.replace(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        "application/vnd.ms-word.document.macroEnabled.main+xml",
      ),
    },
  );
  await assert.rejects(parse(macros), /without macros/);
});

test("malformed XML, entity definitions, undefined entities, and invalid characters are rejected", async () => {
  const bodies = [
    "<w:p><w:r></w:p>",
    "<!DOCTYPE external SYSTEM 'https://example.com/private'>" +
      paragraph("381A"),
    paragraph("&undefined;"),
    paragraph("bad\u0001character"),
  ];
  for (const body of bodies)
    await assert.rejects(parse(sheet(body)), PracticeSheetError);
});

test("ZIP entry, expanded XML, compression-ratio, and actual inflation limits reject resource bombs", async () => {
  const extras = Object.fromEntries(
    Array.from({ length: DOCX_IMPORT_LIMITS.maxZipEntries }, (_, index) => [
      `extra/${index}.xml`,
      "<root/>",
    ]),
  );
  await assert.rejects(
    parse(sheet(paragraph("381A"), {}, extras)),
    /too many ZIP entries/,
  );
  await assert.rejects(
    parse(
      sheet(
        paragraph("381A"),
        {},
        { "word/styles.xml": "x".repeat(DOCX_IMPORT_LIMITS.maxXmlBytes + 1) },
        0,
      ),
    ),
    /XML part exceeds/,
  );
  const ratioBomb = sheet(paragraph("381A"), {}, { "unused.bin": "abc" });
  const ratioPart = partHeader(ratioBomb, "unused.bin");
  ratioPart.view.setUint32(ratioPart.central + 24, 1_000_000, true);
  ratioPart.view.setUint32(ratioPart.local + 22, 1_000_000, true);
  await assert.rejects(parse(ratioBomb), /safe import limit/);
  const forged = sheet(
    paragraph("Sheet") + paragraph("381A — Problem") + " ".repeat(20_000),
  );
  const part = partHeader(forged, "word/document.xml");
  part.view.setUint32(part.central + 24, 100, true);
  part.view.setUint32(part.local + 22, 100, true);
  await assert.rejects(parse(forged), /oversized compressed XML/);
});

test("XML nesting and node-count limits reject oversized structures", async () => {
  await assert.rejects(
    parse(
      sheet(
        "<w:p>" + "<w:r>".repeat(90) + "text" + "</w:r>".repeat(90) + "</w:p>",
      ),
    ),
    /nested too deeply/,
  );
  await assert.rejects(
    parse(sheet("<w:r/>".repeat(DOCX_IMPORT_LIMITS.maxXmlNodes + 1))),
    /too many XML elements/,
  );
});

test("declared per-entry and total ZIP expansion limits are enforced even for ignored parts", async () => {
  const oversized = sheet(
    paragraph("381A"),
    {},
    { "unused.bin": "x".repeat(12_000) },
    0,
  );
  const part = partHeader(oversized, "unused.bin");
  part.view.setUint32(
    part.central + 24,
    DOCX_IMPORT_LIMITS.maxEntryBytes + 1,
    true,
  );
  part.view.setUint32(
    part.local + 22,
    DOCX_IMPORT_LIMITS.maxEntryBytes + 1,
    true,
  );
  await assert.rejects(parse(oversized), /safe import limit/);
  const parts = Object.fromEntries(
    Array.from({ length: 5 }, (_, index) => [
      `unused/${index}.bin`,
      "x".repeat(12_000),
    ]),
  );
  const total = sheet(paragraph("381A"), {}, parts, 0);
  for (const name of Object.keys(parts)) {
    const entry = partHeader(total, name);
    entry.view.setUint32(entry.central + 24, 7 * 1024 * 1024, true);
    entry.view.setUint32(entry.local + 22, 7 * 1024 * 1024, true);
  }
  await assert.rejects(parse(total), /safe import limit/);
});

test("problem and stage count limits fail before an unmanageable preview is returned", async () => {
  const rows = Array.from(
    { length: DOCX_IMPORT_LIMITS.maxProblems + 1 },
    (_, index) =>
      row([
        text(String(index + 1)),
        text("381A — Problem"),
        text("800"),
        text(""),
      ]),
  );
  await assert.rejects(
    parse(sheet(paragraph("Problems") + table(rows))),
    /more than 1000 problems/,
  );
  const stages = Array.from(
    { length: DOCX_IMPORT_LIMITS.maxStages + 1 },
    (_, index) =>
      stage(`Stage ${index + 1} — Practice`) + paragraph("381A — Problem"),
  );
  await assert.rejects(
    parse(sheet(paragraph("Stages") + stages.join(""))),
    /more than 100 stages/,
  );
});
