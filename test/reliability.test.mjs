import test from "node:test";
import assert from "node:assert/strict";
import {
  DevLiteHosting,
  DevLiteHostingError,
  createDevLiteLaunchRoute,
} from "../index.js";
const options = {
  endpoint: "https://api.example.test",
  credential: "server-secret",
};
test("read retries respect Retry-After; state-changing requests are never retried", async () => {
  let calls = 0;
  const client = new DevLiteHosting({
    ...options,
    maxRetries: 2,
    fetch: async () =>
      ++calls < 3
        ? new Response("upstream unavailable", {
            status: 503,
            headers: { "Retry-After": "0" },
          })
        : Response.json({ id: "r" }),
  });
  assert.equal((await client.getResource("r")).id, "r");
  assert.equal(calls, 3);
  calls = 0;
  const write = new DevLiteHosting({
    ...options,
    maxRetries: 3,
    fetch: async () => {
      calls++;
      return Response.json(
        { error: "Try later" },
        {
          status: 503,
          headers: { "X-Request-ID": "req-1", "Retry-After": "2" },
        },
      );
    },
  });
  await assert.rejects(
    write.setStatus("r", "suspended"),
    (e) =>
      e instanceof DevLiteHostingError &&
      e.status === 503 &&
      e.requestId === "req-1" &&
      e.retryAfterMs === 2000,
  );
  assert.equal(calls, 1);
});
test("HTML error pages and malformed successes produce actionable bounded errors", async () => {
  const bad = new DevLiteHosting({
    ...options,
    maxRetries: 0,
    fetch: async () =>
      new Response("<html>private upstream diagnostics</html>", {
        status: 502,
      }),
  });
  await assert.rejects(
    bad.getResource("r"),
    (e) => e.status === 502 && !e.message.includes("private"),
  );
  const malformed = new DevLiteHosting({
    ...options,
    fetch: async () => new Response("not JSON", { status: 200 }),
  });
  await assert.rejects(
    malformed.getResource("r"),
    (e) => e.code === "INVALID_RESPONSE",
  );
  assert.throws(
    () => new DevLiteHosting({ ...options, timeoutMs: 0 }),
    /timeoutMs/,
  );
  assert.throws(
    () => new DevLiteHosting({ ...options, maxRetries: 4 }),
    /maxRetries/,
  );
});
test("overall deadlines cover retry waits and caller cancellation makes no request", async () => {
  const slow = new DevLiteHosting({
    ...options,
    timeoutMs: 10,
    fetch: async () =>
      new Response("busy", { status: 429, headers: { "Retry-After": "10" } }),
  });
  await assert.rejects(slow.getResource("r"), (e) => e.code === "TIMEOUT");
  let calls = 0;
  const cancel = new AbortController();
  cancel.abort();
  const client = new DevLiteHosting({
    ...options,
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  await assert.rejects(
    client.request("/resources", { signal: cancel.signal }),
    (e) => e.code === "ABORTED",
  );
  assert.equal(calls, 0);
});
test("inventory pagination keeps filters and terminates; malformed/repeated cursors fail explicitly", async () => {
  const seen = [];
  const client = new DevLiteHosting({
    ...options,
    fetch: async (url) => {
      seen.push(new URL(url));
      return Response.json(
        seen.length === 1
          ? { items: [{ id: "one" }], nextCursor: "next" }
          : { items: [{ id: "two" }], nextCursor: null },
      );
    },
  });
  const ids = [];
  for await (const r of client.iterateResources({
    customerId: "customer / A",
    limit: 1,
  }))
    ids.push(r.id);
  assert.deepEqual(ids, ["one", "two"]);
  assert.equal(seen[1].searchParams.get("customerId"), "customer / A");
  assert.equal(seen[1].searchParams.get("cursor"), "next");
  const old = new DevLiteHosting({
    ...options,
    fetch: async () => Response.json([]),
  });
  await assert.rejects(old.listResourcePage(), /Update the API/);
  const repeated = new DevLiteHosting({
    ...options,
    fetch: async () =>
      Response.json({ items: [{ id: "same" }], nextCursor: "same" }),
  });
  const iterator = repeated.iterateResources();
  assert.equal((await iterator.next()).value.id, "same");
  await assert.rejects(iterator.next(), /repeated/);
});
test("web-standard launch route checks origin and server authorization and keeps results non-cacheable", async () => {
  let authorizations = 0,
    grant;
  const handler = createDevLiteLaunchRoute({
    client: {
      createLaunch: async (id, input) => {
        grant = { id, ...input };
        return {
          code: "c".repeat(43),
          expiresAt: "later",
          embedUrl: "not-needed",
        };
      },
    },
    allowedOrigins: ["https://console.example.test"],
    authorize: async () => {
      authorizations++;
      return {
        resourceId: "trusted",
        actorId: "signed-in-user",
        permissions: ["read"],
      };
    },
  });
  const request = (
    origin,
    body = {
      nonce: "n".repeat(32),
      parentOrigin: "https://console.example.test",
      resourceId: "victim",
      permissions: ["triage"],
    },
  ) =>
    new Request("https://console.example.test/launch", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const denied = await handler(request("https://attacker.example.test"));
  assert.equal(denied.status, 403);
  assert.equal(authorizations, 0);
  const response = await handler(request("https://console.example.test"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(grant.id, "trusted");
  assert.deepEqual(grant.permissions, ["read"]);
  assert.deepEqual(Object.keys(await response.json()).sort(), [
    "code",
    "expiresAt",
  ]);
  assert.equal(
    (await handler(new Request("https://console.example.test/launch"))).status,
    405,
  );
  assert.equal(
    (
      await handler(
        new Request("https://console.example.test/launch", {
          method: "POST",
          body: "invalid JSON",
        }),
      )
    ).status,
    400,
  );
  assert.throws(
    () =>
      createDevLiteLaunchRoute({
        client: { createLaunch() {} },
        allowedOrigins: ["https://console.example.test/path"],
        authorize: async () => null,
      }),
    /exact allowed/,
  );
});

test("server route example rechecks the current user and application on each launch", async () => {
  const { createMonitoringRoute } = await import("../examples/server-route.js");
  let signedIn = true,
    lookups = 0,
    launched;
  const route = createMonitoringRoute({
    client: {
      createLaunch: async (resourceId, input) => {
        launched = { resourceId, ...input };
        return { code: "c".repeat(43) };
      },
    },
    allowedOrigins: ["https://console.example.test"],
    authenticate: async () => (signedIn ? { id: "current-user" } : null),
    findApplicationVisibleTo: async (user, id) => {
      lookups++;
      assert.equal(user, "current-user");
      return id === "permitted-app"
        ? { devliteResourceId: "trusted-resource" }
        : null;
    },
  });
  const request = () =>
    new Request(
      "https://console.example.test/launch?applicationId=permitted-app",
      {
        method: "POST",
        headers: {
          Origin: "https://console.example.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nonce: "n".repeat(32),
          parentOrigin: "https://console.example.test",
          resourceId: "attacker-resource",
          permissions: ["triage"],
        }),
      },
    );
  assert.equal((await route(request())).status, 200);
  assert.equal(launched.resourceId, "trusted-resource");
  assert.deepEqual(launched.permissions, ["read"]);
  signedIn = false;
  assert.equal((await route(request())).status, 403);
  assert.equal(lookups, 1);
});
