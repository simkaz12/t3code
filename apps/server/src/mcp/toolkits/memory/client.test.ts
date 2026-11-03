// @effect-diagnostics nodeBuiltinImport:off - the stub memory server is a real node:http server.
import * as NodeHttp from "node:http";

import { assert, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";

import * as Settings from "../../../serverSettings.ts";
import * as MemoryClient from "./client.ts";

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

const stubServer = (respond: (request: Recorded) => { status: number; body: unknown }) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ url: string; requests: Array<Recorded>; close: () => Promise<void> }>(
          (resolve) => {
            const requests: Array<Recorded> = [];
            const server = NodeHttp.createServer((request, response) => {
              void readBody(request).then((raw) => {
                const recorded: Recorded = {
                  method: request.method ?? "",
                  url: request.url ?? "",
                  body: raw === "" ? undefined : JSON.parse(raw),
                };
                requests.push(recorded);
                const reply = respond(recorded);
                response.statusCode = reply.status;
                response.setHeader("content-type", "application/json");
                response.end(JSON.stringify(reply.body));
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

const withClient = <A, E>(
  memoryServerUrl: string,
  run: (client: MemoryClient.MemoryClientShape) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const client = yield* MemoryClient.MemoryClient;

    return yield* run(client);
  }).pipe(
    Effect.provide(
      MemoryClient.layer.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          Layer.mock(Settings.ServerSettingsService)({
            getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, memoryServerUrl }),
          }),
        ),
      ),
    ),
  );

it.effect("getSettings decodes the cleaner confidence floor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer(() => ({
        status: 200,
        body: { cleanerConfidenceFloor: 0.7 },
      }));

      const settings = yield* withClient(stub.url, (client) => client.getSettings());

      assert.deepEqual(settings, { cleanerConfidenceFloor: 0.7 });
      assert.equal(stub.requests[0]?.method, "GET");
      assert.equal(stub.requests[0]?.url, "/v2/settings");
    }),
  ),
);

it.effect("updateSettings sends PUT /settings with the body", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer(() => ({
        status: 200,
        body: { cleanerConfidenceFloor: 0.8 },
      }));

      const settings = yield* withClient(stub.url, (client) =>
        client.updateSettings({ cleanerConfidenceFloor: 0.8 }),
      );

      assert.deepEqual(settings, { cleanerConfidenceFloor: 0.8 });
      assert.deepEqual(stub.requests[0], {
        method: "PUT",
        url: "/v2/settings",
        body: { cleanerConfidenceFloor: 0.8 },
      });
    }),
  ),
);

it.effect("maps a 400 from the server to a rejected MemoryClientError", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer(() => ({
        status: 400,
        body: { error: "cleanerConfidenceFloor must be between 0 and 1" },
      }));

      const error = yield* withClient(stub.url, (client) =>
        client.updateSettings({ cleanerConfidenceFloor: 1.5 }),
      ).pipe(Effect.flip);

      assert.equal(error._tag, "MemoryClientError");
      assert.equal(error.reason, "rejected");
      assert.equal(error.status, 400);
    }),
  ),
);

it.effect(
  "reads memoryServerUrl on every call, so a settings change applies to the next call",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stub = yield* stubServer(() => ({
          status: 200,
          body: { cleanerConfidenceFloor: 0.8 },
        }));

        const outcome = yield* Effect.gen(function* () {
          const settings = yield* Settings.ServerSettingsService;
          const client = yield* MemoryClient.MemoryClient;

          const before = yield* client.getSettings().pipe(Effect.flip);
          yield* settings.updateSettings({ memoryServerUrl: stub.url });
          const loaded = yield* client.getSettings();
          yield* settings.updateSettings({ memoryServerUrl: "" });
          const cleared = yield* client.getSettings().pipe(Effect.flip);

          return { before, loaded, cleared };
        }).pipe(
          Effect.provide(
            MemoryClient.layer.pipe(
              Layer.provide(FetchHttpClient.layer),
              Layer.provideMerge(Settings.layerTest()),
            ),
          ),
        );

        assert.equal(outcome.before.reason, "not-configured");
        assert.deepEqual(outcome.loaded, { cleanerConfidenceFloor: 0.8 });
        assert.equal(outcome.cleared.reason, "not-configured");
        assert.equal(stub.requests.length, 1);
      }),
    ),
);

