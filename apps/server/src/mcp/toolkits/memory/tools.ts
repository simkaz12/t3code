import { OrchestratorMcpFailure, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { MemoryClient, MemoryKind, MemoryRecallResult, MemorySource } from "./client.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
    ServerEnvironment.ServerEnvironment,
    Settings.ServerSettingsService,
    MemoryClient,
  ],
};

const MemoryHarvestBeginTool = Tool.make("memory_harvest_begin", {
  ...shared,
  dependencies: [...shared.dependencies, Orchestrator.OrchestratorV2, Crypto.Crypto],
  description:
    "Start a harvest of the calling thread. Stamps the checkpoint and returns `afterPosition` for t3_thread_read and `since`, the time of the previous harvest. Call it first, then read from `afterPosition`, then propose with origin harvest.",
  success: Schema.Struct({
    afterPosition: Schema.Int,
    since: Schema.NullOr(Schema.String),
    threadId: Schema.String,
  }),
})
  .annotate(Tool.Title, "Start a thread harvest")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const MemoryProposeTool = Tool.make("memory_propose", {
  ...shared,
  description:
    "Queue a memory for the user to approve. Nothing is saved until they do. `kind`: decision (needs `rejected`) or fact. `headline` names the topic in under 100 characters. Gotchas and decisions only, never status or session narrative. `flags` and `neighbours` show what the checks found and which saved records are close.",
  parameters: Schema.Struct({
    kind: MemoryKind,
    headline: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
    claim: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
    why: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
    rejected: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(2000))),
    origin: Schema.optional(Schema.Literals(["agent", "harvest"])),
  }),
  success: Schema.Struct({
    proposalId: Schema.String,
    status: Schema.String,
    flags: Schema.Array(Schema.String),
    neighbours: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        source: MemorySource,
        headline: Schema.String,
        similarity: Schema.Number,
        relation: Schema.NullOr(Schema.String),
      }),
    ),
  }),
})
  .annotate(Tool.Title, "Propose a memory")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const MemoryRecallTool = Tool.make("memory_recall", {
  ...shared,
  description:
    "Search saved memory: approved records and the legacy archive. Defaults to this project's scope; `scope` searches another, `kind` filters. Each result names its `source` (v2 or legacy).",
  parameters: Schema.Struct({
    query: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
    scope: Schema.optional(TrimmedNonEmptyString),
    kind: Schema.optional(MemoryKind),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))),
  }),
  success: Schema.Struct({ results: Schema.Array(MemoryRecallResult) }),
})
  .annotate(Tool.Title, "Search memory")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const MemoryGetTool = Tool.make("memory_get", {
  ...shared,
  description: "Read one memory record by `id`, with its supersession lineage.",
  parameters: Schema.Struct({ id: TrimmedNonEmptyString }),
  success: Schema.Record(Schema.String, Schema.Unknown),
})
  .annotate(Tool.Title, "Read a memory")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const MemoryToolkit = Toolkit.make(
  MemoryHarvestBeginTool,
  MemoryProposeTool,
  MemoryRecallTool,
  MemoryGetTool,
);
