# Progress Tracker

## Current phase

Phase 1: security foundation and role-based shell complete; Unit 05 information-conversation slice implemented. Premium UI refresh is applied; authenticated conversation journey and comprehensive accessibility verification remain pending.

## Current goal

Complete and verify the customer conversation journey; production identity remains gated.

## Completed

- Inspected repository, manifests, routes, services, models, tests, and supplied FRD/TRD.
- Completed repository audit, requirements traceability (Unit 01), and the dependency-ordered 17-unit build plan.
- Implemented Unit 02 authenticated principal and backend authorization; see `context/specs/02-authenticated-principal.md`.
- Added signed bearer validation, access/refresh purpose and lifetime checks, one-time refresh rotation via Redis, and configured per-service key/role/scope allowlists.
- Removed caller headers as identity; corrected Knowledge Manager and administrator conversation permissions.
- Scoped reviewed customer resources, conversation/session access, handoffs, approvals, knowledge, QA, analytics, audit reads, and outbox operations by tenant/owner where the existing schema permits.
- Migrated existing API tests to signed test credentials and added security regression tests.
- Completed Unit 03 visible route shell: customer-first public landing, URL-based customer/staff route structure, role-specific navigation from the injected provider session, accessible responsive header, and explicit auth/forbidden/unavailable/unknown states.
- Replaced frontend role/actor header behavior with a fail-closed bearer-token provider boundary; no issuer, login form, or token is fabricated.
- Verified SPA deep-link fallback is configured in `web-workspace/nginx.conf` and `web-workspace/vercel.json`.
- Prepared and implemented Unit 04 after inspecting customer API routes, ownership logic, conversation/message models, tests, and FRD/TRD conversation requirements; details and decisions are in its specification.
- Confirmed the backend already defines the `customer` role and the API test helper can sign test-only customer tokens. A trusted production issuer and customer account provisioning are still absent.
- Found a cross-customer replay risk: provider-message deduplication in `app/modules/conversation.py` is global and returns the prior conversation ID before tenant/owner checks. The Unit 04 spec requires fixing this and adding regression coverage before customer access is exposed.
- Started Vite at `http://127.0.0.1:5173/`; local HTTP GET returned 200 and the application title. This is a launch/HTTP smoke check only; no browser rendering was verified.

## Current status

- Unit 03 completed and verified per `context/specs/03-role-navigation-shell.md`.
- Unit 04 local customer login, API, UI integration and regression tests are implemented. Production identity and schema migration remain gated.

## Next tasks

1. Complete Unit 05 authenticated browser journey, keyboard and accessibility verification; responsive visual layouts were reviewed during the 2026-10-16 UI refresh.
2. Implement Unit 06 complaint/ticket ownership APIs and a documented complaint-to-case flow.
3. Implement Unit 08 full handoff context/read model and agent queue workflow; keep handoff package marked incomplete until verified.
4. Integrate trusted production identity issuer/account provisioning before enabling production access.

## Open questions

- Obtain canonical signed FRD v1.0 and signed TRD section 16 token contracts; supplied documents are drafts.
- Confirm the trusted JWT issuer, claim construction, secret distribution, rotation, and customer account lifecycle; specifically whether `sub` equals the internal customer ID or maps through a trusted directory.
- Confirm customer self-read audit policy and legacy message uniqueness/migration repair policy before production schema changes.
- Confirm local/managed/stub LLM selection; `.env.example` currently selects stub.

## Architecture decisions

- Preserve the FastAPI/SQLAlchemy modular monolith and React/Vite SPA.
- Token validation contract is fixed HS256 with configured issuer/audience, signed access (maximum 15 minutes), refresh (maximum 8 hours), Redis one-time refresh `jti`, and per-service keys plus server-configured role/scope allowlists. Claim schema and HS256 are local implementation choices pending signed TRD approval.
- External trusted issuer mints production credentials. A separate opt-in fixed-account development issuer supports local customer UI verification only.
- Caller-supplied identity and assurance headers are ignored. Service permissions are intersected with both the role permission set and the configured service allowlist.
- Public status-reference lookup returns only customer-visible status; `X-Assurance` cannot elevate disclosure.

