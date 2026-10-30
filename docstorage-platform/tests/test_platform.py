import io
import os
import time
import zipfile
from pathlib import Path
import pymupdf
import pytest
from fastapi.testclient import TestClient
from app.server import create_app
from app.classify import classify, normalize


def pdf(text, scan=False):
    d = pymupdf.open()
    p = d.new_page()
    p.insert_text((45, 70), text, fontname="china-t", fontsize=14)
    if scan:
        pix = p.get_pixmap(matrix=pymupdf.Matrix(2, 2))
        image = pix.tobytes("png")
        d.close()
        d = pymupdf.open()
        p = d.new_page()
        p.insert_image(p.rect, stream=image)
    data = d.tobytes()
    d.close()
    return data


def docx(text):
    import html

    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            + "".join(
                f"<w:p><w:r><w:t>{html.escape(line)}</w:t></w:r></w:p>"
                for line in text.splitlines()
            )
            + "</w:body></w:document>",
        )
    return b.getvalue()


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        yield c


def ready(c, id):
    for _ in range(150):
        r = c.get("/api/records/" + id).json()
        if r["status"] != "processing":
            return r
        time.sleep(0.1)
    raise AssertionError("background processing did not complete")


def upload(c, text, name="letter.pdf"):
    data = pdf(text) if name.endswith(".pdf") else docx(text)
    res = c.post("/api/upload", files=[("files", (name, data))])
    assert res.status_code == 200, res.text
    return res.json()["ids"][0], data


LETTER = "發文單位：範例軌道公司\n受文者：西門子股份有限公司\n文號：P100\n發文日期：115年10月12日\n主旨：測試程序審查意見\n說明：復貴公司 S501 號函，請於文到七日內回覆。\n文件編號：SIG-TP-001\n版次：B"


def test_classify_evidence_deadline_and_ambiguous_customer():
    a = classify(
        [{"page": 1, "text": LETTER}],
        "letter.pdf",
        {"own_names": ["西門子"], "customers": []},
    )
    m = a["metadata"]
    assert m["category"] == "審查意見"
    assert m["direction"] == "收文"
    assert m["date"] == "2026-10-12"
    assert m["due_date"] == ""
    assert "文到七日" in m["due_note"]
    assert a["references"][0]["number"] == "S501"
    assert a["references"][0]["page"] == 1
    assert normalize("工字第 1150011778 號") == normalize("工字1150011778號")


def test_upload_search_download_translation_correction_and_conflict(client):
    id, original = upload(client, LETTER)
    r = ready(client, id)
    assert r["status"] == "ready"
    assert r["effective"]["doc_no"] == "P100"
    assert r["references"][0]["candidates"] == []
    assert client.get("/api/records", params={"q": "審查意見"}).json()["total"] == 1
    assert client.get("/api/records", params={"q": "審查"}).json()["total"] == 1
    f = r["files"][0]
    assert client.get("/api/files/" + f["id"]).content == original
    res = client.patch(
        "/api/records/" + id,
        json={
            "revision": r["revision"],
            "values": {"customer": "人工客戶", "category": "回覆／補充"},
            "confirm": True,
        },
    )
    assert res.status_code == 200
    assert (
        client.patch(
            "/api/records/" + id,
            json={"revision": r["revision"], "values": {"customer": "過期覆蓋"}},
        ).status_code
        == 409
    )
    assert (
        client.get("/api/records", params={"customer": "人工客戶"}).json()["total"] == 1
    )
    word = docx("This is the existing translation.\nReference: P100")
    res = client.post(
        "/api/upload",
        data={"record_id": id, "role": "translation"},
        files=[("files", ("translation.docx", word))],
    )
    assert res.status_code == 200
    r = ready(client, id)
    assert len(r["files"]) == 2
    assert r["effective"]["doc_no"] == "P100"
    assert "existing translation" in str(r["pages"])
    assert client.post("/api/records/" + id + "/retry").status_code == 200
    r = ready(client, id)
    assert r["effective"]["customer"] == "人工客戶"
    assert r["review"] == "confirmed"


