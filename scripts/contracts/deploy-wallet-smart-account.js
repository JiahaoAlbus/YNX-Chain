import { network } from "hardhat";

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
let entryPointTransactionHash = null;
if (mode === "deploy") {
  const entryPoint = await ethers.deployContract("YNXEntryPoint");
  await entryPoint.waitForDeployment();
  entryPointAddress = await entryPoint.getAddress();
  entryPointTransactionHash = entryPoint.deploymentTransaction()?.hash ?? null;
} else {
  entryPointAddress = required("YNX_ERC4337_ENTRYPOINT_ADDRESS", /^0x[0-9a-fA-F]{40}$/);
  if ((await ethers.provider.getCode(entryPointAddress)) === "0x") {
    throw new Error("Configured EntryPoint address has no deployed code");
  }
}

const factory = await ethers.deployContract("YNXSmartAccountFactory", [entryPointAddress]);
await factory.waitForDeployment();
const factoryAddress = await factory.getAddress();
const factoryTransactionHash = factory.deploymentTransaction()?.hash ?? null;
const entryPointCode = await ethers.provider.getCode(entryPointAddress);
const factoryCode = await ethers.provider.getCode(factoryAddress);
const paymaster = await ethers.deployContract("YNXSponsorPaymaster", [entryPointAddress, policySigner, riskOfficer]);
await paymaster.waitForDeployment();
const paymasterAddress = await paymaster.getAddress();
const paymasterCode = await ethers.provider.getCode(paymasterAddress);

console.log(JSON.stringify({
  schemaVersion: 1,
  sourceCommit,
  network: "YNX Testnet",
  chainId: Number(chain.chainId),
  deployer: await deployer.getAddress(),
  entryPoint: {
    mode,
    address: entryPointAddress,
    transactionHash: entryPointTransactionHash,
    runtimeCodeHash: ethers.keccak256(entryPointCode),
    runtimeBytes: (entryPointCode.length - 2) / 2,
  },
  smartAccountFactory: {
    address: factoryAddress,
    transactionHash: factoryTransactionHash,
    runtimeCodeHash: ethers.keccak256(factoryCode),
    runtimeBytes: (factoryCode.length - 2) / 2,
  },
  paymaster: {
    address: paymasterAddress,
    transactionHash: paymaster.deploymentTransaction()?.hash ?? null,
    runtimeCodeHash: ethers.keccak256(paymasterCode),
    runtimeBytes: (paymasterCode.length - 2) / 2,
    policySigner,
    riskOfficer,
    depositWei: "0",
    sponsorshipEnabled: false,
  },
  bundler: null,
  sponsoredReceipt: null,
  state: "contracts-deployed-only-if-transactions-are-mined; sponsorship remains unproven",
}, null, 2));

if (typeof connection.close === "function") await connection.close();
