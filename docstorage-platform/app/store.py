import json
import sqlite3
from pathlib import Path
from .classify import normalize

DEFAULT_SETTINGS = {"own_names": ["西門子", "Siemens"], "customers": []}


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "files").mkdir(exist_ok=True)
        with self.connect() as db:
            db.executescript(
                """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, created TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', manual TEXT NOT NULL DEFAULT '{}', analysis TEXT NOT NULL DEFAULT '{}', review TEXT NOT NULL DEFAULT 'pending', revision INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), name TEXT NOT NULL, role TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, extension TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', error TEXT NOT NULL DEFAULT '', pages TEXT NOT NULL DEFAULT '[]');
            CREATE INDEX IF NOT EXISTS files_record ON files(record_id);
            CREATE TABLE IF NOT EXISTS links(source TEXT NOT NULL REFERENCES records(id), ref TEXT NOT NULL, target TEXT REFERENCES records(id), status TEXT NOT NULL, PRIMARY KEY(source,ref));
            CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
            CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(record_id UNINDEXED, body, tokenize='trigram');
            PRAGMA user_version=1;
            """
            )
            columns = {r[1] for r in db.execute("PRAGMA table_info(records)")}
            for col in ["doc_key", "topic_key"]:
                if col not in columns:
                    db.execute(
                        f"ALTER TABLE records ADD COLUMN {col} TEXT NOT NULL DEFAULT ''"
                    )
            db.execute("CREATE INDEX IF NOT EXISTS records_doc_key ON records(doc_key)")
            db.execute(
                "CREATE INDEX IF NOT EXISTS records_topic_key ON records(topic_key)"
            )
            db.execute(
                "INSERT OR IGNORE INTO settings VALUES(1,?)",
                (json.dumps(DEFAULT_SETTINGS, ensure_ascii=False),),
            )
            for row in db.execute(
                "SELECT id FROM records WHERE doc_key='' AND json_extract(metadata,'$.doc_no')!=''"
            ).fetchall():
                self.reindex(row[0], db)

    def connect(self):
        db = sqlite3.connect(self.root / "metadata.sqlite3", timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def settings(self):
        with self.connect() as db:
            return json.loads(
                db.execute("SELECT value FROM settings WHERE id=1").fetchone()[0]
            )

    def record(self, id, db=None):
        if db is None:
            with self.connect() as c:
                return self.record(id, c)
        row = db.execute("SELECT * FROM records WHERE id=?", (id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        for k in ["metadata", "manual", "analysis"]:
            d[k] = json.loads(d[k])
        d["effective"] = {**d["metadata"], **d["manual"]}
        d["files"] = [
            {k: v for k, v in dict(f).items() if k != "pages"}
            for f in db.execute(
                "SELECT * FROM files WHERE record_id=? ORDER BY rowid", (id,)
            )
        ]
        d["status"] = (
            "processing"
            if any(f["status"] in ["queued", "processing"] for f in d["files"])
            else (
                "error"
                if any(
                    f["status"] == "error" and f["role"] == "original"
                    for f in d["files"]
                )
                else "ready"
            )
        )
        return d

    def reindex(self, id, db):
        r = self.record(id, db)
        db.execute(
            "UPDATE records SET doc_key=?,topic_key=? WHERE id=?",
            (
                normalize(r["effective"].get("doc_no")),
                r["effective"].get("topic", ""),
                id,
            ),
        )
        pages = " ".join(
            " ".join(p["text"] for p in json.loads(f[0]))
            for f in db.execute("SELECT pages FROM files WHERE record_id=?", (id,))
        )
        body = " ".join(str(v) for v in r["effective"].values()) + " " + pages
        db.execute("DELETE FROM search WHERE record_id=?", (id,))
        db.execute("INSERT INTO search(record_id,body) VALUES(?,?)", (id, body))

    def references(self, id):
        r = self.record(id)
        refs = r["analysis"].get("references", [])
        with self.connect() as db:
            others = []
            keys = list({normalize(ref["number"]) for ref in refs})
            if keys:
                marks = ",".join("?" for _ in keys)
                others = [
                    self.record(row[0], db)
                    for row in db.execute(
                        f"SELECT id FROM records WHERE doc_key IN ({marks})", keys
                    )
                ]
            links = {
                l["ref"]: dict(l)
                for l in db.execute("SELECT * FROM links WHERE source=?", (id,))
            }
        out = []
        for ref in refs:
            key = normalize(ref["number"])
            saved = links.pop(key, None)
            candidates = [
                {
                    "id": o["id"],
                    "subject": o["effective"].get("subject", ""),
                    "customer": o["effective"].get("customer", ""),
                }
                for o in others
                if o["id"] != id and normalize(o["effective"].get("doc_no")) == key
            ]
            out.append(
                {
                    **ref,
                    "key": key,
                    "candidates": candidates,
                    "status": saved["status"] if saved else "pending",
                    "target": saved["target"] if saved else None,
                }
            )
        for key, l in links.items():
            out.append(
                {
                    "number": key,
                    "key": key,
                    "quote": "人工建立的關聯",
                    "page": None,
                    "candidates": [],
                    "status": l["status"],
                    "target": l["target"],
                }
            )
        return out
