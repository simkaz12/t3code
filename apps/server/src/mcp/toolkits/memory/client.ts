import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

import * as Settings from "../../../serverSettings.ts";

const REQUEST_TIMEOUT = "10 seconds";
const ERROR_DETAIL_LIMIT = 300;

export const MemoryKind = Schema.Literals(["decision", "fact", "defect"]);
export type MemoryKind = typeof MemoryKind.Type;

export const MemoryAudience = Schema.Literals(["decider", "builder", "reviewer", "navigator"]);
export type MemoryAudience = typeof MemoryAudience.Type;

export const MemoryDefectStatus = Schema.Literals(["open", "taken", "closed"]);
export type MemoryDefectStatus = typeof MemoryDefectStatus.Type;

export const MemoryOrigin = Schema.Literals(["agent", "cleaner", "promotion"]);
export type MemoryOrigin = typeof MemoryOrigin.Type;

export const MemorySource = Schema.Literals(["v2", "legacy"]);

export const MemoryReasonClass = Schema.Literals(["correction", "changed", "elaborated"]);
export type MemoryReasonClass = typeof MemoryReasonClass.Type;

export const MemoryProposalFields = Schema.Struct({
  claim: Schema.String,
  rejected: Schema.optional(Schema.NullOr(Schema.String)),
  where: Schema.optional(Schema.String),
  trigger: Schema.optional(Schema.String),
  left_because: Schema.optional(Schema.String),
  fix_hint: Schema.optional(Schema.String),
  impact: Schema.optional(Schema.String),
});

const optionalText = Schema.optional(Schema.NullOr(Schema.String));

const legacyWhy = Schema.optional(Schema.NullOr(Schema.String)).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformOptional((value) =>
      Option.some(Option.getOrElse(Option.flatMap(value, Option.fromNullishOr), () => "")),
    ),
    encode: SchemaGetter.transform((text: string) => text),
  }),
);

export const MemoryRecordFields = Schema.Struct({
  claim: Schema.String,
  why: legacyWhy,
  rejected: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  where: optionalText,
  trigger: optionalText,
  leftBecause: optionalText,
  fixHint: optionalText,
  impact: optionalText,
});

export const MemoryProposalProvenance = Schema.Struct({
  threadId: Schema.String,
  threadTitle: Schema.String,
  projectId: Schema.String,
  branch: Schema.NullOr(Schema.String),
  machine: Schema.String,
  link: Schema.String,
  excerpt: Schema.String,
  stage: Schema.optional(Schema.String),
});

export const MemoryProposalTarget = Schema.Struct({
  recordId: Schema.String,
  source: MemorySource,
  action: Schema.Literals(["retire", "supersede", "merge", "promote", "close"]),
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
  readonly audience?: MemoryAudience;
}

export const MemoryTakenBy = Schema.Struct({
  threadId: Schema.String,
  link: Schema.String,
  at: Schema.String,
});
export type MemoryTakenBy = typeof MemoryTakenBy.Type;

export interface MemoryDefectState {
  readonly recordId: string;
  readonly defectStatus: MemoryDefectStatus;
  readonly takenBy: MemoryTakenBy | null;
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
  audience: optionalText,
  reader: optionalText,
  defectStatus: Schema.optional(Schema.NullOr(MemoryDefectStatus)),
  takenBy: Schema.optional(Schema.NullOr(MemoryTakenBy)),
  checks: MemoryChecks,
  flags: Schema.Array(Schema.String),
  neighbours: Schema.Array(MemoryNeighbour),
  suggestion: Schema.NullOr(MemorySuggestion),
  createdAt: Schema.String,
  resolvedAt: Schema.NullOr(Schema.String),
  resolution: Schema.optional(
    Schema.NullOr(Schema.Struct({ recordId: Schema.NullOr(Schema.String) })),
  ),
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
  audience: optionalText,
  reader: optionalText,
  stage: optionalText,
  where: optionalText,
  trigger: optionalText,
  leftBecause: optionalText,
  defectStatus: Schema.optional(Schema.NullOr(MemoryDefectStatus)),
  takenBy: Schema.optional(Schema.NullOr(MemoryTakenBy)),
  score: Schema.Number,
});
export type MemoryRecallResult = typeof MemoryRecallResult.Type;

export const MemoryServerSettings = Schema.Struct({
  cleanerConfidenceFloor: Schema.Number,
});
export type MemoryServerSettings = typeof MemoryServerSettings.Type;

