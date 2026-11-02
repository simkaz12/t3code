// @effect-diagnostics nodeBuiltinImport:off - the stub memory server is a real node:http server.
import * as NodeHttp from "node:http";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ThreadHarvest,
  type Project,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";

import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as MemoryClient from "./client.ts";
import * as MemoryHandlers from "./handlers.ts";
import { MemoryToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:memory");
const threadId = ThreadId.make("thread:memory");
const projectId = ProjectId.make("project:mcp-test");

const proposalResponse = {
  id: "proposal-1",
  status: "pending",
  kind: "fact",
  headline: "tinker needs the oktra-be container",
  fields: { claim: "claim", why: "why", rejected: null },
  scope: "oktra",
  provenance: {
    threadId,
    threadTitle: "Fix tinker",
    projectId,
    branch: "feature/tinker",
    machine: "laptop",
    link: "t3-thread://x",
    excerpt: "",
  },
  origin: "agent",
  target: null,
  purpose: "pitfall",
  topic: null,
  checks: {
    status: "ok",
    model: "jev-1.13.0",
    answers: { kind: { choice: "decision", confidence: 0.8, probabilities: { decision: 0.8 } } },
    relations: {},
  },
  flags: ["kind_differs", "low_confidence:purpose", "restatement:rec-1"],
  neighbours: [
    {
      id: "rec-1",
      source: "v2",
      headline: "Existing tinker note",
      similarity: 0.93,
      relation: {
        pick: "restatement",
        confidence: 0.9,
        probabilities: { restatement: 0.9, distinct: 0.1 },
        reasonClass: null,
      },
    },
  ],
  suggestion: { action: "reinforce", recordId: "rec-1", source: "v2", reasonClass: null },
  createdAt: "2026-11-01T10:00:00.000Z",
  resolvedAt: null,
  resolution: null,
};

const message = (index: number, role: "user" | "assistant", text: string) =>
  ({
    createdBy: "user",
    creationSource: "web",
    id: MessageId.make(`message:${index}`),
    threadId,
    runId: null,
    nodeId: null,
    role,
    text,
    attachments: [],
    streaming: false,
    createdAt: DateTime.makeUnsafe(1_700_000_000_000 + index * 1000),
    updatedAt: DateTime.makeUnsafe(1_700_000_000_000 + index * 1000),
  }) satisfies OrchestrationV2ConversationMessage;

const project = (workspaceRoot: string): Project => ({
  id: projectId,
  title: "Project",
  workspaceRoot,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

interface HarvestState {
  current: OrchestrationV2ThreadHarvest | null;
  items: Array<{ readonly position: number; readonly sourceItemId: string }>;
  readonly stamped: Array<OrchestrationV2ThreadHarvest | null>;
}

const harvestState = (itemCount: number): HarvestState => ({
  current: null,
  items: Array.from({ length: itemCount }, (_, position) => ({
    position,
    sourceItemId: `item:${position}`,
  })),
  stamped: [],
});

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

const readBody = (request: NodeHttp.IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

const stubServer = Effect.acquireRelease(
  Effect.promise(
    () =>
      new Promise<{ url: string; requests: Array<Recorded>; close: () => Promise<void> }>(
        (resolve) => {
          const requests: Array<Recorded> = [];
          const server = NodeHttp.createServer((request, response) => {
            void readBody(request).then((raw) => {
              requests.push({
                method: request.method ?? "",
                url: request.url ?? "",
                body: raw === "" ? undefined : JSON.parse(raw),
              });
              const url = new URL(request.url ?? "/", "http://stub");
              response.setHeader("content-type", "application/json");
              if (request.method === "POST" && url.pathname === "/v2/proposals") {
                response.statusCode = 201;
                response.end(JSON.stringify(proposalResponse));
              } else if (url.pathname === "/v2/recall") {
                response.end(
                  JSON.stringify({
                    results: [
                      {
                        id: "rec-1",
                        source: "legacy",
                        kind: "fact",
                        headline: "Existing tinker note",
                        fields: { claim: "claim", why: "", rejected: null },
                        scope: "oktra",
                        purpose: "pitfall",
                        topic: null,
                        score: 0.8,
                      },
                    ],
                  }),
                );
              } else if (url.pathname === "/v2/records/rec-1") {
                response.end(
                  JSON.stringify({
                    id: "rec-1",
                    headline: "Existing tinker note",
                    source: "legacy",
                    collapsedIds: JSON.stringify(["old-1", "old-2"]),
                    lineage: { supersededBy: null, supersedes: [] },
                  }),
                );
              } else {
                response.statusCode = 404;
                response.end("not found");
              }
            });
          });
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            resolve({
              url: `http://127.0.0.1:${port}/v2`,
              requests,
              close: () => new Promise<void>((done) => server.close(() => done())),
            });
          });
        },
      ),
  ),
  (server) => Effect.promise(() => server.close()),
);

const callTool = Effect.fn("memoryTest.call")(function* <A, E, R>(options: {
  readonly memoryServerUrl: string;
  readonly memoryScope?: string;
  readonly workspaceRoot?: string;
  readonly messages?: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly harvest?: HarvestState;
  readonly call: (toolkit: Effect.Success<typeof MemoryToolkit>) => Effect.Effect<A, E, R>;
}) {
  const harvest = options.harvest ?? harvestState(0);
  const shell = { ...liveThreadShell(threadId), title: "Fix tinker", branch: "feature/tinker" };
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    memoryServerUrl: options.memoryServerUrl,
    projectSettingsOverrides:
      options.memoryScope === undefined
        ? {}
        : { [projectId]: { memoryScope: options.memoryScope } },
  };
  const layerDependencies = Layer.mergeAll(
    NodeCrypto.layer,
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId,
      requestNamespace: "provider:memory",
      thread: {
        threadId,
        providerSessionId: "provider:memory",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      capabilities: new Set(["orchestration" as const]),
      issuedAt: 0,
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () => Effect.succeed({ ...shell, harvest: harvest.current }),
      getTimelinePage: (_threadId, page) => {
        const matching =
          page.itemId === undefined
            ? harvest.items.filter((item) => item.position > (page.afterPosition ?? -1))
            : harvest.items.filter((item) => item.sourceItemId === page.itemId);
        return Effect.succeed({
          items: matching.slice(0, page.limit),
          totalItems: harvest.items.length,
          hasMore: matching.length > page.limit,
        }) as never;
      },
      getProjectThreadRecords: () =>
        Effect.succeed({
          ...idleThreadProjection(shell),
          messages: options.messages ?? [],
        }) as never,
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      setHarvestCheckpoint: (input) =>
        Effect.sync(() => {
          harvest.current = input.harvest;
          harvest.stamped.push(input.harvest);
        }),
    }),
    Layer.mock(Environment.ServerEnvironment)({
      getDescriptor: Effect.succeed({
        environmentId,
        label: "laptop",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "0.0.0",
        capabilities: { repositoryIdentity: false },
      }),
    }),
    Layer.mock(Settings.ServerSettingsService)({ getSettings: Effect.succeed(settings) }),
    Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeedSome(project(options.workspaceRoot ?? "/work/oktra-be")),
    }),
    MemoryClient.layer.pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(
        Layer.mock(Settings.ServerSettingsService)({ getSettings: Effect.succeed(settings) }),
      ),
    ),
  );
  const toolkit = yield* MemoryToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(MemoryHandlers.layer).pipe(
        Layer.provide(layerDependencies),
      ),
    ),
  );
  return yield* options.call(toolkit).pipe(Effect.provide(layerDependencies), Effect.orDie);
});

