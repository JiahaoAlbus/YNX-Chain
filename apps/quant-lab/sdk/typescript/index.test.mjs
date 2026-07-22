import assert from "node:assert/strict";
import test from "node:test";
import {QuantClient} from "./index.mjs";

test("read and approved local mutation boundaries", async () => {
  const calls = [];
  const client = new QuantClient({fetchImpl: async (url, init) => {
    calls.push({url, init});
    return {ok: true, json: async () => ({status: "ok"})};
  }});
  assert.equal((await client.health()).status, "ok");
  assert.throws(() => client.killSwitch({reason: "operator test"}), /approval/);
  await client.killSwitch({reason: "operator test", approved: true});
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers["x-ynx-preview-mode"], "local-paper");
});

test("remote preview mutation is rejected before fetch", () => {
  const client = new QuantClient({baseUrl: "https://quant.invalid", fetchImpl: async () => { throw new Error("must not fetch"); }});
  assert.throws(() => client.killSwitch({reason: "operator test", approved: true}), /loopback/);
});
