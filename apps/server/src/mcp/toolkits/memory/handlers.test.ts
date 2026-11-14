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
  type Project,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";

import * as Environment from "../../../environment/ServerEnvironment.ts";
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
  status: "approved",
  kind: "fact",
  headline: "tinker needs the acme-api container",
  fields: { claim: "claim", rejected: null },
  scope: "acme",
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
  audience: "builder",
  reader: "trap",
  suggestion: { action: "reinforce", recordId: "rec-1", source: "v2", reasonClass: null },
  createdAt: "2026-11-01T10:00:00.000Z",
  resolvedAt: "2026-11-01T10:00:00.000Z",
  resolution: { recordId: "rec-2" },
};

const reinforcedResponse = {
  ...proposalResponse,
  id: "proposal-2",
  status: "reinforced",
  resolution: { recordId: "rec-1" },
};

const askedResponse = {
  ...proposalResponse,
  id: "proposal-3",
  status: "asked",
  headline: "The acme report sync is nightly, hourly was rejected",
  fields: {
    claim: "The acme report sync stays nightly; hourly hit the API rate limit.",
    rejected: null,
  },
  flags: [],
  neighbours: [],
  suggestion: null,
  resolvedAt: null,
  resolution: null,
  ask: {
    existing: {
      id: "rec-9",
      source: "v2",
      kind: "decision",
      headline: "The acme report sync runs nightly at 03:00",
      fields: {
        claim: "The acme report sync runs nightly at 03:00.",
        rejected: "Hourly runs, because of the reporting API rate limit.",
      },
    },
    similarity: 0.86,
    sameSubject: 0.8,
    newCoversOld: 0.4,
    existingIsFold: false,
    askedAt: "2026-11-13T10:00:00.000Z",
    expiresAt: "2026-11-13T10:10:00.000Z",
    answer: null,
    answeredAt: null,
    reason: null,
    foldRecordId: null,
    foldCoversOld: null,
    foldCoversNew: null,
  },
};

const foldedResponse = {
  ...askedResponse,
  status: "folded",
  resolvedAt: "2026-11-13T10:01:00.000Z",
  resolution: { recordId: "rec-10" },
};

const coversResponse = {
  ...proposalResponse,
  id: "proposal-4",
  flags: ["covers:rec-1"],
  neighbours: [],
  suggestion: null,
};

const takenDefect = {
  id: "defect-1",
  kind: "defect",
  defectStatus: "taken",
  takenBy: { threadId, link: "t3-thread://x", at: "2026-11-03T10:00:00.000Z" },
};
const releasedDefect = { id: "defect-1", kind: "defect", defectStatus: "open", takenBy: null };

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

