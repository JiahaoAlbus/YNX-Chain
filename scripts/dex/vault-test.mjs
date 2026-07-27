import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.create({ network: "dexTest" });
const [governance, owner, engine, lp, trader, feeRecipient, attacker] = await ethers.getSigners();
const unit = 10n ** 18n;

const tokenA = await ethers.deployContract("MockDexToken", ["Vault A", "VA"]);
const tokenB = await ethers.deployContract("MockDexToken", ["Vault B", "VB"]);
await Promise.all([tokenA.waitForDeployment(), tokenB.waitForDeployment()]);
const tokens = [await tokenA.getAddress(), await tokenB.getAddress()];
const factory = await ethers.deployContract("YNXDexFactory", [governance.address, governance.address, tokens]);
await factory.waitForDeployment();
const router = await ethers.deployContract("YNXDexRouter", [await factory.getAddress()]);
await router.waitForDeployment();
await (await factory.createPool(tokens[0], tokens[1])).wait();
const poolAddress = await factory.getPool(tokens[0], tokens[1]);
const pool = await ethers.getContractAt("YNXDexPool", poolAddress);
const stableFactory = await ethers.deployContract("YNXStableFactory", [governance.address, feeRecipient.address, tokens]);
await stableFactory.waitForDeployment();
const stableRouter = await ethers.deployContract("YNXDexRouter", [await stableFactory.getAddress()]);
await stableRouter.waitForDeployment();
await (await stableFactory.createPool(tokens[0], tokens[1], 200, 4)).wait();
const stablePoolAddress = await stableFactory.getPool(tokens[0], tokens[1]);
const stablePool = await ethers.getContractAt("YNXStablePool", stablePoolAddress);

for (const token of [tokenA, tokenB]) {
  await (await token.mint(lp.address, 2_000_000n * unit)).wait();
  await (await token.mint(owner.address, 100_000n * unit)).wait();
  await (await token.connect(lp).approve(await router.getAddress(), ethers.MaxUint256)).wait();
  await (await token.connect(lp).approve(await stableRouter.getAddress(), ethers.MaxUint256)).wait();
}
let now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
await (await router.connect(lp).addLiquidity(tokens[0], tokens[1], 1_000_000n * unit, 1_000_000n * unit, lp.address, now + 3_600n)).wait();
await (await stableRouter.connect(lp).addLiquidity(tokens[0], tokens[1], 500_000n * unit, 500_000n * unit, lp.address, now + 3_600n)).wait();

const oracle = await ethers.deployContract("MockVaultOracle");
await oracle.waitForDeployment();
await setPrices(1n * unit, 1n * unit, 2n * unit, 0);
const vault = await ethers.deployContract("YNXStrategyVault", [
  owner.address,
  engine.address,
  await router.getAddress(),
  await oracle.getAddress(),
  tokens
]);
await vault.waitForDeployment();
await (await vault.connect(owner).setPoolAllowed(tokens[0], tokens[1], true)).wait();
await assert.rejects(vault.connect(owner).setStablePoolAllowed(poolAddress, true), /InvalidPool|revert/);
await (await vault.connect(owner).setStablePoolAllowed(stablePoolAddress, true)).wait();
assert.equal(await vault.allowedPool(poolAddress), true, "owner binds the exact factory pool");
assert.equal(await vault.allowedStablePool(stablePoolAddress), true, "owner binds the exact reviewed StableSwap pool");
await assert.rejects(vault.connect(attacker).setStablePoolAllowed(stablePoolAddress, false), /Unauthorized/);

await assert.rejects(configure({ minActionInterval: 60, performanceFeeBps: 1_000 }), /InvalidConfiguration/);
await configure({ minActionInterval: 60 });
for (const token of [tokenA, tokenB]) {
  await (await token.connect(owner).approve(await vault.getAddress(), 10_000n * unit)).wait();
  await (await vault.connect(owner).deposit(await token.getAddress(), 10_000n * unit)).wait();
}
assert.equal(await tokenA.balanceOf(await vault.getAddress()), 10_000n * unit, "owner deposit is held by the vault");
assert.equal(await vault.nonceDomain(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
  ["string", "uint256", "address", "address", "address"],
  ["YNX_STRATEGY_VAULT_V1", 31337n, await vault.getAddress(), owner.address, engine.address]
)), "nonce domain binds chain, vault, owner, and engine");