## Known bugs and limitations

- Trusted issuer, human account provisioning, and initial token issuance are not implemented.
- The SPA's development bearer provider is configured only after successful local sign-in and is memory-only; production protected journeys remain unavailable until issuer/account provisioning is integrated.
- The backend role matrix includes `customer` and signed test tokens exercise customer ownership. A trusted production issuer and customer account-to-actor provisioning remain absent; production customer access is therefore not launchable.
- Staff assignment-level authorization is not modeled; current internal reads use role and tenant boundaries.
- Tenant columns are inconsistent and some boundaries rely on joins; a reviewed schema migration is still needed before claiming production multi-tenant readiness.
- Audit storage remains in-memory and is not durable.
- Notifications and attachment storage paths remain stubs; retrieval remains lexical rather than production vector RAG.

## Verification results

- `python -m compileall -q app tests` passed.
- `python -m pytest -q -p no:cacheprovider` passed: 28 passed. Warnings were emitted by Starlette/httpx and python-jose deprecations.
- Unit 02 refresh rotation/replay was tested with mocked Redis. No live Redis or external identity issuer was used.
- Unit 03: `npm run build` in `web-workspace` passed (Vite 5.4.21; 32 modules transformed). Source inspection confirmed no role/actor identity headers remain. Nginx and Vercel SPA fallback were inspected. No browser-based verification or frontend test framework is configured.

## Session notes

Review `context/specs/04-customer-conversation-history.md` and resolve its explicit decisions before starting implementation. The local UI is available at `http://127.0.0.1:5173/`; only HTTP availability was checked. Do not add a role selector, arbitrary identity headers, or a fake issuer.

## Unit 04 implementation update (2026-10-13)

This update supersedes the earlier “Unit 04 specification prepared; implementation not started” status above.

- **Current phase:** Unit 04 customer conversation and local development authentication implemented; production identity remains an integration gate.
- **Completed:** Added a fixed-account dev-only credential issuer with opt-in flag, startup environment guard, loopback restriction, server-derived customer role/actor/tenant, and normal HS256 bearer validation. Added scoped idempotency ledger, validated customer WEB_CHAT, conversation ID in successful turn result, tenant-safe provider replay collision handling and continuity/reopen queries, customer-owned conversation list and bounded cursor history projection. Connected customer login/chat/history routes to API and added responsive transcript/composer states while preserving shell styling.
- **Verification:** `python -m pytest -q -p no:cacheprovider` passed: 38 passed. `npm.cmd run build` passed (32 modules). Browser automation was unavailable/not run. No browser rendering claim. Local HTTP smoke: Vite `/` and `/customer/login` returned 200; API `/healthz` was unavailable because backend is not running.
- **Local configuration:** Existing root `.env` is development mode and contains a signing key, but issuer/audience and customer account fields are unset; no local login succeeds until the operator fills them. Set `DEV_CUSTOMER_AUTH_ENABLED=true`, unique `DEV_CUSTOMER_USERNAME`, `DEV_CUSTOMER_PASSWORD` (at least 20 chars), `DEV_CUSTOMER_ID`, `DEV_TENANT_ID`, `JWT_ISSUER`, `JWT_AUDIENCE`, and `JWT_SIGNING_KEY` (>=32 chars). In `web-workspace/.env.local`, set `VITE_ENABLE_DEV_CUSTOMER_AUTH=true`. Never enable the backend flag outside development. Start backend with `python -m uvicorn app.main:app --reload --port 8000`; start SPA from `web-workspace` with `npm run dev -- --host 127.0.0.1`.
- **Limitations:** No production identity provider/customer provisioning; local token remains memory-only and signs out on refresh/close; no browser refresh token; durable audit storage absent. The new ORM ledger table is created by local `create_all`; production requires a reviewed migration. Existing message tables were not altered and legacy uniqueness/race handling remains for the migration unit.
- **Next:** Unit 05 customer conversation UI journey completion, browser/responsive/accessibility review, safe retry behavior, and human-handoff continuation. Do not reimplement Unit 04 APIs.

## Local authentication repair and staff preparation (2026-10-13)

