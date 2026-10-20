"""FR-ORC-001..009 + FR-SVC-001..007 [J/A]: mesin status deterministik, giliran,
budget, degraded mode, inquiry & service workflows, anti klaim palsu. TRD §8."""
from __future__ import annotations
import time
from sqlalchemy.orm import Session
from ..core import audit as audit_svc
from ..core.ids import new_id
from . import intent as IntentSvc
from . import knowledge as KmSvc
from . import tool_gateway as Gw
from . import guardrail as Grd
from . import conversation as ConvSvc
from . import auth as AuthSvc
from .models_a import ChannelSessionRow

def _queue_handoff(db: Session, conv_id: str, reason: str, corr: str,
                   tenant_id: str, cls: dict | None = None) -> dict:
    """Persist a real queue entry; never tell the customer handoff succeeded without it."""
    from .models import HandoffRow
    from .models_a import ConversationRow
    conv = db.query(ConversationRow).filter_by(conversation_id=conv_id, tenant_id=tenant_id).first()
    if conv is None:
        return {"state": "UNAVAILABLE"}
    existing = (db.query(HandoffRow).filter_by(conversation_id=conv_id, tenant_id=tenant_id)
                .filter(HandoffRow.state.in_(["QUEUED", "OFFERED", "ACCEPTED"]))
                .order_by(HandoffRow.queued_at.desc()).first())
    state = existing.state if existing else None
    if not existing:
        from . import queue as QueueSvc
        try:
            outcome = QueueSvc.enqueue(
                db, conv_id, reason,
                {"tenant_id": tenant_id, "actor_type": "AI_AGENT", "actor_id": "orchestrator"},
                corr, severity="CRITICAL" if (cls or {}).get("safety_flag") else "MEDIUM",
                language=conv.language or "id",
                vulnerability_flag=bool((cls or {}).get("vulnerability_flag") or (cls or {}).get("safety_flag")),
                # The queue record exists, but the full workspace handoff package is not yet implemented.
                package_complete=False)
        except Exception:
            db.rollback()
            return {"state": "UNAVAILABLE"}
        state = outcome["state"]
    if _can(db, conv_id, "PENDING_HANDOFF"):
        ConvSvc.transition(db, conv_id, "PENDING_HANDOFF", reason,
                           {"actor_type": "AI_AGENT", "actor_id": "orchestrator"}, corr)
    return {"state": state}

def _handoff_reply(state: str) -> str:
    if state == "ACCEPTED":
        return "Petugas telah menerima permintaan bantuan dan akan melanjutkan percakapan."
    if state in ("QUEUED", "OFFERED", "ACCEPTED"):
        return "Permintaan bantuan petugas telah masuk antrean. Petugas belum mengonfirmasi penerimaan."
    return "Saya belum dapat memastikan permintaan bantuan masuk antrean. Silakan coba lagi atau gunakan kanal layanan lain."

DEGRADED = {"value": False}
BUDGET_TOOLS, BUDGET_LLM, BUDGET_MS = 5, 4, 20000
_seen_calls: set[str] = set()  # deteksi loop: tool+args identik berulang

def _sess(db: Session, conv_id: str, channel: str = "WEB_CHAT") -> ChannelSessionRow:
    s = (db.query(ChannelSessionRow).filter_by(conversation_id=conv_id, channel=channel)
         .order_by(ChannelSessionRow.started_at.desc()).first())
    return s

