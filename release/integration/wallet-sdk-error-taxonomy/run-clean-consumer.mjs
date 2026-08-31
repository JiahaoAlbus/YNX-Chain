#!/usr/bin/env node
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
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

  await writeFile(resolve(temporary, "package.json"), `${JSON.stringify({name: "ynx-sdk-taxonomy-clean-consumer", version: "0.0.0", private: true, type: "module"})}\n`);
  command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `./${filename}`], temporary);
  const lockBytes = await readFile(resolve(temporary, "package-lock.json"));
  const lock = JSON.parse(lockBytes);
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages["node_modules/@ynx-chain/sdk"].version, "0.2.1");
  assert.match(lock.packages["node_modules/@ynx-chain/sdk"].resolved, /^file:ynx-chain-sdk-0\.2\.1\.tgz$/);
  assert.match(lock.packages["node_modules/@ynx-chain/sdk"].integrity, /^sha512-/);
  const installedManifest = JSON.parse(await readFile(resolve(temporary, "node_modules/@ynx-chain/sdk/package.json"), "utf8"));
  assert.deepEqual(installedManifest.repository, {type: "git", url: "git+https://github.com/JiahaoAlbus/YNX-Chain.git", directory: "sdk/js"});
  const installedFiles = await fileManifest(resolve(temporary, "node_modules/@ynx-chain/sdk"));
  const installedFilesSha256 = createHash("sha256").update(JSON.stringify(installedFiles)).digest("hex");
  const sourceCommit = command("git", ["rev-parse", "HEAD"], root).trim();
  const sourceTree = command("git", ["rev-parse", "HEAD^{tree}"], root).trim();
  const sourceWorktreeDirty = command("git", ["status", "--short"], root).trim() !== "";
  await writeFile(resolve(temporary, "consumer.mjs"), `
import assert from "node:assert/strict";
import {YNXClient, YNXSDKError, callYNXEVM, classifyYNXHTTPFailure, getYNXStatus, proveYNXTestnetRPC, redactYNXSDKError, validateYNXTestnetConfig, ynxErrorCodes, ynxErrorDiagnostic, ynxPublicEndpoints, ynxTestnet} from "@ynx-chain/sdk";

assert.equal(ynxTestnet.chainId, "0x1917");
assert.equal(ynxTestnet.chainIdDecimal, 6423);
assert.equal(ynxPublicEndpoints.rpcUrl, "https://rpc.ynxweb4.com/evm");
assert.equal(classifyYNXHTTPFailure(404, {code: "ACCOUNT_NOT_FOUND"}, {accountLookup: true}), ynxErrorCodes.accountNotFound);
assert.equal(classifyYNXHTTPFailure(404, {code: "ACCOUNT_NOT_FOUND"}), ynxErrorCodes.httpError);
assert.deepEqual(validateYNXTestnetConfig({nativeChainId: "ynx_6423-1", chainIdDecimal: 6423, evmChainId: "0x1917", nativeCurrency: "YNXT"}), {nativeChainId: "ynx_6423-1", chainIdDecimal: 6423, evmChainId: "0x1917", nativeCurrency: "YNXT"});
for (const input of [
  {nativeChainId: "ynx_9102-1", chainIdDecimal: 6423, evmChainId: "0x1917"},
  {nativeChainId: "ynx_6423-1", chainIdDecimal: 9102, evmChainId: "0x1917"},
  {nativeChainId: "ynx_6423-1", chainIdDecimal: 6423, evmChainId: "0x238e"}
]) assert.throws(() => validateYNXTestnetConfig(input), (error) => error.code === ynxErrorCodes.wrongChain);
assert.deepEqual(ynxErrorDiagnostic(ynxErrorCodes.wrongChain), {summary: "The RPC is not YNX Testnet 6423 (0x1917).", remediation: "USE_YNX_TESTNET_6423"});

const invalidNetwork = {nativeChainId: "ynx_9102-1", chainIdDecimal: 9102, evmChainId: "0x238e", nativeCurrency: "OLD"};
let blockedRequests = 0;
const blockedFetch = async () => { blockedRequests += 1; throw new Error("transport must not execute"); };
await assert.rejects(getYNXStatus("https://rest.example.invalid", {network: invalidNetwork, fetchImpl: blockedFetch}), (error) => error.code === ynxErrorCodes.wrongChain);
await assert.rejects(callYNXEVM("https://rpc.example.invalid", "eth_chainId", [], {network: invalidNetwork, fetchImpl: blockedFetch}), (error) => error.code === ynxErrorCodes.wrongChain);
await assert.rejects(proveYNXTestnetRPC("https://rpc.example.invalid", {network: invalidNetwork, fetchImpl: blockedFetch}), (error) => error.code === ynxErrorCodes.wrongChain);
assert.throws(() => new YNXClient({restUrl: "https://rest.example.invalid", evmUrl: "https://rpc.example.invalid", network: invalidNetwork, fetchImpl: blockedFetch}), (error) => error.code === ynxErrorCodes.wrongChain);
assert.equal(blockedRequests, 0);

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

for (const malformed of [
  [{jsonrpc: "2.0", id: 1, result: "0x1917"}],
  {jsonrpc: "2.0", result: "0x1917"}
]) {
  await assert.rejects(proveYNXTestnetRPC(undefined, {fetchImpl: async () =>
    new Response(JSON.stringify(malformed), {status: 200})
  }), (error) => error.code === ynxErrorCodes.malformedResponse);
}

const diagnostic = redactYNXSDKError(new YNXSDKError("secret-url-and-body", {cause: new Error("secret-url-and-body"), code: ynxErrorCodes.jsonRPCError, rpcCode: -32001, status: 200}));
assert.deepEqual(diagnostic, {name: "YNXSDKError", code: "JSON_RPC_ERROR", summary: "The RPC returned an application error.", remediation: "CHECK_RPC_METHOD_SUPPORT", status: 200, rpcCode: -32001});
assert.equal(JSON.stringify(diagnostic).includes("secret-url-and-body"), false);

console.log(JSON.stringify({cleanConsumer: true, installedFromTarball: true, exactChainId: valid.chainId, exactConfigValidated: true, allNetworkEntriesPreflightGated: true, invalidConfigRequestCount: blockedRequests, chain9102Rejected: true, remediationContractVerified: true, implicitRetries: false, abortSignalCancellation: true, malformedRPCSeparated: true, malformedBatchNotificationRejected: true, jsonRPCErrorSeparated: true, redactedDiagnostics: true}));
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
    packageLockSha256: createHash("sha256").update(lockBytes).digest("hex"),
    installedFilesSha256,
    sourceCommit,
    sourceTree,
    sourceWorktreeDirty,
    temporaryConsumerRemoved: true
  }));
} finally {
  await rm(temporary, {recursive: true, force: true});
}

async function fileManifest(directory, prefix = "") {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const metadata = await stat(path);
    if (metadata.isDirectory()) result.push(...await fileManifest(path, relative));
    else if (metadata.isFile()) {
      const value = await readFile(path);
      result.push({path: relative, bytes: value.length, sha256: createHash("sha256").update(value).digest("hex")});
    }
  }
  return result;
}

function command(executable, args, cwd) {
  const result = spawnSync(executable, args, {cwd, encoding: "utf8", timeout: 30_000});
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} ${args.join(" ")} failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }
  return result.stdout;
}