def test_links_chain_and_late_missing_document(client):
    a, _ = upload(client, LETTER)
    r = ready(client, a)
    assert not r["references"][0]["candidates"]
    b, _ = upload(
        client, LETTER.replace("P100", "S501").replace("S501 號函", "S400 號函")
    )
    ready(client, b)
    r = client.get("/api/records/" + a).json()
    assert r["references"][0]["candidates"][0]["id"] == b
    assert (
        client.post(
            "/api/records/" + a + "/links",
            json={"ref": "S501", "target": b, "status": "confirmed"},
        ).status_code
        == 200
    )
    d, _ = upload(client, LETTER.replace("P100", "P125").replace("S501", "P100"))
    ready(client, d)
    client.post(
        "/api/records/" + d + "/links",
        json={"ref": "P100", "target": a, "status": "confirmed"},
    )
    # Clear inferred topic to prove transitive links work independently.
    for id in [a, b, d]:
        r = client.get("/api/records/" + id).json()
        client.patch(
            "/api/records/" + id,
            json={"revision": r["revision"], "values": {"topic": ""}},
        )
    r = client.get("/api/records/" + b).json()
    assert len(r["timeline"]) == 3
    assert (
        client.post(
            "/api/records/" + b + "/links",
            json={"ref": "self", "target": b, "status": "confirmed"},
        ).status_code
        == 422
    )


def test_invalid_batch_is_atomic_and_protected(client, tmp_path):
    res = client.post(
        "/api/upload",
        files=[
            ("files", ("okay.pdf", pdf(LETTER))),
            ("files", ("fake.pdf", b"not pdf")),
        ],
    )
    assert res.status_code == 422
    assert client.get("/api/records").json()["total"] == 0
    assert list(client.app.state.store.root.joinpath("files").iterdir()) == []
    assert (
        client.post(
            "/api/upload",
            headers={"Origin": "https://evil.example"},
            files=[("files", ("x.pdf", pdf(LETTER)))],
        ).status_code
        == 403
    )
    assert client.get("/api/files/not-found").status_code == 404
    assert (
        client.post(
            "/api/upload",
            data={"role": "translation"},
            files=[("files", ("x.docx", docx("hello")))],
        ).status_code
        == 422
    )


def test_persistence_across_restart(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        id, _ = upload(c, LETTER)
        ready(c, id)
    with TestClient(create_app(tmp_path)) as c:
        assert c.get("/api/records/" + id).json()["effective"]["doc_no"] == "P100"


def test_authentication(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCSTORAGE_TOKEN", "test-private-token")
    with TestClient(create_app(tmp_path)) as c:
        assert c.get("/api/records").status_code == 401
        assert c.post("/api/login", json={"token": "wrong"}).status_code == 401
        assert (
            c.post("/api/login", json={"token": "test-private-token"}).status_code
            == 200
        )
        assert c.get("/api/records").status_code == 200


def test_real_scanned_pdf_ocr(client):
    if not os.environ.get("TESSDATA_PREFIX"):
        pytest.skip("local Chinese OCR data required")
    data = pdf(
        "發文單位：範例軌道公司\n文號：P987\n主旨：審查意見\n說明：復貴公司 S501 號函。",
        scan=True,
    )
    res = client.post("/api/upload", files=[("files", ("scan.pdf", data))])
    assert res.status_code == 200
    r = ready(client, res.json()["ids"][0])
    assert r["status"] == "ready", r["files"]
    text = str(r["pages"])
    assert "OCR" in text
    assert "P987" in text


def test_demo_idempotent(client):
    assert client.post("/api/demo").status_code == 200
    rows = client.get("/api/records").json()["items"]
    assert len(rows) == 4
    for r in rows:
        assert ready(client, r["id"])["status"] == "ready"
    client.post("/api/demo")
    assert client.get("/api/records").json()["total"] == 4


def test_verified_backup_restore_and_active_server_lock(tmp_path):
    from backup import backup, restore

    data = tmp_path / "data"
    archive = tmp_path / "archive"
    restored = tmp_path / "restored"
    with TestClient(create_app(data)) as c:
        id, raw = upload(c, LETTER)
        ready(c, id)
        with pytest.raises(BlockingIOError):
            backup(data, archive)
    backup(data, archive)
    restore(archive, restored)
    with TestClient(create_app(restored)) as c:
        r = c.get("/api/records/" + id).json()
        assert r["effective"]["doc_no"] == "P100"
        assert c.get("/api/files/" + r["files"][0]["id"]).content == raw
    with pytest.raises(ValueError):
        restore(archive, restored)
    (archive / "files" / (r["files"][0]["id"] + ".pdf")).write_bytes(b"corrupted")
    with pytest.raises(ValueError):
        restore(archive, tmp_path / "bad-restore")