- **Diagnosis:** Backend consumes `DEV_CUSTOMER_AUTH_ENABLED`, `DEV_CUSTOMER_USERNAME`, `DEV_CUSTOMER_PASSWORD`, `DEV_CUSTOMER_ID`, `DEV_TENANT_ID`, `JWT_SIGNING_KEY`, `JWT_ISSUER`, and `JWT_AUDIENCE`. The root `.env` already had development customer configuration and issuer/audience values, but its signing key was only 30 characters while the implementation requires at least 32. The customer page remained disabled because the Vite flag `VITE_ENABLE_DEV_CUSTOMER_AUTH` was not configured in `web-workspace/.env.local`.
- **Local fix:** Replaced only the local ignored `.env` signing key with a generated 64-character random value; no secret value was emitted. Added ignored `web-workspace/.env.local` with customer auth enabled and staff auth disabled. Added `**/.env.local` to `.gitignore`. The configured local customer credential is already present and meets the 20-character minimum; it was not printed or changed. Both local auth routes remain guarded for development and loopback clients.
- **Staff preparation:** Added a separate development-only `POST /v1/dev-auth/staff/login`, sourced exclusively from server-side `DEV_STAFF_ACCOUNTS` allowlist JSON and the existing human RBAC role set. It accepts username/password only, compares password in constant time, and issues a normal 15-minute signed bearer token. Added SPA staff-login entry/configuration, disabled by default locally. Existing role permissions govern authorization; management remains unable to read conversation content, and Knowledge Manager is not conflated with admin. No production staff issuer, account lifecycle, MFA, or credentials were added.
- **Verification:** `python -m pytest -q -p no:cacheprovider`: 40 passed (91 dependency deprecation warnings). `npm.cmd run build`: passed, 32 modules transformed. Fresh Vite dev server was restarted and `/customer/login` returned HTTP 200; transformed `/src/api.js` confirms customer feature flag `true`, staff feature flag `false`. Frontend source scan found no caller-controlled role/actor headers. No browser automation was run.
- **Runtime limitation:** `127.0.0.1:5432` and `:6379` were closed, Docker Desktop's Linux engine named pipe was unavailable, and the API could not be established. The production app creates database metadata at import, so live login/conversation persistence and tenant isolation against a running database remain unverified in this environment. SQLite-backed API tests cover token-based creation/history and existing ownership/tenant regression cases. Redis is needed for refresh rotation, not for initial development access-token issue.
- **Current phase:** Unit 04 local customer auth/config repaired; local staff authentication is prepared for explicit testing only. Production identity remains an integration gate.
- **Next:** Unit 05 customer conversation UI journey completion and browser/responsive/accessibility review, then staff/management production identity-provider integration when the approved issuer contract is available. Start PostgreSQL (and Redis when refresh rotation is needed), run the API, then exercise the configured local account in the running SPA.

## Unit 05 information conversation slice (2026-10-13)

- **Root cause:** The deterministic keyword classifier maps no-match text to `OTHER_UNCLASSIFIED` with `HANDOFF`, required by the available FRD draft; the orchestrator returned “Saya hubungkan ke petugas...” but did not create a queue row. A supported fee question matched only generic `biaya` and stayed in clarification. Independently, grounding received citation title with empty passage body, so it could reject a supported amount. `run_turn` makes no LLM call; `LLM_PROVIDER=stub` is not the cause of the repeated response.
- **Implemented:** Added phrase evidence for the seeded international transfer fee article; greetings now return deterministic greeting; retrieval rejects non-published/future/expired current versions; citation metadata includes retrieval score; grounding uses retrieved passage text; required handoffs create/reuse a tenant-scoped queue row before claiming it was queued, report accepted vs queued state, and leave `package_complete=false` until Unit 08; customer history renders persisted citations and chat reports queue state. Updated Unit 05 spec, build plan, architecture and traceability. Fixed a legacy fixed-ID test fixture to permit repeatable suite runs.
- **Requirement IDs:** FR-INT-001/003/004/007, FR-KM-003/004, FR-ORC-001/006/009, FR-WS-001/002, FR-CONV-003, against the supplied draft copies only; canonical signed FRD v1.0 and signed TRD §16 approvals remain unavailable.
- **Verification:** `python -m pytest -q -p no:cacheprovider` — 43 passed, 96 deprecation warnings. `npm.cmd run build` — passed, 32 modules. No browser automation tool was available; no browser check or live LLM inference is claimed.
- **Known limits:** Knowledge remains lexical and synthetic; no real provider invocation; full complaint-to-case/SLA workflow is Unit 06; handoff context package/workspace is incomplete (`package_complete=false`, Unit 08); browser responsive/keyboard verification remains open. FRD/TRD draft status remains an approval limitation.
- **Current unit status:** Unit 05 remains in progress until browser and accessibility checks are performed. Next implementation unit after those checks: Unit 06 — Complaint and ticket ownership APIs.

