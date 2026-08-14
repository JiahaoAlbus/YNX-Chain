import { WalletAuthError } from "./canonical.js";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_COMMIT = /^[0-9a-f]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;

export function buildPublicERC4337MetadataCandidate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_CONFIG", "metadata promotion input is invalid");
  const explorer = explorerURL(input.explorerBaseUrl);
  const deployment = deploymentEvidence(input.deployment);
  const monitor = monitorEvidence(input.monitor, deployment);
  const sponsored = sponsoredEvidence(input.sponsoredReceipt, deployment, monitor);
  return Object.freeze({
    schemaVersion: 1,
    metadataId: "ynx-wallet-erc4337-public-v1",
    sourceCommit: deployment.sourceCommit,
    network: "YNX Testnet",
    chainId: 6423,
    verifiedAt: monitor.observedAt,
    contracts: Object.freeze({
      entryPoint: publicContract(deployment.contracts.entryPoint, explorer),
      factory: publicContract(deployment.contracts.factory, explorer),
      paymaster: publicContract(deployment.contracts.paymaster, explorer),
    }),
    bundler: Object.freeze({ protocol: "ERC-7769", evidenceAuthority: input.sponsoredReceipt.authority, evidenceSource: input.sponsoredReceipt.source }),
    sponsoredReceipt: Object.freeze({ userOperationHash: sponsored.userOperationHash, transactionHash: sponsored.transactionHash, blockHash: sponsored.blockHash, blockNumber: sponsored.blockNumber, sender: sponsored.sender, nonce: sponsored.nonce, actualGasCost: sponsored.actualGasCost, actualGasUsed: sponsored.actualGasUsed, explorerUrl: `${explorer.href}tx/${sponsored.transactionHash}` }),
    monitoring: Object.freeze({ sampleObservedAt: monitor.observedAt, latestBlock: monitor.block.number, latestBlockTimestamp: monitor.block.timestamp, paymasterDepositWei: monitor.paymaster.depositWei, sponsorshipEnabled: true, continuousMonitoringDeployed: false }),
    eligibleForWebsitePublication: true,
    websitePublished: false,
    publicMetadataPublished: false,
    requiresWebsiteOwnerAcceptance: true,
    secretMaterialRecorded: false,
  });
}

function deploymentEvidence(value) {
  if (!value || value.schemaVersion !== 1 || value.verification !== "wallet-auth-public-erc4337-deployment" || value.environment !== "public-testnet" || value.chainId !== 6423 || !SOURCE_COMMIT.test(value.sourceCommit ?? "") || value.ready !== true || value.secretMaterialRecorded !== false) notEligible("public deployment evidence is incomplete");
  const requiredChecks = ["rpcChainMatches","bundlerChainMatches","entryPointSupported","entryPointReceiptAndRuntime","factoryReceiptAndRuntime","paymasterReceiptAndRuntime","factoryEntryPointMatches","paymasterEntryPointMatches"];
  if (!requiredChecks.every(key => value.checks?.[key] === true) || !["entryPointDeployedPublic","factoryDeployedPublic","paymasterDeployedPublic","bundlerDeployedPublic"].every(key => value.releaseClaims?.[key] === true)) notEligible("public deployment checks are incomplete");
  const contracts = {};
  const addresses = new Set();
  for (const name of ["entryPoint","factory","paymaster"]) {
    const contract = value.contracts?.[name];
    if (!contract || !ADDRESS.test(contract.address ?? "") || !HASH.test(contract.transactionHash ?? "") || !QUANTITY.test(contract.blockNumber ?? "") || !SHA256.test(contract.observedRuntimeSha256 ?? "") || !Number.isSafeInteger(contract.runtimeBytes) || contract.runtimeBytes < 1 || contract.receiptMatches !== true || contract.runtimeMatches !== true || contract.verified !== true || (name === "paymaster" && contract.requiredDeploymentEventMatches !== true) || addresses.has(contract.address)) notEligible(`${name} deployment evidence is incomplete`);
    addresses.add(contract.address); contracts[name] = contract;
  }
  return { sourceCommit: value.sourceCommit, contracts };
}