const RecallResponse = Schema.Struct({ results: Schema.Array(MemoryRecallResult) });
const ProposalList = Schema.Array(MemoryProposal);
const RecordBody = Schema.Record(Schema.String, Schema.Unknown);

export interface MemoryApproveBody {
  readonly edits?: {
    readonly headline?: string;
    readonly fields?: {
      readonly claim?: string | undefined;
      readonly rejected?: string | null | undefined;
      readonly where?: string | undefined;
      readonly trigger?: string | undefined;
      readonly leftBecause?: string | undefined;
      readonly fixHint?: string | undefined;
      readonly impact?: string | undefined;
    };
    readonly audience?: MemoryAudience | null;
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
  readonly audience?: MemoryAudience | undefined;
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
  readonly take: (
    id: string,
    taker: { readonly threadId: string; readonly link: string },
  ) => Effect.Effect<MemoryDefectState, MemoryClientError>;
  readonly release: (id: string) => Effect.Effect<MemoryDefectState, MemoryClientError>;
  readonly getSettings: () => Effect.Effect<MemoryServerSettings, MemoryClientError>;
  readonly updateSettings: (patch: {
    readonly cleanerConfidenceFloor: number;
  }) => Effect.Effect<MemoryServerSettings, MemoryClientError>;
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
  if (code === "demote") return `weak: ${humanize(rest.join(":"))}`;
  if (code === "unclear") return `unclear: ${humanize(rest.join(":"))}`;
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

const decodeTakenBy = Schema.decodeUnknownOption(MemoryTakenBy);
const decodeDefectStatus = Schema.decodeUnknownEffect(MemoryDefectStatus);

const takenByOf = (body: Readonly<Record<string, unknown>>): MemoryTakenBy | null => {
  const nested = decodeTakenBy(body.takenBy);
  if (Option.isSome(nested)) return nested.value;

  const { takenThreadId, takenLink, takenAt } = body;
  return typeof takenThreadId === "string" &&
    typeof takenLink === "string" &&
    typeof takenAt === "string"
    ? { threadId: takenThreadId, link: takenLink, at: takenAt }
    : null;
};

const defectStateOf = (
  recordId: string,
  body: Readonly<Record<string, unknown>>,
): Effect.Effect<MemoryDefectState, MemoryClientError> =>
  decodeDefectStatus(body.defectStatus).pipe(
    Effect.map((defectStatus) => ({ recordId, defectStatus, takenBy: takenByOf(body) })),
    Effect.mapError(
      (error) =>
        new MemoryClientError({
          reason: "invalid-response",
          detail: `no defect status: ${error.message}`,
        }),
    ),
  );

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

const configuredBase = (memoryServerUrl: string) =>
  memoryServerUrl === ""
    ? Effect.fail(new MemoryClientError({ reason: "not-configured" }))
    : validBase(memoryServerUrl);

const makeMemoryClient = (
  http: HttpClient.HttpClient,
  baseUrl: Effect.Effect<string, MemoryClientError>,
): MemoryClientShape => {
  const send = Effect.fn("MemoryClient.send")(function* (
    method: "GET" | "POST" | "PUT" | "DELETE",
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
            audience: query.audience,
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
    take: (id, taker) =>
      call(
        "take",
        send("POST", `/records/${segment(id)}/take`, { body: taker }).pipe(
          Effect.flatMap(decoded(RecordBody)),
          Effect.flatMap((body) => defectStateOf(id, body)),
        ),
      ),
    release: (id) =>
      call(
        "release",
        send("POST", `/records/${segment(id)}/release`, { body: {} }).pipe(
          Effect.flatMap(decoded(RecordBody)),
          Effect.flatMap((body) => defectStateOf(id, body)),
        ),
      ),
    getSettings: () =>
      call(
        "getSettings",
        send("GET", "/settings").pipe(Effect.flatMap(decoded(MemoryServerSettings))),
      ),
    updateSettings: (patch) =>
      call(
        "updateSettings",
        send("PUT", "/settings", { body: patch }).pipe(
          Effect.flatMap(decoded(MemoryServerSettings)),
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
      Effect.flatMap(({ memoryServerUrl }) => configuredBase(memoryServerUrl)),
    );
    return MemoryClient.of(makeMemoryClient(http, baseUrl));
  }),
);
