# siemens_docstorage：獨立文件關聯平台 Demo

本目錄是一個**獨立啟動、獨立資料庫、獨立檔案儲存**的系統，與儲存庫內的週會平台沒有執行時相依，也不共用資料。程式碼目前放在同一儲存庫，未來可單獨複製這個目錄到公司環境。根目錄的週會建置及既有靜態文件原型維持原樣；本 Demo 不會隨 GitHub Pages 發布。

## 本版可操作的流程

1. 上傳電子／掃描 PDF，背景擷取文字；掃描頁在本機執行繁體中文＋英文 OCR。
2. 提出公文／技術文件、客戶、收發文、文號、日期、主旨、文件編號、版次及業務分類建議，查看辨識依據並人工修改／確認。
3. 已翻譯的 Word `.docx` 可補到指定公文，與原文 PDF、附件一起保存及下載。平台**不翻譯文件、不翻譯主旨**。舊 `.doc` 需先另存為 `.docx`。
4. 辨識引用文號，顯示原句與頁碼。找不到公文時保留引用，日後補入可配對；多筆同文號時不擅自選取。確認或人工建立關聯後，可沿已確認連線展開完整歷程。
5. 同一技術文件編號可建議相同議題識別；也可人工指定／清空。時間軸同時顯示相同議題識別的文件，**並不表示相鄰兩封文已確認回覆關係**。引用需另外核對。
6. 搜尋公文、客戶、登錄欄位及 PDF／Word 全文；分類／客戶篩選、每頁 30 筆。清單每 5 秒更新；詳情按「更新」，不自動覆蓋正在輸入的表單。
7. 提供四封虛構公文作為可選範例，並非真實資料。承辦人與副本 CC 保留為後續討論，不在本版加入分工流程。

**分類能力範圍：本機文字擷取＋可解釋規則，不是語意 AI 模型。** 目前未取得代表性實際公文，尚未驗證各客戶不同寫法的準確率。OCR 可能誤讀；不確定的資料可留白並手動分類。此版適合先評估工作流程，再以核准的去識別樣本調整或引入公司核准的本機模型。

## 推薦啟動方式：Docker Compose

需要 Docker 與 Compose。在此目錄執行：

```sh
# 自行設定一組存取密碼，不要提交至 Git
export DOCSTORAGE_TOKEN='請換成你自己的長密碼'
docker compose up --build -d
```

在執行主機的瀏覽器開啟 `http://127.0.0.1:8080`。登入後可按「載入虛構範例」，或上傳測試檔。預設僅發布本機介面，沒有建立對外分享網址。

```sh
docker compose logs --tail=50
docker compose stop
# 重新啟動；使用原本的密碼，文件保留在 named volume
docker compose up -d
```

資料保存在 Compose 的 `documents` volume，與容器程式分離。`docker compose down` 不會刪除資料；**不要加 `--volumes`，否則會刪除 volume。** 首次建置需連網下載公開依賴與 OCR 工具；執行時不需要外部 OCR、AI 或 CDN。

受管理的雲端建置需保持現有代理與 CA 驗證；此 Dockerfile 支援 BuildKit secret `proxy_ca`。本次已使用系統 CA bundle 掛載建置，沒有關閉 TLS 驗證；不要把代理 CA 或憑證放進程式庫或映像層。

## 不使用 Docker：Linux／WSL＋Python 3.12

