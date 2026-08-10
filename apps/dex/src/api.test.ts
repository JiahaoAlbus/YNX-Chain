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

afterEach(() => vi.unstubAllGlobals());

describe("DEX committed gateway boundary", () => {
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

  it("fails closed before rendering consensus integers that lose precision", async () => {
    const envelopes = [
      {
        source: "ynx-consensus-abci",
        version: "abci-state-v13",
        failure: false,
        assets: [],
      },
      {
        source: "ynx-consensus-abci",
        version: "abci-state-v13",
        failure: false,
        pools: [{ ...POOL, reserve0: Number.MAX_SAFE_INTEGER + 1 }],
      },
      {
        source: "ynx-consensus-abci",
        version: "abci-state-v13",
        failure: false,
        events: [],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify(envelopes.shift()), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        ),
    );
    await expect(loadDexSnapshot()).rejects.toThrow(/safe-integer/);
  });
});
