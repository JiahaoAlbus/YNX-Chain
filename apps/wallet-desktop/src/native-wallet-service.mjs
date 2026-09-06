import { randomUUID } from "node:crypto";
import { Wallet, formatEther, getAddress, parseEther, toQuantity } from "ethers";
import { CANONICAL_RPC_URL } from "./rpc.mjs";
import { providerError } from "./desktop-wallet-vault.mjs";

const CHAIN_ID = "0x1917";
const REVIEW_TTL = 120_000;
const quantity = value => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);

export class CanonicalAccountNetwork {
  constructor({ fetchImpl = globalThis.fetch } = {}) { this.fetchImpl = fetchImpl; }
  async request(method, params = []) {
    try {
      const response = await this.fetchImpl(CANONICAL_RPC_URL, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw providerError(4900, "RPC_UNAVAILABLE", "YNX Testnet is unavailable. Try again shortly.");
      const payload = await response.json();
      if (payload?.jsonrpc !== "2.0" || payload.id !== 1) throw providerError(4900, "RPC_INVALID_RESPONSE", "YNX Testnet returned an invalid response");
      if (payload.error?.code === -32601 && ["eth_gasPrice", "eth_estimateGas"].includes(method)) throw providerError(4900, "RPC_FEE_UNAVAILABLE", "YNX Testnet cannot provide a network fee right now. Your funds have not moved.");
      if (payload.error || !("result" in payload)) throw providerError(4900, "RPC_INVALID_RESPONSE", "YNX Testnet returned an invalid response");
      return payload.result;
    } catch (error) {
      if (error?.data?.code) throw error;
      const timedOut = ["AbortError", "TimeoutError"].includes(error?.name);
      throw providerError(4900, timedOut ? "RPC_TIMEOUT" : "RPC_UNAVAILABLE", timedOut ? "The network check timed out. Please try again." : "Unable to reach YNX Testnet. Check your connection and try again.");
    }
  }
  async verifyChain() {
    if (await this.request("eth_chainId") !== CHAIN_ID) throw providerError(4901, "RPC_CHAIN_MISMATCH", "The network is not YNX Testnet. No transaction was signed.");
  }
  async balance(account) {
    await this.verifyChain();
    const value = await this.request("eth_getBalance", [getAddress(account).toLowerCase(), "latest"]);
    if (!quantity(value)) throw providerError(4900, "RPC_INVALID_BALANCE", "The network returned an invalid balance");
    return value;
  }
  async estimate(transaction) {
    await this.verifyChain();
    const [gas, gasPrice] = await Promise.all([this.request("eth_estimateGas", [transaction]), this.request("eth_gasPrice")]);
    if (!quantity(gas) || !quantity(gasPrice) || BigInt(gas) < 21_000n || BigInt(gasPrice) <= 0n) throw providerError(4900, "RPC_INVALID_FEE", "The network could not estimate a valid transaction fee");
    return { gasLimit: toQuantity((BigInt(gas) * 120n + 99n) / 100n), gasPrice };
  }
}

export class NativeWalletService {
  constructor({ vault, network = new CanonicalAccountNetwork(), sender, clock = () => Date.now(), requestId = randomUUID }) {
    this.vault = vault; this.network = network; this.sender = sender; this.clock = clock; this.requestId = requestId;
    this.pending = new Map();
  }
  clear() { this.pending.clear(); }
  async balance() {
    const status = await this.vault.status();
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create or import an account first");
    const wei = await this.network.balance(status.account);
    return { account: status.account, wei, formatted: formatEther(wei), symbol: "YNXT", chainId: CHAIN_ID, checkedAt: new Date(this.clock()).toISOString() };
  }
  async prepareTransfer({ to, amount } = {}) {
    let recipient, value;
    try {
      recipient = getAddress(to).toLowerCase();
      if (recipient === "0x0000000000000000000000000000000000000000" || typeof amount !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(amount) || amount.length > 80) throw new Error();
      value = parseEther(amount);
      if (value <= 0n) throw new Error();
    } catch { throw providerError(-32602, "INVALID_TRANSFER", "Enter a valid nonzero recipient and a positive YNXT amount with up to 18 decimals"); }
    const status = await this.vault.status();
    if (!status.initialized) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create or import an account first");
    const tx = { from: status.account, to: recipient, value: toQuantity(value), chainId: CHAIN_ID };
    const balance = BigInt(await this.network.balance(status.account));
    if (balance < value) throw providerError(-32000, "INSUFFICIENT_FUNDS", "Insufficient YNXT for this amount. Add Testnet funds before sending.");
    const fee = await this.network.estimate(tx);
    const maximumFee = BigInt(fee.gasLimit) * BigInt(fee.gasPrice);
    if (balance < value + maximumFee) throw providerError(-32000, "INSUFFICIENT_FUNDS", "Insufficient YNXT to cover the amount and network fee");
    const id = this.requestId(), createdAt = this.clock();
    const record = { id, account: status.account, transaction: { ...tx, ...fee }, createdAt };
    this.pending.clear();
    this.pending.set(id, record);
    return { id, account: status.account, to: recipient, amount: formatEther(value), maximumFee: formatEther(maximumFee), total: formatEther(value + maximumFee), symbol: "YNXT", chainId: CHAIN_ID, expiresAt: new Date(createdAt + REVIEW_TTL).toISOString() };
  }
  async transferAction(id, action) {
    if (!["approve", "reject"].includes(action)) throw providerError(-32602, "INVALID_TRANSFER_ACTION", "Choose approve or reject");
    const request = this.pending.get(id);
    this.pending.delete(id);
    if (!request) throw providerError(4100, "UNKNOWN_OR_EXPIRED_REQUEST", "Prepare the transfer again before confirming");
    if (action === "reject") return { rejected: true, transactionCreated: false };
    if (this.clock() - request.createdAt >= REVIEW_TTL) throw providerError(4100, "REQUEST_EXPIRED", "The transfer review expired. Check the current fee and try again.");
    const status = await this.vault.status();
    if (status.account !== request.account) throw providerError(4100, "ACCOUNT_CHANGED", "The selected account changed. Review the transfer again.");
    await this.network.verifyChain();
    const hash = await this.vault.withSecret(async (secret, identity) => {
      if (identity.account !== request.account) throw providerError(4100, "ACCOUNT_CHANGED", "The selected account changed");
      return this.sender.send(new Wallet(`0x${secret}`), request.transaction);
    });
    return { hash, status: "submitted", confirmed: false, account: request.account, to: request.transaction.to, amount: formatEther(request.transaction.value) };
  }
}
