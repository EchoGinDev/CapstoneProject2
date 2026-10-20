# Unit 05 — Customer Information Conversation and Truthful Handoff

Status: this information-flow implementation slice is complete; full Unit 05 remains in progress pending browser journey/accessibility verification.

## Source status and scope

The repository contains FRD-EAICS-001 v0.9 draft for mentor review and TRD-EAICS-001 v0.9 draft. The TRD references a frozen FRD v1.0, but no signed FRD v1.0 or signed TRD §16 integration approval was found. This slice uses only behaviors stated unambiguously in the available drafts; it does not claim approved final compliance.

This is the next eligible build-plan unit (Unit 05), dependent on completed Units 03–04. It implements one customer conversation slice: deterministic greeting, a supported informational fee question answered from eligible knowledge with persisted citations, truthful queue state for required handoff, and citation visibility in history. Complaint/case creation and full staff handoff context are explicitly deferred to Units 06 and 08. Until then, generic request/complaint fallback copy must not claim a case or staff follow-up that did not occur.

## Requirement trace

| Requirement | Source | Required behavior | Actor/component | Acceptance evidence |
|---|---|---|---|---|
| FR-INT-001, FR-INT-004 | FRD §6.4, pp. 42–44; TRD §4.5 | Closed taxonomy; `OTHER_UNCLASSIFIED` stays a mandatory human-handoff path; do not guess an unsupported intent. | Customer, intent service, orchestrator | Unknown text remains unclassified and creates a queued handoff; regression test retains mandatory handoff. |
| FR-INT-003 | FRD §6.4, pp. 43–44 | Clarification is bounded and offered when confidence is in the clarification band; known greeting should not be treated as unknown. | Customer, intent service | “Halo” returns a deterministic greeting with no handoff. |
| FR-INT-007 | FRD §6.4, p. 45 | Safety/vulnerability conditions take priority and require human handoff. | Customer, intent/orchestrator/queue | Existing vulnerability test plus persisted queue state for a forced handoff. |
| FR-KM-003 | FRD §6.5, pp. 46–48 | Customer information answers use applicable published/current sources, are grounded and cited; insufficient evidence abstains and may offer handoff. | Customer, retrieval/orchestrator | Fee inquiry returns the seeded published passage, citation article/version/body locator/score, persists it, and passes grounding; section-anchor gap is explicitly open; expired or non-published versions are excluded. |
| FR-KM-004 | FRD §6.5, p. 48 | Customer-facing retrieval excludes internal knowledge. | Customer, knowledge retrieval | Existing access-level filter remains; verify no internal article appears in returned evidence. |
| FR-ORC-001, FR-ORC-006, FR-ORC-009 | FRD §6.8 / §14; TRD §4.8 and §8 | Deterministic workflow and policy, validate evidence/claims, do not assert unperformed actions or unconfirmed handoff. | Orchestrator, guardrail, queue | No LLM tool authority; grounded answer accepted; handoff text reports queued or unavailable and never implies agent acceptance unless queue state confirms it. |
| FR-WS-001, FR-WS-002 | FRD §7.2, pp. 71–74; TRD §4.13 | Handoff work enters a queue with reason/priority and context sufficient for the human workflow. | Orchestrator, queue, agent | Queue row persists with tenant and reason. It is explicitly `package_complete=false`; full context package remains a Unit 08 gap. |
| FR-CONV-003 | FRD §6.2, pp. 31–34; TRD §7.3 | Persist conversation history and expose source provenance to the customer. | Conversation API and customer portal | Persisted outbound message contains citations; customer history renders source title and passage anchor. |

## Existing path and confirmed defects

`POST /v1/chat/messages` in `app/modules/routes_a.py` authenticates and persists the inbound message, then calls `orchestrator.run_turn`. The orchestrator uses deterministic `intent.classify`; no LLM provider/gateway is invoked in `run_turn`. `LLM_PROVIDER=stub` is configuration but does not explain the repeated response.

For a text with no configured keyword, `intent.classify` returns `OTHER_UNCLASSIFIED` and `HANDOFF`; this is the documented mandatory behavior. The orchestrator then returned “Saya hubungkan ke petugas manusia agar dibantu lebih lanjut.” without persisting a `HandoffRow`. Therefore the wording was untruthful. A supported query such as “Berapa biaya transfer internasional?” matched only the broad `biaya` token and was scored into clarification, despite the matching published seed article. Separately, the groundedness call supplied citation titles but empty bodies, so source numbers could be rejected as unsupported. These were independent causes.

## Implementation decisions

