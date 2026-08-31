export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isYNXWallet?: boolean;
}

export interface WalletProvider {
  id: string;
  name: string;
  icon?: string;
  rdns?: string;
  provider: EIP1193Provider;
  source: "eip6963" | "legacy-eip1193";
}

interface EIP6963Announcement {
  detail?: {
    info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
    provider?: EIP1193Provider;
  };
}

declare global {
  interface Window { ethereum?: EIP1193Provider; }
}

function safeText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim().slice(0, 120) : "";
  return text || fallback;
}

function safeIcon(value: unknown) {
  if (typeof value !== "string" || value.length > 16_384) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.protocol === "data:" ? url.href : undefined;
  } catch { return undefined; }
}

function inferredName(provider: EIP1193Provider) {
  if (provider.isYNXWallet) return "YNX Wallet";
  if (provider.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

function normalizeAnnouncement(event: EIP6963Announcement): WalletProvider | undefined {
  const provider = event.detail?.provider;
  if (!provider || typeof provider.request !== "function") return undefined;
  const info = event.detail?.info;
  const name = safeText(info?.name, inferredName(provider));
  const id = safeText(info?.uuid, `${info?.rdns ?? name}:${name}`);
  return { id: `eip6963:${id}`, name, icon: safeIcon(info?.icon), rdns: safeText(info?.rdns, "") || undefined, provider, source: "eip6963" };
}

/** Discovers injected providers without any custom-scheme navigation. */
export function discoverWalletProviders(onChange: (providers: WalletProvider[]) => void) {
  const found = new Map<string, WalletProvider>();
  const publish = () => onChange([...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)));
  const announce = (event: Event) => {
    const next = normalizeAnnouncement(event as CustomEvent<EIP6963Announcement["detail"]>);
    if (!next || found.has(next.id)) return;
    for (const [id, existing] of found) {
      if (existing.provider !== next.provider) continue;
      if (existing.source === "legacy-eip1193") found.delete(id);
      else return;
    }
    found.set(next.id, next);
    publish();
  };
  window.addEventListener("eip6963:announceProvider", announce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const legacy = window.ethereum;
  if (legacy && typeof legacy.request === "function") {
    found.set("legacy-eip1193", { id: "legacy-eip1193", name: inferredName(legacy), provider: legacy, source: "legacy-eip1193" });
    publish();
  }
  return () => window.removeEventListener("eip6963:announceProvider", announce);
}

export function providerErrorCode(error: unknown) {
  const code = typeof error === "object" && error ? (error as { code?: unknown }).code : undefined;
  return code === 4001 ? "wallet_rejected" : "wallet_request_failed";
}

export function selectedAccount(value: unknown) {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !/^0x[0-9a-f]{40}$/i.test(value[0])) throw new Error("The selected wallet did not return an EVM account.");
  return value[0];
}