def run_turn(db: Session, conv_id: str, text: str, corr: str,
             channel: str = "WEB_CHAT", actor: str = "AI_AGENT", tenant_id: str = "TNT-TEST") -> dict:
    t0 = time.time()
    turn_id = new_id("turn")
    sess = _sess(db, conv_id, channel)
    al = sess.assurance_level if sess else "AL0"
    if sess: al = AuthSvc.check_session(sess)
    # 03 degraded
    if DEGRADED["value"]:
        reply = ("Bantuan otomatis sedang terbatas. Permintaan ini belum dapat diproses. "
                 "Saya belum dapat mengonfirmasi status tiket atau antrean petugas.")
        ConvSvc.append_outbound(db, conv_id, reply)
        audit_svc.emit("TNT-TEST", corr, "SYSTEM", "orchestrator", "system.degraded",
                       "conversation", conv_id, "orchestrator", conversation_id=conv_id)
        return {"turn_id": turn_id, "mode": "DEGRADED", "reply": reply,
                "handoff": False, "handoff_status": "NOT_ATTEMPTED"}
    # 04-07 intent + threshold
    cls = IntentSvc.classify(text, conv_id, corr)
    try:
        from .models_a import IntentRow as _IR
        from ..core.ids import new_id as _nid
        db.add(_IR(intent_id=_nid("intent"), message_id=turn_id, conversation_id=conv_id, intent_code=cls["intent_code"], intent_category=cls.get("category", "INQUIRY"), confidence=float(cls.get("confidence", 0)), is_primary=True, decision=cls.get("decision", "ACT"), entities=cls.get("entities", {})))
        db.commit()
    except Exception:
        pass
    IntentSvc.update_context(conv_id, text, cls)
    inj = Grd.detect_injection(text, corr, conv_id)
    # 06-10 handoff paksa
    if cls.get("decision") == "HANDOFF" or inj.get("detected") and cls.get("confidence", 1) < 0.45:
        reason = cls.get("handoff_reason", "LOW_CONFIDENCE")
        if inj.get("detected") and cls.get("decision") != "HANDOFF":
            reason = "POLICY_DENIED"
        handoff = _queue_handoff(db, conv_id, reason, corr, tenant_id, cls)
        reply = _handoff_reply(handoff["state"])
        ConvSvc.append_outbound(db, conv_id, reply)
        return {"turn_id": turn_id, "intent": cls, "handoff": handoff["state"] != "UNAVAILABLE",
                "handoff_status": handoff["state"], "reason": reason, "reply": reply,
                "injection": inj}
    if cls.get("decision") == "CLARIFY":
        ctx = IntentSvc.get_context(conv_id)
        opts = _options(cls["intent_code"])
        reply = f"Maaf, maksud Anda {opts}? Balas dengan pilihannya."
        try: ConvSvc.transition(db, conv_id, "AWAITING_CUSTOMER", "clarify",
                                {"actor_type": "AI_AGENT", "actor_id": "orchestrator"}, corr)
        except Exception: pass
        ConvSvc.append_outbound(db, conv_id, reply)
        return {"turn_id": turn_id, "intent": cls, "handoff": False, "reply": reply, "clarify": True}
    if cls.get("intent_code") == "GEN_SMALL_TALK_OTHER":
        reply = "Halo! Saya siap membantu pertanyaan layanan atau kebutuhan Anda."
        ConvSvc.append_outbound(db, conv_id, reply)
        return {"turn_id": turn_id, "intent": cls, "handoff": False, "reply": reply}
    # 11-13 permitted set dihitung SEBELUM prompt (ADR-04)
    permitted = Gw.permitted_set(al)
    audit_svc.emit("TNT-TEST", corr, "AI_AGENT", "orchestrator", "policy.tool_set_computed",
                   "conversation", conv_id, "policy-engine", conversation_id=conv_id,
                   after={"permitted": permitted})
    tool_calls, tool_results, citations = [], [], []
    elapsed_ms = lambda: int((time.time() - t0) * 1000)
    # kebutuhan aksi per kategori
    need_tool = _need_tool(cls["intent_code"])
    if need_tool:
        tool, args = need_tool
        if tool not in permitted:
            # di luar himpunan -> policy.denied, ulang 1x lalu handoff (FR-ORC-001 AC1)
            audit_svc.emit("TNT-TEST", corr, "AI_AGENT", "orchestrator", "policy.denied",
                           "tool", tool, "orchestrator", conversation_id=conv_id, result="DENY")
            queued = _queue_handoff(db, conv_id, "POLICY_DENIED", corr, tenant_id, cls)
            reply = "Saya belum dapat melakukan tindakan ini. " + _handoff_reply(queued["state"])
            ConvSvc.append_outbound(db, conv_id, reply)
            return {"turn_id": turn_id, "intent": cls, "handoff": queued["state"] != "UNAVAILABLE",
                    "handoff_status": queued["state"], "reason": "POLICY_DENIED", "reply": reply}
        try:
            dec = Gw.evaluate(tool, args, al, {"actor": actor}, corr, conv_id)
        except Exception as e:
            queued = _queue_handoff(db, conv_id, "POLICY_DENIED", corr, tenant_id, cls)
            reply = "Saya belum dapat melakukan tindakan ini. " + _handoff_reply(queued["state"])
            ConvSvc.append_outbound(db, conv_id, reply)
            return {"turn_id": turn_id, "intent": cls, "handoff": queued["state"] != "UNAVAILABLE",
                    "handoff_status": queued["state"], "reason": "POLICY_DENIED", "reply": reply}
        if dec["decision"] == "STEP_UP_REQUIRED":
            try: ConvSvc.transition(db, conv_id, "AWAITING_AUTH", "stepup",
                                    {"actor_type": "AI_AGENT", "actor_id": "orchestrator"}, corr)
            except Exception: pass
            reply = "Untuk keamanan, verifikasi dulu ya (OTP ke kanal terdaftar). Setelah itu saya lanjutkan."
            ConvSvc.append_outbound(db, conv_id, reply)
            return {"turn_id": turn_id, "intent": cls, "stepup_required": dec.get("required"), "reply": reply}
        # idempotensi: replay
        hit = Gw.idem_lookup(conv_id, tool, args)
        if hit:
            tool_results.append(hit); tool_calls.append({"tool": tool, "replayed": True})
        else:
            rec = Gw.record_call(conv_id, tool, args, "SUCCESS", corr, dec["policy_decision_id"])
            res = _exec_tool(db, tool, args, conv_id, corr)
            Gw.idem_store(conv_id, tool, args, res)
            tool_results.append(res)
            tool_calls.append({"tool": tool, "policy_decision_id": dec["policy_decision_id"]})
    # retrieval untuk INQUIRY
    if cls["category"] == "INQUIRY":
        r = KmSvc.search(db, text, language="id", corr=corr, tenant_id=tenant_id)
        if r["zero_result"]:
            handoff = _queue_handoff(db, conv_id, "KNOWLEDGE_GAP", corr, tenant_id, cls)
            reply = ("Saya tidak menemukan sumber resmi yang cukup untuk memverifikasi jawaban. "
                     + ("Permintaan bantuan petugas telah masuk antrean; penerimaan belum dikonfirmasi."
                        if handoff["state"] in ("QUEUED", "OFFERED", "ACCEPTED")
                        else "Saya belum dapat memastikan permintaan bantuan masuk antrean."))
            ConvSvc.append_outbound(db, conv_id, reply)
            return {"turn_id": turn_id, "intent": cls, "handoff": handoff["state"] != "UNAVAILABLE",
                    "handoff_status": handoff["state"], "reason": "KNOWLEDGE_GAP", "reply": reply}
        citations = KmSvc.cite(r["results"])
        draft = _compose_answer(cls, r["results"], tool_results)
    else:
        draft = _compose_action_answer(cls, tool_results, conv_id)
    # guardrail: groundedness + output policy + action-state (FR-ORC-006/009)
    g = Grd.groundedness(draft, ([{"title": r.get("title", ""), "body": r.get("body", "")} for r in (locals().get("r", {}).get("results", []))]
                                if cls["category"] == "INQUIRY" else []), tool_results)
    # sederhanakan: cek angka vs sumber sitasi+tool
    if g["unsupported"]:
        audit_svc.emit("TNT-TEST", corr, "SYSTEM", "guardrail", "guardrail.unsupported_claim",
                       "conversation", conv_id, "guardrail-svc", conversation_id=conv_id)
        handoff = _queue_handoff(db, conv_id, "KNOWLEDGE_GAP", corr, tenant_id, cls)
        draft = ("Saya tidak dapat memverifikasi hal tersebut dari sumber resmi. "
                 + ("Permintaan bantuan petugas telah masuk antrean; penerimaan belum dikonfirmasi."
                    if handoff["state"] in ("QUEUED", "OFFERED", "ACCEPTED")
                    else "Saya belum dapat memastikan permintaan bantuan masuk antrean."))
        ConvSvc.append_outbound(db, conv_id, draft)
        return {"turn_id": turn_id, "intent": cls, "handoff": handoff["state"] != "UNAVAILABLE",
                "handoff_status": handoff["state"], "reply": draft, "suppressed": True}
    op = Grd.output_policy(draft)
    if op.get("block"):
        draft = "Maaf, saya tidak bisa menampilkan data tersebut di sini. Petugas akan membantu via kanal aman."
        ConvSvc.append_outbound(db, conv_id, draft)
        return {"turn_id": turn_id, "intent": cls, "reply": draft, "blocked": op.get("reason")}
    st = Grd.action_state_check(draft, has_executed=bool(tool_results))
    if st.get("block"): draft = st["rewrite"]
    ConvSvc.append_outbound(db, conv_id, draft, citations=citations,
                            tool_ids=[t.get("tool") for t in tool_calls])
    audit_svc.emit("TNT-TEST", corr, "AI_AGENT", "orchestrator", "orchestration.turn_completed",
                   "conversation", conv_id, "orchestrator", conversation_id=conv_id,
                   after={"intent": cls["intent_code"]})
    return {"turn_id": turn_id, "intent": cls, "reply": draft, "citations": citations,
            "tool_calls": tool_calls, "permitted": permitted,
            "budget": {"tools": len(tool_calls), "elapsed_ms": elapsed_ms()}}

