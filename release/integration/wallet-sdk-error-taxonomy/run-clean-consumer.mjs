#!/usr/bin/env node
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sdk = resolve(root, "sdk/js");
const temporary = await mkdtemp(resolve(tmpdir(), "ynx-sdk-taxonomy-consumer-"));

try {
  const pack = command("npm", ["pack", sdk, "--pack-destination", temporary], root);
  const filename = pack.trim().split("\n").at(-1);
  assert.match(filename, /^ynx-chain-sdk-0\.2\.1\.tgz$/);
  const tarball = resolve(temporary, filename);
  const bytes = await readFile(tarball);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await writeFile(resolve(temporary, "package.json"), `${JSON.stringify({private: true, type: "module"})}\n`);
  command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], temporary);
  await writeFile(resolve(temporary, "consumer.mjs"), `
import assert from "node:assert/strict";
import {classifyYNXHTTPFailure, proveYNXTestnetRPC, ynxErrorCodes, ynxPublicEndpoints, ynxTestnet} from "@ynx-chain/sdk";

assert.equal(ynxTestnet.chainId, "0x1917");
assert.equal(ynxTestnet.chainIdDecimal, 6423);
assert.equal(ynxPublicEndpoints.rpcUrl, "https://rpc.ynxweb4.com/evm");
assert.equal(classifyYNXHTTPFailure(404, {code: "ACCOUNT_NOT_FOUND"}, {accountLookup: true}), ynxErrorCodes.accountNotFound);
assert.equal(classifyYNXHTTPFailure(404, {code: "ACCOUNT_NOT_FOUND"}), ynxErrorCodes.httpError);

let requests = 0;
const valid = await proveYNXTestnetRPC(undefined, {fetchImpl: async () => {
  requests += 1;
  return new Response(JSON.stringify({jsonrpc: "2.0", id: 1, result: "0x1917"}), {status: 200});
}});
assert.equal(valid.chainId, "0x1917");
assert.equal(requests, 1);

requests = 0;
await assert.rejects(proveYNXTestnetRPC(undefined, {fetchImpl: async () => {
  requests += 1;
  return new Response(JSON.stringify({jsonrpc: "2.0", id: 1, result: "0x238e"}), {status: 200});
}}), (error) => error.code === ynxErrorCodes.wrongChain);
assert.equal(requests, 1);

requests = 0;
await assert.rejects(proveYNXTestnetRPC(undefined, {fetchImpl: async () => {
  requests += 1;
  return new Response(JSON.stringify({error: "down"}), {status: 503});
}}), (error) => error.code === ynxErrorCodes.rpcUnavailable);
assert.equal(requests, 1);

const cancelled = new AbortController();
cancelled.abort();
requests = 0;
await assert.rejects(proveYNXTestnetRPC(undefined, {signal: cancelled.signal, fetchImpl: async () => {
  requests += 1;
}}), (error) => error.code === ynxErrorCodes.transportCancelled);
assert.equal(requests, 0);

await assert.rejects(proveYNXTestnetRPC(undefined, {fetchImpl: async () =>
  new Response(JSON.stringify({jsonrpc: "2.0", id: 1, result: null}), {status: 200})
}), (error) => error.code === ynxErrorCodes.malformedResponse);

await assert.rejects(proveYNXTestnetRPC(undefined, {fetchImpl: async () =>
  new Response(JSON.stringify({jsonrpc: "2.0", id: 1, error: {code: -32001, message: "method unavailable"}}), {status: 200})
}), (error) => error.code === ynxErrorCodes.jsonRPCError && error.rpcCode === -32001);

console.log(JSON.stringify({cleanConsumer: true, installedFromTarball: true, exactChainId: valid.chainId, chain9102Rejected: true, implicitRetries: false, abortSignalCancellation: true, malformedRPCSeparated: true, jsonRPCErrorSeparated: true}));
`);
  const consumer = command(process.execPath, [resolve(temporary, "consumer.mjs")], temporary);
  const result = JSON.parse(consumer.trim());
  await writeFile(resolve(temporary, "legacy-consumer.mjs"), `
import assert from "node:assert/strict";
import {proveYNXTestnetRPC, toEVMAddress, toYNXAddress, ynxPublicEndpoints, ynxTestnetAddEthereumChainParameter} from "@ynx-chain/sdk";

const address = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
assert.equal(toEVMAddress(toYNXAddress(address)), address);
assert.equal(ynxPublicEndpoints.rpcUrl, "https://rpc.ynxweb4.com/evm");
assert.equal(ynxTestnetAddEthereumChainParameter().chainId, "0x1917");
const value = await proveYNXTestnetRPC(undefined, {fetchImpl: async () =>
  new Response(JSON.stringify({jsonrpc: "2.0", id: 1, result: "0x1917"}), {status: 200})
});
assert.equal(value.chainId, "0x1917");
console.log(JSON.stringify({legacyExportsCompatible: true, legacyReadOnlyFlowCompatible: true}));
`);
  const legacy = JSON.parse(command(process.execPath, [resolve(temporary, "legacy-consumer.mjs")], temporary).trim());
  console.log(JSON.stringify({
    ...result,
    ...legacy,
    package: "@ynx-chain/sdk@0.2.1",
    tarball: filename,
    tarballBytes: bytes.length,
    tarballSha256: sha256,
    temporaryConsumerRemoved: true
  }));
} finally {
  await rm(temporary, {recursive: true, force: true});
}

function command(executable, args, cwd) {
  const result = spawnSync(executable, args, {cwd, encoding: "utf8", timeout: 30_000});
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} ${args.join(" ")} failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }
  return result.stdout;
}
