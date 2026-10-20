"""FR-KM-001..010 [A]: artikel+versi immutable, expiry enforced saat query+job,
akses PUBLIC/CUSTOMER/INTERNAL/RESTRICTED, sitasi wajib, gap detection. TRD §4.6."""
from __future__ import annotations
import datetime
from sqlalchemy.orm import Session
from ..core.ids import new_id
from ..core import audit as audit_svc
from ..core.errors import AppError
from .models_a import KnowledgeArticleRow, KnowledgeVersionRow

GENERIC_DENY = {"bukti", "dokumen", "berkas bukti", "data saja"}
ACCESS_ORDER = ["PUBLIC", "CUSTOMER", "INTERNAL", "RESTRICTED"]

def _now(): return datetime.datetime.now(datetime.timezone.utc)

def _as_utc(value):
    if value is None: return None
    return value.replace(tzinfo=datetime.timezone.utc) if value.tzinfo is None else value.astimezone(datetime.timezone.utc)

def create_article(db: Session, title: str, body: str, language: str = "id",
                   intents: list | None = None, access: str = "CUSTOMER",
                   expires_at: str | None = None, corr: str = "COR-?", tenant_id: str = "TNT-TEST") -> dict:
    if not expires_at:
        raise AppError("E_VALIDATION", "expiry required (BR-KM-01)",
                       customer_message_id="KM.EXPIRY_REQUIRED",
                       details=[{"field": "expires_at", "rule": "REQUIRED"}])
    aid = new_id("turn"); vid = new_id("turn")
    exp = datetime.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    a = KnowledgeArticleRow(article_id=aid, tenant_id=tenant_id, title=title, summary=body[:200], language=language,
                            intents=intents or [], access_level=access, status="PUBLISHED",
                            current_version_id=vid, expires_at=exp)
    v = KnowledgeVersionRow(version_id=vid, article_id=aid, version_no=1, body=body,
                            status="PUBLISHED", expires_at=exp)
    db.add(a); db.add(v); db.commit()
    audit_svc.emit(tenant_id, corr, "HUMAN_AGENT", "km-manager", "knowledge.version_published",
                   "article", aid, "knowledge-svc")
    return {"article_id": aid, "version_id": vid}

def seed_baseline(db: Session, tenant_id: str = "TNT-TEST"):
    existing_titles = {
        row.title for row in db.query(KnowledgeArticleRow).filter_by(tenant_id=tenant_id).all()
    }
    base = [
        ("Biaya transfer internasional", "Biaya transfer internasional adalah Rp25.000 per transaksi. Berlaku sejak 2026-01-01.", "id", ["INFO_PRODUCT_POLICY"], "CUSTOMER", 365),
        ("International transfer fees", "International transfer fee is IDR 25,000 per transaction.", "en", ["INFO_PRODUCT_POLICY"], "CUSTOMER", 365),
        ("Syarat rekening koran", "Rekening koran dikirim ke email terdaftar dalam 1x24 jam. Butuh AL2.", "id", ["REQ_STATEMENT_DOCUMENT"], "CUSTOMER", 365),
        ("SOP sengketa transaksi", "Langkah: verifikasi AL2, buat kasus, minta bukti detail transaksi + surat pernyataan.", "id", ["CMP_TRANSACTION_DISPUTE"], "INTERNAL", 365),
        ("Ambang fraud internal", "Ambang tinjauan fraud adalah 50 juta. INTERNAL ONLY.", "id", ["CMP_FRAUD_SUSPICION"], "INTERNAL", 365),
        ("Promo kedaluwarsa", "Promo cashback 2024 telah berakhir.", "id", ["INFO_PRODUCT_POLICY"], "CUSTOMER", -10),
        ("Jenis dan metode pembayaran", "Jenis metode pembayaran yang diterima mencakup transfer sesama rekening, transfer antarbank BI-FAST, Real-Time Online, Virtual Account, dan QRIS. Pembayaran tagihan dapat dilakukan melalui aplikasi mobile banking atau ATM.", "id", ["INFO_PRODUCT_POLICY"], "CUSTOMER", 365),
        ("Limit transaksi harian", "Limit transfer antarbank melalui BI-FAST adalah Rp250.000.000 per transaksi. Limit harian penarikan tunai di ATM adalah Rp10.000.000, dan limit transaksi belanja kartu debit adalah Rp25.000.000 per hari.", "id", ["INFO_PRODUCT_POLICY"], "CUSTOMER", 365),
        ("Jam operasional layanan", "Layanan transaksi digital, transfer BI-FAST, dan mesin ATM beroperasi selama 24 jam setiap hari. Layanan kantor cabang buka pada hari kerja Senin sampai Jumat pukul 08:00 hingga 15:00 WIB.", "id", ["INFO_PRODUCT_POLICY"], "CUSTOMER", 365),
        ("Biaya administrasi dan saldo minimum", "Biaya administrasi bulanan tabungan reguler adalah Rp10.000. Bebas biaya administrasi untuk saldo rata-rata bulanan di atas Rp5.000.000. Ketentuan saldo minimum yang mengendap adalah Rp50.000.", "id", ["INFO_PRODUCT_POLICY"], "CUSTOMER", 365),
        ("Suku bunga tabungan dan deposito", "Suku bunga tabungan reguler adalah 1.5% per tahun. Suku bunga deposito berjangka adalah 4.0% per tahun untuk tenor 3 bulan dan 4.5% per tahun untuk tenor 6 bulan.", "id", ["INFO_PRODUCT_POLICY"], "CUSTOMER", 365),
    ]
    for title, body, lang, intents, acc, exp_days in base:
        if title in existing_titles:
            continue
        exp = _now() + datetime.timedelta(days=exp_days)
        aid, vid = new_id("turn"), new_id("turn")
        db.add(KnowledgeArticleRow(article_id=aid, tenant_id=tenant_id, title=title, summary=body[:200], language=lang,
                                   intents=intents, access_level=acc, status="PUBLISHED",
                                   current_version_id=vid, expires_at=exp))
        db.add(KnowledgeVersionRow(version_id=vid, article_id=aid, version_no=1, body=body,
                                   status="PUBLISHED", expires_at=exp))
    db.commit()

