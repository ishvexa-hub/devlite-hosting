import test from "node:test";
import assert from "node:assert/strict";
import { mountDevLite } from "../embed.js";
const providerId = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const previous = { window: globalThis.window, document: globalThis.document };
  let listener;
  const posted = [];
  const frame = {
    style: {},
    contentWindow: {
      postMessage: (data, origin) => posted.push({ data, origin }),
    },
    setAttribute() {},
    remove() {
      this.removed = true;
    },
  };
  globalThis.window = {
    location: { origin: "https://console.example.test" },
    addEventListener: (_, fn) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  globalThis.document = { createElement: () => frame };
  return {
    frame,
    posted,
    options: {
      container: { appendChild() {} },
      providerId,
      dashboardUrl: "https://devlite.example.test",
    },
    send: (data) =>
      listener({
        source: frame.contentWindow,
        origin: "https://devlite.example.test",
        data: { providerId, ...data },
      }),
    restore() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
    },
  };
}
test("ready messages deduplicate, connected nonce is checked, reload reauthorizes and destroy aborts work", async () => {
  const f = fixture();
  let launches = 0,
    ready = 0,
    signal;
  const statuses = [];
  try {
    const embed = mountDevLite({
      ...f.options,
      height: 800,
      minHeight: 300,
      maxHeight: 1000,
      onReady: () => ready++,
      onStatusChange: (s) => statuses.push(s),
      createLaunch: async (input) => {
        launches++;
        signal = input.signal;
        return { code: "c".repeat(43) };
      },
    });
    await f.send({ type: "devlite:connected" });
    assert.equal(ready, 0);
    await f.send({ type: "devlite:ready", nonce: "a".repeat(32) });
    await f.send({ type: "devlite:ready", nonce: "a".repeat(32) });
    assert.equal(launches, 1);
    await f.send({ type: "devlite:connected", nonce: "wrong" });
    assert.equal(ready, 0);
    await f.send({ type: "devlite:connected", nonce: "a".repeat(32) });
    assert.equal(ready, 1);
    assert.equal(embed.status, "connected");
    await f.send({ type: "devlite:resize", height: 99999 });
    assert.equal(f.frame.style.height, "1000px");
    embed.reload();
    assert.equal(embed.status, "loading");
    await f.send({ type: "devlite:ready", nonce: "b".repeat(32) });
    assert.equal(launches, 2);
    embed.destroy();
    embed.destroy();
    assert.equal(signal.aborted, true);
    assert.equal(f.frame.removed, true);
    assert.equal(embed.status, "destroyed");
    assert.deepEqual(statuses, [
      "loading",
      "authorizing",
      "connected",
      "loading",
      "authorizing",
      "destroyed",
    ]);
    assert.throws(() => embed.reload(), /destroyed/);
  } finally {
    f.restore();
  }
});
test("authorization stays bounded after ready and a late code cannot reach a timed-out frame", async () => {
  const f = fixture();
  let finish, reported;
  let embed;
  try {
    const error = new Promise((resolve) => {
      reported = resolve;
    });
    embed = mountDevLite({
      ...f.options,
      timeoutMs: 10,
      onError: reported,
      createLaunch: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = f.send({ type: "devlite:ready", nonce: "a".repeat(32) });
    const result = await error;
    assert.match(result.message, /timed out/);
    assert.equal(embed.status, "error");
    finish({ code: "c".repeat(43) });
    await pending;
    assert.equal(
      f.posted.filter((p) => p.data.type === "devlite:authorize").length,
      0,
    );
  } finally {
    embed?.destroy();
    f.restore();
  }
});
