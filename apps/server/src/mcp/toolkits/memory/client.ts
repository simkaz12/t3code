import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

import * as Settings from "../../../serverSettings.ts";

const REQUEST_TIMEOUT = "10 seconds";
const ERROR_DETAIL_LIMIT = 300;

export const MemoryKind = Schema.Literals(["decision", "fact"]);
export type MemoryKind = typeof MemoryKind.Type;

export const MemoryOrigin = Schema.Literals(["agent", "harvest", "cleaner", "promotion"]);
export type MemoryOrigin = typeof MemoryOrigin.Type;

export const MemorySource = Schema.Literals(["v2", "legacy"]);

export const MemoryReasonClass = Schema.Literals(["correction", "changed", "elaborated"]);
export type MemoryReasonClass = typeof MemoryReasonClass.Type;

export const MemoryProposalFields = Schema.Struct({
  claim: Schema.String,
  why: Schema.String,
  rejected: Schema.optional(Schema.NullOr(Schema.String)),
});

export const MemoryRecordFields = Schema.Struct({
  claim: Schema.String,
  why: Schema.String,
  rejected: Schema.NullOr(Schema.String),
});

export const MemoryProposalProvenance = Schema.Struct({
  threadId: Schema.String,
  threadTitle: Schema.String,
  projectId: Schema.String,
  branch: Schema.NullOr(Schema.String),
  machine: Schema.String,
  link: Schema.String,
  excerpt: Schema.String,
});

export const MemoryProposalTarget = Schema.Struct({
  recordId: Schema.String,
  source: MemorySource,
  action: Schema.Literals(["retire", "supersede", "merge", "promote"]),
  replacementId: Schema.optional(Schema.NullOr(Schema.String)),
  recordHeadline: Schema.optional(Schema.NullOr(Schema.String)),
  replacementHeadline: Schema.optional(Schema.NullOr(Schema.String)),
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});

export interface MemoryProposeBody {
  readonly kind: MemoryKind;
  readonly headline: string;
  readonly fields: typeof MemoryProposalFields.Type;
  readonly scope: string;
  readonly provenance: typeof MemoryProposalProvenance.Type;
  readonly origin: MemoryOrigin;
  readonly target?: typeof MemoryProposalTarget.Type;
}

export const MemoryRelation = Schema.Struct({
  pick: Schema.String,
  confidence: Schema.Number,
  probabilities: Schema.Record(Schema.String, Schema.Number),
  reasonClass: Schema.NullOr(MemoryReasonClass),
});
export type MemoryRelation = typeof MemoryRelation.Type;

export const MemoryNeighbour = Schema.Struct({
  id: Schema.String,
  source: MemorySource,
  headline: Schema.String,
  similarity: Schema.Number,
  relation: Schema.NullOr(MemoryRelation),
});
export type MemoryNeighbour = typeof MemoryNeighbour.Type;

export const MemorySuggestion = Schema.Struct({
  action: Schema.Literals(["reinforce", "supersede"]),
  recordId: Schema.String,
  source: MemorySource,
  reasonClass: Schema.NullOr(MemoryReasonClass),
});
export type MemorySuggestion = typeof MemorySuggestion.Type;

export const MemoryChecks = Schema.Struct({
  status: Schema.Literals(["ok", "unavailable", "skipped"]),
  reason: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  wordingHashes: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  answers: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  relations: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type MemoryChecks = typeof MemoryChecks.Type;

export const MemoryProposal = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["pending", "approved", "rejected", "reinforced"]),
  kind: MemoryKind,
  headline: Schema.String,
  fields: MemoryRecordFields,
  scope: Schema.String,
  provenance: MemoryProposalProvenance,
  origin: MemoryOrigin,
  target: Schema.NullOr(MemoryProposalTarget),
  purpose: Schema.NullOr(Schema.String),
  topic: Schema.NullOr(Schema.String),
  checks: MemoryChecks,
  flags: Schema.Array(Schema.String),
  neighbours: Schema.Array(MemoryNeighbour),
  suggestion: Schema.NullOr(MemorySuggestion),
  createdAt: Schema.String,
  resolvedAt: Schema.NullOr(Schema.String),
});
export type MemoryProposal = typeof MemoryProposal.Type;

export const MemoryRecallResult = Schema.Struct({
  id: Schema.String,
  source: MemorySource,
  kind: MemoryKind,
  headline: Schema.String,
  fields: MemoryRecordFields,
  scope: Schema.String,
  purpose: Schema.NullOr(Schema.String),
  topic: Schema.NullOr(Schema.String),
  score: Schema.Number,
});
export type MemoryRecallResult = typeof MemoryRecallResult.Type;

