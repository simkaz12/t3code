# Verification — memory redesign (t3code, scopes 6–10)

Brief: ~/.claude/specs/2026-11-03-memory-redesign.md
Revision: dev @ fbfe56a994139fbb2ade201035b5d51a055e9635 (pull-base: tree unchanged, local dev 2 ahead of origin), work uncommitted
Environment: real memory handlers and MemoryClient against an in-process Tabularium v2 (HashEmbedder, stubJev) on 127.0.0.1:18791; tray driven earlier by main in `vp run dev` (state ~/.t3/dev) against a local v2 on 127.0.0.1:18789 with memoryServerUrl http://127.0.0.1:18789/v2; 10.8.0.1:8789 untouched
Identity: dev pairing token, owner account
Fingerprint 22fe1eb4c6fab6234b8ce4cf563611929a5c2380cb3657a116b4ffbcf7b01e0d, computed with:

    cd /home/sim/Projects/t3code && { git diff HEAD -- apps/server/src/mcp/toolkits/memory/client.test.ts apps/server/src/mcp/toolkits/memory/client.ts apps/server/src/mcp/toolkits/memory/handlers.test.ts apps/server/src/mcp/toolkits/memory/handlers.ts apps/server/src/mcp/toolkits/memory/tools.ts apps/server/src/memory/MemoryProposalPoller.test.ts apps/server/src/memory/MemoryProposalPoller.ts apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts apps/server/src/orchestration-v2/IdleHarvestWorker.test.ts apps/server/src/orchestration-v2/IdleHarvestWorker.ts apps/server/src/orchestration-v2/Orchestrator.ts apps/server/src/ws.ts apps/web/src/components/memory/MemoryDetails.tsx apps/web/src/components/memory/MemoryTile.tsx apps/web/src/components/memory/memoryTray.logic.test.ts apps/web/src/components/memory/memoryTray.logic.ts apps/web/src/components/memory/MemoryTray.tsx packages/client-runtime/src/t3ToolSummary.ts packages/contracts/src/orchestrationV2.ts packages/contracts/src/rpc.ts packages/provider-core/src/server/orchestrationInstructions.ts packages/shared/src/t3McpToolPresentation.ts; cat apps/server/src/memory/MemoryNoticeService.test.ts apps/server/src/memory/MemoryNoticeService.ts; } | sha256sum

## Criteria

Wire and worker (hand-ex, live against the local v2):

| Criterion | Observed | Result |
|---|---|---|
| memory_propose fact / decision+audience+stage / defect; defect missing left_because → invalid_request "A defect needs `left_because`."; no `why` in the schema | as stated | PASS |
| pending() carries kind, section, audience, reader, stage, defect fields | as stated | PASS |
| approve with edits.audience null clears audience; reject without reason surfaces 400 "reason is required"; with reason ok | as stated | PASS |
| memory_take → taken + takenBy; memory_release → open, takenBy null | as stated | PASS |
| closes → pending tile with target.action close and recordHeadline; approve → defectStatus closed, closedBy | as stated | PASS |
| memory_recall audience builder and kind defect carry the new top-level fields | as stated | PASS |
| IdleHarvestWorker skips a span holding memory_propose (Claude, bare and t3-code. forms), stamps the checkpoint, reads activity view (D10) | tests named in the run, all green | PASS |
| orchestrationInstructions lines 27 and 29 equal the brief's scope 7 text (D10a); Memory section 1739 bytes < 4000 | as stated | PASS |
| Tray-empty notice: one message.dispatch with memoryNotice tray-empty, queue_after_active, commandId server:memory-notice:<thread>:<batch>; one flush per empty-tray event with concurrent actions; none after an unconfigured poll (D11, D12) | tests named in the run, all green | PASS |

Tray (main, Browser panel, this fingerprint, earlier in the thread):

| Criterion | Observed | Result |
|---|---|---|
| Real and weak sections; badge counts real only | Proposals (3), Weak (1) collapsed, badge 3; expands to show the weak tile | PASS |
| Reject needs a reason | reason bar with placeholder, Reject disabled while empty, empty Enter ignored, typed `a`/`r` fired no shortcut, Enter with text rejected; v2 stored the reason | PASS |
| Audience edit on approve | details select; `a` in the select did not approve; Approve stored audience reviewer | PASS |
| Defect tile layout | `where` line above the claim | PASS |
| Close tile | "Closes: <headline>" and the Close approve label; approving closed the record | PASS |
| Tray-empty notice | origin thread received "Memory tray resolved: 4 approved (…, edited; …), 1 rejected (…: reason)" | PASS |

## Regression
apps/server `vp test run src/memory src/mcp/toolkits/memory src/orchestration-v2/IdleHarvestWorker.test.ts`: 5 files, 75 passed. apps/web `src/components/memory`: 2 files, 55 passed. provider-core orchestrationInstructions test: 5 passed. `tsc --noEmit` clean in apps/server, apps/web, packages/contracts, packages/shared, packages/client-runtime, packages/provider-core. No testing.md section for t3code (no snapshot configured). Red results: none.

## Verdict
PASS. Note: a `why` sent to memory_propose is dropped by the handler rather than rejected at the transport; harmless.
