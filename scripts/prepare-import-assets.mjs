import { copyFile, cp, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

// Serve pinned engines from this app. A selected document never leaves the browser.
// Generated assets stay out of Git and are recreated by install/build/dev.
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const target = join(root, "public", "import-assets");
const packages = [
  "pdfjs-dist",
  "tesseract.js",
  "tesseract.js-core",
  "@tesseract.js-data/eng",
];
const info = {};
for (const name of packages) {
  const path = require.resolve(`${name}/package.json`);
  info[name] = {
    path: dirname(path),
    version: JSON.parse(await readFile(path, "utf8")).version,
  };
}
const pdf = info["pdfjs-dist"],
  ocr = info["tesseract.js"],
  core = info["tesseract.js-core"],
  language = info["@tesseract.js-data/eng"];
const pdfTarget = join(target, `pdfjs-${pdf.version}`);
const ocrTarget = join(target, `tesseract-${ocr.version}`);
const coreTarget = join(target, `core-${core.version}`);
const languageTarget = join(target, `eng-${language.version}`);
await Promise.all(
  [pdfTarget, ocrTarget, coreTarget, languageTarget].map((path) =>
    mkdir(path, { recursive: true }),
  ),
);
for (const name of ["pdf.mjs", "pdf.worker.mjs"])
  await copyFile(join(pdf.path, "build", name), join(pdfTarget, name));
for (const name of ["cmaps", "standard_fonts", "wasm"])
  await cp(join(pdf.path, name), join(pdfTarget, name), { recursive: true });
await copyFile(join(pdf.path, "LICENSE"), join(pdfTarget, "LICENSE"));
for (const name of [
  "tesseract.min.js",
  "worker.min.js",
  "tesseract.min.js.LICENSE.txt",
  "worker.min.js.LICENSE.txt",
])
  await copyFile(join(ocr.path, "dist", name), join(ocrTarget, name));
await copyFile(join(ocr.path, "LICENSE.md"), join(ocrTarget, "LICENSE.md"));
for (const name of await readdir(core.path)) {
  if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(name))
    await copyFile(join(core.path, name), join(coreTarget, name));
}
await copyFile(join(core.path, "LICENSE"), join(coreTarget, "LICENSE"));
await copyFile(
  join(language.path, "4.0.0_best_int", "eng.traineddata.gz"),
  join(languageTarget, "eng.traineddata.gz"),
);
await copyFile(
  join(language.path, "package.json"),
  join(languageTarget, "package.json"),
);
console.log(`Prepared local PDF ${pdf.version} and OCR ${ocr.version} assets.`);
