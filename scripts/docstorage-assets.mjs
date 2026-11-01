import { cpSync, mkdirSync } from "node:fs";
const target = process.argv[2] || "dist/siemens_docstorage";
mkdirSync(target + "/ocr", { recursive: true });
for (const name of [
  "tesseract-core.wasm.js",
  "tesseract-core.wasm",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-simd.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
])
  cpSync("node_modules/tesseract.js-core/" + name, target + "/ocr/" + name);
cpSync(
  "node_modules/tesseract.js/dist/worker.min.js",
  target + "/ocr/worker.min.js",
);
for (const lang of ["chi_tra", "eng"])
  cpSync(
    `node_modules/@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`,
    `${target}/ocr/${lang}.traineddata.gz`,
  );
cpSync("node_modules/pdfjs-dist/cmaps", target + "/pdf-cmaps", {
  recursive: true,
});
cpSync("node_modules/pdfjs-dist/standard_fonts", target + "/pdf-fonts", {
  recursive: true,
});