const quote = await router.quoteExactInput(100n * unit, tokens);
let deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await assert.rejects(
  vault.connect(attacker).swapExactInput(0, 100n * unit, quote[1] * 99n / 100n, tokens, deadline),
  /Unauthorized/
);
await assert.rejects(
  vault.connect(engine).swapExactInput(0, 100n * unit, quote[1] / 2n, tokens, deadline),
  /SlippageExceeded/
);
const ownerBefore = await tokenB.balanceOf(owner.address);
await (await vault.connect(engine).swapExactInput(0, 100n * unit, quote[1] * 99n / 100n, tokens, deadline)).wait();
assert.equal(await tokenB.balanceOf(owner.address), ownerBefore, "engine cannot route proceeds to itself or the owner");
assert.equal(await tokenA.allowance(await vault.getAddress(), await router.getAddress()), 0n, "exact approval is cleared");
assert.equal(await vault.actionNonce(), 1n, "successful action consumes one nonce");
await assert.rejects(
  vault.connect(engine).swapExactInput(0, 100n * unit, 1, tokens, deadline),
  /NonceMismatch/
);
await assert.rejects(
  vault.connect(engine).swapExactInput(1, 100n * unit, 1, tokens, deadline),
  /FrequencyExceeded/
);

await increaseTime(61);
await refreshPrices();
const exactOut = 25n * unit;
const exactQuote = await router.quoteExactOutput(exactOut, tokens);
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await (await vault.connect(engine).swapExactOutput(1, exactOut, exactQuote[0] * 101n / 100n, tokens, deadline)).wait();
assert.equal(await tokenA.allowance(await vault.getAddress(), await router.getAddress()), 0n, "exact-output approval is cleared");

await increaseTime(61);
await refreshPrices();
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await (await vault.connect(engine).addLiquidity(2, tokens[0], tokens[1], 100n * unit, 100n * unit, 1, deadline)).wait();
const lpBalance = await pool.balanceOf(await vault.getAddress());
assert(lpBalance > 0n, "LP position remains inside the user vault");
assert.equal(await tokenA.allowance(await vault.getAddress(), await router.getAddress()), 0n);
assert.equal(await tokenB.allowance(await vault.getAddress(), await router.getAddress()), 0n);

await increaseTime(61);
await refreshPrices();
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await (await vault.connect(engine).removeLiquidity(3, tokens[0], tokens[1], lpBalance / 2n, 1, 1, deadline)).wait();
assert.equal(await pool.allowance(await vault.getAddress(), await router.getAddress()), 0n, "LP approval is cleared");

await increaseTime(61);
await refreshPrices();
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
const stableInput = 10n * unit;
const stableQuote = await stablePool.getAmountOutFor(tokens[0], stableInput);
await (await vault.connect(engine).stableSwapExactInput(
  4, stablePoolAddress, tokens[0], stableInput, stableQuote * 99n / 100n, deadline
)).wait();
assert.equal(await tokenA.allowance(await vault.getAddress(), stablePoolAddress), 0n, "StableSwap uses no standing approval");

await increaseTime(61);
await refreshPrices();
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
const stableOutput = 5n * unit;
const stableInputQuote = await stablePool.getAmountInFor(tokens[1], stableOutput);
await (await vault.connect(engine).stableSwapExactOutput(
  5, stablePoolAddress, tokens[1], stableOutput, stableInputQuote * 101n / 100n, deadline
)).wait();

await increaseTime(61);
await refreshPrices();
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await (await vault.connect(engine).stableAddLiquidity(6, stablePoolAddress, 10n * unit, 10n * unit, 1, deadline)).wait();
const stableLPBalance = await stablePool.balanceOf(await vault.getAddress());
assert(stableLPBalance > 0n, "StableSwap LP position remains inside the user vault");

await increaseTime(61);
await refreshPrices();
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await (await vault.connect(engine).stableRemoveLiquidity(
  7, stablePoolAddress, stableLPBalance / 2n, 1, 1, deadline
)).wait();
assert((await stablePool.balanceOf(await vault.getAddress())) < stableLPBalance, "StableSwap removal burns only the approved Vault LP amount");

await (await vault.connect(engine).pause()).wait();
await assert.rejects(
  vault.connect(engine).swapExactInput(8, unit, 1, tokens, deadline),
  /VaultPaused/
);
await assert.rejects(vault.connect(attacker).resume(), /Unauthorized/);
await (await vault.connect(owner).resume()).wait();

await setPrices(unit, unit, 2n * unit, 101);
await increaseTime(61);
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await assert.rejects(
  vault.connect(engine).swapExactInput(8, unit, 1, tokens, deadline),
  /DepegDetected/
);
await refreshPrices();
const stale = BigInt((await ethers.provider.getBlock("latest")).timestamp) - 3_601n;
await setPrices(unit, unit, 2n * unit, 0, stale);
await assert.rejects(
  vault.connect(engine).swapExactInput(8, unit, 1, tokens, deadline),
  /OracleStale/
);

