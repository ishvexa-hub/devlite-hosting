import { test } from "node:test";
import assert from "node:assert/strict";
import { DevLiteHosting, createDevLiteLaunchHandler } from "../index.js";
import { mountDevLite } from "../embed.js";
test("server client uses bearer credentials, encoded IDs, no-store, deadlines and explicit errors", async () => {
  const calls = [];
  const client = new DevLiteHosting({
    endpoint: "https://api.example",
    credential: "server-secret",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ id: "resource" }) };
    },
  });
  await client.provision({
    customerId: "c",
    externalResourceId: "r",
    name: "app",
  });
  await client.createLaunch("id/with space", {
    nonce: "a".repeat(32),
    parentOrigin: "https://console.example",
    actorId: "u",
  });
  assert.equal(calls[0].options.headers.Authorization, "Bearer server-secret");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(!calls[0].url.includes("secret"));
  assert.match(calls[1].url, /id%2Fwith%20space\/launch$/);
  const denied = new DevLiteHosting({
    endpoint: "https://api.example",
    credential: "secret",
    fetch: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "resource denied" }),
    }),
  });
  await assert.rejects(
    denied.getResource("x"),
    (e) => e.status === 403 && e.message === "resource denied",
  );
  assert.throws(
    () =>
      new DevLiteHosting({
        endpoint: "http://public.example",
        credential: "s",
      }),
  );
});
test("launch adapter uses server RBAC and rejects forged origins before authorization", async () => {
  let authorized = 0,
    grant;
  const client = {
    async createLaunch(id, input) {
      grant = { id, ...input };
      return { code: "c".repeat(43), expiresAt: "later" };
    },
  };
  const handler = createDevLiteLaunchHandler({
    client,
    allowedOrigins: ["https://console.example"],
    authorize: async (req) => {
      authorized++;
      return req.user
        ? {
            resourceId: "trusted-resource",
            actorId: req.user.id,
            permissions: ["read"],
          }
        : null;
    },
  });
  const response = () => ({
    statusCode: 200,
    status(v) {
      this.statusCode = v;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    },
    set() {},
  });
  const req = {
    method: "POST",
    headers: { origin: "https://console.example" },
    body: {
      parentOrigin: "https://console.example",
      nonce: "n".repeat(32),
      resourceId: "victim",
      permissions: ["triage"],
    },
    user: { id: "actual-user" },
  };
  let res = response();
  await handler(req, res);
  assert.equal(grant.id, "trusted-resource");
  assert.deepEqual(grant.permissions, ["read"]);
  assert.equal(grant.actorId, "actual-user");
  assert.equal(res.body.code, "c".repeat(43));
  res = response();
  await handler(
    { ...req, headers: { origin: "https://attacker.example" } },
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(authorized, 1);
  res = response();
  await handler({ ...req, user: null }, res);
  assert.equal(res.statusCode, 403);
});
test("browser helper requires frame source, exact origin, provider and nonce; destroy removes listener", async () => {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document;
  let listener,
    launches = 0,
    removed = false;
  const posted = [];
  const contentWindow = {
    postMessage: (message, origin) => posted.push({ message, origin }),
  };
  const frame = {
    style: {},
    contentWindow,
    setAttribute() {},
    remove() {
      removed = true;
    },
  };
  globalThis.window = {
    location: { origin: "https://console.example" },
    addEventListener: (_type, fn) => (listener = fn),
    removeEventListener: (_type, fn) => {
      if (fn === listener) listener = null;
    },
  };
  globalThis.document = { createElement: () => frame };
  try {
    const providerId = "11111111-1111-4111-8111-111111111111";
    const result = mountDevLite({
      container: { appendChild() {} },
      providerId,
      dashboardUrl: "https://devlite.example",
      createLaunch: async (input) => {
        launches++;
        assert.equal(input.parentOrigin, "https://console.example");
        return { code: "c".repeat(43) };
      },
    });
    assert.ok(!frame.src.includes("secret"));
    const message = {
      source: contentWindow,
      origin: "https://devlite.example",
      data: { type: "devlite:ready", providerId, nonce: "n".repeat(32) },
    };
    await listener({ ...message, origin: "https://evil.example" });
    await listener({ ...message, source: {} });
    await listener({
      ...message,
      data: { ...message.data, providerId: "other" },
    });
    assert.equal(launches, 0);
    await listener(message);
    assert.equal(launches, 1);
    assert.equal(posted[0].origin, "https://devlite.example");
    assert.equal(posted[0].message.nonce, "n".repeat(32));
    result.destroy();
    assert.equal(removed, true);
    assert.equal(listener, null);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
