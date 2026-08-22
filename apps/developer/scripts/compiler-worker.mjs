import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import solc from "solc";

const sha256 = (value) => `0x${createHash("sha256").update(value).digest("hex")}`;

try {
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
    const contractName = contracts[name] ? name : Object.keys(contracts)[0];
    if (!contractName) throw new Error("The source did not produce a contract artifact.");
    const contract = contracts[contractName];
    const bytecode = `0x${contract.evm?.bytecode?.object || ""}`;
    const deployedBytecode = `0x${contract.evm?.deployedBytecode?.object || ""}`;
    const artifactCore = { contractName, sourceName, abi: contract.abi || [], bytecode, deployedBytecode, metadata: contract.metadata || null };
    parentPort.postMessage({
      ok: true,
      compiler: { name: "solc", version: "0.8.24", longVersion: solc.version(), optimizer: { enabled: true, runs: 200 }, execution: "worker-isolated-standard-json" },
      ...artifactCore,
      bytecodeHash: sha256(bytecode),
      deployedBytecodeHash: sha256(deployedBytecode),
      artifactHash: sha256(JSON.stringify(artifactCore)),
      diagnostics,
      deployability: "bytecode-compiled; YNX Testnet execution compatibility must still be established by an authoritative receipt",
    });
  }
} catch (error) {
  parentPort.postMessage({ ok: false, status: 500, error: error instanceof Error ? error.message : String(error), diagnostics: [] });
}