需要 Tesseract 5 及 `chi_tra`、`eng` 語言包；Ubuntu/Debian 對應 `tesseract-ocr tesseract-ocr-chi-tra tesseract-ocr-eng`。PDF 解析使用 PyMuPDF，不需要外部 PDF 服務。

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
# 明確指定資料位置，務必在 Git checkout 之外
export DOCSTORAGE_DATA_DIR=/你的私有資料目錄/siemens-docstorage
.venv/bin/python run.py
```

若 OCR 語言包在自訂位置，設定 `TESSDATA_PREFIX`，目錄內需有 `chi_tra.traineddata` 及 `eng.traineddata`。`OCR_LANGS` 預設 `chi_tra+eng`。

可設定：`PORT`（預設 8080）、`HOST`（預設 127.0.0.1）、`DOCSTORAGE_DATA_DIR`、`DOCSTORAGE_TOKEN`。對非本機介面監聽時，啟動程式強制要求存取密碼。本版是共用密碼 Demo，**尚未整合公司帳號、角色權限與操作稽核，不適合直接公開部署。** 公司正式版需反向代理／HTTPS、SSO、權限、備份、檔案保護與安全檢查。

本次雲端實測位置：程式 `/workspace/siemensintern/docstorage-platform`，Python `/workspace/.venvs/docstorage/bin/python`，資料 `/workspace/siemens-docstorage-data`，OCR 語言目錄 `/workspace/docstorage-tools/tessdata`。啟動：

```sh
cd /workspace/siemensintern/docstorage-platform
TESSDATA_PREFIX=/workspace/docstorage-tools/tessdata /workspace/.venvs/docstorage/bin/python run.py
```

## 架構與資料保護

- 前端：獨立 HTML/CSS/JavaScript，由後端同源提供，不依賴週會平台的 Vite 或瀏覽器資料庫。
- 後端：FastAPI；SQLite WAL、全文 trigram 索引、文號／議題索引；單一服務程序、單一持久化辨識佇列。
- 檔案：以伺服器產生的 UUID 儲存原始位元組，資料庫記錄名稱、用途與 SHA-256。資料庫只保存資訊、辨識文字與關係。
- 人工修改與系統建議分開保存；使用 revision 偵測過期編輯。重新辨識保留人工欄位。原檔、資料庫、備份不進 GitHub；本系統不呼叫外部辨識 API。
- 日期：保留期限原文；只有明確日期才建議填入。文到七日等相對期限**不推算**，實際收文日、日曆規則與承辦人／CC 日後再設計。
- 範圍：單檔 100 MB、PDF 最多 150 頁、每次 20 檔；不支援加密 PDF。辨識失敗仍保留原檔並可人工整理／重試。原檔與備份未加密，需使用公司核准的磁碟加密與存取控制。
- 未完成：Excel 匯入、完整審查意見附件內容的細部關聯、自訂分類體系、語意理解、公司帳號與稽核，以及十萬筆規模的效能驗證。SQLite 可供本次單機 Demo 使用；未來是否改 PostgreSQL／物件儲存需依 IT 環境與負載評估，不能視為已完成大規模正式部署。

## 搬移／備份與還原

先停止服務。`backup.py` 會取得服務鎖，拒絕在服務執行時製作備份；複製 SQLite 一致快照與原檔，校驗每份原檔並建立 SHA-256 manifest。還原會檢查 manifest，拒絕覆寫現有目錄。

```sh
python backup.py backup /原資料目錄 /私有備份目錄/backup-001
python backup.py restore /私有備份目錄/backup-001 /全新資料目錄
DOCSTORAGE_DATA_DIR=/全新資料目錄 python run.py
```

容器 volume 備份：先 `docker compose stop`，再用一次性容器掛載同一 volume 與公司核准的備份目錄，執行 `/app/backup.py`。依公司權限設定目錄可寫權限，容器使用 UID 10001。備份與還原後應再抽查登入、檔案下載及歷程，不能只複製程式碼。

## 驗證

```sh
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
# 後端已啟動；需 Node.js 與 Chromium
npm ci
PYTHON_BIN=.venv/bin/python npm run test:browser
```

瀏覽器測試會新增虛構資料、修改分類及補上測試翻譯，請用**獨立測試資料目錄**啟動服務；可設定 `DOCSTORAGE_URL`、`CHROMIUM_PATH`。

本次已驗證：9 項後端測試（含真實 raster 掃描件 OCR、翻譯配對、全文搜尋、關聯鏈、衝突、重啟保留、登入、備份還原及損毀拒絕）；兩個獨立瀏覽器共用更新、原檔下載、翻譯讀取、桌面／手機版與無外部請求；Docker 實際建置及容器內中文 OCR／登入／上傳流程。未驗證十萬筆效能、公司內網部署或公開網址。