const collect = <E, R>(stream: Stream.Stream<{ readonly result: unknown }, E, R>) =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((results) => results.at(-1)?.result),
  );

const proposeInput = {
  kind: "fact",
  headline: "tinker needs the oktra-be container",
  claim: "Run tinker inside the container.",
  why: "Outside it psysh cannot reach the database.",
} as const;

it.effect("sends provenance, the last six messages and the scope from the setting", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;
      const messages = Array.from({ length: 8 }, (_, index) =>
        message(index, index % 2 === 0 ? "user" : "assistant", `turn ${index}`),
      );

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        memoryScope: "oktra",
        messages: [...messages].reverse(),
        call: (toolkit) =>
          toolkit.handle("memory_propose", proposeInput).pipe(Stream.unwrap, collect),
      });

      const sent = stub.requests.find((request) => request.method === "POST");
      expect(sent?.url).toBe("/v2/proposals");
      expect(sent?.body).toMatchObject({
        kind: "fact",
        headline: proposeInput.headline,
        fields: { claim: proposeInput.claim, why: proposeInput.why },
        scope: "oktra",
        origin: "agent",
        provenance: {
          threadId,
          threadTitle: "Fix tinker",
          projectId,
          branch: "feature/tinker",
          machine: "laptop",
        },
      });
      const body = sent?.body as { provenance: { excerpt: string; link: string } };
      const { provenance } = body;
      expect(provenance.link).toMatch(/^t3-thread:\/\/v2\/.+thread:memory$/);
      expect(provenance.excerpt.split("\n\n")).toEqual([
        "user: turn 2",
        "assistant: turn 3",
        "user: turn 4",
        "assistant: turn 5",
        "user: turn 6",
        "assistant: turn 7",
      ]);
      expect(result).toMatchObject({
        proposalId: "proposal-1",
        status: "pending",
        flags: [
          "kind differs from declared",
          "low confidence: purpose",
          "restates an existing record",
        ],
        neighbours: [{ id: "rec-1", source: "v2", similarity: 0.93, relation: "restatement" }],
      });
    }),
  ),
);