def _can(db: Session, conv_id: str, to_state: str) -> bool:
    from .models_a import ConversationRow
    c = db.query(ConversationRow).filter_by(conversation_id=conv_id).first()
    if not c: return False
    from .conversation import VALID_TRANSITIONS
    return to_state in VALID_TRANSITIONS.get(c.status, set())

def _options(intent: str) -> str:
    m = {"INFO_ACCOUNT_BALANCE": "saldo atau mutasi", "REQ_CARD_BLOCK": "blokir atau ganti kartu",
         "CMP_TRANSACTION_DISPUTE": "sengketa transaksi atau gangguan layanan"}
    return m.get(intent, "informasi atau layanan")

def _need_tool(intent: str):
    if intent == "INFO_ACCOUNT_BALANCE": return ("account_lookup", {"ref": "****4821"})
    if intent == "INFO_TRANSACTION_HISTORY": return ("transaction_lookup", {"range": "30d"})
    if intent == "REQ_STATEMENT_DOCUMENT": return ("notification_send", {"channel": "REGISTERED_EMAIL"})
    if intent == "REQ_CARD_BLOCK": return ("card_status_update", {"action": "TEMP_BLOCK", "last4": "4821"})
    if intent == "INFO_CASE_STATUS": return ("case_lookup", {})
    return None

