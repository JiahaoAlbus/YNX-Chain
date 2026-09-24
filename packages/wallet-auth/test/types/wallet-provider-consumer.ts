import {
  WALLET_PROVIDER_KIND,
  createWalletProviderDiscovery,
  type ContinuousWalletProviderDiscovery,
  type WalletProviderCandidate,
  type WalletProviderDiscoverySnapshot,
  type WalletProviderKind,
} from "@ynx-chain/wallet-auth";
import { createWalletProviderDiscovery as createFromSubpath } from "@ynx-chain/wallet-auth/wallet-provider-discovery";

const kind: WalletProviderKind = WALLET_PROVIDER_KIND.METAMASK;
const provider: WalletProviderCandidate["provider"] = {
  async request(input) { return input.method === "eth_chainId" ? "0x1917" : null; },
};
const candidate: WalletProviderCandidate = {
  kind, provider, source: "legacy-injected", uuid: null, rdns: "io.metamask", name: "MetaMask", authority: "unverified-injected-candidate",
};
const discovery: ContinuousWalletProviderDiscovery = createWalletProviderDiscovery();
const subpathDiscovery: ContinuousWalletProviderDiscovery = createFromSubpath();
const snapshot: WalletProviderDiscoverySnapshot = discovery.snapshot();
snapshot.candidates.concat(candidate);
subpathDiscovery.dispose();
discovery.dispose();