it.effect("take posts the thread and link to the record and reads the defect status", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer(() => ({
        status: 200,
        body: {
          id: "defect-1",
          defectStatus: "taken",
          takenThreadId: "thread-1",
          takenLink: "t3-thread://x",
          takenAt: "2026-11-03T10:00:00.000Z",
        },
      }));

      const state = yield* withClient(stub.url, (client) =>
        client.take("defect-1", { threadId: "thread-1", link: "t3-thread://x" }),
      );

      assert.deepEqual(state, {
        recordId: "defect-1",
        defectStatus: "taken",
        takenBy: { threadId: "thread-1", link: "t3-thread://x", at: "2026-11-03T10:00:00.000Z" },
      });
      assert.deepEqual(stub.requests[0], {
        method: "POST",
        url: "/v2/records/defect-1/take",
        body: { threadId: "thread-1", link: "t3-thread://x" },
      });
    }),
  ),
);

it.effect("release posts to the record and returns it to open", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer(() => ({
        status: 200,
        body: { id: "defect-1", defectStatus: "open", takenBy: null },
      }));

      const state = yield* withClient(stub.url, (client) => client.release("defect-1"));

      assert.deepEqual(state, { recordId: "defect-1", defectStatus: "open", takenBy: null });
      assert.equal(stub.requests[0]?.method, "POST");
      assert.equal(stub.requests[0]?.url, "/v2/records/defect-1/release");
    }),
  ),
);

it.effect("take surfaces a 409 from a closed defect as a rejected error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer(() => ({ status: 409, body: { error: "defect is closed" } }));

      const error = yield* withClient(stub.url, (client) =>
        client.take("defect-1", { threadId: "thread-1", link: "t3-thread://x" }),
      ).pipe(Effect.flip);

      assert.equal(error.reason, "rejected");
      assert.equal(error.status, 409);
    }),
  ),
);

it.effect("recall sends audience and decodes a defect result without why", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer(() => ({
        status: 200,
        body: {
          results: [
            {
              id: "defect-1",
              source: "v2",
              kind: "defect",
              headline: "Cart drops the coupon",
              fields: { claim: "The total ignores the coupon." },
              scope: "oktra",
              purpose: null,
              topic: null,
              audience: null,
              reader: "trap",
              stage: "recon",
              where: "app/Cart/TotalCalculator.php",
              trigger: "Reload the cart.",
              leftBecause: "Pricing rewrite.",
              defectStatus: "taken",
              takenBy: {
                threadId: "thread-1",
                link: "t3-thread://x",
                at: "2026-11-03T10:00:00.000Z",
              },
              score: 0.7,
            },
          ],
        },
      }));

      const results = yield* withClient(stub.url, (client) =>
        client.recall({ q: "coupon", scope: "oktra", kind: "defect", audience: "navigator" }),
      );

      const query = new URL(stub.requests[0]?.url ?? "", "http://stub").searchParams;
      assert.equal(query.get("audience"), "navigator");
      assert.equal(query.get("kind"), "defect");
      assert.equal(results[0]?.fields.why, "");
      assert.equal(results[0]?.fields.rejected, null);
      assert.equal(results[0]?.takenBy?.threadId, "thread-1");
    }),
  ),
);

it.effect("decodes a legacy record that still carries why", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stub = yield* stubServer(() => ({
        status: 200,
        body: {
          results: [
            {
              id: "rec-1",
              source: "legacy",
              kind: "fact",
              headline: "Old note",
              fields: { claim: "claim", why: "an old reason", rejected: null },
              scope: "oktra",
              purpose: null,
              topic: null,
              score: 0.5,
            },
          ],
        },
      }));

      const results = yield* withClient(stub.url, (client) => client.recall({ q: "old" }));

      assert.equal(results[0]?.fields.why, "an old reason");
    }),
  ),
);