def search(db: Session, query: str, language: str = "id", for_agent: bool = False,
           corr: str = "COR-?", tenant_id: str = "TNT-TEST") -> dict:
    """Retrieval hibrida sederhana: filter status+akses+basa, skor keyword, floor relevansi."""
    seed_baseline(db, tenant_id)
    now = _now()
    q = query.lower()
    allowed = ["PUBLIC", "CUSTOMER", "INTERNAL"] if for_agent else ["PUBLIC", "CUSTOMER"]
    scored = []
    for a in db.query(KnowledgeArticleRow).filter_by(tenant_id=tenant_id).all():
        if a.status != "PUBLISHED": continue
        if a.access_level not in allowed: continue
        if _as_utc(a.expires_at) and _as_utc(a.expires_at) < now: continue
        v = db.query(KnowledgeVersionRow).filter_by(version_id=a.current_version_id).first()
        if not v: continue
        if v.status != "PUBLISHED": continue
        if _as_utc(v.effective_from) and _as_utc(v.effective_from) > now: continue
        if _as_utc(v.expires_at) and _as_utc(v.expires_at) < now: continue
        body = (v.body or "").lower()
        hits = sum(1 for w in q.split() if len(w) > 2 and w in body) + (2 if any(w in (a.title or '').lower() for w in q.split()) else 0)
        score = hits / max(1, len([w for w in q.split() if len(w) > 2]))
        if score >= 0.20:
            # preferensi bahasa, fallback en (BR-KM-06 + FR-CONV-007)
            lang_boost = 0.1 if a.language == language else 0
            scored.append((score + lang_boost, a, v))
    scored.sort(key=lambda x: -x[0])
    top = scored[:5]
    audit_svc.emit("TNT-TEST", corr, "SYSTEM", "rag-svc", "knowledge.retrieved",
                   "query", query[:40], "retrieval-svc", after={"hits": len(top)})
    if not top:
        audit_svc.emit("TNT-TEST", corr, "SYSTEM", "rag-svc", "knowledge.gap_detected",
                       "query", query[:40], "retrieval-svc")
        return {"results": [], "zero_result": True}
    results = [{"article_id": a.article_id, "version_id": v.version_id, "title": a.title,
                "last_updated": (v.effective_from.isoformat() if v.effective_from else ""),
                # The schema stores one unstructured body, not section anchors.
                "passage_ref": "body", "body": v.body, "score": round(s, 3)} for s, a, v in top]
    return {"results": results, "zero_result": False}

def cite(results: list) -> list:
    return [{"article_id": r["article_id"], "version_id": r["version_id"], "title": r["title"],
             "last_updated": r["last_updated"], "passage_ref": r["passage_ref"],
             "retrieval_score": r["score"]} for r in results]
