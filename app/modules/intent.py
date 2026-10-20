"""FR-INT-001..009 [A]: klasifikasi taksonomi tertutup, multi-intent, klarifikasi max 2,
ambang 0.75/0.45, konteks slot+ringkasan, sentimen/urgensi, kerentanan, kontak berulang.
TRD §4.5: dua tahap disederhanakan jadi rule terkalibrasi + validasi enum (BR-INT-01)."""
from __future__ import annotations
from ..core.ids import new_id
from ..core import audit as audit_svc

TAXONOMY = ["INFO_PRODUCT_POLICY", "INFO_ACCOUNT_BALANCE", "INFO_TRANSACTION_HISTORY",
            "INFO_CASE_STATUS", "REQ_STATEMENT_DOCUMENT", "REQ_CARD_BLOCK",
            "REQ_CARD_REPLACEMENT", "REQ_LIMIT_CHANGE", "REQ_PROFILE_UPDATE",
            "CMP_TRANSACTION_DISPUTE", "CMP_SERVICE_FAILURE", "CMP_STAFF_CONDUCT",
            "CMP_FRAUD_SUSPICION", "GEN_SMALL_TALK_OTHER"]
CATEGORY = {"INFO_PRODUCT_POLICY": "INQUIRY", "INFO_ACCOUNT_BALANCE": "INQUIRY",
            "INFO_TRANSACTION_HISTORY": "INQUIRY", "INFO_CASE_STATUS": "INQUIRY",
            "REQ_STATEMENT_DOCUMENT": "REQUEST", "REQ_CARD_BLOCK": "REQUEST",
            "REQ_CARD_REPLACEMENT": "REQUEST", "REQ_LIMIT_CHANGE": "REQUEST",
            "REQ_PROFILE_UPDATE": "REQUEST", "CMP_TRANSACTION_DISPUTE": "COMPLAINT",
            "CMP_SERVICE_FAILURE": "COMPLAINT", "CMP_STAFF_CONDUCT": "COMPLAINT",
            "CMP_FRAUD_SUSPICION": "COMPLAINT", "GEN_SMALL_TALK_OTHER": "INQUIRY"}
MANDATORY_HANDOFF = {"CMP_FRAUD_SUSPICION", "CMP_STAFF_CONDUCT"}
ACT_T, CLAR_FLOOR = 0.75, 0.45

KEYWORDS = {
    # Include the exact supported seed-article topic as a phrase. A single
    # broad token ("biaya") otherwise stays in CLARIFY despite a clear query.
    "INFO_PRODUCT_POLICY": ["biaya", "biaya transfer", "transfer internasional", "fee", "bunga", "syarat", "ketentuan", "policy", "tarif"],
    "INFO_ACCOUNT_BALANCE": ["saldo", "balance", "dana tersedia", "sisa uang"],
    "INFO_TRANSACTION_HISTORY": ["transaksi", "mutasi", "riwayat", "history", "transaction"],
    "INFO_CASE_STATUS": ["status", "tiket", "kasus", "referensi", "reference", "laporan saya"],
    "REQ_STATEMENT_DOCUMENT": ["rekening koran", "statement", "surat", "sertifikat", "dokumen"],
    "REQ_CARD_BLOCK": ["blokir", "block", "hilang", "dicuri", "kartu hilang"],
    "REQ_CARD_REPLACEMENT": ["ganti kartu", "replacement", "kartu baru", "penggantian kartu"],
    "REQ_LIMIT_CHANGE": ["limit", "batas", "naikkan limit", "ubah limit"],
    "REQ_PROFILE_UPDATE": ["alamat", "address", "update profil", "ubah data", "nomor hp", "email baru"],
    "CMP_TRANSACTION_DISPUTE": ["tidak kenal", "tidak merasa", "dispute", "sengketa", "salah debet", "ditolak", "gagal transfer"],
    "CMP_SERVICE_FAILURE": ["gagal", "error", "tidak bisa", "lemot", "gangguan", "rusak"],
    "CMP_STAFF_CONDUCT": ["petugas kasar", "staff", "cs jutek", "pelayanan buruk", "komplain petugas"],
    "CMP_FRAUD_SUSPICION": ["penipuan", "fraud", "dipaksa", "ditipu", "scam", "phising", "phishing"],
    "GEN_SMALL_TALK_OTHER": ["halo", "hai", "pagi", "siang", "terima kasih", "thanks", "hello"],
}
_contexts: dict[str, dict] = {}
_repeat: dict[str, int] = {}

def _score(text: str, words: list[str]) -> float:
    t = text.lower()
    hits = sum(1 for w in words if w in t)
    if not hits: return 0.0
    return min(0.95, 0.55 + 0.15 * hits)