it.effect("falls back to the repository directory name when no scope is set", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;

      yield* callTool({
        memoryServerUrl: stub.url,
        workspaceRoot: "/home/sim/Projects/oktra-be/",
        call: (toolkit) =>
          toolkit
            .handle("memory_propose", { ...proposeInput, origin: "harvest" })
            .pipe(Stream.unwrap, collect),
      });

      expect(stub.requests[0]?.body).toMatchObject({ scope: "oktra-be", origin: "harvest" });
    }),
  ),
);

it.effect("refuses a decision without a rejected alternative before calling the server", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit
            .handle("memory_propose", { ...proposeInput, kind: "decision" })
            .pipe(Stream.unwrap, collect),
      });

      expect(result).toMatchObject({ code: "invalid_request" });
      expect(stub.requests).toEqual([]);
    }),
  ),
);

it.effect("tells the agent when no memory server is configured", () =>
  Effect.gen(function* () {
    const result = yield* callTool({
      memoryServerUrl: "",
      call: (toolkit) =>
        toolkit.handle("memory_propose", proposeInput).pipe(Stream.unwrap, collect),
    });

    expect(result).toMatchObject({ code: "invalid_request" });
    expect(JSON.stringify(result)).toContain("not configured");
  }),
);

it.effect("recalls in the project scope and reads one record", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;

      const recalled = yield* callTool({
        memoryServerUrl: stub.url,
        memoryScope: "oktra",
        call: (toolkit) =>
          toolkit
            .handle("memory_recall", { query: "tinker psysh", kind: "fact", limit: 5 })
            .pipe(Stream.unwrap, collect),
      });
      const read = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit.handle("memory_get", { id: "rec-1" }).pipe(Stream.unwrap, collect),
      });

      const query = new URL(stub.requests[0]?.url ?? "", "http://stub").searchParams;
      expect(Object.fromEntries(query)).toEqual({
        q: "tinker psysh",
        scope: "oktra",
        kind: "fact",
        limit: "5",
      });
      expect(recalled).toMatchObject({ results: [{ id: "rec-1", source: "legacy" }] });
      expect(read).toMatchObject({ id: "rec-1", collapsedIds: ["old-1", "old-2"] });
      expect(stub.requests[1]?.url).toBe("/v2/records/rec-1");
    }),
  ),
);

