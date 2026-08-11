import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { network } from "hardhat";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
};

required("YNX_EVM_RPC_URL");
required("DEPLOYER_PRIVATE_KEY");
const output = process.env.DEX_DEPLOYMENT_MANIFEST_PATH || "tmp/dex/public-testnet-candidate.json";
const connection = await network.connect();
const { ethers } = connection;
const providerNetwork = await ethers.provider.getNetwork();
if (providerNetwork.chainId !== 6423n) throw new Error(`Refusing deployment to chain ${providerNetwork.chainId}`);
const deployer = (await ethers.getSigners())[0];
const nativeBalanceBefore = await ethers.provider.getBalance(deployer.address);
if (nativeBalanceBefore === 0n) throw new Error("Dedicated DEX deployer has no Testnet YNXT gas balance");

const tokenA = await ethers.deployContract("MockDexToken", ["YNX DEX Test Alpha", "YDTA"]);
const tokenB = await ethers.deployContract("MockDexToken", ["YNX DEX Test Beta", "YDTB"]);
const tokenAReceipt = await tokenA.deploymentTransaction().wait();
const tokenBReceipt = await tokenB.deploymentTransaction().wait();
await Promise.all([tokenA.waitForDeployment(), tokenB.waitForDeployment()]);
const tokens = [await tokenA.getAddress(), await tokenB.getAddress()];
const factory = await ethers.deployContract("YNXDexFactory", [deployer.address, deployer.address, tokens]);
const factoryReceipt = await factory.deploymentTransaction().wait();
await factory.waitForDeployment();
const router = await ethers.deployContract("YNXDexRouter", [await factory.getAddress()]);
const routerReceipt = await router.deploymentTransaction().wait();
await router.waitForDeployment();
const quoter = await ethers.deployContract("YNXDexQuoter", [await router.getAddress()]);
const quoterReceipt = await quoter.deploymentTransaction().wait();
await quoter.waitForDeployment();
const createPoolReceipt = await (await factory.createPool(tokens[0], tokens[1])).wait();
const poolAddress = await factory.getPool(tokens[0], tokens[1]);
const pool = await ethers.getContractAt("YNXDexPool", poolAddress);

const unit = 10n ** 18n;
const minted = 1_000_000n * unit;
const liquidityA = 100_000n * unit;
const liquidityB = 100_000n * unit;
for (const token of [tokenA, tokenB]) {
  await (await token.mint(deployer.address, minted)).wait();
  await (await token.approve(await router.getAddress(), minted)).wait();
}
const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
const liquidityReceipt = await (await router.addLiquidity(tokens[0], tokens[1], liquidityA, liquidityB, deployer.address, deadline)).wait();
const swapInput = 1_000n * unit;
const quote = await quoter.quoteExactInput(swapInput, tokens);
const swapReceipt = await (await router.swapExactInput(swapInput, quote[1], tokens, deployer.address, deadline)).wait();
const [reserve0, reserve1] = await pool.getReserves();
if (reserve0 === 0n || reserve1 === 0n || quote[1] === 0n) throw new Error("Testnet pool or quote is empty after deployment");
const swapTransaction = await ethers.provider.getTransaction(swapReceipt.hash);
if (!swapTransaction || swapTransaction.from.toLowerCase() !== deployer.address.toLowerCase()) throw new Error("Testnet swap sender mismatch");

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const latest = await ethers.provider.getBlock("latest");
const manifest = {
  schemaVersion: 1,
  productId: "ynx-dex",
  releaseClass: "unaudited-public-testnet-candidate",
  network: "YNX Testnet",
  nativeChainId: "ynx_6423-1",
  evmChainId: 6423,
  mainnet: false,
  audited: false,
  productionLiquidity: false,
  sourceCommit: commit,
  compiler: { version: "0.8.24", optimizer: true, runs: 200 },
  deployer: deployer.address,
  governance: deployer.address,
  governanceBoundary: "dedicated root-managed Testnet signer; multisig and external audit required before production",
  nativeBalanceBefore: nativeBalanceBefore.toString(),
  contracts: {
    tokenA: { address: tokens[0], symbol: "YDTA", transactionHash: tokenAReceipt.hash, blockNumber: tokenAReceipt.blockNumber },
    tokenB: { address: tokens[1], symbol: "YDTB", transactionHash: tokenBReceipt.hash, blockNumber: tokenBReceipt.blockNumber },
    factory: { address: await factory.getAddress(), transactionHash: factoryReceipt.hash, blockNumber: factoryReceipt.blockNumber },
    router: { address: await router.getAddress(), transactionHash: routerReceipt.hash, blockNumber: routerReceipt.blockNumber },
    quoter: { address: await quoter.getAddress(), transactionHash: quoterReceipt.hash, blockNumber: quoterReceipt.blockNumber },
    pool: { address: poolAddress, transactionHash: createPoolReceipt.hash, blockNumber: createPoolReceipt.blockNumber }
  },
  liquidity: { amountA: liquidityA.toString(), amountB: liquidityB.toString(), transactionHash: liquidityReceipt.hash, blockNumber: liquidityReceipt.blockNumber, reserve0: reserve0.toString(), reserve1: reserve1.toString() },
  swap: { exactInput: swapInput.toString(), quotedOutput: quote[1].toString(), transactionHash: swapReceipt.hash, blockNumber: swapReceipt.blockNumber, sender: deployer.address },
  feePolicy: { swapFeeBps: 30, protocolFeeShareBps: 1667 },
  deployedAt: new Date(Number(latest.timestamp) * 1000).toISOString(),
  secretMaterialRecorded: false
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, sourceCommit: commit, deployer: deployer.address, factory: manifest.contracts.factory.address, router: manifest.contracts.router.address, quoter: manifest.contracts.quoter.address, pool: poolAddress, liquidityTransactionHash: manifest.liquidity.transactionHash, swapTransactionHash: manifest.swap.transactionHash }, null, 2));
if (typeof connection.close === "function") await connection.close();