- Retain the closed taxonomy and mandatory handoff for truly unclassified intent. Add phrase evidence for the supported seed article topic; do not lower the global ACT threshold.
- Treat recognized greeting intent as a deterministic conversational response, not a knowledge answer or handoff.
- Retrieval filters published article and version, access level, tenant, language relevance, and both article/version effective and expiry times.
- Citation response and stored message retain article ID, version ID, the actual `body` source locator, and retrieval score. Grounding checks actual retrieved text, not citation metadata alone. The model has no section anchors, so this does not satisfy the FRD's section-anchor requirement; `§1` is not fabricated.
- Required handoff attempts create a tenant-scoped `HandoffRow`; an existing active queue row is reused to avoid another open queue entry. Customer response says request queued only after successful persistence and distinguishes queue state from agent acceptance.
- New handoff rows set `package_complete=false`. The current row contains routing metadata but does not persist the full FR-WS-001 context package; Unit 08 remains responsible for completing the staff read model/context.
- Unsupported request/complaint action fallbacks confirm only that the inbound message is saved in the conversation; they do not claim ticket/case creation or staff follow-up.
- LLM remains unused for this flow. No provider credentials were added or tested.

## Changed boundaries

- `app/modules/intent.py`: phrase-level evidence for the supported fee article and greeting decision.
- `app/modules/knowledge.py`: current published version/effective window filtering, actual body locator, and retrieval score in citations.
- `app/modules/orchestrator.py`: deterministic greeting, passage-grounded validation, persisted handoff queue and truthful state copy.
- `web-workspace/src/App.jsx`: handoff status feedback and citations in selected history.
- `tests/test_a_skeleton.py`: supported cited answer, history persistence, greeting, and queued mandatory handoff regression tests.

## Verification

- Focused: `python -m pytest tests/test_a_skeleton.py -q -p no:cacheprovider` — 10 passed before adding the version lifecycle and duplicate-queue assertions.
- Full backend: `python -m pytest -q -p no:cacheprovider` — 43 passed, 96 dependency deprecation warnings.
- Frontend: `npm.cmd run build` from `web-workspace` — passed; Vite transformed 32 modules.
- No browser automation or live LLM request is claimed.

## Remaining work / risks

- Full suite/build pass; rerun after any subsequent code change.
- Verify the customer UI in an actual browser at mobile/desktop widths and by keyboard; browser automation was not run in this session so far.
- Complete FR-WS-001 package and agent handoff context in Unit 08; do not mark package complete before then.
- Implement the complaint/case path in Unit 06; current chat classifier does not itself satisfy the FRD complaint case workflow.
- Lexical retrieval is not vector RAG, ingestion/review lifecycle remains Unit 11, and no LLM inference occurred.
- Knowledge article schema has no section/anchor representation; citations identify the stored body field, not an FRD section anchor.
- Draft/version approval and signed integration-contract discrepancies remain unresolved.

## Composer Enter-key follow-up (2026-10-20)

- **Diagnosis:** `CustomerChat()` used a multiline `<textarea>` inside a form with only `onSubmit={send}`. Native Enter in a textarea inserts a newline; no composer key handler submitted the form. Clicking the send button already used the correct `send` path.
- **Change:** Plain Enter now calls the form's native `requestSubmit()` path; Shift+Enter and IME composition remain native. The send function has a synchronous ref lock to prevent overlapping submissions before React updates the loading state. Whitespace/disabled states remain guarded, and the form still prevents navigation/reload.
- **Verification:** `npm.cmd run build` in `web-workspace` passed (Vite 5.4.21; 32 modules). No frontend interaction test framework is installed. Browser interaction, browser-console review, retry, duplicate-request, Shift+Enter and focus behavior were not executed in this follow-up; Unit 05 remains in progress until manual/browser verification is recorded.

## Customer conversation UI refresh (2026-10-16)

- The existing customer landing, login presentation, and `/customer/chat` were visually redesigned without changing conversation endpoints, payloads, auth/session handling, or orchestration behavior.
- Empty conversation includes prompt chips that fill (but do not submit) the composer. Loading, API error, citation, and handoff states are rendered from actual UI/API state; a successful queue message still distinguishes queueing from staff acceptance. Resend uses the existing same-text idempotency key; no regenerate action was added.
- Frontend production build passed and the public shell was visually inspected at desktop and a 390px emulated mobile viewport. Keyboard Enter was verified for the mobile menu and protected chat route. Authenticated chat/API journey, broader keyboard coverage, and assistive-technology checks remain pending because the browser environment has no configured trusted session provider and no frontend E2E test framework.
- This refresh does not enable Gemini or add any runtime LLM call. FRD v0.9 draft versus TRD v0.9 reference to FRD v1.0 remains unresolved; the UX reference PDF named in the request was not present in the repository.
