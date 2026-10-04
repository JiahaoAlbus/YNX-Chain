import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { assertCompilerPin, loadPinnedCompiler, COMPILER_VERSION } from './compiler-pin.mjs';

const sha256 = (value) => `0x${createHash("sha256").update(value).digest("hex")}`;

try {
  const pin = assertCompilerPin();
  const solc = loadPinnedCompiler();
  if (!solc.version().startsWith(`${COMPILER_VERSION}+commit.e11b9ed9.`)) throw Object.assign(new Error('Solidity compiler runtime version does not match the reviewed artifact.'), { status: 503, code: 'compiler_pin_mismatch' });
  const { name, source } = workerData;
  const sourceName = `${name || "Contract"}.sol`;
  const input = {
    language: "Solidity",
    sources: { [sourceName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "metadata", "evm.bytecode.object", "evm.bytecode.sourceMap", "evm.deployedBytecode.object", "evm.deployedBytecode.sourceMap"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const diagnostics = (output.errors || []).map(({ severity, errorCode, type, component, message, formattedMessage, sourceLocation }) => ({ severity, errorCode, type, component, message, formattedMessage, sourceLocation }));
  const failures = diagnostics.filter((item) => item.severity === "error");
  if (failures.length) {
    parentPort.postMessage({ ok: false, status: 422, error: "Solidity compilation failed.", diagnostics });
  } else {
    const contracts = output.contracts?.[sourceName] || {};
    const contractName = name;
    if (!contracts[contractName]) throw Object.assign(new Error('The requested contract was not found in the source. Choose its exact contract name.'), { status: 422, code: 'compiler_contract_missing' });
    const contract = contracts[contractName];
    const bytecode = `0x${contract.evm?.bytecode?.object || ""}`;
    const deployedBytecode = `0x${contract.evm?.deployedBytecode?.object || ""}`;
    const artifactCore = { contractName, sourceName, abi: contract.abi || [], bytecode, deployedBytecode, metadata: contract.metadata || null };
    parentPort.postMessage({
      ok: true,
      compiler: { name: "solc", version: COMPILER_VERSION, longVersion: solc.version(), artifactSha256: pin.artifactSha256, optimizer: { enabled: true, runs: 200 }, execution: "worker-isolated-standard-json" },
      ...artifactCore,
      bytecodeHash: sha256(bytecode),
      deployedBytecodeHash: sha256(deployedBytecode),
      artifactHash: sha256(JSON.stringify(artifactCore)),
      diagnostics,
      deployability: "bytecode-compiled; YNX Testnet execution compatibility must still be established by an authoritative receipt",
    });
  }
} catch (error) {
  parentPort.postMessage({ ok: false, status: error.status || 500, ...(error.code ? { code: error.code } : {}), ...(error.compiler ? { compiler: error.compiler } : {}), error: error instanceof Error ? error.message : String(error), diagnostics: [] });
}
