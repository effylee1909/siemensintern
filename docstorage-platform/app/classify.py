"""Explainable local extraction. All outputs are suggestions, never an LLM claim."""

import re
import unicodedata
from datetime import date

FIELDS = [
    "subject",
    "doc_no",
    "customer",
    "sender",
    "recipient",
    "date",
    "kind",
    "category",
    "direction",
    "document_no",
    "version",
    "topic",
    "due_date",
    "due_note",
]
CATEGORIES = ["提送文件", "審查意見", "回覆／補充", "一般往來", "技術文件", "待分類"]


def normalize(value):
    return re.sub(
        r"[\s：:字第號()（）\-－—]", "", unicodedata.normalize("NFKC", value or "")
    ).upper()


def field(text, labels):
    for label in labels:
        match = re.search(r"(?:^|\n)\s*" + label + r"\s*[:：]\s*([^\n]+)", text, re.I)
        if match:
            return match[1].strip()[:500]
    return ""


def date_value(text):
    match = re.search(
        r"(?:(?:中華)?民國\s*)?(\d{2,4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?",
        text,
    )
    if not match:
        return ""
    y, m, d = map(int, match.groups())
    if y < 1911:
        y += 1911
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return ""


# Full Chinese prefixes are preserved. Short Latin examples also support S501 / P100.
REF_PATTERN = re.compile(
    r"(?:[\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9（）()\-]{0,30}字\s*第?\s*\d{3,18}\s*號|\b[A-Z]{1,8}[-－]?\d{3,12}\b)",
    re.I,
)


def classify(pages, filename, settings):
    text = "\n".join(p["text"] for p in pages)
    m = {k: "" for k in FIELDS}
    evidence = []
    m["subject"] = field(text, ["主旨", "Subject", "Title"])
    m["doc_no"] = field(
        text,
        [
            "發文字號",
            "來文文號",
            "文號",
            r"Letter No\.?",
            r"Reference No\.?",
            r"Ref\.?",
        ],
    )
    m["sender"] = field(text, ["發文單位", "發文者", "寄件者", "From", "Sender"])
    if not m["sender"]:
        lines = [l.strip() for l in text.splitlines()[:10] if l.strip()]
        m["sender"] = next(
            (
                re.sub(r"\s*函\s*$", "", l)
                for l in lines
                if re.search(r"(公司|管理局|工程局|Corporation|Authority)", l, re.I)
                and not re.match(r"(受文|主旨|說明|Subject|To)", l, re.I)
            ),
            "",
        )
    m["recipient"] = field(text, ["受文者", "收文單位", "To", "Recipient"])
    m["date"] = date_value(field(text, ["發文日期", "來文日期", "日期", "Date"]))
    if not m["subject"]:
        m["subject"] = filename.rsplit(".", 1)[0]
    own = settings.get("own_names", [])
    sender_own = any(
        normalize(a) in normalize(m["sender"]) for a in own if a and m["sender"]
    )
    recipient_own = any(
        normalize(a) in normalize(m["recipient"]) for a in own if a and m["recipient"]
    )
    m["direction"] = "發文" if sender_own else "收文" if recipient_own else "待確認"
    partner = m["recipient"] if sender_own else m["sender"]
    aliases = settings.get("customers", [])
    hits = [
        c["name"]
        for c in aliases
        if any(
            normalize(a) in normalize(partner)
            for a in [c["name"], *c.get("aliases", [])]
            if a and partner
        )
    ]
    m["customer"] = hits[0] if len(hits) == 1 else partner
    if partner:
        evidence.append(
            {
                "field": "customer",
                "reason": f"依發受文欄位判斷：{partner}；需確認往來對象。",
            }
        )
    m["kind"] = (
        "公文"
        if m["doc_no"]
        or re.search(r"主旨\s*[:：]|受文者\s*[:：]|說明\s*[:：]|Dear\s", text, re.I)
        else (
            "技術文件"
            if re.search(
                r"文件編號|Document\s*(?:No|Number)|Revision|測試程序|技術規範",
                text,
                re.I,
            )
            else "待分類"
        )
    )
    subject = m["subject"]
    rules = [
        ("回覆／補充", r"回覆|補充|補件|回復|response|reply"),
        ("審查意見", r"審查意見|審查結果|review\s*(?:comments|results)"),
        ("提送文件", r"提送|送審|報核|submit|submission"),
    ]
    m["category"] = "技術文件" if m["kind"] == "技術文件" else "待分類"
    for category, pattern in rules:
        match = re.search(pattern, subject, re.I)
        if match:
            m["category"] = category
            evidence.append(
                {
                    "field": "category",
                    "reason": f"主旨含「{match[0]}」；規則分類，需人工核對。",
                }
            )
            break
    if m["category"] == "待分類" and m["kind"] == "公文":
        m["category"] = "一般往來"
    m["document_no"] = field(text, ["文件編號", r"Document No\.?", "Document Number"])
    m["version"] = field(text, ["版次", "Revision", r"Rev\.?"])
    if not m["version"]:
        match = re.search(
            r"\bRev(?:ision)?\.?\s*[:：]?\s*([A-Z0-9][A-Z0-9.\-]{0,12})\b", text, re.I
        )
        if match:
            m["version"] = match[1]
    m["topic"] = m["document_no"]
    for page in pages:
        for line in page["text"].splitlines():
            if re.search(
                r"期限|文到|回覆|回復|截止|以前|之前|限於|due|deadline|within",
                line,
                re.I,
            ):
                if re.search(
                    r"[\d一二三四五六七八九十百]+\s*(?:日|天|days)|期限|截止|deadline|due|\d+年\d+月\d+日",
                    line,
                    re.I,
                ):
                    m["due_note"] = line.strip()[:500]
                    deadline = re.search(
                        r"請於|應於|最遲|截止|期限|deadline|due|before|by\s", line, re.I
                    )
                    m["due_date"] = (
                        date_value(line[deadline.end() :]) if deadline else ""
                    )
                    evidence.append(
                        {
                            "field": "due_date",
                            "page": page["page"],
                            "reason": line.strip()[:500],
                        }
                    )
                    break
        if m["due_note"]:
            break
    refs = []
    for page in pages:
        for line in page["text"].splitlines():
            if re.search(
                r"復|依據|依貴|回覆|回復|參照|reference|reply|response|pursuant",
                line,
                re.I,
            ):
                for match in REF_PATTERN.finditer(line):
                    number = match[0].strip()
                    if normalize(number) != normalize(m["doc_no"]) and not any(
                        normalize(r["number"]) == normalize(number) for r in refs
                    ):
                        refs.append(
                            {
                                "number": number,
                                "page": page["page"],
                                "quote": line.strip()[:1000],
                                "relation": "引用（待確認是否回覆）",
                            }
                        )
    for k in ["doc_no", "sender", "recipient", "date", "document_no", "version"]:
        if m[k]:
            evidence.append({"field": k, "reason": f"文件欄位擷取：{m[k]}"})
    return {
        "metadata": m,
        "evidence": evidence,
        "references": refs,
        "engine": "本機文字擷取＋規則分類 v1（非語意模型）",
    }
