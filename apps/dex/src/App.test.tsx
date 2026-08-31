import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const json = (value: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(value),
  }) as Promise<Response>;
const nativeFetch = (
  assets: unknown[] = [],
  pools: unknown[] = [],
  events: unknown[] = [],
) =>
  vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/v1/native-snapshot"))
      return json({
        source: "authoritative chain-native YNX Testnet state",
        updatedAt: new Date().toISOString(),
        assets,
        pools,
        events,
      });
    throw new Error(`unexpected request ${path}`);
  });

describe("YNX DEX consensus product shell", () => {
  beforeEach(() => {
    location.hash = "";
    localStorage.clear();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    vi.stubGlobal("fetch", nativeFetch());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.dir = "ltr";
    document.documentElement.lang = "en";
  });

  it("renders truthful empty consensus states without fabricated metrics", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Swap" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("No executable route")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/APY [1-9]/)).not.toBeInTheDocument();
    const primary = screen.getByRole("complementary", {
      name: "Primary navigation",
    });
    fireEvent.click(within(primary).getByRole("button", { name: "Pools" }));
    await waitFor(() =>
      expect(
        screen.getByText("No authoritative Testnet pools yet"),
      ).toBeInTheDocument(),
    );
  });
  it("automatically reloads the read-only snapshot after the browser reconnects", async () => {
    const reconnectFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockImplementation(nativeFetch());
    vi.stubGlobal("fetch", reconnectFetch);
    render(<App />);
    expect(await screen.findByText(/network unavailable/)).toBeInTheDocument();
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(reconnectFetch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText("No executable route")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/network unavailable/)).not.toBeInTheDocument();
  });
  it("offers YNX Wallet, its official download and MetaMask while native signing remains separately gated", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    expect(
      await screen.findByRole("dialog", { name: "Connect Wallet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/exact DEX identity and permissions/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue in YNX Wallet" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("link", { name: "Download YNX Wallet" }),
    ).toHaveAttribute(
      "href",
      "https://www.ynxweb4.com/dapp/download",
    );
    expect(
      screen.getByRole("button", { name: "Connect MetaMask" }),
    ).toBeEnabled();
  });
  it("renders OHLC candles only from confirmed native swap events", async () => {
    const asset = {
      id: "ynx-usd-test",
      symbol: "YUSDT",
      name: "YNX USD Test",
      decimals: 0,
      blockHeight: 10,
    };
    const pool = {
      id: "dex_ynxt_yusdt",
      kind: "ynx-cpmm-v1",
      asset0: "YNXT",
      asset1: "ynx-usd-test",
      reserve0: 50,
      reserve1: 100000,
      feeBps: 30,
      totalShares: 100,
      blockHeight: 11,
      updatedAt: new Date().toISOString(),
      auditHash: "a".repeat(64),
    };
    const events = [
      {
        id: "swap-1",
        type: "dex_swap_exact_input",
        poolId: pool.id,
        signer: "ynx1trader",
        asset0: "YNXT",
        asset1: "ynx-usd-test",
        amount0: 2,
        amount1: 2000,
        blockHeight: 12,
        occurredAt: new Date().toISOString(),
        transactionHash: "b".repeat(64),
        auditHash: "c".repeat(64),
      },
    ];
    vi.stubGlobal("fetch", nativeFetch([asset], [pool], events));
    render(<App />);
    const primary = screen.getByRole("complementary", {
      name: "Primary navigation",
    });
    fireEvent.click(within(primary).getByRole("button", { name: "Analytics" }));
    expect(
      await screen.findByLabelText(
        "YNXT/ynx-usd-test confirmed swap candles",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/confirmed chain swaps/)).toBeInTheDocument();
    expect(screen.getByText(/coverage native-snapshot-assets-pools-events/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1m" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("persists Arabic RTL and dark appearance", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "ar" },
    });
    expect(document.documentElement.dir).toBe("rtl");
    fireEvent.click(screen.getByLabelText("داكن"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("quotes a committed native consensus pool and sends guests through real Wallet connection", async () => {
    const asset = {
      id: "ynx-usd-test",
      symbol: "YUSDT",
      name: "YNX USD Test",
      decimals: 0,
      issuer: "ynx1issuer000000000000000000",
      maxSupply: 1000000,
      totalSupply: 100000,
      blockHeight: 11,
      txHash: "a".repeat(64),
      auditHash: "b".repeat(64),
    };
    const pool = {
      id: "dex_ynxt_yusdt",
      kind: "constant-product",
      asset0: "YNXT",
      asset1: "ynx-usd-test",
      reserve0: 1000,
      reserve1: 2000,
      feeBps: 30,
      totalShares: 1000,
      shares: [],
      blockHeight: 12,
      updatedAt: "2026-08-09T00:00:00Z",
      txHash: "c".repeat(64),
      auditHash: "d".repeat(64),
    };
    vi.stubGlobal("fetch", nativeFetch([asset], [pool], []));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText("You pay token")).toHaveValue("ynxt"),
    );
    fireEvent.change(screen.getByLabelText("You pay amount"), {
      target: { value: "10" },
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Price impact is 5% or higher. Review size and route.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("You receive amount")).toHaveValue("17");
    fireEvent.click(screen.getByRole("button", { name: "Review swap" }));
    const dialog = screen.getByRole("dialog", { name: "Review swap" });
    expect(within(dialog).getByText("dex_ynxt_yusdt")).toBeInTheDocument();
    expect(
      within(dialog).getByText("dex_swap_exact_input"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("17 YUSDT")).toBeInTheDocument();
    const connect = within(dialog).getByRole("button", {
      name: "Connect Wallet to continue",
    });
    expect(connect).toBeEnabled();
    fireEvent.click(connect);
    expect(
      await screen.findByRole("dialog", { name: "Connect Wallet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/quote remains available without login/i),
    ).toBeInTheDocument();
  });
  it("quotes and reviews an exact-output swap with a maximum-input bound", async () => {
    const asset = {
      id: "ynx-usd-test",
      symbol: "YUSDT",
      name: "YNX USD Test",
      decimals: 0,
      maxSupply: 1_000_000,
      totalSupply: 100_000,
      blockHeight: 11,
    };
    const pool = {
      id: "dex_ynxt_yusdt",
      kind: "constant-product",
      asset0: "YNXT",
      asset1: "ynx-usd-test",
      reserve0: 1_000,
      reserve1: 2_000,
      feeBps: 30,
      totalShares: 1_000,
      blockHeight: 12,
      updatedAt: "2026-08-09T00:00:00.000Z",
      txHash: "c".repeat(64),
      auditHash: "d".repeat(64),
    };
    vi.stubGlobal("fetch", nativeFetch([asset], [pool], []));
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Exact output" }));
    fireEvent.change(screen.getByLabelText("You receive amount"), {
      target: { value: "20" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("You pay amount")).toHaveValue("11"),
    );
    expect(screen.getByText("Maximum paid")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review swap" }));
    const dialog = screen.getByRole("dialog", { name: "Review swap" });
    expect(
      within(dialog).getByText("dex_swap_exact_output"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("12 YNXT")).toBeInTheDocument();
  });

  it("renders a committed multi-hop quote but refuses to request a one-pool Wallet action", async () => {
    const assetB = {
      id: "asset-b",
      symbol: "BTEST",
      name: "YNX B Test",
      decimals: 0,
      blockHeight: 10,
    };
    const assetC = {
      id: "asset-c",
      symbol: "CTEST",
      name: "YNX C Test",
      decimals: 0,
      blockHeight: 10,
    };
    const poolAB = {
      id: "dex_ynxt_b",
      kind: "ynx-cpmm-v1",
      asset0: "YNXT",
      asset1: "asset-b",
      reserve0: 1_000,
      reserve1: 1_000,
      feeBps: 30,
      totalShares: 1_000,
      blockHeight: 11,
      updatedAt: new Date().toISOString(),
      auditHash: "a".repeat(64),
    };
    const poolBC = {
      ...poolAB,
      id: "dex_b_c",
      asset0: "asset-b",
      asset1: "asset-c",
      auditHash: "b".repeat(64),
    };
    vi.stubGlobal("fetch", nativeFetch([assetB, assetC], [poolAB, poolBC], []));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText("You receive token")).toHaveValue("asset-b"),
    );
    fireEvent.change(screen.getByLabelText("You receive token"), {
      target: { value: "asset-c" },
    });
    fireEvent.change(screen.getByLabelText("You pay amount"), {
      target: { value: "10" },
    });
    await waitFor(() =>
      expect(screen.getByText("2-hop chain-native quote")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review swap" }));
    const dialog = screen.getByRole("dialog", { name: "Review swap" });
    expect(within(dialog).getByText(/multi-hop result is a read-only quote/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Multi-hop execution unavailable" }),
    ).toBeDisabled();
  });
});
