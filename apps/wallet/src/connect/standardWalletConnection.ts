/**
 * Platform-owned implementation seam for the accepted P0 standard Wallet
 * connection contract.  It deliberately has no Gateway dependency: native
 * hosts, a future extension and the Wallet DApp Browser can all supply the
 * same reviewed signing operations without making Product Session availability
 * a prerequisite for ordinary EVM use.
 */

export const YNX_EVM_CHAIN_ID = 6423 as const;
export const YNX_EVM_CHAIN_HEX = "0x1917" as const;

export type Eip1193Event = "accountsChanged" | "chainChanged" | "connect" | "disconnect";
export type Eip1193Request = Readonly<{ method: string; params?: readonly unknown[] }>;
export type Eip1193Listener = (...args: readonly unknown[]) => void;
export type StandardWalletStatus = "WALLET_NOT_CONNECTED" | "STANDARD_CONNECTED" | "PRIVATE_SERVICE_DEGRADED" | "PRODUCT_SESSION_READY";

export class Eip1193Error extends Error {
  constructor(readonly code: 4001 | 4100 | 4200 | 4900 | 4901 | 4902, message: string) {
    super(message);
    this.name = "Eip1193Error";
  }
}

export type EvmTransaction = Readonly<Record<string, unknown> & { from?: string }>;
export type PlatformWalletOperations = Readonly<{
  requestAccount(): Promise<string>;
  signPersonalMessage(input: Readonly<{ account: string; message: string }>): Promise<string>;
  signTypedDataV4(input: Readonly<{ account: string; typedData: string }>): Promise<string>;
  sendTransaction(input: Readonly<{ account: string; transaction: EvmTransaction }>): Promise<string>;
  addChain?(chain: Readonly<Record<string, unknown>>): Promise<void>;
  switchChain?(chainId: typeof YNX_EVM_CHAIN_HEX): Promise<void>;
}>;

type ListenerMap = Map<Eip1193Event, Set<Eip1193Listener>>;

export class StandardWalletConnection {
  readonly #listeners: ListenerMap = new Map();
  #account: string | null = null;
  #status: StandardWalletStatus = "WALLET_NOT_CONNECTED";

  constructor(private readonly operations: PlatformWalletOperations) {}

  status(): StandardWalletStatus { return this.#status; }
  account(): string | null { return this.#account; }

  on(event: Eip1193Event, listener: Eip1193Listener): this {
    const listeners = this.#listeners.get(event) ?? new Set<Eip1193Listener>();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return this;
  }

  removeListener(event: Eip1193Event, listener: Eip1193Listener): this {
    this.#listeners.get(event)?.delete(listener);
    return this;
  }

  async request(input: Eip1193Request): Promise<unknown> {
    const method = exactMethod(input);
    const params = exactParams(input.params);
    switch (method) {
      case "eth_chainId": return YNX_EVM_CHAIN_HEX;
      case "net_version": return String(YNX_EVM_CHAIN_ID);
      case "eth_accounts": return this.#account ? [this.#account] : [];
      case "eth_requestAccounts": return this.#requestAccounts(params);
      case "wallet_addEthereumChain": return this.#addChain(params);
      case "wallet_switchEthereumChain": return this.#switchChain(params);
      case "personal_sign": return this.#personalSign(params);
      case "eth_signTypedData_v4": return this.#typedData(params);
      case "eth_sendTransaction": return this.#sendTransaction(params);
      default: throw new Eip1193Error(4200, `Unsupported EIP-1193 method: ${method}`);
    }
  }

  /** Gateway/Product Session failures affect only private service state. */
  markPrivateServiceDegraded(): void {
    if (!this.#account) return;
    this.#status = "PRIVATE_SERVICE_DEGRADED";
  }

  markProductSessionReady(): void {
    if (!this.#account) throw new Eip1193Error(4100, "Wallet account is not connected");
    this.#status = "PRODUCT_SESSION_READY";
  }

  disconnect(reason = "Wallet disconnected"): void {
    if (!this.#account) return;
    this.#account = null;
    this.#status = "WALLET_NOT_CONNECTED";
    this.#emit("accountsChanged", []);
    this.#emit("disconnect", new Eip1193Error(4900, reason));
  }

  async #requestAccounts(params: readonly unknown[]): Promise<readonly string[]> {
    if (params.length !== 0) throw new Eip1193Error(4200, "eth_requestAccounts does not accept parameters");
    const account = strictAddress(await this.operations.requestAccount());
    const changed = account !== this.#account;
    this.#account = account;
    this.#status = "STANDARD_CONNECTED";
    if (changed) this.#emit("accountsChanged", [account]);
    this.#emit("connect", { chainId: YNX_EVM_CHAIN_HEX });
    return [account];
  }

  async #addChain(params: readonly unknown[]): Promise<null> {
    if (params.length !== 1 || !plain(params[0])) throw new Eip1193Error(4200, "wallet_addEthereumChain requires one chain object");
    const chain = params[0];
    if (chain.chainId !== YNX_EVM_CHAIN_HEX) throw new Eip1193Error(4902, "Only YNX Testnet (0x1917) is available in this Wallet build");
    await this.operations.addChain?.(Object.freeze({ ...chain }));
    return null;
  }

  async #switchChain(params: readonly unknown[]): Promise<null> {
    if (params.length !== 1 || !plain(params[0]) || Object.keys(params[0]).length !== 1 || typeof params[0].chainId !== "string") throw new Eip1193Error(4200, "wallet_switchEthereumChain requires one chainId object");
    if (params[0].chainId !== YNX_EVM_CHAIN_HEX) throw new Eip1193Error(4902, "Requested chain is not configured in this Wallet build");
    await this.operations.switchChain?.(YNX_EVM_CHAIN_HEX);
    this.#emit("chainChanged", YNX_EVM_CHAIN_HEX);
    return null;
  }

  async #personalSign(params: readonly unknown[]): Promise<string> {
    const account = this.#requireAccount();
    if (params.length !== 2 || typeof params[0] !== "string" || strictAddress(params[1]) !== account) throw new Eip1193Error(4100, "personal_sign must contain message and the approved account");
    return strictSignature(await this.operations.signPersonalMessage({ account, message: params[0] }));
  }

  async #typedData(params: readonly unknown[]): Promise<string> {
    const account = this.#requireAccount();
    if (params.length !== 2 || strictAddress(params[0]) !== account || typeof params[1] !== "string") throw new Eip1193Error(4100, "eth_signTypedData_v4 must contain the approved account and JSON typed data");
    try { JSON.parse(params[1]); } catch { throw new Eip1193Error(4200, "eth_signTypedData_v4 typed data must be JSON"); }
    return strictSignature(await this.operations.signTypedDataV4({ account, typedData: params[1] }));
  }