function monitorEvidence(value, deployment) {
  if (!value || value.schemaVersion !== 1 || value.verification !== "wallet-auth-public-erc4337-monitor-sample" || value.environment !== "public-testnet" || value.healthy !== true || value.secretMaterialRecorded !== false || !iso(value.observedAt)) notEligible("public monitor evidence is incomplete");
  if (value.deployment?.sourceCommit !== deployment.sourceCommit || value.deployment?.ready !== true) notEligible("monitor deployment source does not match");
  for (const name of ["entryPoint","factory","paymaster"]) if (value.deployment?.contracts?.[name]?.address !== deployment.contracts[name].address || value.deployment?.contracts?.[name]?.observedRuntimeSha256 !== deployment.contracts[name].observedRuntimeSha256) notEligible("monitor contract binding does not match");
  if (!["deploymentVerified","blockFresh","sponsorshipEnabledMatches","depositMeetsMinimum","paymasterEventLogQueryVerified"].every(key => value.checks?.[key] === true)) notEligible("monitor checks are incomplete");
  if (!QUANTITY.test(value.block?.number ?? "") || !iso(value.block?.timestamp) || !Number.isSafeInteger(value.block?.ageSeconds) || value.block.ageSeconds < 0 || value.paymaster?.sponsorshipEnabled !== true || value.paymaster?.expectedSponsorshipEnabled !== true || !decimal(value.paymaster?.depositWei) || !decimal(value.paymaster?.minimumDepositWei) || BigInt(value.paymaster.depositWei) < 1n || BigInt(value.paymaster.depositWei) < BigInt(value.paymaster.minimumDepositWei) || !Array.isArray(value.paymaster.events)) notEligible("monitor state is not publication-ready");
  return value;
}

function sponsoredEvidence(wrapper, deployment, monitor) {
  if (!wrapper || wrapper.authority !== "bundler-provider-response" || wrapper.version !== "ERC-7769" || !publicOrigin(wrapper.source) || !iso(wrapper.asOf)) notEligible("sponsored receipt authority is invalid");
  const value = wrapper.value;
  const keys = ["actualGasCost","actualGasUsed","blockHash","blockNumber","entryPoint","nonce","paymaster","sender","success","transactionHash","userOperationHash"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\n") !== [...keys].sort().join("\n") || !QUANTITY.test(value.actualGasCost ?? "") || !QUANTITY.test(value.actualGasUsed ?? "") || !HASH.test(value.blockHash ?? "") || !QUANTITY.test(value.blockNumber ?? "") || !ADDRESS.test(value.sender ?? "") || !QUANTITY.test(value.nonce ?? "") || !HASH.test(value.transactionHash ?? "") || !HASH.test(value.userOperationHash ?? "") || value.success !== true || value.entryPoint !== deployment.contracts.entryPoint.address || value.paymaster !== deployment.contracts.paymaster.address) notEligible("sponsored receipt does not match deployment");
  const block = BigInt(value.blockNumber);
  if (block < BigInt(deployment.contracts.paymaster.blockNumber) || block > BigInt(monitor.block.number)) notEligible("sponsored receipt block is outside verified monitor range");
  return value;
}

function publicContract(value, explorer) { return Object.freeze({ address: value.address, deploymentTransactionHash: value.transactionHash, deploymentBlockNumber: value.blockNumber, runtimeSha256: value.observedRuntimeSha256, explorerUrl: `${explorer.href}address/${value.address}` }); }
function explorerURL(value) { let url; try { url = new URL(value); } catch { fail("INVALID_CONFIG", "Explorer base URL is invalid"); } if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") fail("INVALID_CONFIG", "Explorer base URL must be canonical credential-free HTTPS root"); return url; }
function publicOrigin(value) { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/"; } catch { return false; } }
function iso(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value; }
function decimal(value) { return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value); }
function notEligible(message) { fail("PUBLIC_METADATA_NOT_ELIGIBLE", message); }
function fail(code, message) { throw new WalletAuthError(code, message); }
