import { afterEach, describe, expect, it, vi } from "vitest";
import { broadcastDexAction, loadAccountNonce, loadDexSnapshot } from "./api";
import {
  evmAddressFromYNX,
  walletIdentity,
  type DexActionResponse,
} from "@ynx-chain/wallet-auth";

const HASH = `0x${"a".repeat(64)}`;
const POOL = {
  id: "dex_ynxt_yusd",
  kind: "constant-product",
  asset0: "YNXT",
  asset1: "yusd-test",
  reserve0: 1000,
  reserve1: 2000,
  feeBps: 30,
  totalShares: 1400,
  blockHeight: 19,
  updatedAt: "2026-08-10T03:00:00.000Z",
  txHash: HASH,
  auditHash: "b".repeat(64),
};
const EVENT = {
  id: "event-1",
  type: "dex_swap_exact_input",
  poolId: POOL.id,
  signer: `0x${"1".repeat(40)}`,
  amount0: 10,
  amount1: 19,
  blockHeight: 20,
  occurredAt: "2026-08-10T03:00:01.000Z",
  txHash: HASH,
  auditHash: "c".repeat(64),
};
const ACTION = {
  action: "dex_swap_exact_input",
  transactionHash: HASH,
  signedTransaction: { payload: { poolId: POOL.id } },
} as unknown as DexActionResponse;
const RAW_POOL = {
  ...POOL,
  kind: "ynx-cpmm-v1",
  transactionHash: POOL.txHash,
  txHash: undefined,
};
const RAW_EVENT = {
  ...EVENT,
  transactionHash: EVENT.txHash,
  txHash: undefined,
};

afterEach(() => vi.unstubAllGlobals());

describe("DEX committed gateway boundary", () => {
  it("loads the currently deployed authoritative native DEX schema", async () => {
    const response = {
      source: "authoritative chain-native YNX Testnet state",
      updatedAt: new Date().toISOString(),
      assets: [
          {
            id: "yusd-test",
            symbol: "YUSD",
            name: "YNX USD Test",
            decimals: 6,
            blockHeight: 18,
            transactionHash: HASH,
            auditHash: "d".repeat(64),
          },
      ],
      pools: [RAW_POOL],
      events: [RAW_EVENT],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
          new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const snapshot = await loadDexSnapshot();
    expect(snapshot.analytics).toMatchObject({
      source: "authoritative chain-native YNX Testnet state",
      version: "native-dex-schema-v1",
      pools: 1,
    });
    expect(snapshot.pools[0]).toMatchObject({
      contractVersion: "ynx-native-dex-cpmm-v1",
      txHash: HASH,
    });
    expect(snapshot.events[0].txHash).toBe(HASH);
    expect(snapshot.provenance).toMatchObject({
      source: "authoritative chain-native YNX Testnet state",
      classification: "testnet",
      status: "live",
      version: "native-dex-schema-v1",
      coverage: "native-snapshot-assets-pools-events",
      latestBlock: 20,
    });
  });

  it("accepts only the exact authoritative account nonce", async () => {
    const account = walletIdentity("01".padStart(64, "0")).account,
      address = evmAddressFromYNX(account),
      fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ address, nonce: 7 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadAccountNonce(account)).resolves.toBe(7);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ address: `0x${"1".repeat(40)}`, nonce: 7 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(loadAccountNonce(account)).rejects.toThrow(
      /nonce is unavailable/,
    );
  });

  it("broadcasts the Wallet-signed body and requires matching committed evidence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            source: "ynx-consensus-abci",
            version: "abci-state-v13",
            failure: false,
            event: EVENT,
            pool: POOL,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const committed = await broadcastDexAction(ACTION);
    expect(committed.transactionHash).toBe(HASH);
    expect(fetchMock).toHaveBeenCalledWith(
      "/dex/pools/dex_ynxt_yusd/swaps/exact-input",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(ACTION.signedTransaction),
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          source: "ynx-consensus-abci",
          version: "abci-state-v13",
          failure: false,
          event: { ...EVENT, txHash: `0x${"d".repeat(64)}` },
          pool: POOL,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(broadcastDexAction(ACTION)).rejects.toThrow(/does not match/);
  });

  it("accepts only matching authoritative native mutation evidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          source: "authoritative chain-native YNX Testnet state",
          mainnet: false,
          replayed: false,
          transaction: { hash: HASH },
          result: { event: RAW_EVENT, pool: RAW_POOL },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(broadcastDexAction(ACTION)).resolves.toMatchObject({
      transactionHash: HASH,
      pool: { contractVersion: "ynx-cpmm-v1" },
    });
    fetchMock.mockResolvedValueOnce(
      new Response("<!doctype html><title>DEX</title>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    await expect(broadcastDexAction(ACTION)).rejects.toThrow(/failed closed/);
  });

  it("fails closed before rendering consensus integers that lose precision", async () => {
    const envelope = {
      source: "authoritative chain-native YNX Testnet state",
      updatedAt: new Date().toISOString(),
      assets: [],
      pools: [{ ...RAW_POOL, reserve0: Number.MAX_SAFE_INTEGER + 1 }],
      events: [],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
            new Response(JSON.stringify(envelope), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        ),
    );
    await expect(loadDexSnapshot()).rejects.toThrow(/safe-integer/);
  });
});
