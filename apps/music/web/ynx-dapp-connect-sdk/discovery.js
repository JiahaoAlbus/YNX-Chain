import {DAppConnectError} from "./errors.js";

export async function discoverEIP6963(windowLike, {timeoutMs = 250} = {}) {
  if (!windowLike?.addEventListener || !windowLike?.dispatchEvent) throw new DAppConnectError("DISCOVERY_ENVIRONMENT_REQUIRED", "EIP-6963 discovery requires a browser event target.");
  const providers = new Map();
  const receive = event => { const detail = event?.detail; if (detail?.info?.uuid && detail?.provider?.request) providers.set(detail.info.uuid, detail); };
  windowLike.addEventListener("eip6963:announceProvider", receive);
  windowLike.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise(resolve => setTimeout(resolve, timeoutMs));
  windowLike.removeEventListener("eip6963:announceProvider", receive);
  return [...providers.values()];
}