const beginHarvestCall = (stub: { readonly url: string }, harvest: HarvestState) =>
  callTool({
    memoryServerUrl: stub.url,
    harvest,
    call: (toolkit) => toolkit.handle("memory_harvest_begin", {}).pipe(Stream.unwrap, collect),
  });

it.effect("stamps the first harvest at the last message and reads from the start", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;
      const harvest = harvestState(450);

      const result = yield* beginHarvestCall(stub, harvest);

      expect(result).toEqual({ afterPosition: -1, since: null, threadId });
      expect(harvest.current).toMatchObject({
        position: 449,
        itemId: "item:449",
        runId: "run:mcp-test",
        pendingRunId: null,
      });
      expect(stub.requests).toEqual([]);
    }),
  ),
);

it.effect(
  "refuses to begin a harvest and leaves the checkpoint alone when memory is not configured",
  () =>
    Effect.gen(function* () {
      const harvest = harvestState(5);

      const result = yield* beginHarvestCall({ url: "" }, harvest);

      expect(result).toMatchObject({ code: "invalid_request" });
      expect(JSON.stringify(result)).toContain("not configured");
      expect(harvest.stamped).toEqual([]);
      expect(harvest.current).toBeNull();
    }),
);

it.effect("returns the previous stamp on the second harvest and moves the checkpoint", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;
      const harvest = harvestState(10);

      yield* beginHarvestCall(stub, harvest);
      const first = harvest.current;
      harvest.items.push({ position: 10, sourceItemId: "item:10" });
      const result = yield* beginHarvestCall(stub, harvest);

      expect(result).toEqual({
        afterPosition: 9,
        since: first === null ? null : DateTime.formatIso(first.at),
        threadId,
      });
      expect(harvest.current).toMatchObject({ position: 10, itemId: "item:10" });
      expect(harvest.stamped).toHaveLength(2);
    }),
  ),
);

it.effect("treats a pending-only stamp with position -1 as no previous checkpoint", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;
      const harvest = harvestState(5);
      harvest.current = {
        at: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
        position: -1,
        itemId: null,
        runId: null,
        pendingRunId: "run:pending",
      };

      const result = yield* beginHarvestCall(stub, harvest);

      expect(result).toEqual({ afterPosition: -1, since: null, threadId });
      expect(harvest.current).toMatchObject({ position: 4, pendingRunId: null });
    }),
  ),
);

it.effect("never returns a position past the last item after a rollback", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;
      const harvest = harvestState(10);

      yield* beginHarvestCall(stub, harvest);
      harvest.items = harvest.items.slice(0, 4);
      const result = (yield* beginHarvestCall(stub, harvest)) as { afterPosition: number };

      expect(result.afterPosition).toBeLessThanOrEqual(3);
      expect(harvest.current).toMatchObject({ position: 3, itemId: "item:3" });
    }),
  ),
);

it.effect("follows the checkpoint item when positions shift", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;
      const harvest = harvestState(10);

      yield* beginHarvestCall(stub, harvest);
      harvest.items = [
        { position: 0, sourceItemId: "item:9" },
        ...Array.from({ length: 3 }, (_, index) => ({
          position: index + 1,
          sourceItemId: `item:new${index}`,
        })),
      ];
      const result = yield* beginHarvestCall(stub, harvest);

      expect(result).toMatchObject({ afterPosition: 0 });
    }),
  ),
);

it.effect("caps the excerpt at 2,000 characters from the latest message back", () =>
  Effect.sync(() => {
    const excerpt = MemoryHandlers.buildExcerpt([
      { role: "user", text: "a".repeat(1500) },
      { role: "assistant", text: `${"b".repeat(1500)}END` },
    ]);

    expect(Array.from(excerpt)).toHaveLength(2000);
    expect(excerpt.endsWith("bbbEND")).toBe(true);
  }),
);
