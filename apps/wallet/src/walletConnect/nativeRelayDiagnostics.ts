// Passive observations only: the original native constructor and TLS settings remain in use.
export type NativeRelayDiagnostic = Readonly<{ stage: "opened" | "pre-open-close" | "close"; failureClass: "CONNECTION_RESET" | "DNS_FAILURE" | "TLS_FAILURE" | "NETWORK_FAILURE" | null; closeCode: number | null }>;
const listeners = new Set<(value: NativeRelayDiagnostic) => void>();
const observers = new WeakSet<Function>();
export function subscribeNativeRelayDiagnostics(listener: (value: NativeRelayDiagnostic) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
function emit(value: NativeRelayDiagnostic): void { for (const listener of listeners) { try { listener(Object.freeze(value)); } catch {} } }
function classify(reason: unknown): NativeRelayDiagnostic["failureClass"] {
  if (typeof reason !== "string") return "NETWORK_FAILURE";
  if (/connection reset|ECONNRESET/i.test(reason)) return "CONNECTION_RESET";
  if (/UnknownHostException|ENOTFOUND|unable to resolve host/i.test(reason)) return "DNS_FAILURE";
  if (/SSLHandshakeException|SSLPeerUnverifiedException|certificate|hostname.*verif/i.test(reason)) return "TLS_FAILURE";
  return "NETWORK_FAILURE";
}
function officialRelay(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "wss:" && !url.username && !url.password && !url.port && ["relay.walletconnect.com", "relay.walletconnect.org"].includes(url.hostname); } catch { return false; }
}
export function observeNativeRelayWebSocket<T extends Function>(Native: T, report: (value: NativeRelayDiagnostic) => void = emit): T {
  if (observers.has(Native)) return Native;
  const observed = new Proxy(Native, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      if (!officialRelay(args[0]) || typeof socket.addEventListener !== "function") return socket;
      let opened = false;
      const safeReport = (value: NativeRelayDiagnostic) => { try { report(Object.freeze(value)); } catch {} };
      try {
      socket.addEventListener("open", () => { opened = true; safeReport({ stage: "opened", failureClass: null, closeCode: null }); });
      // RN carries the native failure reason on close, while its error Event contains no Error.
      socket.addEventListener("close", (event: { code?: unknown; reason?: unknown }) => {
        safeReport({ stage: opened ? "close" : "pre-open-close", failureClass: event.code === 1000 ? null : classify(event.reason), closeCode: typeof event.code === "number" && Number.isInteger(event.code) && event.code >= 1000 && event.code <= 4999 ? event.code : null });
      });
      } catch { /* Observation failure must not change native connection behavior. */ }
      return socket;
    },
  });
  observers.add(observed); return observed;
}
export function installNativeRelayDiagnostics(): void {
  try { if (typeof globalThis.WebSocket === "function") globalThis.WebSocket = observeNativeRelayWebSocket(globalThis.WebSocket); } catch {}
}