## LLM provider readiness audit (2026-10-16)

- **Scope/outcome:** Documentation/source audit only, recorded in `context/audit-report.md`. No application code, `.env`, dependency, or provider setting was changed; no secret was inspected and no Gemini request was made.
- **Finding:** The repository has no provider gateway/interface/adapter or provider-specific tests. `.env.example` contains `LLM_PROVIDER=stub`, `LLM_MODEL=stub-1.0`, and blank `LLM_API_KEY`; source code does not consume these values. The deterministic orchestrator currently invokes zero model calls. TRD v0.9 draft §8 defines four constrained logical functions (F1–F4); this is target architecture, not current implementation.
- **Gemini assessment:** Technically feasible after a provider abstraction, server-only key configuration, a reviewed `google-genai` dependency, strict schemas, bounded timeout/error behavior, and regression/contract tests. Stub remains necessary for deterministic offline tests. No live integration was tested or approved. FRD/TRD version and signature conflicts remain open.
- **Specification gap:** Build plan Unit 06 exists, but no active Unit 06 specification file is currently present in `context/specs/`.
- **Verification:** Read-only source searches and PDF inspection completed. Historical Unit 05 verification (43 backend tests passed and Vite build passed) is recorded in its spec and was not rerun. No provider test exists or was run. Unit 05 remains untouched and in progress pending browser/accessibility verification.
- **Next safe step:** Resolve/record the approved FRD/TRD and provider contract decisions, then write/review a dedicated provider specification and tests before implementation. Continue Unit 05 browser/accessibility verification separately; do not implement a Gemini adapter from this audit alone.
## LLM provider contract preparation (2026-10-16)

- **Documents:** Added draft design/test spec at context/specs/llm-provider-contract.md and a source-linked matrix addendum in context/requirements-traceability.md.
- **TRD findings:** Verified §8.1–§8.2 in source PDF p. 43: F1–F4 narrow schemas, 20-second total turn budget, one strict F4 retry for unsupported claims then safe fallback/handoff, and code-owned state/policy/execution. §13.9 defines degraded handling for LLM timeout/error/rate limit; §13.11 calls for stub/fixtures in routine testing and a pinned real model only in selected EVAL/E2E runs. §16 contract signatures remain unconfirmed.
- **Specification status:** Interface, deterministic fixture stub, separate external adapter, configuration questions, Pydantic validation, failure/fallback/logging requirements, F1–F4 constraints, security invariants, and unit/contract/opt-in integration test plans are documented. Details not fully specified by TRD (including claim_map schema, confidence_hint semantics, key setting, and per-call timeout) are explicitly open.
- **Boundary:** Documentation/traceability only. No source code, env files, dependency manifest, provider config, or tests changed. No credential read and no external API request made. Gemini remains an unapproved candidate; no integration is claimed.
- **Approval gates:** FRD v0.9 is draft; TRD v0.9 references FRD v1.0; canonical signed FRD v1.0 and signed TRD §16 approval are still absent/unconfirmed.
- **Next:** Review and approve the provider contract and unresolved schema/configuration choices before implementation. Implement no adapter until that approval is given.

## LLM provider foundation implementation (2026-10-16)

