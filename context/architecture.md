# Architecture

## Existing stack and boundaries

- Python + FastAPI is the HTTP/API boundary. `app/main.py` owns many B routes; `app/modules/routes_a.py` registers A routes on the same application.
- `app/core/` supplies SQLAlchemy engine/session, errors, correlation middleware, audit, RBAC, IDs, and masking.
- `app/modules/` contains domain services and persistence models for conversation, identity simulation, intent, knowledge, orchestration, tools, cases, tickets, handoff, SLA, approval, QA, analytics, and outbox.
- SQLAlchemy models are split between `models_a.py` and `models.py`; PostgreSQL is default, SQLite is opt-in for tests. Alembic currently has one initial migration.
- React 18 + Vite 5 SPA is in `web-workspace/`; the role-aware History API shell and injectable bearer-token provider are in `src/api.js`. Fixed-account local customer login and allowlisted local staff login can each be enabled explicitly for development; both mint 15-minute tokens through the same HS256 principal path and are loopback-only. Tokens remain memory-only in the SPA. These are not production identity providers. Vite proxies API paths to port 8000 and both Nginx/Vercel configurations provide SPA deep-link fallback.
- Docker Compose includes PostgreSQL/pgvector, Redis, MinIO and Mailpit, but source inspection did not establish complete usage of each service.

## Data ownership and persistence

Conversation, session, message, intent, knowledge article/version, tool call/policy decision, case/ticket, SLA, handoff, approval, QA, and outbox SQLAlchemy rows are defined in module model files. Some auth challenges/consents, intent context, workflow deduplication, circuit-breaker/idempotency details, or legacy analytics/case state use module-level memory. Do not rely on in-memory state for multi-process durability. Tenant and customer ownership constraints must be established and enforced in query/service boundaries before customer routes are exposed.

`app/main.py` invokes `Base.metadata.create_all()` at import while Alembic is also present. Unit 04 adds only the new `customer_chat_request` ledger table; it does not add constraints or alter existing message/conversation rows. The local create-all path creates this new table, but a production rollout requires an explicit reviewed migration once the Alembic environment and deployment migration policy are established.

## Authentication and authorization

`app/core/rbac.py` validates bearer JWTs with fixed HS256, configured issuer/audience, required subject/token/tenant claims, and bounded access-token lifetime. Production human access credentials are expected from an external trusted issuer; this repository has no production login/account issuer or staff account store. The opt-in customer route mints a token for one server-configured account. The separate opt-in staff route resolves identity, tenant, and role only from the server-side `DEV_STAFF_ACCOUNTS` JSON allowlist; its request accepts only username/password. Both routes require development mode, are disabled by default, loopback-only, and use constant-time password comparison. Permissions come from the existing RBAC role map. This development mechanism does not implement production staff authentication or account provisioning. Refresh credentials rotate through Redis using one-time `jti` consumption. Service credentials use per-service keys plus server configured role/scope allowlists; effective permissions intersect token scope and the role map. Missing config and invalid credentials fail closed. Caller-provided role, actor, and assurance headers are ignored.

`VerifiedPrincipal` supplies the actor, identity type, tenant, role, permissions, scope, and signed assurance context. Route dependencies deny by default. Customer case/ticket reads and conversation detail/append paths include owner and tenant checks; Unit 04 audit found that provider-message replay lookup and 72-hour continuity/reopen lookup still need tenant/owner-safe correction before customer conversation use. Internal conversation projections, handoff, approval, evidence, tool, ticket, and case operations apply tenant checks. The public status-reference route returns only the customer-visible status projection. The backend role map includes `customer`; no production issuer or customer account provisioning is configured. Knowledge Manager is a distinct role; administrator has no conversation-content permission under FRD RBAC-05.

Tenant filters are now applied to the implemented case, ticket, conversation, knowledge, handoff, approval, QA, analytics, audit, and outbox paths; some use joins because their own records have no tenant column. Staff assignment-level access is still not modeled. The schemas also lack a uniform tenant foreign key and migration history, so the joins are a compatibility measure, not a substitute for the approved tenant-schema migration. Audit storage remains in-memory in this skeleton and is not durable. FRD §4.2 remains the permission source of truth.

