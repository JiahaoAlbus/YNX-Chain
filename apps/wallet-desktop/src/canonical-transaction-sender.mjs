import { JsonRpcProvider } from "ethers";
import { CANONICAL_RPC_URL } from "./rpc.mjs";

export class CanonicalTransactionSender {
  constructor({ rpcUrl = CANONICAL_RPC_URL } = {}) {
    if (rpcUrl !== CANONICAL_RPC_URL) throw Object.assign(new Error("Only the frozen canonical RPC is accepted"), { code: "RPC_ENDPOINT_REJECTED" });
    this.provider = new JsonRpcProvider(rpcUrl, { chainId: 6423, name: "ynx-testnet" }, { staticNetwork: true });
  }
  async send(wallet, transaction) {
    try {
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