const stubServerWith = (
  proposal: unknown,
  answer: { readonly status: number; readonly body: unknown } = {
    status: 200,
    body: foldedResponse,
  },
) =>
  Effect.acquireRelease(
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
                  response.end(JSON.stringify(proposal));
                } else if (
                  request.method === "POST" &&
                  url.pathname === "/v2/proposals/proposal-3/answer"
                ) {
                  response.statusCode = answer.status;
                  response.end(JSON.stringify(answer.body));
                } else if (url.pathname === "/v2/recall") {
                  response.end(
                    JSON.stringify({
                      results: [
                        {
                          id: "rec-1",
                          source: "legacy",
                          kind: "fact",
                          headline: "Existing tinker note",
                          fields: { claim: "claim", rejected: null },
                          audience: "builder",
                          reader: "lookup",
                          scope: "acme",
                          purpose: "pitfall",
                          topic: null,
                          score: 0.8,
                        },
                      ],
                    }),
                  );
                } else if (
                  request.method === "POST" &&
                  url.pathname === "/v2/records/defect-1/take"
                ) {
                  response.end(JSON.stringify(takenDefect));
                } else if (
                  request.method === "POST" &&
                  url.pathname === "/v2/records/defect-1/release"
                ) {
                  response.end(JSON.stringify(releasedDefect));
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

const stubServer = stubServerWith(proposalResponse);

const callTool = Effect.fn("memoryTest.call")(function* <A, E, R>(options: {
  readonly memoryServerUrl: string;
  readonly memoryScope?: string;
  readonly workspaceRoot?: string;
  readonly messages?: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly call: (toolkit: Effect.Success<typeof MemoryToolkit>) => Effect.Effect<A, E, R>;
}) {
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
      getThreadShell: () => Effect.succeed(shell),
      getProjectThreadRecords: () =>
        Effect.succeed({
          ...idleThreadProjection(shell),
          messages: options.messages ?? [],
        }) as never,
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
      getById: () => Effect.succeedSome(project(options.workspaceRoot ?? "/work/acme-api")),
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
  headline: "tinker needs the acme-api container",
  claim: "Run tinker inside the container.",
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
        memoryScope: "acme",
        messages: [...messages].reverse(),
        call: (toolkit) =>
          toolkit.handle("memory_propose", proposeInput).pipe(Stream.unwrap, collect),
      });

      const sent = stub.requests.find((request) => request.method === "POST");
      expect(sent?.url).toBe("/v2/proposals");
      expect(sent?.body).toMatchObject({
        kind: "fact",
        headline: proposeInput.headline,
        fields: { claim: proposeInput.claim },
        scope: "acme",
        origin: "agent",
        provenance: {
          threadId,
          threadTitle: "Fix tinker",
          projectId,
          branch: "feature/tinker",
          machine: "laptop",
          stage: "",
        },
      });
      expect(JSON.stringify(sent?.body)).not.toContain("why");
      expect(sent?.body).not.toHaveProperty("audience");
      expect(sent?.body).not.toHaveProperty("target");
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
        status: "approved",
        recordId: "rec-2",
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

it.effect("reports a reinforced proposal with the neighbour's recordId", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServerWith(reinforcedResponse);

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        memoryScope: "acme",
        call: (toolkit) =>
          toolkit.handle("memory_propose", proposeInput).pipe(Stream.unwrap, collect),
      });

      expect(result).toMatchObject({
        proposalId: "proposal-2",
        status: "reinforced",
        recordId: "rec-1",
      });
    }),
  ),
);

it.effect("labels a covers flag and returns no ask when the save went through", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServerWith(coversResponse);

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        memoryScope: "acme",
        call: (toolkit) =>
          toolkit.handle("memory_propose", proposeInput).pipe(Stream.unwrap, collect),
      });

      expect(result).toMatchObject({
        status: "approved",
        flags: ["covers an existing record"],
        ask: null,
      });
    }),
  ),
);

it.effect("hands an asked proposal back with the existing record and the instruction", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServerWith(askedResponse);

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        memoryScope: "acme",
        call: (toolkit) =>
          toolkit
            .handle("memory_propose", {
              kind: "decision",
              headline: "The acme report sync is nightly, hourly was rejected",
              claim: "The acme report sync stays nightly.",
              rejected: "Hourly runs, because they hit the API rate limit.",
            })
            .pipe(Stream.unwrap, collect),
      });

      expect(result).toMatchObject({
        proposalId: "proposal-3",
        status: "asked",
        recordId: null,
        ask: {
          proposalId: "proposal-3",
          existing: {
            id: "rec-9",
            kind: "decision",
            headline: "The acme report sync runs nightly at 03:00",
            claim: "The acme report sync runs nightly at 03:00.",
            rejected: "Hourly runs, because of the reporting API rate limit.",
          },
        },
      });
      const { ask } = result as { ask: { instruction: string } };
      expect(ask.instruction).toContain("Your note was not saved yet.");
      expect(ask.instruction).toContain("The acme report sync runs nightly at 03:00.");
      expect(ask.instruction).toContain(
        "Rejected: Hourly runs, because they hit the API rate limit.",
      );
      expect(ask.instruction).toContain('memory_answer with answers: "proposal-3"');
    }),
  ),
);

const askedWithWhy = {
  ...askedResponse,
  ask: {
    ...askedResponse.ask,
    existing: {
      ...askedResponse.ask.existing,
      fields: {
        ...askedResponse.ask.existing.fields,
        why: "Lost three round trips on 2026-11-02. Confirm the copy with diff -rq a b.",
      },
    },
  },
};

const proposeAsked = (response: typeof askedResponse) =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServerWith(response);

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        memoryScope: "acme",
        call: (toolkit) =>
          toolkit
            .handle("memory_propose", {
              kind: "decision",
              headline: "The acme report sync is nightly, hourly was rejected",
              claim: "The acme report sync stays nightly.",
              rejected: "Hourly runs, because they hit the API rate limit.",
            })
            .pipe(Stream.unwrap, collect),
      });

      return (result as { ask: { instruction: string } }).ask.instruction;
    }),
  );

