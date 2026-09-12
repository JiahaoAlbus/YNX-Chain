import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  disconnectStandardWallet,
  readStandardWalletProviderPreference,
  standardWalletDetails,
  YNX_EVM_CHAIN,
} from "./wallet";

const PREFERENCE_KEY = "ynx.dex.standard-wallet.v1.provider";
const META_ACCOUNT = `0x${"a".repeat(40)}`;
const YNX_ACCOUNT = `0x${"b".repeat(40)}`;

// These injected providers are test doubles only. The component, Wallet
// adapter, shared discovery and shared connection reducer execute unchanged.
function provider(kind: "metamask" | "ynx-wallet", account: string) {
  const listeners = new Map<string, Set<(value?: unknown) => void>>();
  return {
    isMetaMask: kind === "metamask",
    isYNXWallet: kind === "ynx-wallet",
    providerInfo: { rdns: kind === "metamask" ? "io.metamask" : "com.ynx.wallet" },
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_chainId") return YNX_EVM_CHAIN.chainId;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      throw new Error(`Unexpected test-provider method: ${method}`);
    }),
    on(event: string, listener: (value?: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeListener(event: string, listener: (value?: unknown) => void) {
      listeners.get(event)?.delete(listener);
    },
  };
}

const methods = (value: ReturnType<typeof provider>) =>
  value.request.mock.calls.map(([request]) => request.method);

async function settleDiscovery() {
  // Drive the actual SDK's bounded EIP-6963 discovery window deterministically.
  await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
}

describe("DEX selected-provider restore and disconnect lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    disconnectStandardWallet();
    location.hash = "";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input), location.origin).pathname !== "/v1/native-snapshot") {
        throw new Error(`Unexpected network request in Wallet component fixture: ${String(input)}`);
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          source: "authoritative chain-native YNX Testnet state",
          updatedAt: new Date().toISOString(),
          assets: [], pools: [], events: [],
        }),
      } as Response;
    }));
  });

  afterEach(() => {
    cleanup();
    disconnectStandardWallet();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("restores the explicitly chosen MetaMask on remount even when YNX Wallet is also present", async () => {
    const ynx = provider("ynx-wallet", YNX_ACCOUNT);
    const metaMask = provider("metamask", META_ACCOUNT);
    vi.stubGlobal("ethereum", { providers: [ynx, metaMask] });
    const first = render(<App />);
    await settleDiscovery();
    expect(ynx.request).not.toHaveBeenCalled();
    expect(metaMask.request).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Connect MetaMask" }));
    await settleDiscovery();
    expect(methods(metaMask)).toEqual(["wallet_switchEthereumChain", "eth_chainId", "eth_requestAccounts"]);
    expect(ynx.request).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(readStandardWalletProviderPreference()).toBe("metamask");

    first.unmount();
    metaMask.request.mockClear();
    render(<App />);
    await settleDiscovery();
    expect(methods(metaMask)).toEqual(["eth_accounts", "eth_chainId"]);
    expect(ynx.request).not.toHaveBeenCalled();
    expect(standardWalletDetails()).toMatchObject({
      status: "connected", providerKind: "metamask", account: META_ACCOUNT,
    });
    fireEvent.click(screen.getByRole("button", { name: "0xaaaa…aaaa" }));
    expect(within(screen.getByRole("dialog")).getByText(META_ACCOUNT)).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("MetaMask", { exact: true })).toBeInTheDocument();
  });

  it("keeps an explicit disconnect across remount without account or chain requests", async () => {
    const ynx = provider("ynx-wallet", YNX_ACCOUNT);
    const metaMask = provider("metamask", META_ACCOUNT);
    vi.stubGlobal("ethereum", { providers: [ynx, metaMask] });
    const first = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Connect MetaMask" }));
    await settleDiscovery();
    fireEvent.click(screen.getByRole("button", { name: "0xaaaa…aaaa" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect wallet" }));
    expect(readStandardWalletProviderPreference()).toBeNull();
    expect(localStorage.getItem(PREFERENCE_KEY)).toBeNull();

    first.unmount();
    metaMask.request.mockClear();
    ynx.request.mockClear();
    render(<App />);
    await settleDiscovery();
    expect(metaMask.request).not.toHaveBeenCalled();
    expect(ynx.request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Swap" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not substitute YNX Wallet when the saved MetaMask provider is missing", async () => {
    localStorage.setItem(PREFERENCE_KEY, "metamask");
    const ynx = provider("ynx-wallet", YNX_ACCOUNT);
    vi.stubGlobal("ethereum", { providers: [ynx] });
    render(<App />);
    await settleDiscovery();
    expect(ynx.request).not.toHaveBeenCalled();
    expect(readStandardWalletProviderPreference()).toBe("metamask");
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Swap" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["discovery", "network-switch"] as const)(
    "cancels a newer Wallet connection when disconnected during %s",
    async (phase) => {
      localStorage.setItem(PREFERENCE_KEY, "metamask");
      const ynx = provider("ynx-wallet", YNX_ACCOUNT);
      const metaMask = provider("metamask", META_ACCOUNT);
      vi.stubGlobal("ethereum", { providers: [ynx, metaMask] });
      render(<App />);
      await settleDiscovery();
      expect(standardWalletDetails().account).toBe(META_ACCOUNT);
      metaMask.request.mockClear();

      let completeSwitch!: () => void;
      const pendingSwitch = new Promise<null>((resolve) => {
        completeSwitch = () => resolve(null);
      });
      if (phase === "network-switch") {
        ynx.request.mockImplementationOnce(async ({ method }) => {
          expect(method).toBe("wallet_switchEthereumChain");
          return pendingSwitch;
        });
      }
      fireEvent.click(screen.getByRole("button", { name: "0xaaaa…aaaa" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continue in YNX Wallet" }));
      if (phase === "network-switch") {
        await settleDiscovery();
        expect(methods(ynx)).toEqual(["wallet_switchEthereumChain"]);
      }

      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect wallet" }));
      await act(async () => { completeSwitch(); });
      await settleDiscovery();
      expect(methods(ynx)).toEqual(phase === "network-switch" ? ["wallet_switchEthereumChain"] : []);
      expect(metaMask.request).not.toHaveBeenCalled();
      expect(readStandardWalletProviderPreference()).toBeNull();
      expect(standardWalletDetails().status).toBe("disconnected");
      expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();
      expect(screen.getByText("Standard Wallet disconnected. Read-only DEX remains available.")).toBeInTheDocument();
    },
  );

  it("does not continue account requests or persist a connection after unmount during a network switch", async () => {
    const metaMask = provider("metamask", META_ACCOUNT);
    let completeSwitch!: () => void;
    const pendingSwitch = new Promise<null>((resolve) => {
      completeSwitch = () => resolve(null);
    });
    metaMask.request.mockImplementationOnce(async ({ method }) => {
      expect(method).toBe("wallet_switchEthereumChain");
      return pendingSwitch;
    });
    vi.stubGlobal("ethereum", { providers: [metaMask] });
    const view = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Connect MetaMask" }));
    await settleDiscovery();
    expect(methods(metaMask)).toEqual(["wallet_switchEthereumChain"]);
    view.unmount();
    await act(async () => { completeSwitch(); });
    await settleDiscovery();
    expect(methods(metaMask)).toEqual(["wallet_switchEthereumChain"]);
    expect(readStandardWalletProviderPreference()).toBeNull();
    render(<App />);
    await settleDiscovery();
    expect(methods(metaMask)).toEqual(["wallet_switchEthereumChain"]);
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument();
  });
});
