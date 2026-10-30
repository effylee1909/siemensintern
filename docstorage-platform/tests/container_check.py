"""Runs inside the built container; uses only runtime dependencies and synthetic data."""

import http.cookiejar
import json
import os
import time
import urllib.request
import uuid
import pymupdf

base = "http://127.0.0.1:8080/api"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(jar), urllib.request.ProxyHandler({})
)


def request(path, body=None, content_type="application/json"):
    r = urllib.request.Request(
        base + path, data=body, headers={"Content-Type": content_type}
    )
    with opener.open(r) as response:
        return json.load(response)


for _ in range(100):
    try:
        request("/health")
        break
    except Exception:
        time.sleep(0.2)
request("/login", json.dumps({"token": os.environ["DOCSTORAGE_TOKEN"]}).encode())
request("/demo", b"{}")
# Raster-only Chinese document proves packaged OCR works, not just host tools.
d = pymupdf.open()
p = d.new_page()
p.insert_text(
    (50, 80),
    "文號：P987\n主旨：測試程序審查意見\n說明：復貴公司 S501 號函。",
    fontname="china-t",
    fontsize=16,
)
image = p.get_pixmap(matrix=pymupdf.Matrix(2, 2)).tobytes("png")
d.close()
d = pymupdf.open()
p = d.new_page()
p.insert_image(p.rect, stream=image)
blob = d.tobytes()
d.close()
boundary = uuid.uuid4().hex
body = (
    f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="scan.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode()
    + blob
    + f"\r\n--{boundary}--\r\n".encode()
)
id = request("/upload", body, f"multipart/form-data; boundary={boundary}")["ids"][0]
for _ in range(100):
    r = request("/records/" + id)
    if r["status"] != "processing":
        break
    time.sleep(0.2)
assert r["status"] == "ready", r["files"]
assert "P987" in str(r["pages"])
assert "OCR" in str(r["pages"])
print(
    "PASS container login, shared database, generated sample PDFs, uploaded scanned Chinese PDF, packaged local OCR"
)
