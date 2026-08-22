import assert from "node:assert/strict";
import test from "node:test";
import { EvmBroadcastClient } from "./evmBroadcast";

const RAW = "0x02aabb";
const HASH = `0x${"ab".repeat(32)}`;

test("broadcast verifies 0x1917 before submitting the exact signed transaction", async () => {
  const calls: any[] = [];
  const fetcher = async (_url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)); calls.push(request);
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "eth_chainId" ? "0x1917" : HASH });
  };
  assert.equal(await new EvmBroadcastClient("https://rpc.ynxweb4.com/evm", fetcher).broadcastRawTransaction(RAW), HASH);
  assert.deepEqual(calls.map(({ method, params }) => ({ method, params })), [
    { method: "eth_chainId", params: [] },
    { method: "eth_sendRawTransaction", params: [RAW] },
  ]);
});

test("broadcast fails closed before submission on wrong chain", async () => {
  let calls = 0;
  const fetcher = async (_url: string, init?: RequestInit) => { calls += 1; const request = JSON.parse(String(init?.body)); return Response.json({ jsonrpc: "2.0", id: request.id, result: "0x1" }); };
  await assert.rejects(new EvmBroadcastClient("http://127.0.0.1", fetcher).broadcastRawTransaction(RAW), /chain identity/);
  assert.equal(calls, 1);
});

test("broadcast rejects malformed input, RPC errors and invalid hashes", async () => {
  await assert.rejects(new EvmBroadcastClient("http://127.0.0.1", async () => { throw new Error("not reached"); }).broadcastRawTransaction("0xABC"), /canonical lowercase/);
  let phase = 0;
  const rpcError = async (_url: string, init?: RequestInit) => { const request = JSON.parse(String(init?.body)); phase += 1; return Response.json(phase === 1 ? { jsonrpc: "2.0", id: request.id, result: "0x1917" } : { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "rejected" } }); };
  await assert.rejects(new EvmBroadcastClient("http://127.0.0.1", rpcError).broadcastRawTransaction(RAW), /failed \(-32000\)/);
  phase = 0;
  const badHash = async (_url: string, init?: RequestInit) => { const request = JSON.parse(String(init?.body)); phase += 1; return Response.json({ jsonrpc: "2.0", id: request.id, result: phase === 1 ? "0x1917" : "0x12" }); };
  await assert.rejects(new EvmBroadcastClient("http://127.0.0.1", badHash).broadcastRawTransaction(RAW), /invalid transaction hash/);
});