## API conventions

Existing routes use `/v1/...`, JSON responses, request correlation middleware, and `AppError` envelopes. Many endpoints accept untyped dictionaries and instantiate `SessionLocal` directly. Preserve compatibility while introducing typed request/response validation and consistent database dependency/service boundaries in separately specified units.

## AI orchestration and tools

`routes_a.py` calls `orchestrator.run_turn`; intent and sentiment are deterministic; `knowledge.py` performs lexical retrieval; `tool_gateway.py` checks registry/policy and records calls; orchestrator tool results and corebank behavior are simulated. `app/modules/llm_provider.py` now defines a local structured-generation interface, F1–F4 Pydantic contracts, strict validation helpers, typed safe errors, and a deterministic fixture stub. `build_provider()` only constructs the stub; external names are rejected. This foundation is not called by the orchestrator: the chat turn still makes zero LLM calls and `.env.example` settings are not consumed by application code. No Gemini SDK, external adapter, provider settings loader, timeout transport, or live provider test exists. For customer informational turns, retrieval filters both article and current version status/effective dates, citations retain retrieval score, and grounding checks the retrieved passage body. Greeting is handled deterministically. Outside-taxonomy, policy, injection, and evidence-gap handoffs create a tenant-scoped queue row before the customer is told that a request is queued; the queue's `package_complete` remains false until Unit 08 completes the full workspace context. The `.env.example` LLM provider remains `stub`. Do not claim model, provider, or financial action execution that is not implemented.

### Provider adapter status update (2026-10-16)

The historical note above that no Gemini adapter exists is superseded: `app/modules/gemini_provider.py` now implements the structured provider interface using the pinned `google-genai` SDK. Provider choice is explicit through `LLM_PROVIDER`; its default stays `stub`, while Gemini requires server-side key/model configuration. The adapter is not imported or called by `orchestrator.run_turn`, does not configure SDK tools, and does not perform policy or workflow actions. Offline fake-client tests cover its contract. No provider request or live compatibility test has been performed; data-processing approval and conversation fallback integration remain open.

## RAG and knowledge

Knowledge article/version rows and search/citation logic exist. A persistent document ingestion/indexing pipeline or vector query path was not established by inspection. pgvector in the compose image is not evidence that vector retrieval is wired. Current citations identify the stored article version and whole `body`; the schema has no section anchor, so section-level citation compliance remains open. Any RAG implementation must follow approved TRD requirements, preserve provenance/citations, and report indexing/publication only after the operation succeeds.

## Background work and integrations

SLA tick and outbox drain are exposed as internal routes and worker scripts exist. Compose includes Redis/MinIO/Mailpit; actual message broker, object storage, and provider adapters need verification. CRM/corebank/channel behavior is synthetic or simulated in inspected code. Background jobs must be idempotent and durable according to TRD before production claims.

## Logging and audit

Correlation middleware, audit service, masking utility, and audit-trail endpoint exist. Keep correlation IDs through API, tool, workflow, and integration actions. Verify masking, append-only integrity, access to audit data, retention, and tenant scope against FRD/TRD.

## Security invariants

- Authenticate principal before authorization; never trust browser-selected role or actor headers.
- Enforce tenant and customer ownership on backend reads and writes.
- Deny by default and require least privilege for routes and data.
- Do not expose secrets, OTPs, internal notes, or unverified AI output as authoritative customer facts.
- Enforce assurance level, tool allowlists, approval separation, and argument integrity server-side.
- Keep customer data synthetic unless explicitly approved otherwise; audit sensitive actions with correlation IDs.

## Architectural decisions and open items

- Preserve the current modular monolith and stack (README identifies ADR-01); no migration is approved.
- Confirm canonical FRD revision and trace role matrix/API ownership requirements.
- Production customer access remains gated on a trusted issuer, customer provisioning, and an authoritative subject-to-customer/tenant mapping. Local development login does not resolve those production dependencies.
- Decide provider/storage/vector/queue adapters only from TRD and approved deployment scope.
- Reconcile schema creation at import with Alembic in a focused migration unit.