await refreshPrices();
await configure({ minActionInterval: 0, maxDailyLossBps: 2_000 });
let fuzzNonce = 8n;
let maxGasUsed = 0n;
for (let index = 0n; index < 32n; index++) {
  const fuzzPath = index % 2n === 0n ? tokens : [tokens[1], tokens[0]];
  const amount = (index % 17n + 1n) * unit;
  const fuzzQuote = await router.quoteExactInput(amount, fuzzPath);
  deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
  const receipt = await (await vault.connect(engine).swapExactInput(
    fuzzNonce,
    amount,
    fuzzQuote[1] * 99n / 100n,
    fuzzPath,
    deadline
  )).wait();
  if (receipt.gasUsed > maxGasUsed) maxGasUsed = receipt.gasUsed;
  fuzzNonce++;
  assert.equal(await vault.actionNonce(), fuzzNonce, `stateful vector ${index} consumes exactly one nonce`);
  assert.equal(await tokenA.allowance(await vault.getAddress(), await router.getAddress()), 0n, `stateful vector ${index} clears A approval`);
  assert.equal(await tokenB.allowance(await vault.getAddress(), await router.getAddress()), 0n, `stateful vector ${index} clears B approval`);
}
assert(maxGasUsed > 0n, "stateful gas benchmark records executed swaps");

await configure({ minActionInterval: 0, maxTradeValue: 10n * unit });
const capitalQuote = await router.quoteExactInput(11n * unit, tokens);
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await assert.rejects(
  vault.connect(engine).swapExactInput(fuzzNonce, 11n * unit, capitalQuote[1] * 99n / 100n, tokens, deadline),
  /CapitalExceeded/
);
await configure({ minActionInterval: 0, maxGasPrice: 1_000_000_000n });
await assert.rejects(
  vault.connect(engine).swapExactInput(fuzzNonce, unit, 1, tokens, deadline, { gasPrice: 2_000_000_000n }),
  /GasPriceExceeded/
);
const expiryBase = BigInt((await ethers.provider.getBlock("latest")).timestamp);
await configure({ minActionInterval: 0, expiresAt: expiryBase + 2n });
await increaseTime(3);
await refreshPrices();
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await assert.rejects(
  vault.connect(engine).swapExactInput(fuzzNonce, unit, 1, tokens, deadline),
  /MandateExpired/
);

await configure({ minActionInterval: 0, maxDailyLossBps: 0 });
const lossQuote = await router.quoteExactInput(1_000n * unit, tokens);
deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3_000n;
await assert.rejects(
  vault.connect(engine).swapExactInput(fuzzNonce, 1_000n * unit, lossQuote[1] * 99n / 100n, tokens, deadline),
  /DailyLossExceeded/
);
assert.equal(await vault.actionNonce(), fuzzNonce, "reverted risk action does not consume nonce");

await configure({ minActionInterval: 0, maxDailyLossBps: 2_000 });
assert.equal((await vault.mandate()).performanceFeeBps, 0n, "v1 has no path to charge unrealized profit");

await assert.rejects(vault.connect(attacker).withdraw(tokens[0], unit, attacker.address), /Unauthorized/);
await (await vault.connect(owner).revoke()).wait();
await assert.rejects(vault.connect(owner).resume(), /MandateRevoked/);
await assert.rejects(
  vault.connect(engine).swapExactInput(fuzzNonce, unit, 1, tokens, deadline),
  /VaultPaused|MandateRevoked/
);
const exitBeforeA = await tokenA.balanceOf(owner.address);
const exitBeforeB = await tokenB.balanceOf(owner.address);
const exitStale = BigInt((await ethers.provider.getBlock("latest")).timestamp) - 86_400n;
await setPrices(unit, unit, 2n * unit, 0, exitStale);
await (await vault.connect(owner).emergencyExit(owner.address)).wait();
assert((await tokenA.balanceOf(owner.address)) > exitBeforeA, "emergency exit returns token A without oracle dependence");
assert((await tokenB.balanceOf(owner.address)) > exitBeforeB, "emergency exit returns token B without oracle dependence");
assert.equal(await tokenA.balanceOf(await vault.getAddress()), 0n);
assert.equal(await tokenB.balanceOf(await vault.getAddress()), 0n);
assert.equal(await pool.balanceOf(await vault.getAddress()), 0n);
assert.equal(await stablePool.balanceOf(await vault.getAddress()), 0n);

