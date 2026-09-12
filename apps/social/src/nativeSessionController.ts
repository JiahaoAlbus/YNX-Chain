import { RecoverableProductSessionClient } from "./vendor/product-session-native.mjs";

export type NativeSessionView = Readonly<{
  status: string;
  message: string;
  account?: string;
  scopes: readonly string[];
  canOpen: boolean;
}>;
type Store = {
  securityLevel: "os-protected";
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};
export type NativeSessionDevice = {
  id: string;
  key: string;
  sign(input: { purpose: "challenge" | "http-proof"; algorithm: "p256-sha256"; deviceKey: string; payload: string }): Promise<string>;
};
export function createNativeSessionController(config: {
  registry: unknown;
  platform: "android" | "ios";
  scopes: readonly string[];
  storage: Store;
  device(create: boolean): Promise<NativeSessionDevice | null>;
  gateway: unknown;
  tokenFactory(): string;
  openURL(url: string): Promise<void>;
}) {
  let client: RecoverableProductSessionClient | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let suspended = false;
  let view: NativeSessionView = {
    status: "guest", message: "Wallet identity is not linked. No authorization has been requested.", scopes: [], canOpen: false,
  };
  const listeners = new Set<(state: NativeSessionView) => void>();
  const publish = (state: Readonly<Record<string, unknown>>) => {
    const session = state.session as { account?: unknown; scopes?: unknown } | undefined;
    const route = state.route as { url?: unknown } | undefined;
    view = Object.freeze({
      status: String(state.status ?? "disconnected"),
      message: String(state.message ?? "Wallet connection requires attention."),
      account: state.status === "connected" && typeof session?.account === "string" ? session.account : undefined,
      scopes: state.status === "connected" && Array.isArray(session?.scopes) ? Object.freeze([...session.scopes]) : [],
      canOpen: state.status === "connecting" && typeof route?.url === "string" && !suspended,
    });
    for (const listener of listeners) listener(view);
    return view;
  };
  const run = <T>(action: () => Promise<T>): Promise<T> => {
    const pending = queue.then(action);
    queue = pending.catch(() => undefined);
    return pending;
  };
  const resolve = async (create: boolean) => {
    if (client) return client;
    const device = await config.device(create);
    if (!device) return null;
    client = new RecoverableProductSessionClient({
      registry: config.registry, productId: "social", platform: config.platform,
      storage: config.storage, gateway: config.gateway,
      device: { ...device, scopes: [...config.scopes], purpose: "Link your Wallet identity to YNX Social. Messaging requires separate permission." },
      tokenFactory: config.tokenFactory, clock: () => new Date(),
    });
    return client;
  };
  const restore = () => run(async () => {
    const active = await resolve(false);
    if (!active) return view;
    const keys = [active.storageKey, ...["pending", "return", "completion", "revoke"].map(suffix => `${active.storageKey}:${suffix}`)];
    let retained = false;
    for (const key of keys) if (await config.storage.get(key) !== null) retained = true;
    if (!retained) return publish({ status: "guest", message: "Wallet identity is not linked." });
    return publish(await active.restore(true));
  });
  return {
    get current() { return view; },
    subscribe(listener: (state: NativeSessionView) => void) { listeners.add(listener); listener(view); return () => { listeners.delete(listener); }; },
    restore,
    begin: () => run(async () => {
      const active = await resolve(true);
      if (!active) throw new Error("Protected product-device storage is unavailable");
      suspended = false;
      return publish(await active.beginExplicit());
    }),
    open: () => run(async () => {
      const active = await resolve(false);
      if (!active || suspended) throw new Error("No Wallet request is available");
      const state = await active.restore(true);
      publish(state);
      const route = state.route as { url?: unknown } | undefined;
      if (state.status !== "connecting" || typeof route?.url !== "string") throw new Error("The original Wallet request is unavailable");
      await config.openURL(route.url);
      return view;
    }),
    handleReturn: (url: string) => run(async () => {
      const active = await resolve(false);
      if (!active || suspended) throw new Error("No matching protected Wallet request exists");
      return publish(await active.handleReturn(url));
    }),
    disconnect: () => {
      suspended = true;
      publish({ status: "retry-required", message: "Revocation is pending. API authorization is suspended." });
      return run(async () => {
        const active = await resolve(false);
        if (!active) return publish({ status: "disconnected", message: "No Wallet identity is linked." });
        return publish(await active.disconnect());
      });
    },
    proof: (requiredScopes: readonly string[]) => run(async () => {
      const active = await resolve(false);
      if (!active || suspended || active.current.status !== "connected") throw new Error("A verified Wallet session is required");
      const proof = await active.createIntrospectionProof(requiredScopes);
      if (suspended) throw new Error("Wallet authorization was suspended");
      return proof;
    }),
  };
}