def sentiment(text: str) -> tuple[str, str]:
    t = text.lower()
    very_neg = ["kecewa berat", "marah", "benci", "parah", "ancam", "lapor polisi", "viral"]
    neg = ["kecewa", "kesal", "lama", "buruk", "gagal", "bodoh"]
    if any(w in t for w in very_neg): s = "very_negative"
    elif any(w in t for w in neg): s = "negative"
    elif any(w in t for w in ["terima kasih", "bagus", "puas", "thanks"]): s = "positive"
    else: s = "neutral"
    urg = "high" if any(w in t for w in ["segera", "urgent", "darurat", "sekarang", "dipaksa"]) else ("medium" if s in ("negative", "very_negative") else "low")
    return s, urg

def vulnerability(text: str) -> tuple[bool, bool, str | None]:
    t = text.lower()
    if any(w in t for w in ["dipaksa", "diancam", "disandera", "bunuh", "menyakiti diri", "self-harm"]):
        return True, True, "SAFETY"
    if any(w in t for w in ["dipaksa transfer", "ditipu", "pinjol", "tidak makan", "phk", "bangkrut"]):
        return True, False, "VULNERABILITY"
    return False, False, None

def classify(text: str, conversation_id: str, corr: str = "COR-?") -> dict:
    """Mengembalikan intent primer + sekunder, confidence, decision ACT/CLARIFY/HANDOFF."""
    scores = {k: _score(text, v) for k, v in KEYWORDS.items()}
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    top, top_c = ranked[0]
    second, second_c = ranked[1]
    # di luar taksonomi
    if top_c < 0.30:
        res = {"intent_code": "OTHER_UNCLASSIFIED", "category": "INQUIRY", "confidence": 0.30,
               "decision": "HANDOFF", "entities": {}, "multi": []}
    else:
        # hampir-seri dalam 0.10 -> paksa klarifikasi (TRD §4.5)
        near_tie = (top_c - second_c) < 0.10 and second_c >= 0.45
        if top in MANDATORY_HANDOFF:
            dec = "HANDOFF"
        elif top == "GEN_SMALL_TALK_OTHER" and top_c >= CLAR_FLOOR:
            dec = "ACT"
        elif near_tie:
            dec = "CLARIFY"
        elif top_c >= ACT_T: dec = "ACT"
        elif top_c >= CLAR_FLOOR: dec = "CLARIFY"
        else: dec = "HANDOFF"
        multi = []
        if second_c >= ACT_T and second != top:
            multi = [{"intent_code": second, "confidence": second_c}]
        res = {"intent_code": top, "category": CATEGORY[top], "confidence": round(top_c, 3),
               "decision": dec, "entities": _slots(text), "multi": multi}
    # klarifikasi count max 2
    ctx = _contexts.setdefault(conversation_id, {"clarification_count": 0, "slots": {}, "summary": ""})
    if res["decision"] == "CLARIFY":
        if ctx["clarification_count"] >= 2:
            res["decision"] = "HANDOFF"; res["handoff_reason"] = "LOW_CONFIDENCE"
    s, urg = sentiment(text)
    vuln, safety, sig = vulnerability(text)
    if vuln or safety:
        res["decision"] = "HANDOFF"; res["handoff_reason"] = "VULNERABILITY"
        res["vulnerability_flag"] = True
    res.update({"sentiment": s, "urgency": urg, "safety_flag": safety})
    # kontak berulang: hitung per (customer,intent) sederhana via conversation prefix
    key = f"{conversation_id}:{res['intent_code']}"
    _repeat[key] = _repeat.get(key, 0) + 1
    if _repeat[key] >= 3:
        res["decision"] = "HANDOFF"; res["handoff_reason"] = "REPEAT_CONTACT"
    audit_svc.emit("TNT-TEST", corr, "SYSTEM", "intent-svc", "intent.classified",
                   "message", conversation_id, "intent-svc", conversation_id=conversation_id,
                   after={"intent": res["intent_code"], "conf": res["confidence"], "decision": res["decision"]})
    return res

def _slots(text: str) -> dict:
    import re
    t = text.lower()
    out = {}
    m = re.search(r"(\d{4})(?!.*\d)", text)
    if m: out["card_last4"] = m.group(1)
    m2 = re.search(r"(trx|ref)[-:\s]*([\w-]+)", t)
    if m2: out["reference"] = m2.group(2)
    if "besok" in t: out["date_hint"] = "tomorrow"
    return out

def update_context(conversation_id: str, text: str, cls: dict) -> dict:
    ctx = _contexts.setdefault(conversation_id, {"clarification_count": 0, "slots": {}, "summary": ""})
    if cls["decision"] == "CLARIFY":
        ctx["clarification_count"] += 1
    else:
        ctx["clarification_count"] = 0
    ctx["slots"].update(cls.get("entities", {}))
    # ringkasan bergulir: tanpa fakta baru (BR-INT-08) — potong 300 char
    ctx["summary"] = (ctx["summary"] + " | " + text.strip())[-300:]
    return ctx

def get_context(conversation_id: str) -> dict:
    return _contexts.get(conversation_id, {"clarification_count": 0, "slots": {}, "summary": ""})
