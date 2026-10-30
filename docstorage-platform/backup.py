"""Offline verified backup/restore: stop service first. Never stores secrets."""

import argparse
import fcntl
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path


def checksums(root):
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
        and p.name not in ["manifest.json", ".server.lock"]
        and not p.name.endswith(("-wal", "-shm"))
    }


def backup(source, target):
    source = Path(source).resolve()
    target = Path(target).resolve()
    if not (source / "metadata.sqlite3").is_file():
        raise ValueError("來源缺少資料庫")
    if target == source or source in target.parents:
        raise ValueError("備份位置必須在資料目錄之外")
    if target.exists():
        raise ValueError("目標已存在，拒絕覆寫")
    with (source / ".server.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        target.mkdir(parents=True)
        try:
            with sqlite3.connect(source / "metadata.sqlite3") as db, sqlite3.connect(
                target / "metadata.sqlite3"
            ) as dest:
                db.backup(dest)
            shutil.copytree(source / "files", target / "files")
            with sqlite3.connect(target / "metadata.sqlite3") as db:
                assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                for id, ext, sha in db.execute("SELECT id,extension,sha256 FROM files"):
                    if (
                        hashlib.sha256(
                            (target / "files" / (id + ext)).read_bytes()
                        ).hexdigest()
                        != sha
                    ):
                        raise ValueError("原檔校驗失敗")
            (target / "manifest.json").write_text(
                json.dumps(
                    {"format": "siemens_docstorage_v1", "sha256": checksums(target)},
                    indent=2,
                ),
                encoding="utf-8",
            )
        except Exception:
            shutil.rmtree(target)
            raise


def restore(source, target):
    source = Path(source).resolve()
    target = Path(target).resolve()
    if target.exists():
        raise ValueError("還原目標必須不存在，避免覆蓋既有資料")
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format") != "siemens_docstorage_v1" or manifest[
        "sha256"
    ] != checksums(source):
        raise ValueError("備份內容校驗失敗")
    shutil.copytree(source, target)
    (target / "manifest.json").unlink()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("operation", choices=["backup", "restore"])
    p.add_argument("source")
    p.add_argument("target")
    args = p.parse_args()
    try:
        (backup if args.operation == "backup" else restore)(args.source, args.target)
        print("完成：資料庫、原檔與校驗驗證")
    except Exception as e:
        raise SystemExit(f"作業未完成：{e}")