it.effect("shows the existing why and the carry-over rule in the ask instruction", () =>
  Effect.gen(function* () {
    const withWhy = yield* proposeAsked(askedWithWhy as typeof askedResponse);
    const without = yield* proposeAsked(askedResponse);

    expect(withWhy).toContain(
      "Why it was saved: Lost three round trips on 2026-11-02. Confirm the copy with diff -rq a b.",
    );
    expect(withWhy).toContain("The merged note has no why field.");
    expect(without).not.toContain("Why it was saved");
    expect(without).not.toContain("no why field");
    expect(
      withWhy
        .split("\n")
        .filter((line) => !line.startsWith("Why it was saved:") && !line.includes("no why field"))
        .join("\n"),
    ).toBe(without);
  }),
);

it.effect("sends a merged note as a fold answer and reports the fold record", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServerWith(askedResponse);

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit
            .handle("memory_answer", {
              answers: "proposal-3",
              kind: "decision",
              headline: "The acme report sync is nightly at 03:00",
              claim: "The acme report sync runs nightly at 03:00.",
              rejected: "Hourly runs, because of the reporting API rate limit.",
            })
            .pipe(Stream.unwrap, collect),
      });

      expect(stub.requests).toEqual([
        {
          method: "POST",
          url: "/v2/proposals/proposal-3/answer",
          body: {
            action: "fold",
            kind: "decision",
            headline: "The acme report sync is nightly at 03:00",
            fields: {
              claim: "The acme report sync runs nightly at 03:00.",
              rejected: "Hourly runs, because of the reporting API rate limit.",
            },
          },
        },
      ]);
      expect(result).toEqual({ proposalId: "proposal-3", status: "folded", recordId: "rec-10" });
    }),
  ),
);

it.effect("sends keep_both as a reason only", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServerWith(askedResponse, {
        status: 200,
        body: { ...askedResponse, status: "approved", resolution: { recordId: "rec-11" } },
      });

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit
            .handle("memory_answer", {
              answers: "proposal-3",
              keep_both: "The existing note is about the 03:00 start time.",
            })
            .pipe(Stream.unwrap, collect),
      });

      expect(stub.requests[0]?.body).toEqual({
        action: "keep_both",
        reason: "The existing note is about the 03:00 start time.",
      });
      expect(result).toEqual({ proposalId: "proposal-3", status: "approved", recordId: "rec-11" });
    }),
  ),
);

it.effect("surfaces the server's 409 message on an answer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServerWith(askedResponse, {
        status: 409,
        body: { error: "proposal already answered" },
      });

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit
            .handle("memory_answer", { answers: "proposal-3", keep_both: "A different fact." })
            .pipe(Stream.unwrap, collect),
      });

      expect(result).toMatchObject({ code: "orchestration_error" });
      expect(JSON.stringify(result)).toContain("409");
      expect(JSON.stringify(result)).toContain("proposal already answered");
    }),
  ),
);

it.effect("refuses an answer that mixes keep_both with a note or leaves it incomplete", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServerWith(askedResponse);

      const mixed = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit
            .handle("memory_answer", {
              answers: "proposal-3",
              keep_both: "A different fact.",
              claim: "A merged claim.",
            })
            .pipe(Stream.unwrap, collect),
      });
      const incomplete = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit
            .handle("memory_answer", { answers: "proposal-3", claim: "A merged claim." })
            .pipe(Stream.unwrap, collect),
      });
      const decision = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit
            .handle("memory_answer", {
              answers: "proposal-3",
              kind: "decision",
              headline: "Nightly sync",
              claim: "A merged claim.",
            })
            .pipe(Stream.unwrap, collect),
      });

      expect(mixed).toMatchObject({ code: "invalid_request" });
      expect(incomplete).toMatchObject({ code: "invalid_request" });
      expect(decision).toMatchObject({ code: "invalid_request" });
      expect(stub.requests).toEqual([]);
    }),
  ),
);