- **Implemented:** Added `app/modules/llm_provider.py` with one structured provider Protocol, four function identifiers only (F1–F4), Pydantic request/response schemas, deterministic fixture stub, stub-only factory, typed safe provider errors, and common output/semantic validation for tool proposals and claim references.
- **Call sites:** No provider call was added to `orchestrator.run_turn`; current runtime still performs zero LLM calls. `BUDGET_LLM = 4` is unchanged. No external adapter, SDK, settings loader, `.env` change, or network transport exists. Stub remains the only constructible provider.
- **Tests:** `python -m pytest tests/test_llm_provider.py -q -p no:cacheprovider`: 29 passed. `python -m pytest -q -p no:cacheprovider`: 72 passed, 96 dependency deprecation warnings. No Gemini/provider connection test was run.
- **Security/regression:** Provider module has no tool executor or access to principal, database, or workflow services. Existing backend suite passed, including auth/RBAC, tenant ownership, idempotency, audit, and workflow regression tests. F3 allowlist and schema validation are local contract checks only; no tool call is made.
- **Limits/open:** F4 semantic grounding still belongs to the existing guardrail and is not wired to a call site; no orchestrator fallback/degraded provider path exists yet. Schemas/entity bounds and config decisions remain subject to FRD/TRD approval. FRD v0.9 draft vs TRD v0.9 reference to FRD v1.0 and unsigned/unconfirmed TRD §16 remain open.
- **Docs synchronized:** `context/specs/llm-provider-contract.md`, `context/requirements-traceability.md`, and `context/architecture.md` now describe the implemented local boundary and its limits. Unit 05 remains untouched; no Unit 06 implementation was started.
- **Next:** Review this foundation and resolve contract decisions before wiring any F1–F4 call sites. Gemini must remain unimplemented until a separate approval.

## Truthful ticket and degraded fallback repair (2026-10-16)

- **Root cause:** The orchestrator degraded branch claimed ticket creation and human follow-up without calling ticket storage or enqueueing a handoff. The card-block response also said a delivery ticket was created although the executed simulator only returned card status.
- **Implemented:** Degraded output and persisted message now use the same honest response, report handoff `NOT_ATTEMPTED`, and do not claim ticket creation or follow-up. Action response wording now requires matching operation evidence (`TEMP_BLOCKED` or `sent is True`); card-block copy no longer asserts a ticket. The separately authorized ticket endpoint continues to return success/status only after its store transaction commits.
- **Tests:** Focused regression tests: 5 passed. `python -m pytest -q -p no:cacheprovider` with isolated temporary SQLite DB: 77 passed, 99 warnings. Warnings: Starlette/httpx TestClient and anyio deprecations, plus python-jose `datetime.utcnow()` deprecation. A prior full-suite run against the shared test DB had one collision on fixed conversation ID `CNV-1`; rerun with a clean isolated DB passed.
- **Boundary:** No auth/RBAC, tenant ownership, approval, queue acceptance, Gemini, Unit 06 workflow, dependency, or env configuration was changed. No external connection was made.

## Gemini provider adapter foundation (2026-10-16)

- Added `GeminiStructuredGenerationProvider` as an isolated implementation of the existing structured provider interface. It is selected only by explicit `LLM_PROVIDER=gemini`; default remains deterministic `stub`, and API-key presence does not change provider selection.
- Pinned `google-genai==2.31.0`. Backend settings use `LLM_MODEL`, `LLM_API_KEY`, and `LLM_TIMEOUT_MS` (default 10000 ms; max 20000 ms). `.env.example` documents names and empty placeholders only. Local `.env` was not read or changed.
- Structured JSON passes the existing F1–F4 Pydantic validators. F3 schema is narrowed to the policy-provided allowlist; no tool executor is exposed. Provider errors map to safe categories without upstream text; SDK retries are disabled.
- Tests: adapter/provider contract tests **48 passed**. Full backend suite **96 passed, 99 warnings** in 12.98 s from an isolated temporary working directory to keep the repository `.env` outside dotenv discovery. Warnings: Starlette/httpx TestClient and AnyIO BlockingPortal deprecations, plus python-jose `datetime.utcnow()` deprecation.
- Boundary: no orchestrator call site was added; runtime LLM calls remain zero and stub remains active default. No SDK installation, API-key test, Gemini request, or external connection. Adapter compatibility with an installed SDK and live behavior remain unverified; tests use a fake client. Conversation fallback, semantic grounding through guardrail, and FRD/TRD approval remain open.