  async #sendTransaction(params: readonly unknown[]): Promise<string> {
    const account = this.#requireAccount();
    if (params.length !== 1 || !plain(params[0])) throw new Eip1193Error(4200, "eth_sendTransaction requires one transaction object");
    const transaction = Object.freeze({ ...params[0] });
    if (transaction.from !== undefined && strictAddress(transaction.from) !== account) throw new Eip1193Error(4100, "Transaction from address is not the approved Wallet account");
    return strictHash(await this.operations.sendTransaction({ account, transaction }));
  }

  #requireAccount(): string {
    if (!this.#account) throw new Eip1193Error(4100, "Wallet account is not connected");
    return this.#account;
  }

  #emit(event: Eip1193Event, ...args: readonly unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args);
  }
}

/** Browser-only EIP-6963 bridge. Native applications do not claim injection. */
export function announceEip6963Provider(target: Pick<EventTarget, "dispatchEvent" | "addEventListener" | "removeEventListener">, provider: StandardWalletConnection, info: Readonly<{ uuid: string; name: string; icon: string; rdns: string }>): () => void {
  const announce = () => target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: Object.freeze({ ...info }), provider }) }));
  target.addEventListener("eip6963:requestProvider", announce);
  announce();
  return () => target.removeEventListener("eip6963:requestProvider", announce);
}

function exactMethod(input: Eip1193Request): string {
  if (!plain(input) || typeof input.method !== "string" || input.method.length < 1 || input.method.length > 128) throw new Eip1193Error(4200, "EIP-1193 request method is invalid");
  return input.method;
}
function exactParams(params: readonly unknown[] | undefined): readonly unknown[] { if (params === undefined) return []; if (!Array.isArray(params)) throw new Eip1193Error(4200, "EIP-1193 request params must be an array"); return params; }
function strictAddress(value: unknown): string { if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value)) throw new Eip1193Error(4100, "EVM account must be a lowercase 0x address"); return value; }
function strictSignature(value: unknown): string { if (typeof value !== "string" || !/^0x[0-9a-f]{130}$/.test(value)) throw new Eip1193Error(4200, "Wallet signing operation returned an invalid EVM signature"); return value; }
function strictHash(value: unknown): string { if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) throw new Eip1193Error(4200, "Wallet transaction operation returned an invalid transaction hash"); return value; }
function plain(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