const taxed = await ethers.deployContract("FeeOnTransferDexToken");
const plain = await ethers.deployContract("MockDexToken", ["Vault Plain", "VPL"]);
await Promise.all([taxed.waitForDeployment(), plain.waitForDeployment()]);
const taxedTokens = [await taxed.getAddress(), await plain.getAddress()];
const taxedFactory = await ethers.deployContract("YNXStableFactory", [governance.address, feeRecipient.address, taxedTokens]);
await taxedFactory.waitForDeployment();
const taxedRouter = await ethers.deployContract("YNXDexRouter", [await taxedFactory.getAddress()]);
await taxedRouter.waitForDeployment();
await (await taxedFactory.createPool(taxedTokens[0], taxedTokens[1], 200, 4)).wait();
const taxedPoolAddress = await taxedFactory.getPool(taxedTokens[0], taxedTokens[1]);
const taxedPool = await ethers.getContractAt("YNXStablePool", taxedPoolAddress);
for (const token of [taxed, plain]) {
  await (await token.mint(lp.address, 100_000n * unit)).wait();
  await (await token.connect(lp).approve(await taxedRouter.getAddress(), ethers.MaxUint256)).wait();
}
now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
await (await taxedRouter.connect(lp).addLiquidity(
  taxedTokens[0], taxedTokens[1], 50_000n * unit, 50_000n * unit, lp.address, now + 3_600n
)).wait();
const taxedOracle = await ethers.deployContract("MockVaultOracle");
await taxedOracle.waitForDeployment();
const taxedVault = await ethers.deployContract("YNXStrategyVault", [
  owner.address, engine.address, await router.getAddress(), await taxedOracle.getAddress(), taxedTokens
]);
await taxedVault.waitForDeployment();
await (await taxedVault.connect(owner).setStablePoolAllowed(taxedPoolAddress, true)).wait();
now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
for (const asset of [...taxedTokens, taxedPoolAddress]) {
  await (await taxedOracle.setPrice(asset, unit, now, 0)).wait();
}
await (await taxedVault.connect(owner).configureMandate(buildMandate(now))).wait();
await (await taxed.mint(owner.address, 1_000n * unit)).wait();
await (await taxed.connect(owner).approve(await taxedVault.getAddress(), 1_000n * unit)).wait();
const taxedOwnerBefore = await taxed.balanceOf(owner.address);
await assert.rejects(
  taxedVault.connect(owner).deposit(taxedTokens[0], 1_000n * unit),
  /TransferFailed|revert/
);
assert.equal(await taxedVault.actionNonce(), 0n, "taxed deposit rejection does not consume the Vault nonce");
assert.equal(await taxed.balanceOf(await taxedVault.getAddress()), 0n, "taxed assets never enter the Vault");
assert.equal(await taxed.balanceOf(owner.address), taxedOwnerBefore, "taxed deposit rejection is atomic");

console.log(`YNX Strategy Vault integration/adversarial/property: PASS (32 stateful vectors, max swap gas ${maxGasUsed})`);

async function configure(overrides = {}) {
  const timestamp = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  await (await vault.connect(owner).configureMandate(buildMandate(timestamp, overrides))).wait();
}

function buildMandate(timestamp, overrides = {}) {
  return {
    maxVaultValue: 100_000n * unit,
    maxTradeValue: overrides.maxTradeValue ?? 10_000n * unit,
    maxGasPrice: overrides.maxGasPrice ?? 100_000_000_000n,
    expiresAt: overrides.expiresAt ?? timestamp + 86_400n,
    minActionInterval: overrides.minActionInterval ?? 0,
    oracleMaxAge: 3_600,
    maxSlippageBps: 100,
    maxImpactBps: 1_000,
    maxDailyLossBps: overrides.maxDailyLossBps ?? 2_000,
    maxDrawdownBps: 3_000,
    depegToleranceBps: 100,
    performanceFeeBps: overrides.performanceFeeBps ?? 0,
    feeAsset: ethers.ZeroAddress,
    feeRecipient: ethers.ZeroAddress
  };
}

async function refreshPrices() {
  await setPrices(unit, unit, 2n * unit, 0);
}

async function setPrices(priceA, priceB, priceLP, deviation, timestamp) {
  const updatedAt = timestamp ?? BigInt((await ethers.provider.getBlock("latest")).timestamp);
  await (await oracle.setPrice(tokens[0], priceA, updatedAt, deviation)).wait();
  await (await oracle.setPrice(tokens[1], priceB, updatedAt, deviation)).wait();
  await (await oracle.setPrice(poolAddress, priceLP, updatedAt, deviation)).wait();
  await (await oracle.setPrice(stablePoolAddress, unit, updatedAt, deviation)).wait();
}

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}
