import os
import uvicorn
from app.server import create_app

if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    if host not in ["127.0.0.1", "localhost", "::1"] and not os.environ.get(
        "DOCSTORAGE_TOKEN"
    ):
        raise SystemExit(
            "對外監聽需設定 DOCSTORAGE_TOKEN；正式部署另需 HTTPS 與公司權限整合。"
        )
    uvicorn.run(
        create_app(),
        host=host,
        port=int(os.environ.get("PORT", "8080")),
        access_log=False,
    )