## Gemini diagnostic error mapping refinement (2026-10-16)

- Added safe, additive provider error categories for authentication, access denied, resource not found, connection failure, and provider/server error. Existing categories remain. Adapter uses the installed SDK's `APIError.code`/allowlisted `status` and `httpx` timeout/transport types only; it never stores or emits raw exception details.
- 429/`RESOURCE_EXHAUSTED` maps to `RATE_LIMITED`; the available status does not safely distinguish quota from rate limiting. Unknown errors retain `UNAVAILABLE`.
- Offline tests for SDK `ClientError`/`ServerError`/`APIError`, timeout, connection, status mapping, and sensitive canary redaction: **55 passed**. No live test or external request was run. Orchestrator/default provider/configuration are unchanged.

## Premium frontend UI/UX refresh (2026-10-16)

- **Implemented:** Updated the existing React/Vite shell with a responsive charcoal-green sidebar, collapsible desktop navigation, mobile drawer, warm-paper surfaces, local/system typography, restrained motion, and shared operational styles. Reworked the customer landing and chat empty/loading/error/message presentation. Existing routes, bearer API boundary, auth/session rules, and backend contracts were preserved.
- **Conversation UX:** Starter prompts only populate the composer; citations render only from API responses; queue/acceptance copy remains backend-state driven; 401 returns to login, 403 does not offer retry, and safe resend retains the existing idempotency key. No regeneration feature, fake source, status, analytics, or AI response was added. No LLM runtime call was added.
- **Verification:** `npm.cmd run build` passed (Vite 5.4.21, 32 modules). Local frontend at `http://127.0.0.1:5173/` returned HTTP 200 and was visually inspected in Edge at 1440x1000 and a 390px emulated mobile viewport. Browser interaction checks verified Enter opens the mobile menu and routes to the protected chat/auth gate, Escape closes the menu and restores focus, and desktop collapse works by click. No frontend test framework is installed; authenticated API journey and comprehensive screen-reader checks remain outstanding.
- **Reference limits:** `https://emitra-app.vercel.app/` was inaccessible to the web inspection tool, and `UX for AI week 07 gabungan.pdf` was not present in the repository. Design uses the visual and seven-pattern guidance in the task prompt. FRD v0.9 draft / TRD v0.9 reference to FRD v1.0 and TRD §16 approval status remain unresolved.
- **Files:** `web-workspace/src/App.jsx`, `web-workspace/src/app.css`, `context/ui-context.md`, `context/specs/03-role-navigation-shell.md`, `context/specs/05-customer-information-conversation.md`, and this tracker.
- **Runtime note:** A Vite proxy log showed `ECONNREFUSED` for the development-auth endpoint during the local session. No authenticated API journey was attempted, so backend connectivity remains unverified.

## Customer chat Enter submission fix (2026-10-20)

- **Diagnosis:** `CustomerChat()` used a multiline textarea in a form with an `onSubmit` handler; Enter therefore inserted a newline and did not invoke the send handler. The button already submitted through that handler.
- **Implemented:** Plain Enter now requests native form submission; Shift+Enter and IME composition preserve textarea behavior. A synchronous submission lock prevents repeated Enter/click events from overlapping before React applies the loading state. API path, authentication, conversation ID, idempotency key generation/retry, and styling are unchanged.
- **Verification:** `npm.cmd run build` in `web-workspace` passed (Vite 5.4.21; 32 modules). No frontend interaction test framework is configured. This review did not run browser interaction or inspect a browser console. Edge is installed, but no browser automation harness/authenticated session was available to this process. Enter/Shift+Enter, rapid repeat, button parity, retry, focus, and no-reload behavior remain unverified in a browser.
- **Unit status:** Unit 05 remains IN PROGRESS. Do not mark its browser/accessibility gate complete until the manual checks are recorded.
## Unit 05 gate evidence refresh after Enter-key fix (2026-10-20)

