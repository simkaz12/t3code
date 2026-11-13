import { OrchestratorMcpFailure, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  MemoryAudience,
  MemoryClient,
  MemoryDefectStatus,
  MemoryKind,
  MemoryRecallResult,
  MemorySource,
  MemoryTakenBy,
} from "./client.ts";

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

const MemoryProposeTool = Tool.make("memory_propose", {
  ...shared,
  description:
    "Propose a memory. The server saves it at once and returns `recordId`; the cleaner reviews it later. `status` is `approved` for a new record, or `reinforced` when the server counted your proposal against an existing record and wrote nothing new, and then `recordId` is that record. Status `asked` means the note is held, not saved: `ask` carries the existing record and the reply to give, and you answer with `memory_answer` in the same turn. `kind`: fact, decision (needs `rejected`) or defect (needs `where`, `trigger`, `left_because`; `claim` is the symptom). `headline` is the claim in one sentence. No ticket ids, dates or file:line in `claim`. `closes` closes that defect at once. `flags` and `neighbours` show what the checks found and which saved records are close.",
  parameters: Schema.Struct({
    kind: MemoryKind,
    headline: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
    claim: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
    rejected: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(2000))),
    where: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
    trigger: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(1000))),
    left_because: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(1000))),
    fix_hint: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(1000))),
    impact: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(1000))),
    audience: Schema.optional(MemoryAudience),
    stage: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(40))),
    closes: Schema.optional(TrimmedNonEmptyString),
  }),
  success: Schema.Struct({
    proposalId: Schema.String,
    status: Schema.String,
    recordId: Schema.NullOr(Schema.String),
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
    ask: Schema.NullOr(
      Schema.Struct({
        proposalId: Schema.String,
        existing: Schema.Struct({
          id: Schema.String,
          kind: MemoryKind,
          headline: Schema.String,
          claim: Schema.String,
          rejected: Schema.NullOr(Schema.String),
        }),
        instruction: Schema.String,
      }),
    ),
  }),
})
  .annotate(Tool.Title, "Propose a memory")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const MemoryAnswerTool = Tool.make("memory_answer", {
  ...shared,
  description:
    "Answer a held `memory_propose` (status `asked`). Pass `answers` (its `proposalId`) and either one merged note (`kind`, `headline`, `claim`, and `rejected` for a decision) that replaces both records, or `keep_both` with a one-line reason naming the fact in the existing note that your note is not about. Returns the resulting `status` and `recordId`.",
  parameters: Schema.Struct({
    answers: TrimmedNonEmptyString,
    keep_both: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
    kind: Schema.optional(Schema.Literals(["fact", "decision"])),
    headline: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(100))),
    claim: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(2000))),
    rejected: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(2000))),
  }),
  success: Schema.Struct({
    proposalId: Schema.String,
    status: Schema.String,
    recordId: Schema.NullOr(Schema.String),
  }),
})
  .annotate(Tool.Title, "Answer a held memory")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const MemoryRecallTool = Tool.make("memory_recall", {
  ...shared,
  description:
    "Search saved memory: approved records and the legacy archive. Defaults to this project's scope; `scope` searches another, `kind` filters, `audience` keeps records written for that role or for everyone. Each result names its `source` (v2 or legacy).",
  parameters: Schema.Struct({
    query: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
    scope: Schema.optional(TrimmedNonEmptyString),
    kind: Schema.optional(MemoryKind),
    audience: Schema.optional(MemoryAudience),
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

const DefectState = Schema.Struct({
  recordId: Schema.String,
  defectStatus: MemoryDefectStatus,
  takenBy: Schema.NullOr(MemoryTakenBy),
});

const MemoryTakeTool = Tool.make("memory_take", {
  ...shared,
  description:
    "Mark an open defect as taken by this thread because you are folding its fix into current work. Returns the defect's status. A take left for 14 days reverts to open.",
  parameters: Schema.Struct({ recordId: TrimmedNonEmptyString }),
  success: DefectState,
})
  .annotate(Tool.Title, "Take a defect")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const MemoryReleaseTool = Tool.make("memory_release", {
  ...shared,
  description:
    "Return a taken defect to open when the work that took it will not fix it. Returns the defect's status.",
  parameters: Schema.Struct({ recordId: TrimmedNonEmptyString }),
  success: DefectState,
})
  .annotate(Tool.Title, "Release a defect")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const MemoryToolkit = Toolkit.make(
  MemoryProposeTool,
  MemoryAnswerTool,
  MemoryRecallTool,
  MemoryGetTool,
  MemoryTakeTool,
  MemoryReleaseTool,
);
