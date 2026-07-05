import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredFiles = [
  "hardhat.config.ts",
  "foundry.toml",
  "package.json",
  "contracts/tokens/SampleYNXTCompatibleERC20.sol",
  "contracts/tokens/SampleYNXTCompatibleERC721.sol",
  "contracts/resource-market/YnxResourceMarketEscrow.sol",
  "dex/ynx-testnet.integration.json",
  "token-lists/ynx-testnet.tokenlist.json",
  "scripts/contracts/deploy-samples-hardhat.js",
  "scripts/contracts/generate-selector-metadata.mjs",
  "docs/developers/QUICKSTART_HARDHAT.md",
  "docs/developers/QUICKSTART_FOUNDRY.md",
  "docs/developers/CONTRACT_VERIFICATION.md"
];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `missing required contract tooling file: ${file}`);
}

const packageJson = JSON.parse(read("package.json"));
assert(packageJson.private === true, "root package must remain private");
assert(packageJson.type === "module", "root package must use ESM for Hardhat 3");
assert(packageJson.scripts["contracts:check"] === "bash ./scripts/verify/contract-tooling-check.sh", "contracts:check script mismatch");
assert(packageJson.scripts["contracts:selectors"] === "node ./scripts/contracts/generate-selector-metadata.mjs", "contracts:selectors script mismatch");
assert(packageJson.scripts["hardhat:build"] === "hardhat build", "Hardhat 3 build script mismatch");
assert(packageJson.devDependencies.hardhat.startsWith("^3."), "Hardhat dependency must track v3");
assert(packageJson.devDependencies.ethers.startsWith("^6."), "ethers dependency must remain available for selector metadata");

const hardhatConfig = read("hardhat.config.ts");
assert(hardhatConfig.includes("configVariable(\"YNX_EVM_RPC_URL\")"), "Hardhat config must require YNX_EVM_RPC_URL");
assert(hardhatConfig.includes("configVariable(\"DEPLOYER_PRIVATE_KEY\")"), "Hardhat config must require DEPLOYER_PRIVATE_KEY");
assert(hardhatConfig.includes("chainId: 6423"), "Hardhat config must use YNX Testnet chainId 6423");
assert(hardhatConfig.includes("chainType: \"l1\""), "Hardhat config must declare L1 chain type");
assert(hardhatConfig.includes("version: \"0.8.24\""), "Hardhat config must pin Solidity 0.8.24");
assert(hardhatConfig.includes("preferWasm: true"), "Hardhat config must prefer wasm solc for reproducible builds");
assert(hardhatConfig.includes("enabled: true"), "Hardhat optimizer must be enabled");
assert(hardhatConfig.includes("runs: 200"), "Hardhat optimizer runs must stay pinned at 200");

const compilerGo = read("internal/chain/compiler.go");
for (const text of [
  'contractCompilerVersion       = "0.8.24"',
  'contractCompilerConfigPath    = "hardhat.config.ts"',
  'contractArtifactKind          = "source-analyzer-artifact"',
  'contractPinnedArtifactKind    = "pinned-solc-bytecode-artifact"',
  "ProductionCompilerEnabled: false"
]) {
  assert(compilerGo.includes(text), `Go compiler metadata missing ${text}`);
}
assert(read("internal/chain/types.go").includes("DeployedBytecodeComparisonStatus"), "contract verifier must expose deployed bytecode comparison status");
assert(read("internal/chain/types.go").includes("ContractVerificationEvidence"), "contract verifier evidence type missing");
assert(read("internal/chain/types.go").includes("BytecodeSelectorMatched"), "contract runtime must expose bytecode selector match evidence");
assert(read("internal/api/server.go").includes("GET /ide/verifier/{address}"), "IDE verifier evidence endpoint missing");

const sampleArtifact = JSON.parse(read("artifacts/contracts/tokens/SampleYNXTCompatibleERC20.sol/SampleYNXTCompatibleERC20.json"));
assert(sampleArtifact.contractName === "SampleYNXTCompatibleERC20", "sample ERC20 artifact contract name mismatch");
assert(sampleArtifact.sourceName === "contracts/tokens/SampleYNXTCompatibleERC20.sol", "sample ERC20 artifact source mismatch");
assert(/^0x[0-9a-fA-F]+$/.test(sampleArtifact.bytecode) && sampleArtifact.bytecode.length > 100, "sample ERC20 bytecode missing");
assert(/^0x[0-9a-fA-F]+$/.test(sampleArtifact.deployedBytecode) && sampleArtifact.deployedBytecode.length > 100, "sample ERC20 deployed bytecode missing");

