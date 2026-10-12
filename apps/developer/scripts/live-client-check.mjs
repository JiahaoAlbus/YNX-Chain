import assert from "node:assert/strict";
import { YNXChainClient } from "../../../packages/developer-client/src/index.js";

const client = new YNXChainClient({ baseURL: process.env.YNX_REST_URL || "http://127.0.0.1:6420" });
const status = await client.health();
assert.equal(status.chainId, 6423); assert.equal(status.nativeCurrencySymbol, "YNXT");
const compiler = await client.assertPinnedCompiler(); assert.equal(compiler.version, "0.8.24"); assert.equal(compiler.pinned, true);
const artifact = await client.compile({ name: "DeveloperLiveCheck", source: "// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\ncontract DeveloperLiveCheck { function ping() external pure returns (uint256) { return 1; } }\n" });
assert.equal(artifact.ok, true); assert.ok(artifact.artifactHash); assert.ok(artifact.compilerConfigHash);
assert.equal(await client.rpc("eth_chainId"), "0x1917");
assert.throws(() => client.rpc("eth_sendTransaction", []), (error) => error.code === "rpc_method_not_allowed");
console.log(JSON.stringify({ live: true, chainId: status.chainId, height: status.height, compiler: compiler.version, artifactHash: artifact.artifactHash, arbitraryEVMClaim: false }, null, 2));