- **Fresh automated checks:** `python -m pytest tests/test_a_skeleton.py -q -p no:cacheprovider` — **11 passed, 27 warnings** (2.16 s), with `LLM_PROVIDER=stub` and a uniquely named SQLite database in the OS temp directory. `npm.cmd run build` from `web-workspace` — **passed**, Vite 5.4.21, 32 modules (659 ms).
- **Coverage boundary:** The backend tests cover deterministic supported-question/citation/history and unknown-intent queued handoff behavior. The frontend build verifies compilation only. No frontend test script or browser automation framework is configured; no authenticated browser session, chat keyboard interaction, console, Network capture, responsive chat journey, or assistive-technology check was run.
- **Current Unit 05 status:** **IN PROGRESS; gate BLOCKED.** Enter/Send behavior, Shift+Enter, blank/repeated submission, UI retry, reload/history, desktop/mobile chat, focus/labels, and accessibility still require browser evidence. Prior 1440px/390px shell inspection and menu keyboard checks do not satisfy these chat checks.
- **Unit 06:** Not started. Continue to wait for Unit 05 browser/accessibility gate evidence and unresolved Unit 06 prerequisite decisions.

## Unit 05 developer-reported browser acceptance (2026-10-20)

- **Reported manual results:** Development login; Enter single-send; Shift+Enter newline; Send button; blank-input rejection; repeated-Enter duplicate prevention; history after reload; supported and unsupported questions; error handling; idempotent retry; desktop chat at 1440 px; mobile chat at 390 px; keyboard controls; visible/logical focus; and zoom/reflow were all reported PASS by the developer.
- **Evidence boundary:** Codex did not execute or observe these manual checks. No screenshots, recording, Network/HAR, console capture, or separate test log was supplied/located for this update. Record these as developer-reported, not Codex-verified. The previous fresh automated result remains 11 backend tests passed and frontend build passed.
- **Still untested:** Screen-reader/basic assistive-technology checks, contrast, and browser console/Network capture. Unit 05 spec/build plan require browser and accessibility verification generally; `context/ui-context.md` explicitly requires contrast testing, so contrast remains a closure item. Screen-reader basics are in the broader Unit 17 release verification and are not separately listed as a Unit 05 acceptance item. Confirm the required contrast target before claiming compliance.
- **Current Unit 05 status:** **IN PROGRESS; BLOCKED FOR CLOSURE pending contrast evidence and reviewer disposition.** This supersedes the earlier readiness note; reported manual outcomes remain developer-reported, and no approval is recorded. Unit 06 implementation remains not started.

## Unit 06 readiness audit (2026-10-20)

- **Unit 05 gate:** manual browser outcomes remain PASS — developer-reported, not Codex-verified. Re-review of `context/ui-context.md` found an explicit contrast-testing rule; contrast was not reported. Unit 05 remains **IN PROGRESS; blocked for closure** pending contrast evidence and reviewer disposition. Screen-reader basics remain untested for the Unit 17 release verification; no approval is inferred.
- **Unit 06 status:** **BLOCKED; implementation not started.** The active `docs/units/UNIT_06_SPEC.md` is a draft with no implementation authorization. D-01–D-10 remain unresolved in the decision log/checklist. Required gates include Unit 05 disposition; official FRD/TRD baseline; approved actor/assurance for customer case creation; migration baseline/rollout; and customer-facing CRM outage/ACK/retry/reconciliation contract.
- **Other stage decisions:** D-05 duplicate matching, D-06 customer status, D-07 audit/timeline retention, D-08 idempotency contract, and Unit 06/07 UI scope must be resolved before their affected schema/service/API/UI stages. No implementation, migration, test, provider, CRM, or banking operation was performed for this readiness audit.
- **Audit report:** `docs/units/UNIT_06_READINESS_AUDIT.md`. Recommendations in it do not constitute mentor, product, security, DB, or operations approval.

## Unit 05 contrast follow-up (2026-10-20)