const selectorMetadata = JSON.parse(read("artifacts/ynx-selector-metadata.json"));
const sampleSelectorMetadata = selectorMetadata.artifacts?.["artifacts/contracts/tokens/SampleYNXTCompatibleERC20.sol/SampleYNXTCompatibleERC20.json"];
assert(sampleSelectorMetadata?.runtimeSelectorMode === "hardhat-ethers-keccak-selector-and-deployed-bytecode-presence", "sample ERC20 selector metadata mode mismatch");
const decimalsSelector = sampleSelectorMetadata.functions?.find((fn) => fn.signature === "decimals()");
assert(decimalsSelector?.selector === "0x313ce567" && decimalsSelector.bytecodeSelectorMatched === true, "sample ERC20 decimals selector must match deployed bytecode");

const buildInfoFiles = fs.readdirSync(path.join(root, "artifacts/build-info")).filter((file) => file.endsWith(".json") && !file.endsWith(".output.json"));
assert(buildInfoFiles.length > 0, "Hardhat build-info file missing after build");
const buildInfo = JSON.parse(read(`artifacts/build-info/${buildInfoFiles[0]}`));
assert(buildInfo.solcVersion === "0.8.24", "Hardhat build-info solc version mismatch");
assert(buildInfo.input?.settings?.optimizer?.enabled === true, "Hardhat build-info optimizer must be enabled");
assert(buildInfo.input?.settings?.optimizer?.runs === 200, "Hardhat build-info optimizer runs mismatch");

const foundry = read("foundry.toml");
assert(foundry.includes("ynx_testnet = \"${YNX_EVM_RPC_URL}\""), "Foundry config must use YNX_EVM_RPC_URL");
assert(foundry.includes("chain = 6423"), "Foundry verifier config must use chain 6423");

const tokenList = JSON.parse(read("token-lists/ynx-testnet.tokenlist.json"));
assert(tokenList.name === "YNX Testnet Token List", "token list name mismatch");
assert(tokenList.extensions.network.chainId === 6423, "token list chainId mismatch");
assert(tokenList.extensions.network.nativeCurrency.symbol === "YNXT", "token list native symbol mismatch");
assert(Array.isArray(tokenList.tokens), "token list tokens must be an array");
for (const token of tokenList.tokens) {
  assert(token.chainId === 6423, `token ${token.symbol} has wrong chainId`);
  assert(/^0x[a-fA-F0-9]{40}$/.test(token.address), `token ${token.symbol} must use a real EVM address`);
}

const dex = JSON.parse(read("dex/ynx-testnet.integration.json"));
assert(dex.network.chainId === 6423, "DEX config chainId mismatch");
assert(dex.network.nativeCurrency.symbol === "YNXT", "DEX config native symbol mismatch");
assert(dex.rpc.requiredEnv === "YNX_EVM_RPC_URL", "DEX config must name the EVM RPC env");
assert(dex.deployments.wrappedYNXT.addressEnv === "WRAPPED_YNXT_ADDRESS", "DEX wrapped YNXT env mismatch");

const docs = [
  read("docs/developers/QUICKSTART_HARDHAT.md"),
  read("docs/developers/QUICKSTART_FOUNDRY.md"),
  read("docs/developers/CONTRACT_VERIFICATION.md"),
  read("docs/defi/DEFI_ECOSYSTEM_READINESS.md"),
  read("docs/api/API_REFERENCE.md")
].join("\n");
for (const text of ["YNX Testnet", "6423", "YNXT", "YNX_EVM_RPC_URL", "make contract-tooling-check", "/ide/compiler", "/ide/verifier", "source-analyzer-artifact", "pinned-solc-bytecode-artifact", "deployedBytecodeComparisonStatus", "remotePublicProofStatus", "bytecodeSelectorMatched", "0.8.24"]) {
  assert(docs.includes(text), `developer docs missing ${text}`);
}

const scanned = requiredFiles
  .filter((file) => !file.endsWith(".json"))
  .map((file) => `${file}\n${read(file)}`)
  .join("\n");
const misspelledNativeSymbol = ["N", "YXT"].join("");
assert(!new RegExp(`\\b${misspelledNativeSymbol}\\b`).test(scanned), "misspelled native symbol found");
assert(!/native coin[^.\n]*\bYNX\b/i.test(scanned), "native coin must not be described as YNX");

console.log("contract-tooling-check passed: Hardhat, Foundry, Token List, DEX config, contracts, and docs are coherent");
