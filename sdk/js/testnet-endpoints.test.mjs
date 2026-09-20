import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {getTestnetEndpoints, testnetEndpointProfiles, ynxTestnet, YNXClient,bundledEndpointAuthority} from "./index.js";
const time={nowMs:Date.parse(bundledEndpointAuthority.issuedAt)+1};

test("active consumers use renewed canonical RPC/Faucet and retain explicit legacy compatibility", () => {
  const active = getTestnetEndpoints('active',time),legacy=getTestnetEndpoints('legacy',time);
  assert.equal(active.evmJsonRpc,bundledEndpointAuthority.evmRpc);
  assert.equal(active.nativeRest,bundledEndpointAuthority.rpc);
  assert.equal(active.faucet,bundledEndpointAuthority.faucet);
  assert.equal(legacy.evmJsonRpc, ynxTestnet.rpcUrls[0]);
  assert.equal(legacy.nativeRest, ynxTestnet.restUrls[0]);
  assert.equal(legacy.faucet, ynxTestnet.faucetUrls[0]);
  assert.equal(active.explorer, ynxTestnet.blockExplorerUrls[0]);
  assert.notEqual(active.restGateway, active.nativeRest);
  assert.equal(active.grpcTlsAuthority, "grpc.ynxweb4.com:443");
  assert.equal(active.websocket, null);
  assert.deepEqual(testnetEndpointProfiles.activation, {explorerAliasPublicVerified:false,faucetAliasPublicVerified:true,rpcAliasPublicVerified:true});
});

test("no Mainnet, unverified Explorer activation, automatic fallback or client renewal", () => {
  assert.equal(testnetEndpointProfiles.candidate.evmJsonRpc, "https://rpc-testnet.ynxweb4.com");
  assert.equal(testnetEndpointProfiles.candidate.nativeRest, "https://rpc-testnet.ynxweb4.com");
  assert.equal(testnetEndpointProfiles.candidate.faucet, "https://faucet-testnet.ynxweb4.com");
  assert.equal(testnetEndpointProfiles.candidate.grpcTlsAuthority, getTestnetEndpoints('active',time).grpcTlsAuthority);
  assert.equal(testnetEndpointProfiles.candidate.restGateway, getTestnetEndpoints('active',time).restGateway);
  for (const profile of ["candidate", "canonical", "mainnet", "live", "", null]) assert.throws(() => getTestnetEndpoints(profile,time));
  assert.throws(() => { testnetEndpointProfiles.activation.rpcAliasPublicVerified = true; });
  assert.equal(testnetEndpointProfiles.mainnet.enabled, false);
  assert.equal(testnetEndpointProfiles.mainnet.chainId, null);
  for(const profile of ['active','legacy'])assert.throws(()=>getTestnetEndpoints(profile,{nowMs:Date.parse(bundledEndpointAuthority.expiresAt)}),/EXPIRED/);
});

test("SDK separates native REST from JSON-RPC on both configured profiles without network writes", async () => {
  for (const profile of [testnetEndpointProfiles.legacy, testnetEndpointProfiles.candidate]) {
    const calls = [];
    const client = new YNXClient({restUrl: profile.nativeRest, evmUrl: profile.evmJsonRpc, fetchImpl: async (url, options) => {
      calls.push({url: String(url), options});
      const request = options.body ? JSON.parse(options.body) : null;
      return new Response(JSON.stringify(request ? {jsonrpc: "2.0", id: request.id, result: "0x1917"} : {chainId: 6423}), {status: 200});
    }});
    await client.getStatus(); await client.callEVM("eth_chainId");
    assert.equal(calls[0].url, `${profile.nativeRest}/status`);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[1].url, `${profile.evmJsonRpc}/`);
    assert.equal(JSON.parse(calls[1].options.body).method, "eth_chainId");
  }
});

test("generated SDK/config artifacts match the canonical migration source", () => {
  const root = new URL("../../", import.meta.url);
  execFileSync(process.execPath, ["scripts/ops/generate-testnet-endpoints.mjs", "--check"], {cwd: root});
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL("configs/testnet-endpoints.json", root))), testnetEndpointProfiles);
  const config = JSON.parse(fs.readFileSync(new URL("configs/networks.json", root)));
  assert.equal(config.networks.mainnetDraft.enabled, false);
  assert.equal(config.networks.mainnetDraft.chainId, null);
  assert.equal(config.networks.testnet.chainId, 6423);
  assert.equal(config.networks.devnet.chainId, 6425);
});
