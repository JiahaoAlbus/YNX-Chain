import { JsonRpcProvider } from "ethers";
import { CANONICAL_RPC_URL } from "./rpc.mjs";
import { CanonicalAccountNetwork } from "./native-wallet-service.mjs";

export class CanonicalTransactionSender {
  constructor({ rpcUrl = CANONICAL_RPC_URL, network = new CanonicalAccountNetwork(), fetchImpl = globalThis.fetch } = {}) {
    if (rpcUrl !== CANONICAL_RPC_URL) throw Object.assign(new Error("Only the frozen canonical RPC is accepted"), { code: "RPC_ENDPOINT_REJECTED" });
    this.provider = new CanonicalJsonRpcProvider(fetchImpl);
    this.network = network;
  }
  async send(wallet, transaction) {
    try {
      await this.network.verifyChain();
      const response = await wallet.connect(this.provider).sendTransaction({ ...transaction, from: undefined, chainId: 6423 });
      if (!/^0x[0-9a-f]{64}$/.test(response.hash)) throw new Error("Canonical RPC did not return a transaction hash");
      return response.hash;
    } catch (error) {
      throw Object.assign(new Error("Canonical YNX Testnet transaction submission failed closed"), {
        code: 4900,
        data: { code: "TRANSACTION_SUBMISSION_FAILED", cause: error?.code ?? "RPC_ERROR" }
      });
    }
  }
}

// The canonical gateway accepts individual JSON-RPC requests. Use the host's
// network stack and disable batching so nonce/fee requests are not combined.
export class CanonicalJsonRpcProvider extends JsonRpcProvider {
  constructor(fetchImpl = globalThis.fetch) {
    super(CANONICAL_RPC_URL, { chainId: 6423, name: "ynx-testnet" }, { staticNetwork: true, batchMaxCount: 1 });
    this.fetchImpl = fetchImpl;
  }
  async _send(payload) {
    if (Array.isArray(payload)) throw new Error("Canonical RPC batching is not supported");
    const response = await this.fetchImpl(CANONICAL_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Canonical RPC is unavailable");
    return [await response.json()];
  }
}
