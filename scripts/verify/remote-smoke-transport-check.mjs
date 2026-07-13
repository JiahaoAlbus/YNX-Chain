#!/usr/bin/env node
import assert from "node:assert/strict";
import { parseRemoteSmokeTransport, remapConnectOptions, remoteSocketTarget } from "./lib/remote-smoke-transport.mjs";

assert.equal(parseRemoteSmokeTransport({}), null);
assert.throws(() => parseRemoteSmokeTransport({ YNX_REMOTE_CONNECT_HOST: "127.0.0.1" }), /must be set together/);
assert.throws(() => parseRemoteSmokeTransport({ YNX_REMOTE_CONNECT_HOST: "127.0.0.1", YNX_REMOTE_CONNECT_PORT: "0" }), /between 1 and 65535/);

const transport = parseRemoteSmokeTransport({
  YNX_REMOTE_CONNECT_HOST: "127.0.0.1",
  YNX_REMOTE_CONNECT_PORT: "18443",
  YNX_REMOTE_PROOF_ROUTE: "operator-controlled-cross-region:ssh:singapore",
});
assert.deepEqual(transport, {
  host: "127.0.0.1",
  port: 18443,
  route: "operator-controlled-cross-region:ssh:singapore",
});
assert.deepEqual(remapConnectOptions({ hostname: "rpc.ynxweb4.com", protocol: "https:", port: "443" }, transport), {
  hostname: "127.0.0.1",
  host: "127.0.0.1",
  protocol: "https:",
  port: "18443",
  servername: "rpc.ynxweb4.com",
});
assert.deepEqual(remoteSocketTarget("grpc.ynxweb4.com", 443, transport), { host: "127.0.0.1", port: 18443 });

console.log("remote-smoke-transport-check passed: explicit routing is paired, bounded, and preserves logical TLS server names");