const RecallResponse = Schema.Struct({ results: Schema.Array(MemoryRecallResult) });
const ProposalList = Schema.Array(MemoryProposal);
const RecordBody = Schema.Record(Schema.String, Schema.Unknown);

export interface MemoryApproveBody {
  readonly edits?: {
    readonly headline?: string;
    readonly fields?: {
      readonly claim?: string | undefined;
      readonly why?: string | undefined;
      readonly rejected?: string | null | undefined;
    };
    readonly scope?: string;
    readonly purpose?: string;
    readonly topic?: string;
  };
  readonly supersedes?: ReadonlyArray<string>;
  readonly reason?: string;
}

export interface MemoryRecallQuery {
  readonly q: string;
  readonly scope?: string | undefined;
  readonly kind?: MemoryKind | undefined;
  readonly limit?: number | undefined;
}

export class MemoryClientError extends Schema.TaggedError<MemoryClientError>()(
  "MemoryClientError",
  {
    reason: Schema.Literals(["not-configured", "unreachable", "rejected", "invalid-response"]),
    detail: Schema.optional(Schema.String),
    status: Schema.optional(Schema.Int),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-configured":
        return `Memory is not configured${this.detail ? ` (${this.detail})` : ""}: set memoryServerUrl in the T3 Code settings.`;
      case "unreachable":
        return `The memory server could not be reached${this.detail ? `: ${this.detail}` : "."}`;
      case "rejected":
        return `The memory server refused the request${this.status ? ` (${this.status})` : ""}${
          this.detail ? `: ${this.detail}` : "."
        }`;
      case "invalid-response":
        return `The memory server sent an unexpected answer${this.detail ? `: ${this.detail}` : "."}`;
    }
  }
}

export interface MemoryClientShape {
  readonly propose: (body: MemoryProposeBody) => Effect.Effect<MemoryProposal, MemoryClientError>;
  readonly recall: (
    query: MemoryRecallQuery,
  ) => Effect.Effect<ReadonlyArray<MemoryRecallResult>, MemoryClientError>;
  readonly get: (id: string) => Effect.Effect<Readonly<Record<string, unknown>>, MemoryClientError>;
  readonly pending: (
    since?: string,
  ) => Effect.Effect<ReadonlyArray<MemoryProposal>, MemoryClientError>;
  readonly approve: (
    id: string,
    body: MemoryApproveBody,
  ) => Effect.Effect<Readonly<Record<string, unknown>>, MemoryClientError>;
  readonly reject: (id: string, reason?: string) => Effect.Effect<void, MemoryClientError>;
  readonly reinforce: (id: string, recordId: string) => Effect.Effect<void, MemoryClientError>;
}

export class MemoryClient extends Context.Service<MemoryClient, MemoryClientShape>()(
  "t3/mcp/toolkits/memory/client/MemoryClient",
) {}

const FLAG_LABELS: Readonly<Record<string, string>> = {
  kind_differs: "kind differs from declared",
  worth_not_keep: "worth is not keep",
  perishable_not_standing: "may not stay true",
  rejected_missing: "decision has no rejected alternative",
  jev_unavailable: "checks unavailable",
  restatement: "restates an existing record",
  replacement: "replaces an existing record",
  relation_unavailable: "relation check failed",
};

const humanize = (value: string) => value.replaceAll("_", " ");

function flagLabel(flag: string): string {
  const [code = flag, ...rest] = flag.split(":");
  const known = FLAG_LABELS[code];
  if (known !== undefined) return known;
  if (code === "shape_low") return `weak shape: ${humanize(rest[0] ?? "")}`.trimEnd();
  if (code === "low_confidence") return `low confidence: ${humanize(rest[0] ?? "")}`.trimEnd();
  return flag;
}

const idList = (raw: unknown): ReadonlyArray<string> => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
};

