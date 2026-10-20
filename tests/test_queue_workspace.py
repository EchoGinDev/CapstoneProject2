"""FR-WS-002 prioritas antrean + BR-WS-04 catatan transfer wajib + FR-WS-003 satu layar."""
import os
os.environ.setdefault("DATABASE_URL", "sqlite:///./eaics_test_q.db")
from fastapi.testclient import TestClient

def _client():
    from app.main import app
    from app.core.db import Base, engine
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(app)

def _seed_conversation(conversation_id):
    from app.core.db import SessionLocal
    from app.modules.models_a import ConversationRow
    db = SessionLocal()
    db.add(ConversationRow(conversation_id=conversation_id, tenant_id="TNT-TEST"))
    db.commit(); db.close()

from tests.auth_helpers import auth_headers
H = auth_headers("cs_agent", "agent-1")
HSUP = auth_headers("supervisor", "sup-1")

def test_critical_didahulukan_dari_low():
    c = _client()
    _seed_conversation("CNV-LOW"); _seed_conversation("CNV-CRIT")
    c.post("/v1/workspace/queue/enqueue", json={"conversation_id": "CNV-LOW", "severity": "LOW"}, headers=H)
    c.post("/v1/workspace/queue/enqueue", json={"conversation_id": "CNV-CRIT", "severity": "CRITICAL"}, headers=H)
    r = c.get("/v1/workspace/queue", headers=HSUP)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items[0]["conversation_id"] == "CNV-CRIT"  # FR-WS-002 AC1

def test_transfer_tanpa_catatan_ditolak():
    c = _client()
    _seed_conversation("CNV-T")
    e = c.post("/v1/workspace/queue/enqueue", json={"conversation_id": "CNV-T", "severity": "MEDIUM"}, headers=H)
    hid = e.json()["handoff_id"]
    r = c.post(f"/v1/workspace/handoffs/{hid}/transfer",
               json={"to_queue": "Q-DISPUTES", "reason": "x", "note": ""}, headers=HSUP)
    assert r.status_code == 400
    assert r.json()["error_code"] == "E_VALIDATION"

def test_read_model_satu_layar():
    c = _client()
    from app.core.db import SessionLocal
    from app.modules.models_a import ConversationRow
    db = SessionLocal()
    db.add(ConversationRow(conversation_id="CNV-RM", tenant_id="TNT-TEST", customer_id="CUS-TEST"))
    db.commit(); db.close()
    c.post("/v1/cases", json={"conversation_id": "CNV-RM", "category": "GENERAL",
        "severity_proposed": "LOW", "description": "z"}, headers=H)
    c.post("/v1/workspace/queue/enqueue", json={"conversation_id": "CNV-RM", "severity": "HIGH",
        "reason_code": "CUSTOMER_REQUEST"}, headers=H)
    r = c.get("/v1/workspace/conversations/CNV-RM", headers=HSUP)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["handoff"]["reason_code"] == "CUSTOMER_REQUEST"
    assert len(body["cases"]) == 1
    assert body["sla"][0]["state"] in ("RUNNING", "AT_RISK", "BREACHED")
