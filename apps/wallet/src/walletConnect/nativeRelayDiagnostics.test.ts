import assert from "node:assert/strict";
import test from "node:test";
import { observeNativeRelayWebSocket, type NativeRelayDiagnostic } from "./nativeRelayDiagnostics";
class NativeSocket {
  static OPEN = 1;
  handlers = new Map<string, ((value: any) => void)[]>();
  constructor(...args: unknown[]) { this.args = args; }
  args: unknown[];
  addEventListener(name: string, handler: (value: any) => void) { this.handlers.set(name, [...this.handlers.get(name) ?? [], handler]); }
  dispatch(name: string, value: any) { for (const handler of this.handlers.get(name) ?? []) handler(value); }
}
test("native Relay observer preserves construction, prototype, statics, arguments and event delivery", () => {
  const records: NativeRelayDiagnostic[] = [], Observed = observeNativeRelayWebSocket(NativeSocket, value => records.push(value));
  const args = ["wss://relay.walletconnect.com/?auth=secret", [], { anything: true }];
  const socket = new Observed(...args);
  assert.equal(Observed.prototype, NativeSocket.prototype); assert.equal(Observed.OPEN, NativeSocket.OPEN);
  assert.ok(socket instanceof NativeSocket); assert.ok(socket instanceof Observed); assert.deepEqual(socket.args, args);
  let closes = 0; socket.addEventListener("close", () => closes++);
  socket.dispatch("close", { code: 1006, reason: "Connection reset auth=secret wc:secret" });
  assert.equal(closes, 1); assert.deepEqual(records, [{ stage: "pre-open-close", failureClass: "CONNECTION_RESET", closeCode: 1006 }]);
  assert.equal(JSON.stringify(records).includes("secret"), false);
});
test("non-Relay and insecure/lookalike/credential URLs receive no observer", () => {
  for (const url of ["wss://example.com", "ws://relay.walletconnect.com", "wss://relay.walletconnect.com.evil.test", "wss://user:password@relay.walletconnect.com", "wss://relay.walletconnect.com:8443"]) {
    const socket = new (observeNativeRelayWebSocket(NativeSocket))(url); assert.equal(socket.handlers.size, 0);
  }
});
test("native close safely classifies DNS/TLS/reset without inferring HTTP status from arbitrary text", () => {
  for (const [reason, expected] of [["UnknownHostException secret", "DNS_FAILURE"], ["SSLHandshakeException auth=secret", "TLS_FAILURE"], ["403 arbitrary secret", "NETWORK_FAILURE"]]) {
    const records: NativeRelayDiagnostic[] = [], socket = new (observeNativeRelayWebSocket(NativeSocket, value => records.push(value)))("wss://relay.walletconnect.org");
    socket.dispatch("error", {}); socket.dispatch("close", { code: 1006, reason });
    assert.ok(records[0]); assert.equal(records[0].failureClass, expected); assert.deepEqual(Object.keys(records[0]).sort(), ["closeCode", "failureClass", "stage"]);
  }
});
test("opened sockets remain native and observer errors cannot interrupt normal close", () => {
  const records: NativeRelayDiagnostic[] = [], socket = new (observeNativeRelayWebSocket(NativeSocket, value => { records.push(value); throw new Error("observer failed"); }))("wss://relay.walletconnect.com");
  socket.dispatch("open", {}); assert.doesNotThrow(() => socket.dispatch("close", { code: 1000, reason: "secret" }));
  assert.deepEqual(records, [{stage:"opened",failureClass:null,closeCode:null},{stage:"close",failureClass:null,closeCode:1000}]);
});
test("installation is idempotent and listener installation failure leaves native construction usable", () => {
  const Observed = observeNativeRelayWebSocket(NativeSocket);
  assert.equal(observeNativeRelayWebSocket(Observed), Observed);
  class BrokenObserverSocket extends NativeSocket { addEventListener() { throw new Error("listener failure"); } }
  assert.ok(new (observeNativeRelayWebSocket(BrokenObserverSocket))("wss://relay.walletconnect.com") instanceof BrokenObserverSocket);
});
