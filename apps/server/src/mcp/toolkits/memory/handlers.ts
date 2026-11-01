import {
  OrchestratorMcpFailure,
  type OrchestrationV2ThreadShell,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { type Caller, loadCaller, unavailable } from "../../threadAccess.ts";
import { flagLabels, MemoryClient, MemoryClientError } from "./client.ts";
import { MemoryToolkit } from "./tools.ts";

const EXCERPT_MESSAGES = 6;
const EXCERPT_CHARACTERS = 2000;

const bareLink = (link: string) => link.replace(/^<(.*)>$/, "$1");

function repoDirectoryName(workspaceRoot: string): string {
  const segments = workspaceRoot.split(/[\\/]+/).filter((segment) => segment !== "");
  return segments.at(-1) ?? "";
}

export function buildExcerpt(messages: ReadonlyArray<{ role: string; text: string }>): string {
  const characters = Array.from(
    messages
      .filter((message) => message.text.trim() !== "")
      .slice(-EXCERPT_MESSAGES)
      .map((message) => `${message.role}: ${message.text.trim()}`)
      .join("\n\n"),
  );
  return characters.slice(-EXCERPT_CHARACTERS).join("");
}

const memoryFailure = (error: MemoryClientError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "not-configured" ? "invalid_request" : "orchestration_error",
    message: error.message,
  });

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const projectScope = Effect.fn("MemoryToolkit.projectScope")(function* (projectId: ProjectId) {
  const settings = yield* (yield* Settings.ServerSettingsService).getSettings.pipe(
    Effect.mapError(unavailable),
  );
  const configured = resolveProjectSettings(settings, projectId).settings.memoryScope;
  if (configured !== "") return configured;

  const project = yield* (yield* ProjectService.ProjectService)
    .getById(projectId)
    .pipe(Effect.mapError(unavailable));
  const directory = Option.isSome(project) ? repoDirectoryName(project.value.workspaceRoot) : "";
  if (directory === "")
    return yield* invalid("This project has no memory scope: set memoryScope in its settings.");

  return directory;
});

const threadExcerpt = Effect.fn("MemoryToolkit.excerpt")(function* (
  threads: Caller["threads"],
  caller: OrchestrationV2ThreadShell,
) {
  const records = yield* threads
    .getProjectThreadRecords({ projectId: caller.projectId, threadId: caller.id }, ["messages"], {
      messageRoles: ["user", "assistant"],
    })
    .pipe(Effect.mapError(unavailable));
  const ordered = records.messages.toSorted(
    (a, b) => DateTime.toEpochMillis(a.createdAt) - DateTime.toEpochMillis(b.createdAt),
  );

  return buildExcerpt(ordered);
});

export const layer = McpToolAccess.toLayer(MemoryToolkit, {
  memory_propose: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { scope, threads, caller } = yield* loadCaller();
      if (caller === undefined) return yield* invalid("memory_propose needs a calling thread.");
      if (input.kind === "decision" && input.rejected === undefined)
        return yield* invalid("A decision needs `rejected`: the alternative that was ruled out.");

      const client = yield* MemoryClient;
      const environment = yield* ServerEnvironment.ServerEnvironment;
      const memoryScope = yield* projectScope(caller.projectId);
      const descriptor = yield* environment.getDescriptor;
      const excerpt = yield* threadExcerpt(threads, caller);

      const proposal = yield* client
        .propose({
          kind: input.kind,
          headline: input.headline,
          fields: {
            claim: input.claim,
            why: input.why,
            ...(input.rejected === undefined ? {} : { rejected: input.rejected }),
          },
          scope: memoryScope,
          provenance: {
            threadId: caller.id,
            threadTitle: caller.title,
            projectId: caller.projectId,
            branch: caller.branch,
            machine: descriptor.label,
            link: bareLink(McpInvocationContext.threadLinkFor(scope, caller.id)),
            excerpt,
          },
          origin: input.origin ?? "agent",
        })
        .pipe(Effect.mapError(memoryFailure));

      return {
        proposalId: proposal.id,
        status: proposal.status,
        flags: flagLabels(proposal.flags),
        neighbours: proposal.neighbours.map(({ id, source, headline, similarity, relation }) => ({
          id,
          source,
          headline,
          similarity,
          relation: relation?.pick ?? null,
        })),
      };
    }),
  ),
  memory_recall: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { caller } = yield* loadCaller();
      const client = yield* MemoryClient;
      const scope =
        input.scope ?? (caller === undefined ? undefined : yield* projectScope(caller.projectId));

      const results = yield* client
        .recall({ q: input.query, scope, kind: input.kind, limit: input.limit })
        .pipe(Effect.mapError(memoryFailure));

      return { results };
    }),
  ),
  memory_get: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const client = yield* MemoryClient;

      return yield* client.get(input.id).pipe(Effect.mapError(memoryFailure));
    }),
  ),
});
