"""Configuration guard for the fixed-account local customer login."""
from __future__ import annotations

import os
import time
import uuid
from jose import jwt


def validate_dev_customer_auth_config(environment: str | None = None, enabled: str | None = None,
                                      staff_enabled: str | None = None) -> None:
    env = (environment if environment is not None else os.getenv("ENVIRONMENT", "")).lower()
    flag = (enabled if enabled is not None else os.getenv("DEV_CUSTOMER_AUTH_ENABLED", "")).lower()
    staff_flag = (staff_enabled if staff_enabled is not None else os.getenv("DEV_STAFF_AUTH_ENABLED", "")).lower()
    if (flag == "true" or staff_flag == "true") and env != "development":
        raise RuntimeError("Development authentication flags are allowed only when ENVIRONMENT=development")


def issue_dev_access_token(actor_id: str, tenant_id: str, role: str) -> tuple[str, int]:
    key = os.getenv("JWT_SIGNING_KEY", "")
    issuer, audience = os.getenv("JWT_ISSUER", ""), os.getenv("JWT_AUDIENCE", "")
    if len(key) < 32 or not issuer or not audience:
        raise ValueError("JWT signing key, issuer, and audience must be configured")
    now = int(time.time())
    claims = {"sub": actor_id, "iss": issuer, "aud": audience, "iat": now,
              "exp": now + 900, "jti": uuid.uuid4().hex, "tenant_id": tenant_id,
              "role": role, "token_use": "access", "assurance_level": "AL0"}
    return jwt.encode(claims, key, algorithm="HS256"), 900
