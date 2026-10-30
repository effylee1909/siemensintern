import os
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
import pymupdf

MAX_PAGES = 150


def extract(path, filename):
    if filename.lower().endswith(".docx"):
        with zipfile.ZipFile(path) as z:
            if sum(i.file_size for i in z.infolist()) > 40 * 1024 * 1024:
                raise ValueError("Word 解壓縮內容超過 40 MB")
            content = z.read("word/document.xml")
        root = ET.fromstring(content)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        text = "\n".join(
            (
                "".join(p.itertext())
                if not p.findall(".//w:t", ns)
                else "".join(n.text or "" for n in p.findall(".//w:t", ns))
            )
            for p in root.findall(".//w:p", ns)
        )
        return [{"page": 1, "text": text, "method": "Word 文字擷取（不對應原始頁碼）"}]
    pages = []
    with pymupdf.open(path) as pdf:
        if pdf.needs_pass:
            raise ValueError("PDF 有密碼，請先提供未加密的副本")
        if len(pdf) > MAX_PAGES:
            raise ValueError(f"Demo 單檔最多 {MAX_PAGES} 頁，原檔已保留，可手動整理")
        for i, page in enumerate(pdf):
            text = page.get_text(sort=True)
            method = "PDF 文字擷取"
            # Image pages, even in mixed PDFs, receive local OCR.
            if len("".join(text.split())) < 30:
                method = "掃描 OCR（需核對）"
                with tempfile.TemporaryDirectory(prefix="docstorage-ocr-") as temp:
                    image = Path(temp) / "page.png"
                    page.get_pixmap(matrix=pymupdf.Matrix(2, 2)).save(image)
                    command = [
                        "tesseract",
                        str(image),
                        "stdout",
                        "-l",
                        os.environ.get("OCR_LANGS", "chi_tra+eng"),
                        "--psm",
                        "3",
                    ]
                    result = subprocess.run(
                        command, check=True, capture_output=True, timeout=90
                    )
                    text = result.stdout.decode("utf-8")
            pages.append({"page": i + 1, "text": text, "method": method})
    if not any(p["text"].strip() for p in pages):
        raise ValueError("未辨識到文字；原檔已保留，請手動輸入資料")
    return pages
