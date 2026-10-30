import asyncio
import fcntl
import hashlib
import hmac
import json
import os
import secrets
import shutil
import sqlite3
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .store import Store
from .classify import classify, normalize, FIELDS, CATEGORIES
from .extract import extract

STATIC = Path(__file__).parent / "static"
DEFAULT_DATA = Path(__file__).resolve().parent.parent.parent.parent / "siemens-docstorage-data"
MAX_FILE = 100 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid.uuid4().hex


class Edit(BaseModel):
    revision: int
    values: dict[str, str]
    confirm: bool = False


class Link(BaseModel):
    ref: str = Field(min_length=1, max_length=100)
    target: str | None = None
    status: str


class Settings(BaseModel):
    own_names: list[str] = Field(max_length=100)
    customers: list[dict] = Field(max_length=1000)


def create_app(data_dir=None):
    store = Store(data_dir or os.environ.get("DOCSTORAGE_DATA_DIR", DEFAULT_DATA))
    stop = threading.Event()
    session = secrets.token_urlsafe(32)
    token = os.environ.get("DOCSTORAGE_TOKEN", "")

    def worker():
        while not stop.is_set():
            with store.connect() as db:
                file = db.execute(
                    "SELECT * FROM files WHERE status='queued' ORDER BY rowid LIMIT 1"
                ).fetchone()
                if file:
                    db.execute(
                        "UPDATE files SET status='processing' WHERE id=?", (file["id"],)
                    )
            if not file:
                stop.wait(0.3)
                continue
            try:
                pages = extract(
                    store.root / "files" / (file["id"] + file["extension"]),
                    file["name"],
                )
                analysis = classify(pages, file["name"], store.settings())
                with store.connect() as db:
                    db.execute(
                        "UPDATE files SET status='done',pages=?,error='' WHERE id=?",
                        (json.dumps(pages, ensure_ascii=False), file["id"]),
                    )
                    if file["role"] == "original":
                        db.execute(
                            "UPDATE records SET metadata=?,analysis=?,revision=revision+1 WHERE id=?",
                            (
                                json.dumps(analysis["metadata"], ensure_ascii=False),
                                json.dumps(analysis, ensure_ascii=False),
                                file["record_id"],
                            ),
                        )
                    store.reindex(file["record_id"], db)
            except Exception as e:
                # Never send document content or local filesystem paths in errors.
                message = (
                    str(e)
                    if isinstance(e, ValueError)
                    else "辨識工具執行失敗，請檢查 PDF／Word 格式與本機 OCR 安裝"
                )
                with store.connect() as db:
                    db.execute(
                        "UPDATE files SET status='error',error=? WHERE id=?",
                        (message[:500], file["id"]),
                    )

    @asynccontextmanager
    async def lifespan(app):
        lock = (store.root / ".server.lock").open("a")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("同一資料目錄僅允許一個服務程序，或備份作業進行中")
        with store.connect() as db:
            db.execute("UPDATE files SET status='queued' WHERE status='processing'")
        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        try:
            yield
        finally:
            stop.set()
            await asyncio.to_thread(thread.join)
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()

    app = FastAPI(
        title="siemens_docstorage", lifespan=lifespan, docs_url=None, redoc_url=None
    )
    app.state.store = store

    @app.middleware("http")
    async def protect(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            if request.method not in ["GET", "HEAD"]:
                origin = request.headers.get("origin")
                if origin and urlsplit(origin).netloc != request.headers.get("host"):
                    return JSONResponse({"detail": "不允許跨網站操作"}, 403)
            if (
                token
                and request.url.path not in ["/api/login", "/api/health"]
                and not hmac.compare_digest(
                    request.cookies.get("docstorage_session", ""), session
                )
            ):
                return JSONResponse({"detail": "請先登入"}, 401)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        )
        return response

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "name": "siemens_docstorage",
            "auth_required": bool(token),
            "engine": "本機規則分類 v1",
            "storage": "SQLite＋伺服器檔案儲存",
        }

    @app.post("/api/login")
    async def login(request: Request):
        body = await request.json()
        if not token or not hmac.compare_digest(str(body.get("token", "")), token):
            raise HTTPException(401, "登入資訊錯誤")
        response = JSONResponse({"ok": True})
        response.set_cookie(
            "docstorage_session",
            session,
            httponly=True,
            samesite="strict",
            secure=request.url.scheme == "https",
        )
        return response

    @app.get("/api/settings")
    def settings():
        return store.settings()

    @app.put("/api/settings")
    def put_settings(value: Settings):
        clean = {
            "own_names": [x.strip()[:100] for x in value.own_names if x.strip()],
            "customers": [],
        }
        for c in value.customers:
            if (
                not isinstance(c.get("name"), str)
                or not isinstance(c.get("aliases", []), list)
                or not all(isinstance(a, str) for a in c.get("aliases", []))
            ):
                raise HTTPException(422, "客戶名稱／別名格式錯誤")
            clean["customers"].append(
                {
                    "name": c["name"][:200],
                    "aliases": [a[:200] for a in c.get("aliases", [])],
                }
            )
        with store.connect() as db:
            db.execute(
                "UPDATE settings SET value=? WHERE id=1",
                (json.dumps(clean, ensure_ascii=False),),
            )
        return clean

    @app.get("/api/records")
    def records(
        q: str = "",
        customer: str = "",
        category: str = "",
        review: str = "",
        kind: str = "",
        page: int = 1,
    ):
        page = max(1, page)
        where = []
        args = []
        if q:
            if len(q) >= 3:
                where.append(
                    "id IN (SELECT record_id FROM search WHERE search MATCH ?)"
                )
                args.append('"' + q.replace('"', '""') + '"')
            else:
                where.append(
                    "id IN (SELECT record_id FROM search WHERE body LIKE ? ESCAPE '\\')"
                )
                args.append(
                    "%"
                    + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                    + "%"
                )
        condition = " WHERE " + " AND ".join(where) if where else ""
        with store.connect() as db:
            # JSON overrides are respected by filters; paginate on the server.
            for field, value in [
                ("customer", customer),
                ("category", category),
                ("kind", kind),
            ]:
                if value:
                    where.append(
                        f"COALESCE(json_extract(manual,'$.{field}'),json_extract(metadata,'$.{field}'),'')=?"
                    )
                    args.append(value)
            if review == "pending":
                where.append("review='pending'")
            condition = " WHERE " + " AND ".join(where) if where else ""
            total = db.execute(
                "SELECT count(*) FROM records" + condition, args
            ).fetchone()[0]
            ids = db.execute(
                "SELECT id FROM records"
                + condition
                + " ORDER BY created DESC LIMIT 30 OFFSET ?",
                [*args, (page - 1) * 30],
            ).fetchall()
            items = [store.record(r[0], db) for r in ids]
            all_rows = db.execute(
                "SELECT metadata,manual,review FROM records"
            ).fetchall()
            customers = sorted(
                {
                    ({**json.loads(r[0]), **json.loads(r[1])}).get("customer", "")
                    for r in all_rows
                }
                - {""}
            )
            stats = {
                "total": len(all_rows),
                "pending": sum(r[2] == "pending" for r in all_rows),
                "processing": db.execute(
                    "SELECT count(DISTINCT record_id) FROM files WHERE status IN ('queued','processing')"
                ).fetchone()[0],
                "bytes": db.execute(
                    "SELECT coalesce(sum(size),0) FROM files"
                ).fetchone()[0],
            }
        return {
            "items": items,
            "total": total,
            "page": page,
            "customers": customers,
            "stats": stats,
        }

    def required(id):
        r = store.record(id)
        if not r:
            raise HTTPException(404, "找不到文件")
        return r

    @app.get("/api/records/{id}")
    def detail(id):
        r = required(id)
        r["references"] = store.references(id)
        with store.connect() as db:
            r["pages"] = [
                {
                    "file_id": f["id"],
                    "name": f["name"],
                    "role": f["role"],
                    "pages": json.loads(f["pages"]),
                }
                for f in db.execute("SELECT * FROM files WHERE record_id=?", (id,))
            ]
            # Only confirmed links and explicitly assigned topics form the timeline.
            edges = [
                dict(x)
                for x in db.execute("SELECT * FROM links WHERE status='confirmed'")
            ]
            nodes = {id}
            topic = r["effective"].get("topic", "")
            if topic:
                for row in db.execute(
                    "SELECT id FROM records WHERE topic_key=?", (topic,)
                ):
                    nodes.add(row[0])
            changed = True
            while changed:
                changed = False
                for edge in edges:
                    if edge["source"] in nodes or edge["target"] in nodes:
                        before = len(nodes)
                        nodes.update([edge["source"], edge["target"]])
                        changed |= len(nodes) > before
            r["timeline"] = sorted(
                [store.record(n, db) for n in nodes],
                key=lambda x: x["effective"].get("date") or x["created"],
            )
            r["edges"] = [
                e for e in edges if e["source"] in nodes and e["target"] in nodes
            ]
        return r

    @app.patch("/api/records/{id}")
    def edit(id, value: Edit):
        required(id)
        if any(k not in FIELDS or len(v) > 2000 for k, v in value.values.items()):
            raise HTTPException(422, "欄位或內容長度不正確")
        if value.values.get("category") and value.values["category"] not in CATEGORIES:
            raise HTTPException(422, "分類不正確")
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            r = store.record(id, db)
            if r["revision"] != value.revision:
                raise HTTPException(
                    409, "另一位使用者或辨識程序已更新此文件，請重新載入後再編輯"
                )
            manual = {**r["manual"], **value.values}
            db.execute(
                "UPDATE records SET manual=?,review=?,revision=revision+1 WHERE id=?",
                (
                    json.dumps(manual, ensure_ascii=False),
                    "confirmed" if value.confirm else "pending",
                    id,
                ),
            )
            store.reindex(id, db)
        return required(id)

    @app.post("/api/records/{id}/links")
    def link(id, value: Link):
        required(id)
        if value.status not in ["confirmed", "dismissed"]:
            raise HTTPException(422, "關聯狀態錯誤")
        if value.status == "confirmed":
            if not value.target or value.target == id:
                raise HTTPException(422, "請選擇其他公文")
            required(value.target)
        with store.connect() as db:
            db.execute(
                "INSERT INTO links(source,ref,target,status) VALUES(?,?,?,?) ON CONFLICT(source,ref) DO UPDATE SET target=excluded.target,status=excluded.status",
                (id, normalize(value.ref), value.target, value.status),
            )
        return {"ok": True}

    @app.post("/api/records/{id}/retry")
    def retry(id):
        required(id)
        with store.connect() as db:
            if db.execute(
                "SELECT 1 FROM files WHERE record_id=? AND status IN ('queued','processing')",
                (id,),
            ).fetchone():
                raise HTTPException(409, "文件仍在處理中")
            db.execute(
                "UPDATE files SET status='queued',error='' WHERE record_id=?", (id,)
            )
        return {"ok": True}

    @app.get("/api/files/{id}")
    def file_download(id, inline: bool = False):
        with store.connect() as db:
            f = db.execute("SELECT * FROM files WHERE id=?", (id,)).fetchone()
        if not f:
            raise HTTPException(404, "找不到檔案")
        return FileResponse(
            store.root / "files" / (id + f["extension"]),
            filename=f["name"],
            media_type=(
                "application/pdf"
                if f["extension"] == ".pdf"
                else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
            content_disposition_type=(
                "inline" if inline and f["extension"] == ".pdf" else "attachment"
            ),
        )

    @app.post("/api/upload")
    async def upload(
        files: list[UploadFile] = File(...),
        record_id: str = Form(""),
        role: str = Form("original"),
    ):
        if len(files) > 20:
            raise HTTPException(422, "一次最多 20 個檔案")
        if role not in ["original", "translation", "attachment"]:
            raise HTTPException(422, "檔案用途不正確")
        if record_id:
            if role == "original" and len(files) != 1:
                raise HTTPException(422, "每筆紀錄僅能有一份原文")
            r = required(record_id)
            if role == "original" and any(f["role"] == "original" for f in r["files"]):
                raise HTTPException(
                    422, "已有原文，請以附件上傳，或為另一封公文新增紀錄"
                )
        elif role != "original":
            raise HTTPException(422, "翻譯與附件請先選擇所屬公文")
        staged = []
        created = []
        try:
            for file in files:
                name = Path((file.filename or "").replace("\\", "/")).name[:240]
                ext = Path(name).suffix.lower()
                if ext not in [".pdf", ".docx"]:
                    raise HTTPException(
                        422, "僅接受 PDF 與已翻譯的 Word .docx；舊 .doc 請另存為 .docx"
                    )
                fid = uid()
                path = store.root / "files" / (fid + ext)
                created.append(path)
                size = 0
                sha = hashlib.sha256()
                with path.open("xb") as out:
                    while chunk := await file.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_FILE:
                            raise HTTPException(413, "單檔上限 100 MB")
                        sha.update(chunk)
                        out.write(chunk)
                if not size:
                    raise HTTPException(422, "檔案為空")
                # Validate basic file signature, not just the extension.
                with path.open("rb") as check:
                    signature = check.read(5)
                if (ext == ".pdf" and signature != b"%PDF-") or (
                    ext == ".docx" and signature[:2] != b"PK"
                ):
                    raise HTTPException(422, "檔案內容與副檔名不符")
                staged.append((fid, name, ext, size, sha.hexdigest()))
            ids = []
            with store.connect() as db:
                for fid, name, ext, size, sha in staged:
                    rid = record_id or uid()
                    if not record_id:
                        db.execute(
                            "INSERT INTO records(id,created,metadata) VALUES(?,?,?)",
                            (
                                rid,
                                now(),
                                json.dumps(
                                    {
                                        "subject": Path(name).stem,
                                        "kind": "待分類",
                                        "category": "待分類",
                                    },
                                    ensure_ascii=False,
                                ),
                            ),
                        )
                    db.execute(
                        "INSERT INTO files(id,record_id,name,role,size,sha256,extension) VALUES(?,?,?,?,?,?,?)",
                        (fid, rid, name, role, size, sha, ext),
                    )
                    store.reindex(rid, db)
                    ids.append(rid)
            return {
                "ids": list(dict.fromkeys(ids)),
                "message": "原檔已保存，正在本機排隊辨識",
            }
        except Exception:
            for path in created:
                path.unlink(missing_ok=True)
            raise
        finally:
            for f in files:
                await f.close()

    @app.post("/api/demo")
    def demo():
        import pymupdf

        samples = [
            (
                "S501",
                "西門子股份有限公司",
                "範例軌道公司",
                "2026/08/01",
                "提送軌旁設備測試程序 Rev. A",
                "檢附測試程序，請惠予審查。",
                "A",
            ),
            (
                "P100",
                "範例軌道公司",
                "西門子股份有限公司",
                "2026/08/15",
                "軌旁設備測試程序審查意見",
                "復貴公司 S501 號函，請於文到七日內回覆。",
                "A",
            ),
            (
                "S530",
                "西門子股份有限公司",
                "範例軌道公司",
                "2026/09/01",
                "回覆審查意見並提送 Rev. B",
                "依貴公司 P100 號函辦理。",
                "B",
            ),
            (
                "P125",
                "範例軌道公司",
                "西門子股份有限公司",
                "2026/09/18",
                "軌旁設備測試程序再次審查意見",
                "復貴公司 S530 號函，請於 2026年10月15日以前回覆。",
                "B",
            ),
        ]
        with store.connect() as db:
            if db.execute("SELECT 1 FROM records WHERE id LIKE 'demo-%'").fetchone():
                return {"message": "虛構範例已存在，不重複建立。"}
            for no, sender, recipient, date, subject, note, version in samples:
                rid = "demo-" + uid()
                fid = uid()
                path = store.root / "files" / (fid + ".pdf")
                pdf = pymupdf.open()
                p = pdf.new_page()
                p.insert_text(
                    (50, 60),
                    "虛構示範資料 — 非真實公文",
                    fontname="china-t",
                    fontsize=16,
                )
                text = f"發文單位：{sender}\n受文者：{recipient}\n文號：{no}\n發文日期：{date}\n主旨：{subject}\n說明：{note}\n文件編號：SIG-TP-001\n版次：{version}"
                p.insert_text((50, 105), text, fontname="china-t", fontsize=12)
                pdf.save(path)
                pdf.close()
                db.execute(
                    "INSERT INTO records(id,created,metadata) VALUES(?,?,?)",
                    (
                        rid,
                        now(),
                        json.dumps(
                            {"subject": subject, "doc_no": no}, ensure_ascii=False
                        ),
                    ),
                )
                db.execute(
                    "INSERT INTO files(id,record_id,name,role,size,sha256,extension) VALUES(?,?,?,?,?,?,?)",
                    (
                        fid,
                        rid,
                        no + ".pdf",
                        "original",
                        path.stat().st_size,
                        hashlib.sha256(path.read_bytes()).hexdigest(),
                        ".pdf",
                    ),
                )
                store.reindex(rid, db)
        return {"message": "已建立 4 封虛構公文，稍後可查看分類與引用建議。"}

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app
