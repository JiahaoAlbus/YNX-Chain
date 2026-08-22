import { createStandardWalletPlatformRuntime } from "./standard-wallet-platform-runtime.js";
import { standardWalletEip6963Announcement } from "./standard-wallet-provider-engine.js";

const INSTALLED = new WeakMap();

export async function installStandardWalletWebRuntime(config = {}) {
  if (!object(config) || Object.keys(config).some((key) => !["scope", "uuid", "walletAccounts", "approveAccounts", "permissionStorage", "rpcTransport", "signMessage", "signTypedData", "sendTransaction", "legacyInjection"].includes(key))) throw new TypeError("Standard Wallet Web runtime configuration is invalid");
  const scope = config.scope ?? globalThis;
  if (!object(scope) || INSTALLED.has(scope)) throw new TypeError("Standard Wallet Web runtime scope is invalid or already installed");
  const origin = exactScopeOrigin(scope);
  const add = scope.addEventListener, remove = scope.removeEventListener, dispatch = scope.dispatchEvent;
  const CustomEventConstructor = scope.CustomEvent ?? globalThis.CustomEvent;
  if (typeof add !== "function" || typeof remove !== "function" || typeof dispatch !== "function" || typeof CustomEventConstructor !== "function") throw new TypeError("Standard Wallet Web runtime requires EventTarget and CustomEvent support");
  const runtime = createStandardWalletPlatformRuntime({ ...config, platform: "web", origin });
  await runtime.start();
  const announcement = standardWalletEip6963Announcement(runtime.provider, config.uuid);
  const announce = () => dispatch.call(scope, new CustomEventConstructor("eip6963:announceProvider", { detail: announcement }));
  const requestListener = () => { try { announce(); } catch {} };
  add.call(scope, "eip6963:requestProvider", requestListener);
  let legacyInstalled = false;
  if ((config.legacyInjection ?? "if-empty") === "if-empty" && scope.ethereum === undefined) {
    try { Object.defineProperty(scope, "ethereum", { configurable: true, enumerable: false, writable: false, value: runtime.provider }); legacyInstalled = scope.ethereum === runtime.provider; } catch {}
  } else if (config.legacyInjection !== undefined && !["if-empty", "never"].includes(config.legacyInjection)) {
    remove.call(scope, "eip6963:requestProvider", requestListener);
    throw new TypeError("Standard Wallet legacy injection policy is invalid");
  }
  const installation = Object.freeze({
    runtime,
    provider: runtime.provider,
    announcement,
    legacyInstalled,
    announce,
    uninstall() {
      if (INSTALLED.get(scope) !== installation) return Object.freeze({ uninstalled: false });
      remove.call(scope, "eip6963:requestProvider", requestListener);
      if (legacyInstalled && scope.ethereum === runtime.provider) try { delete scope.ethereum; } catch {}
      runtime.stop();
      INSTALLED.delete(scope);
      return Object.freeze({ uninstalled: true });
    },
  });
  INSTALLED.set(scope, installation);
  announce();
  return installation;
}

function exactScopeOrigin(scope) {
  let origin;
  try { origin = scope.location.origin; } catch { throw new TypeError("Standard Wallet Web runtime origin is unavailable"); }
  if (typeof origin !== "string" || new URL(origin).origin !== origin) throw new TypeError("Standard Wallet Web runtime origin is invalid");
  return origin;
}
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