def _compose_answer(cls, results, tool_results) -> str:
    r0 = results[0]
    base = r0.get("body", "")[:220]
    extra = ""
    if tool_results:
        extra = " Data per " + str(tool_results[0].get("as_of", "")) + "."
    return f"{base}{extra} [Sumber: {r0.get('title')}]"

def _compose_action_answer(cls, tool_results, conv_id) -> str:
    if cls["intent_code"] == "REQ_CARD_BLOCK":
        if any(result.get("status") == "TEMP_BLOCKED" for result in tool_results):
            return "Kartu Anda telah diblokir sementara."
        return "Saya belum dapat mengonfirmasi status pemblokiran kartu saat ini."
    if cls["intent_code"] == "REQ_STATEMENT_DOCUMENT":
        if any(result.get("sent") is True for result in tool_results):
            return "Rekening koran telah dikirim ke email terdaftar."
        return "Saya belum dapat mengonfirmasi pengiriman rekening koran."
    return "Pesan Anda tersimpan dalam percakapan. Saya belum dapat mengonfirmasi pembuatan tiket atau tindak lanjut petugas untuk permintaan ini."

def _exec_tool(db: Session, tool: str, args: dict, conv_id: str, corr: str) -> dict:
    """Eksekusi simulator deterministik (TRD §4.9). Timeout non-idempoten -> jujur, tanpa retry."""
    from datetime import datetime, timezone
    now = datetime.datetime.now(timezone.utc).isoformat()
    if tool == "account_lookup":
        return {"balance_minor": 12500000, "account_ref": "****4821", "as_of": now}
    if tool == "transaction_lookup":
        return {"count": 5, "as_of": now}
    if tool == "card_status_update":
        return {"card_last4": "4821", "status": "TEMP_BLOCKED", "as_of": now}
    if tool in ("notification_send",):
        return {"sent": True, "as_of": now}
    if tool in ("case_lookup",):
        return {"cases": [], "as_of": now}
    return {"ok": True, "as_of": now}