- **Source review:** Re-inspected active `web-workspace/src/app.css` and `App.jsx`. The contrast changes documented in the Unit 05 audit are already present: secondary text for placeholder/counter, chat-scoped dark focus outline and composer focus ring, explicit disabled/sending palettes. Chat labels, keyboard submit behavior, loading/status/error semantics, and responsive rules remain present. No application source change was necessary.
- **Build:** `npm.cmd run build` from `web-workspace` — **PASS**, Vite 5.4.21, 32 modules, 769 ms. No frontend test script or browser automation framework is configured.
- **Runtime:** Edge headless rendered `/customer/chat` at 1440×1000 and showed the authentication-required panel. Without a customer session, composer/focus/loading/error states were not visible; no keyboard or contrast sampling is claimed.
- **Target note:** Requirements traceability maps draft FRD §17.1 NFR-09 to WCAG 2.1 AA; signed FRD v1.0 remains unavailable. Ratios in the contrast audit use WCAG 2.2 AA as a technical reference, not a separately approved project threshold.
- **Gate:** Unit 05 remains **IN PROGRESS; BLOCKED FOR CLOSURE** pending authenticated chat-state/browser verification and reviewer disposition of the evidence/baseline. Unit 06 remains blocked and not started.

## Unit 06 readiness re-audit (2026-10-20)

- **Requester report:** The requester says they manually tested Unit 05 and consider it okay to continue. Codex did not repeat those tests; no detailed checklist/artifact or reviewer disposition was attached. This authorizes the requested readiness review only and does not mark Unit 05 COMPLETE/APPROVED or authorize Unit 06 source work.
- **Source probe:** Direct `intent.classify()` probe for “Transaksi saya gagal, tetapi saldo saya terpotong.” returned `INFO_ACCOUNT_BALANCE`, confidence 0.7, `CLARIFY`. This is a pure-function probe, not a pytest result; no case was created.
- **Approvals:** D-01–D-10 remain UNRESOLVED in the decision register; approval checklist remains blank. Fresh source findings and per-decision choices/risks/recommendations/approvers are in `docs/units/UNIT_06_READINESS_AUDIT.md`.
- **Test/migration boundary:** No pytest suite or migration ran. Relevant pytest fixtures drop/create tables or remove `eaics_test.db`; tests were not run to protect database contents. No live DB schema was inspected. `git status` could not run because this folder has no discovered `.git` metadata.
- **Unit 06:** **BLOCKED for implementation.** Continue approval/specification work only. No Unit 07 work started.

## Unit 05 current-session verification (2026-10-20)

- **Fresh frontend build:** `npm.cmd run build` in `web-workspace` passed (Vite 5.4.21, 32 modules, 648 ms). No frontend test script or Playwright/Puppeteer/WebDriver harness is configured/installed.
- **Frontend serving:** started Vite with `npm.cmd run dev -- --host 127.0.0.1`; it became ready on port 5173. `GET /customer/login` and `GET /customer/chat` both returned HTTP 200 with the SPA root shell. These GETs do not establish browser rendering, login, or chat behavior.
- **Backend:** `GET http://127.0.0.1:8000/healthz` was unavailable (connection refused). The backend was not started because importing `app/main.py` invokes `Base.metadata.create_all()`; starting it would not be a read-only check.
- **Login access conditions:** `CustomerLogin` displays “Login lokal belum diaktifkan” unless `VITE_ENABLE_DEV_CUSTOMER_AUTH` is enabled; when enabled it calls `/v1/dev-auth/customer/login`. A configured development identity and a running backend are required. The chat route requires a customer session. No credentials/config secrets were read and no login/chat POST was sent.
- **Contrast/source:** re-inspection found the earlier placeholder/counter, focus, disabled, and sending palette fixes still present; no new source defect and no CSS/source edit. Existing calculated ratios remain static, not runtime contrast evidence.
- **Not run in this session:** Enter/Shift+Enter, blank/repeated sends, authenticated history reload, error/retry/fallback/handoff behavior, keyboard focus, 1440 px/390 px browser rendering, dynamic contrast, and assistive technology. The developer-reported manual results elsewhere remain reported results, not Codex-verified results.
- **Environment limitation:** `git status --short` failed because this active project path is not recognized as a Git repository; no clean/dirty status is asserted.
- **Unit 05 status:** remains **IN PROGRESS; BLOCKED FOR CLOSURE**. Required final evidence is a safe authenticated browser run covering the chat journey and specified responsive/keyboard/dynamic states, plus reviewer confirmation/disposition of the contrast baseline and gate evidence. Do not mark COMPLETE/APPROVED on the basis of build/SPA GET/source checks.
