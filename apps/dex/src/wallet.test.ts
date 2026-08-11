import {
  createCallbackURL,
  createDexActionCallback,
  requestDigest,
  signAuthorization,
  signDexAction,
  walletIdentity,
} from "@ynx-chain/wallet-auth";
import { describe, expect, it, vi } from "vitest";
import {
  buildWalletRequest,
  connectMetaMask,
  consumeDexActionCallback,
  consumeWalletCallback,
  DEX_WALLET_CALLBACK,
  YNX_EVM_CHAIN,
  walletDeepLink,
  WalletRequestError,
} from "./wallet";

const key = "AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv";
const now = new Date("2026-07-18T08:00:00.000Z");
const build = () =>
  buildWalletRequest({
    nonce: "abcdefghijklmnopqrstuvwxyz123456",
    productDeviceKey: key,
    now,
  });
class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("canonical Wallet request adapter", () => {
  it("adds YNX Testnet when needed and returns a validated MetaMask account", async () => {
    const calls: string[] = [];
    const account = `0x${"A".repeat(40)}`;
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === "wallet_switchEthereumChain" && calls.length === 1)
          throw Object.assign(new Error("unknown chain"), { code: 4902 });
        if (method === "eth_chainId") return YNX_EVM_CHAIN.chainId;
        if (method === "eth_requestAccounts") return [account];
        return null;
      }),
    };
    await expect(connectMetaMask(provider)).resolves.toBe(
      account.toLowerCase(),
    );
    expect(calls).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
      "eth_chainId",
      "eth_requestAccounts",
    ]);
  });
  it("fails clearly when MetaMask is unavailable", async () => {
    await expect(connectMetaMask(undefined)).rejects.toThrow(
      /MetaMask was not detected/,
    );
  });
  it("binds the exact reviewed web product, callback, scopes and five-minute expiry", () => {
    const value = build();
    expect(value.chainId).toBe("ynx_6423-1");
    expect(value.bundleId).toBe("com.ynxweb4.dex.web");
    expect(value.callback).toBe(DEX_WALLET_CALLBACK);
    expect(value.scopes).toEqual([
      "account:read",
      "dex:positions:read",
      "dex:transaction:request",
    ]);
    expect(value.expiresAt).toBe("2026-07-18T08:05:00.000Z");
    expect(requestDigest(value)).toMatch(/^[0-9a-f]{64}$/);
    expect(walletDeepLink(value)).toMatch(
      /^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]+$/,
    );
  });
  it("rejects callback, scope, product, unknown-field and malformed device substitution", () => {
    const value = build();
    for (const changed of [
      { ...value, callback: "https://attacker.invalid/callback" },
      { ...value, scopes: ["admin:all"] },
      { ...value, productClientId: "ynx-exchange-v1" },
      { ...value, unknown: true },
      { ...value, productDeviceKey: "opaque" },
    ])
      expect(() => walletDeepLink(changed as never)).toThrow(
        WalletRequestError,
      );
  });
  it("accepts one signed Wallet callback and rejects replay, tampering and cross-tab returns", () => {
    const request = build(),
      storage = new MemoryStorage();
    storage.setItem("ynx-dex-wallet-pending-v1", JSON.stringify(request));
    const approval = signAuthorization(request, {
      accountSecret: "01".padStart(64, "0"),
      issuedAt: "2026-07-18T08:01:00.000Z",
    });
    const url = createCallbackURL(approval);
    expect(
      consumeWalletCallback(url, storage, new Date("2026-07-18T08:02:00.000Z"))
        ?.account,
    ).toBe(approval.account);
    expect(() =>
      consumeWalletCallback(url, storage, new Date("2026-07-18T08:02:00.000Z")),
    ).toThrow(/no pending/);
    const cross = new MemoryStorage();
    cross.setItem(
      "ynx-dex-wallet-pending-v1",
      JSON.stringify({ ...request, bundleId: "com.ynxweb4.exchange" }),
    );
    expect(() =>
      consumeWalletCallback(url, cross, new Date("2026-07-18T08:02:00.000Z")),
    ).toThrow(WalletRequestError);
  });
  it("accepts one exact Go-compatible DEX action callback and rejects replay or widening", () => {
    const secret = "01".padStart(64, "0"),
      account = walletIdentity(secret).account,
      request = {
        version: "1" as const,
        chainId: 6423 as const,
        productClientId: "ynx-dex-web-v1" as const,
        bundleId: "com.ynxweb4.dex.web" as const,
        callback: "https://dex.ynxweb4.com/wallet-action/callback" as const,
        sessionBinding: "a".repeat(64),
        account,
        nonce: 2,
        action: "dex_swap_exact_input" as const,
        payload: {
          poolId: "dex_ynxt_yusd",
          assetIn: "YNXT",
          amountIn: 100,
          minAmountOut: 190,
          deadlineUnix: 1786331040,
        },
        quote: {
          poolId: "dex_ynxt_yusd",
          poolBlockHeight: 931437,
          poolUpdatedAt: "2026-08-10T02:59:30.000Z",
          asset0: "YNXT",
          asset1: "yusd-test",
          reserve0: 1000000,
          reserve1: 2000000,
          feeBps: 30,
          expectedAmount: 197,
        },
        issuedAt: "2026-08-10T03:00:00.000Z",
        expiresAt: "2026-08-10T03:05:00.000Z",
      },
      signed = signDexAction(
        request,
        { accountSecret: secret, account },
        new Date(request.issuedAt),
      ),
      url = createDexActionCallback(
        signed,
        request,
        new Date(request.issuedAt),
      ),
      storage = new MemoryStorage();
    storage.setItem("ynx-dex-action-pending-v1", JSON.stringify(request));
    expect(
      consumeDexActionCallback(
        url,
        storage,
        new Date("2026-08-10T03:01:00.000Z"),
      )?.transactionHash,
    ).toBe(signed.transactionHash);
    expect(() =>
      consumeDexActionCallback(
        url,
        storage,
        new Date("2026-08-10T03:01:00.000Z"),
      ),
    ).toThrow(/no pending/);
    const widened = new MemoryStorage();
    widened.setItem(
      "ynx-dex-action-pending-v1",
      JSON.stringify({
        ...request,
        payload: { ...request.payload, amountIn: 101 },
      }),
    );
    expect(() =>
      consumeDexActionCallback(
        url,
        widened,
        new Date("2026-08-10T03:01:00.000Z"),
      ),
    ).toThrow(WalletRequestError);
  });
});
