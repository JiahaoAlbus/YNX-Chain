import { network } from "hardhat";
import { createWalletTestnetDeploymentManifest } from "../../packages/wallet-auth/src/testnet-deployment-verifier.js";

function required(name, pattern) {
  const value = process.env[name];
  if (!value || (pattern && !pattern.test(value))) throw new Error(`Missing or invalid required env: ${name}`);
  return value;
}

required("YNX_EVM_RPC_URL");
required("DEPLOYER_PRIVATE_KEY");
const sourceCommit = required("SOURCE_COMMIT", /^[0-9a-f]{40}$/);
const mode = required("YNX_ERC4337_ENTRYPOINT_MODE", /^(deploy|existing)$/);
const policySigner = required("YNX_PAYMASTER_POLICY_SIGNER_ADDRESS", /^0x[0-9a-fA-F]{40}$/);
const riskOfficer = required("YNX_PAYMASTER_RISK_OFFICER_ADDRESS", /^0x[0-9a-fA-F]{40}$/);

const connection = await network.connect();
const { ethers } = connection;
const deployer = (await ethers.getSigners())[0];
const chain = await ethers.provider.getNetwork();
if (chain.chainId !== 6423n) throw new Error(`Refusing non-YNX chainId ${chain.chainId}`);

let entryPointAddress;
let entryPointTransaction;
if (mode === "deploy") {
  const entryPoint = await ethers.deployContract("YNXEntryPoint");
  await entryPoint.waitForDeployment();
  entryPointAddress = await entryPoint.getAddress();
  entryPointTransaction = entryPoint.deploymentTransaction();
} else {
  entryPointAddress = required("YNX_ERC4337_ENTRYPOINT_ADDRESS", /^0x[0-9a-fA-F]{40}$/);
  const transactionHash = required("YNX_ERC4337_ENTRYPOINT_TRANSACTION_HASH", /^0x[0-9a-fA-F]{64}$/);
  entryPointTransaction = { hash: transactionHash, wait: () => ethers.provider.getTransactionReceipt(transactionHash) };
  if ((await ethers.provider.getCode(entryPointAddress)) === "0x") {
    throw new Error("Configured EntryPoint address has no deployed code");
  }
}

const factory = await ethers.deployContract("YNXSmartAccountFactory", [entryPointAddress]);
await factory.waitForDeployment();
const factoryAddress = await factory.getAddress();
const entryPointCode = await ethers.provider.getCode(entryPointAddress);
const factoryCode = await ethers.provider.getCode(factoryAddress);
const paymaster = await ethers.deployContract("YNXSponsorPaymaster", [entryPointAddress, policySigner, riskOfficer]);
await paymaster.waitForDeployment();
const paymasterAddress = await paymaster.getAddress();
const paymasterCode = await ethers.provider.getCode(paymasterAddress);
const factoryEntryPoint = await factory.entryPoint();
const paymasterEntryPoint = await paymaster.entryPoint();
if (factoryEntryPoint.toLowerCase() !== entryPointAddress.toLowerCase() || paymasterEntryPoint.toLowerCase() !== entryPointAddress.toLowerCase()) throw new Error("Deployed contract EntryPoint relationship mismatch");

const entryPointReceipt = await requiredMinedReceipt(entryPointTransaction, entryPointAddress);
const factoryReceipt = await requiredMinedReceipt(factory.deploymentTransaction(), factoryAddress);
const paymasterReceipt = await requiredMinedReceipt(paymaster.deploymentTransaction(), paymasterAddress);
const deploymentManifest = createWalletTestnetDeploymentManifest({
  sourceCommit,
  chainId: Number(chain.chainId),
  entryPoint: deployed(entryPointAddress, entryPointTransaction.hash, entryPointCode, entryPointReceipt),
  factory: deployed(factoryAddress, factory.deploymentTransaction().hash, factoryCode, factoryReceipt),
  paymaster: deployed(paymasterAddress, paymaster.deploymentTransaction().hash, paymasterCode, paymasterReceipt),
});

console.log(JSON.stringify(deploymentManifest, null, 2));

if (typeof connection.close === "function") await connection.close();

function deployed(address, transactionHash, runtimeCode, receipt) { return { address: address.toLowerCase(), transactionHash: transactionHash.toLowerCase(), runtimeCode: runtimeCode.toLowerCase(), receipt }; }
async function requiredMinedReceipt(transaction, expectedAddress) {
  if (!transaction?.hash) throw new Error("Deployment transaction is unavailable");
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1 || receipt.contractAddress?.toLowerCase() !== expectedAddress.toLowerCase() || !receipt.blockHash || receipt.blockNumber === null) throw new Error("Deployment receipt is not a successful contract creation");
  return { transactionHash: transaction.hash.toLowerCase(), status: "0x1", contractAddress: expectedAddress.toLowerCase(), blockHash: receipt.blockHash.toLowerCase(), blockNumber: ethers.toQuantity(receipt.blockNumber), logs: receipt.logs.map(log => ({ address: log.address.toLowerCase(), topics: [...log.topics], data: log.data })) };
}
