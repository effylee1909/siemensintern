import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { unzipSync, strFromU8 } from "fflate";
import { textFromItems } from "./pdf-layout.js";
GlobalWorkerOptions.workerSrc = pdfWorker;
let ocr;
export async function extract(file, onProgress = () => {}) {
  if (file.name.toLowerCase().endsWith(".docx")) {
    const z = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (e) => {
        if (e.originalSize > 30 * 1024 * 1024)
          throw Error("Word 解壓縮超過限制");
        return e.name === "word/document.xml";
      },
    });
    if (!z["word/document.xml"]) throw Error("無效的 Word");
    const xml = new DOMParser().parseFromString(
      strFromU8(z["word/document.xml"]),
      "application/xml",
    );
    if (xml.querySelector("parsererror")) throw Error("Word XML 格式錯誤");
    return [
      {
        page: 1,
        method: "Word 段落文字",
        text: [...xml.getElementsByTagNameNS("*", "p")]
          .map((p) =>
            [...p.getElementsByTagNameNS("*", "t")]
              .map((t) => t.textContent)
              .join(""),
          )
          .join("\n"),
      },
    ];
  }
  const pdf = await getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: import.meta.env.BASE_URL + "pdf-cmaps/",
    cMapPacked: true,
    standardFontDataUrl: import.meta.env.BASE_URL + "pdf-fonts/",
  }).promise;
  try {
    if (pdf.numPages > 150) throw Error("初版每份 PDF 最多 150 頁");
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress(`第 ${i} / ${pdf.numPages} 頁`);
      const page = await pdf.getPage(i),
        content = await page.getTextContent();
      let text = textFromItems(content.items),
        method = "PDF 文字擷取";
      if (text.replace(/\s/g, "").length < 30) {
        onProgress(`第 ${i} 頁 · 掃描 OCR`);
        if (!ocr) {
          const { createWorker } = await import("tesseract.js");
          ocr = await createWorker("chi_tra+eng", 1, {
            workerPath: import.meta.env.BASE_URL + "ocr/worker.min.js",
            corePath: import.meta.env.BASE_URL + "ocr/",
            langPath: import.meta.env.BASE_URL + "ocr/",
            workerBlobURL: false,
          });
        }
        const viewport = page.getViewport({ scale: 1.5 }),
          canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport })
          .promise;
        try {
          text = (await ocr.recognize(canvas)).data.text;
          method = "掃描 OCR（需核對）";
        } catch (e) {
          await ocr.terminate();
          ocr = null;
          throw e;
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      pages.push({ page: i, method, text });
      page.cleanup();
    }
    if (!pages.some((p) => p.text.trim()))
      throw Error("未辨識到文字，請手動分類");
    return pages;
  } finally {
    await pdf.destroy();
  }
}
