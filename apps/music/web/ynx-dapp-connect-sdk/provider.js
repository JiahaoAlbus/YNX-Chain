import {EIP1193_METHODS, YNX_TESTNET} from "./constants.js";
import {DAppConnectError, classifyWalletError} from "./errors.js";

function validAddress(value) { return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value); }
function assertProvider(provider) {
  if (!provider || typeof provider.request !== "function") throw new DAppConnectError("PROVIDER_REQUIRED", "A standard EIP-1193 wallet provider is required.");
}

export class StandardWalletConnection {
  constructor(provider, {chain = YNX_TESTNET} = {}) { assertProvider(provider); this.provider = provider; this.chain = chain; this.account = null; this.chainId = null; }
  async connect() {
    try {
      const accounts = await this.provider.request({method: EIP1193_METHODS.accounts});
      if (!Array.isArray(accounts) || !validAddress(accounts[0])) throw new DAppConnectError("INVALID_EVM_ACCOUNT", "Wallet did not return an approved 0x EVM account.");
      this.account = accounts[0]; this.chainId = await this.provider.request({method: EIP1193_METHODS.chainId});
      return {account: this.account, chainId: this.chainId, state: "STANDARD_CONNECTED"};
    } catch (error) { throw classifyWalletError(error); }
  }
  async ensureYNXTestnet({addChain} = {}) {
    try {
      const current = await this.provider.request({method: EIP1193_METHODS.chainId});
      if (String(current).toLowerCase() === this.chain.evmChainHex) return {chainId: current, switched: false};
      try { await this.provider.request({method: EIP1193_METHODS.switchChain, params: [{chainId: this.chain.evmChainHex}]}); }
      catch (error) { if (Number(error?.code) !== 4902 || !addChain) throw error; await this.provider.request({method: EIP1193_METHODS.addChain, params: [addChain]}); }
      this.chainId = await this.provider.request({method: EIP1193_METHODS.chainId});
      if (String(this.chainId).toLowerCase() !== this.chain.evmChainHex) throw new DAppConnectError("WRONG_CHAIN", "Wallet did not switch to YNX Testnet.");
      return {chainId: this.chainId, switched: true};
    } catch (error) { throw classifyWalletError(error); }
  }
  async signMessage(message, account = this.account) { if (!validAddress(account)) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before signing."); try { return await this.provider.request({method: EIP1193_METHODS.sign, params: [message, account]}); } catch (error) { throw classifyWalletError(error); } }
  async signTypedData(typedData, account = this.account) { if (!validAddress(account)) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before signing."); try { return await this.provider.request({method: EIP1193_METHODS.signTypedData, params: [account, JSON.stringify(typedData)]}); } catch (error) { throw classifyWalletError(error); } }
  async sendTransaction(transaction) { if (!this.account) throw new DAppConnectError("ACCOUNT_REQUIRED", "Connect an EVM account before sending a transaction."); try { return await this.provider.request({method: EIP1193_METHODS.sendTransaction, params: [{...transaction, from: transaction.from || this.account}]}); } catch (error) { throw classifyWalletError(error); } }
  on(event, listener) { if (typeof this.provider.on !== "function") throw new DAppConnectError("PROVIDER_EVENTS_UNSUPPORTED", "Wallet provider does not expose EIP-1193 events."); this.provider.on(event, listener); return () => this.provider.removeListener?.(event, listener); }
}

export async function connectWithWalletConnect(adapter, request) {
  if (!adapter || typeof adapter.connect !== "function") throw new DAppConnectError("WALLETCONNECT_ADAPTER_REQUIRED", "A WalletConnect v2 adapter is required.");
  try { const result = await adapter.connect(request); if (!result?.provider || typeof result.provider.request !== "function") throw new DAppConnectError("WALLETCONNECT_INVALID_SESSION", "WalletConnect did not provide an EIP-1193 session provider."); return new StandardWalletConnection(result.provider); }
  catch (error) { throw classifyWalletError(error); }
}