it.effect("falls back to the repository directory name when no scope is set", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;

      yield* callTool({
        memoryServerUrl: stub.url,
        workspaceRoot: "/home/user/projects/acme-api/",
        call: (toolkit) =>
          toolkit.handle("memory_propose", proposeInput).pipe(Stream.unwrap, collect),
      });

      expect(stub.requests[0]?.body).toMatchObject({ scope: "acme-api", origin: "agent" });
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

const defectInput = {
  kind: "defect",
  headline: "Cart totals drop the coupon on reload",
  claim: "The cart total ignores an applied coupon after a page reload.",
  where: "app/Cart/TotalCalculator.php",
  trigger: "Apply a coupon, then reload the cart page.",
  left_because: "The fix belongs to the pricing rewrite.",
  fix_hint: "Read the coupon from the session in the calculator.",
  audience: "navigator",
  stage: "recon",
} as const;

it.effect("proposes a defect with its fields, audience and stage", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;

      yield* callTool({
        memoryServerUrl: stub.url,
        memoryScope: "acme",
        call: (toolkit) =>
          toolkit.handle("memory_propose", defectInput).pipe(Stream.unwrap, collect),
      });

      expect(stub.requests[0]?.body).toMatchObject({
        kind: "defect",
        headline: defectInput.headline,
        fields: {
          claim: defectInput.claim,
          where: defectInput.where,
          trigger: defectInput.trigger,
          left_because: defectInput.left_because,
          fix_hint: defectInput.fix_hint,
        },
        audience: "navigator",
        provenance: { stage: "recon" },
      });
      expect(stub.requests[0]?.body).not.toHaveProperty("target");
    }),
  ),
);

it.effect("refuses a defect missing a required field before calling the server", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;
      const { trigger: _trigger, ...incomplete } = defectInput;

      const result = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit.handle("memory_propose", incomplete).pipe(Stream.unwrap, collect),
      });

      expect(result).toMatchObject({ code: "invalid_request" });
      expect(JSON.stringify(result)).toContain("trigger");
      expect(stub.requests).toEqual([]);
    }),
  ),
);

it.effect("sends a close target for the defect when a proposal carries closes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;

      yield* callTool({
        memoryServerUrl: stub.url,
        memoryScope: "acme",
        call: (toolkit) =>
          toolkit
            .handle("memory_propose", {
              kind: "fact",
              headline: "Coupon survives a cart reload",
              claim: "The reload test in CartReloadTest now passes with the coupon applied.",
              closes: "defect-1",
              stage: "land",
            })
            .pipe(Stream.unwrap, collect),
      });

      expect(stub.requests[0]?.body).toMatchObject({
        kind: "fact",
        target: { recordId: "defect-1", source: "v2", action: "close" },
        provenance: { stage: "land" },
      });
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
        memoryScope: "acme",
        call: (toolkit) =>
          toolkit
            .handle("memory_recall", {
              query: "tinker psysh",
              kind: "fact",
              audience: "builder",
              limit: 5,
            })
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
        scope: "acme",
        kind: "fact",
        audience: "builder",
        limit: "5",
      });
      expect(recalled).toMatchObject({
        results: [{ id: "rec-1", source: "legacy", audience: "builder", reader: "lookup" }],
      });
      expect(read).toMatchObject({ id: "rec-1", collapsedIds: ["old-1", "old-2"] });
      expect(stub.requests[1]?.url).toBe("/v2/records/rec-1");
    }),
  ),
);

it.effect("takes a defect for the calling thread and releases it with no body", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer;

      const taken = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit.handle("memory_take", { recordId: "defect-1" }).pipe(Stream.unwrap, collect),
      });
      const released = yield* callTool({
        memoryServerUrl: stub.url,
        call: (toolkit) =>
          toolkit.handle("memory_release", { recordId: "defect-1" }).pipe(Stream.unwrap, collect),
      });

      expect(stub.requests[0]).toMatchObject({
        method: "POST",
        url: "/v2/records/defect-1/take",
        body: { threadId },
      });
      const sent = stub.requests[0]?.body as { link: string };
      expect(sent.link).toMatch(/^t3-thread:\/\/v2\/.+thread:memory$/);
      expect(taken).toMatchObject({
        recordId: "defect-1",
        defectStatus: "taken",
        takenBy: { threadId },
      });
      expect(stub.requests[1]).toMatchObject({
        method: "POST",
        url: "/v2/records/defect-1/release",
      });
      expect(released).toEqual({ recordId: "defect-1", defectStatus: "open", takenBy: null });
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