const normalizeRecord = (
  body: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  "collapsedIds" in body ? { ...body, collapsedIds: idList(body.collapsedIds) } : body;

export const flagLabels = (flags: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.from(new Set(flags.map(flagLabel)));

const trimBase = (value: string) => value.trim().replace(/\/+$/, "");

const validBase = (value: string) =>
  Effect.try({
    try: () => {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not http");
      return trimBase(url.toString());
    },
    catch: () =>
      new MemoryClientError({
        reason: "not-configured",
        detail: "memoryServerUrl is not an http(s) URL",
      }),
  });

const makeMemoryClient = (
  http: HttpClient.HttpClient,
  baseUrl: Effect.Effect<string, MemoryClientError>,
): MemoryClientShape => {
  const send = Effect.fn("MemoryClient.send")(function* (
    method: "GET" | "POST" | "DELETE",
    path: string,
    options?: {
      readonly query?: Readonly<Record<string, string | undefined>>;
      readonly body?: unknown;
    },
  ) {
    const base = yield* baseUrl;
    const query = Object.fromEntries(
      Object.entries(options?.query ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const bare = HttpClientRequest.make(method)(`${base}${path}`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setUrlParams(query),
    );
    const request =
      options?.body === undefined
        ? bare
        : yield* HttpClientRequest.bodyJson(bare, options.body).pipe(
            Effect.mapError(
              (error) =>
                new MemoryClientError({ reason: "invalid-response", detail: error.message }),
            ),
          );
    const response = yield* http
      .execute(request)
      .pipe(
        Effect.mapError(
          (error) => new MemoryClientError({ reason: "unreachable", detail: error.message }),
        ),
      );
    if (response.status >= 300) {
      const detail = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* new MemoryClientError({
        reason: "rejected",
        status: response.status,
        detail: Array.from(detail).slice(0, ERROR_DETAIL_LIMIT).join(""),
      });
    }
    return response;
  });

  const decoded = <A>(schema: Schema.Decoder<A>) => {
    const decode = Schema.decodeUnknownEffect(schema);
    return (response: HttpClientResponse.HttpClientResponse) =>
      response.json.pipe(
        Effect.flatMap(decode),
        Effect.mapError(
          (error) => new MemoryClientError({ reason: "invalid-response", detail: error.message }),
        ),
      );
  };

  const call = <A>(
    operation: string,
    run: Effect.Effect<A, MemoryClientError>,
  ): Effect.Effect<A, MemoryClientError> =>
    run.pipe(
      Effect.timeoutOrElse({
        duration: REQUEST_TIMEOUT,
        orElse: () =>
          Effect.fail(new MemoryClientError({ reason: "unreachable", detail: "timed out" })),
      }),
      Effect.withSpan(`MemoryClient.${operation}`),
    );

  const segment = encodeURIComponent;

  return {
    propose: (body) =>
      call(
        "propose",
        send("POST", "/proposals", { body }).pipe(Effect.flatMap(decoded(MemoryProposal))),
      ),
    recall: (query) =>
      call(
        "recall",
        send("GET", "/recall", {
          query: {
            q: query.q,
            scope: query.scope,
            kind: query.kind,
            limit: query.limit === undefined ? undefined : String(query.limit),
          },
        }).pipe(
          Effect.flatMap(decoded(RecallResponse)),
          Effect.map((response) => response.results),
        ),
      ),
    get: (id) =>
      call(
        "get",
        send("GET", `/records/${segment(id)}`).pipe(
          Effect.flatMap(decoded(RecordBody)),
          Effect.map(normalizeRecord),
        ),
      ),
    pending: (since) =>
      call(
        "pending",
        send("GET", "/proposals", { query: { status: "pending", since } }).pipe(
          Effect.flatMap(decoded(ProposalList)),
        ),
      ),
    approve: (id, body) =>
      call(
        "approve",
        send("POST", `/proposals/${segment(id)}/approve`, { body }).pipe(
          Effect.flatMap(decoded(RecordBody)),
        ),
      ),
    reject: (id, reason) =>
      call(
        "reject",
        send("POST", `/proposals/${segment(id)}/reject`, {
          body: reason === undefined ? {} : { reason },
        }).pipe(Effect.asVoid),
      ),
    reinforce: (id, recordId) =>
      call(
        "reinforce",
        send("POST", `/proposals/${segment(id)}/reinforce`, { body: { recordId } }).pipe(
          Effect.asVoid,
        ),
      ),
  };
};

export const layer = Layer.effect(
  MemoryClient,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const settings = yield* Settings.ServerSettingsService;
    const baseUrl = settings.getSettings.pipe(
      Effect.mapError(
        () => new MemoryClientError({ reason: "not-configured", detail: "settings unreadable" }),
      ),
      Effect.flatMap(({ memoryServerUrl }) =>
        memoryServerUrl === ""
          ? Effect.fail(new MemoryClientError({ reason: "not-configured" }))
          : validBase(memoryServerUrl),
      ),
    );
    return MemoryClient.of(makeMemoryClient(http, baseUrl));
  }),
);
