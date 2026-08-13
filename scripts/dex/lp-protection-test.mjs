import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.create({ network: "dexTest" });
const [governance, lp, trader, feeRecipient, attacker] = await ethers.getSigners();
const unit = 10n ** 18n;
const q96 = 1n << 96n;
const deadline = (1n << 64n) - 1n;
const sourceHash = ethers.id("YNX_TESTNET_REVIEWED_ORACLE_FIXTURE_V1");
const defaults = {
  baseFeeBps: 30,
  maxFeeBps: 500,
  volatilityMultiplierBps: 5_000,
  depthMultiplierBps: 10_000,
  divergenceMultiplierBps: 10_000,
  toxicMultiplierBps: 5_000,
  jitFeeBps: 50,
  depegToleranceBps: 100,
  guardBlocks: 2,
  oracleMaxAge: 300,
  flowWindow: 60
};

const tokenA = await ethers.deployContract("MockDexToken", ["Protected A", "PRA"]);
const tokenB = await ethers.deployContract("MockDexToken", ["Protected B", "PRB"]);
const oracle = await ethers.deployContract("MockLPProtectionOracle");
await Promise.all([tokenA.waitForDeployment(), tokenB.waitForDeployment(), oracle.waitForDeployment()]);
const tokens = [await tokenA.getAddress(), await tokenB.getAddress()];
const ordered = [...tokens].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
const factory = await ethers.deployContract("YNXProtectedDexFactory", [
  governance.address, feeRecipient.address, tokens, await oracle.getAddress(), defaults
]);
const factoryReceipt = await factory.deploymentTransaction().wait();
await factory.waitForDeployment();
const router = await ethers.deployContract("YNXDexRouter", [await factory.getAddress()]);
await router.waitForDeployment();
const createReceipt = await (await factory.createPool(tokens[0], tokens[1])).wait();
const poolAddress = await factory.getPool(tokens[0], tokens[1]);
const pool = await ethers.getContractAt("YNXDexPool", poolAddress);
const protection = await ethers.getContractAt("YNXLPProtection", await factory.lpProtection());
assert.equal(await pool.lpProtection(), await protection.getAddress(), "pool immutably binds the factory protection policy");
assert.equal(await factory.deploymentVersion(), "ynx-dex-protected-cpmm-v1");
assert.equal((await protection.poolState(poolAddress)).registered, true, "pool is registered before use");

for (const token of [tokenA, tokenB]) {
  await (await token.mint(lp.address, 2_000_000n * unit)).wait();
  await (await token.mint(trader.address, 200_000n * unit)).wait();
  await (await token.connect(lp).approve(await router.getAddress(), ethers.MaxUint256)).wait();
  await (await token.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
}
await (await router.connect(lp).addLiquidity(tokens[0], tokens[1], 1_000_000n * unit, 1_000_000n * unit, lp.address, deadline)).wait();

async function timestamp() {
  return BigInt((await ethers.provider.getBlock("latest")).timestamp);
}
async function setOracle({ priceX96 = q96, volatilityBps = 100, depegBps = 0, age = 0n, source = sourceHash } = {}) {
  const now = await timestamp();
  await (await oracle.setObservation(ordered[0], ordered[1], priceX96, volatilityBps, depegBps, now - age, source)).wait();
}
async function setOracleToSpot(options = {}) {
  const [reserve0, reserve1] = await pool.getReserves();
  return setOracle({ ...options, priceX96: (reserve1 << 96n) / reserve0 });
}

await setOracle();
const amount = 1_000n * unit;
const initialQuote = await pool.currentFeeQuote(tokens[0], amount);
assert.equal(initialQuote.baseFeeBps, 30n);
assert.equal(initialQuote.volatilityFeeBps, 50n);
assert.equal(initialQuote.depthFeeBps, 10n);
assert.equal(initialQuote.divergenceFeeBps, 0n);
assert.equal(initialQuote.toxicFlowFeeBps, 5n);
assert.equal(initialQuote.jitFeeBps, 50n);
assert.equal(initialQuote.totalFeeBps, 145n, "dynamic fee exposes every additive component");
assert.equal(initialQuote.oracleSourceHash, sourceHash, "fee evidence binds the reviewed oracle source");
await assert.rejects(pool.getAmountOut(amount, 1_000_000n * unit, 1_000_000n * unit), /ProtectedQuoteRequiresToken|revert/);

const routeQuote = await router.quoteExactInput(amount, [tokens[0], tokens[1]]);
const [before0, before1] = await pool.getReserves();
const kBefore = before0 * before1;
const swapReceipt = await (await router.connect(trader).swapExactInput(amount, routeQuote[1], [tokens[0], tokens[1]], trader.address, deadline)).wait();
const [after0, after1] = await pool.getReserves();
assert(after0 * after1 >= kBefore, "dynamic-fee swap preserves the constant-product invariant");
const storedFlow = await protection.poolState(poolAddress);
assert(storedFlow.token0FlowBps + storedFlow.token1FlowBps > 0n, "successful swap records transparent directional flow");
assert((await pool.protocolFees0()) + (await pool.protocolFees1()) > 0n, "dynamic realized fee accrues the published protocol share");

await setOracleToSpot();
const repeated = await pool.currentFeeQuote(tokens[0], amount);
const opposite = await pool.currentFeeQuote(tokens[1], amount);
assert(repeated.toxicFlowFeeBps > opposite.toxicFlowFeeBps, "same-side flow costs more than offsetting flow");

await ethers.provider.send("hardhat_mine", ["0x3"]);
await setOracleToSpot();
const noJit = await pool.currentFeeQuote(tokens[0], amount);
assert.equal(noJit.jitFeeBps, 0n, "JIT fee expires after the public guard interval");

const exactWanted = 250n * unit;
const exactQuote = await router.quoteExactOutput(exactWanted, [tokens[0], tokens[1]]);
const beforeExact = await tokenB.balanceOf(trader.address);
await (await router.connect(trader).swapExactOutput(exactWanted, exactQuote[0], [tokens[0], tokens[1]], trader.address, deadline)).wait();
assert((await tokenB.balanceOf(trader.address)) - beforeExact >= exactWanted, "protected exact-output quote is conservative and executable");

// Differential/property vectors cover fee component arithmetic, rounding and cap.
for (let index = 1n; index <= 32n; index++) {
  await ethers.provider.send("evm_increaseTime", [61]);
  await ethers.provider.send("evm_mine", []);
  const [reserve0, reserve1] = await pool.getReserves();
  const spot = (reserve1 << 96n) / reserve0;
  const shiftBps = (index * 37n) % 701n;
  const oraclePrice = spot * (10_000n + shiftBps) / 10_000n;
  const volatility = Number((index * 53n) % 801n);
  await setOracle({ priceX96: oraclePrice, volatilityBps: volatility });
  const vectorAmount = (index * 137n + index * index) * unit;
  const quote = await pool.currentFeeQuote(ordered[0], vectorAmount);
  const reserveIn = ordered[0].toLowerCase() === (await pool.token0()).toLowerCase() ? reserve0 : reserve1;
  const depth = vectorAmount * 10_000n / reserveIn > 10_000n ? 10_000n : vectorAmount * 10_000n / reserveIn;
  const divergenceRaw = (spot > oraclePrice ? spot - oraclePrice : oraclePrice - spot) * 10_000n / oraclePrice;
  const divergence = divergenceRaw > 10_000n ? 10_000n : divergenceRaw;
  const expected = 30n + BigInt(volatility) * 5_000n / 10_000n + depth + divergence + depth * 5_000n / 10_000n;
  assert.equal(quote.totalFeeBps, expected > 500n ? 500n : expected, `fee differential vector ${index}`);
  assert(quote.totalFeeBps >= 30n && quote.totalFeeBps <= 500n, `fee bound vector ${index}`);
}

// Stateful invariant campaign: refresh to the real spot and alternate direction.
for (let index = 0; index < 16; index++) {
  await ethers.provider.send("evm_increaseTime", [61]);
  await ethers.provider.send("evm_mine", []);
  await setOracleToSpot({ volatilityBps: (index * 41) % 400 });
  const tokenIn = index % 2 === 0 ? tokens[0] : tokens[1];
  const tokenOut = index % 2 === 0 ? tokens[1] : tokens[0];
  const input = BigInt(50 + index * 17) * unit;
  const [r0, r1] = await pool.getReserves();
  const invariantBefore = r0 * r1;
  const quote = await router.quoteExactInput(input, [tokenIn, tokenOut]);
  await (await router.connect(trader).swapExactInput(input, quote[1], [tokenIn, tokenOut], trader.address, deadline)).wait();
  const [n0, n1] = await pool.getReserves();
  assert(n0 * n1 >= invariantBefore, `stateful invariant vector ${index}`);
}

// Oracle and depeg chaos fail closed for swaps.
await setOracleToSpot({ source: ethers.ZeroHash });
await assert.rejects(router.quoteExactInput(amount, [tokens[0], tokens[1]]), /InvalidOracleObservation|revert/);
await setOracleToSpot({ age: 301n });
await assert.rejects(router.quoteExactInput(amount, [tokens[0], tokens[1]]), /StaleOracle|revert/);
await setOracleToSpot({ depegBps: 101 });
await assert.rejects(router.quoteExactInput(amount, [tokens[0], tokens[1]]), /DepegCircuitBreaker|revert/);

// A depeg never traps LPs: proportional exit bypasses swap/oracle protection.
const lpShares = await pool.balanceOf(lp.address);
await (await pool.connect(lp).approve(await router.getAddress(), lpShares / 10n)).wait();
const lpTokenBefore = await tokenA.balanceOf(lp.address);
await (await router.connect(lp).removeLiquidity(tokens[0], tokens[1], lpShares / 10n, 1n, 1n, lp.address, deadline)).wait();
assert((await tokenA.balanceOf(lp.address)) > lpTokenBefore, "depeg circuit breaker preserves permissionless LP exit");

// Governance cannot rewrite fee policy instantly.
const nextConfig = { ...defaults, maxFeeBps: 600, jitFeeBps: 60 };
await assert.rejects(protection.connect(attacker).scheduleConfig(poolAddress, nextConfig), /Unauthorized|revert/);
await (await protection.connect(governance).scheduleConfig(poolAddress, nextConfig)).wait();
await assert.rejects(protection.executeConfig(poolAddress), /DelayNotElapsed|revert/);
await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
await ethers.provider.send("evm_mine", []);
await (await protection.executeConfig(poolAddress)).wait();
assert.equal((await protection.feeBounds(poolAddress)).maxFeeBps, 600n, "public delayed config execution changes the disclosed cap");

// Fee-on-transfer chaos proves the assessment state and token transfer roll back together.
const taxed = await ethers.deployContract("FeeOnTransferDexToken");
const plain = await ethers.deployContract("MockDexToken", ["Protected Plain", "PPL"]);
const taxedOracle = await ethers.deployContract("MockLPProtectionOracle");
await Promise.all([taxed.waitForDeployment(), plain.waitForDeployment(), taxedOracle.waitForDeployment()]);
const taxedTokens = [await taxed.getAddress(), await plain.getAddress()];
const taxedOrdered = [...taxedTokens].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
const taxedFactory = await ethers.deployContract("YNXProtectedDexFactory", [governance.address, feeRecipient.address, taxedTokens, await taxedOracle.getAddress(), defaults]);
await taxedFactory.waitForDeployment();
const taxedRouter = await ethers.deployContract("YNXDexRouter", [await taxedFactory.getAddress()]);
await taxedRouter.waitForDeployment();
await (await taxedFactory.createPool(taxedTokens[0], taxedTokens[1])).wait();
const taxedPoolAddress = await taxedFactory.getPool(taxedTokens[0], taxedTokens[1]);
const taxedPool = await ethers.getContractAt("YNXDexPool", taxedPoolAddress);
const taxedProtection = await ethers.getContractAt("YNXLPProtection", await taxedFactory.lpProtection());
for (const token of [taxed, plain]) {
  await (await token.mint(lp.address, 100_000n * unit)).wait();
  await (await token.connect(lp).approve(await taxedRouter.getAddress(), ethers.MaxUint256)).wait();
}
await (await taxed.mint(trader.address, 1_000n * unit)).wait();
await (await taxed.connect(trader).approve(await taxedRouter.getAddress(), ethers.MaxUint256)).wait();
await (await taxedRouter.connect(lp).addLiquidity(taxedTokens[0], taxedTokens[1], 50_000n * unit, 50_000n * unit, lp.address, deadline)).wait();
const [taxR0, taxR1] = await taxedPool.getReserves();
const now = await timestamp();
await (await taxedOracle.setObservation(taxedOrdered[0], taxedOrdered[1], (taxR1 << 96n) / taxR0, 0, 0, now, sourceHash)).wait();
const flowBefore = await taxedProtection.poolState(taxedPoolAddress);
const taxedPath = [await taxed.getAddress(), await plain.getAddress()];
const taxedQuote = await taxedRouter.quoteExactInput(100n * unit, taxedPath);
const taxedBalance = await taxed.balanceOf(trader.address);
await assert.rejects(taxedRouter.connect(trader).swapExactInput(100n * unit, taxedQuote[1], taxedPath, trader.address, deadline), /InsufficientOutput|revert/);
const flowAfter = await taxedProtection.poolState(taxedPoolAddress);
assert.equal(flowAfter.token0FlowBps, flowBefore.token0FlowBps, "failed taxed swap rolls protection state back");
assert.equal(flowAfter.token1FlowBps, flowBefore.token1FlowBps, "failed taxed swap preserves opposite flow state");
assert.equal(await taxed.balanceOf(trader.address), taxedBalance, "failed taxed swap returns all user assets");

console.log(`YNX LP Protection integration/invariant/differential/chaos: PASS (32 differential + 16 stateful vectors, factory deploy gas ${factoryReceipt.gasUsed}, pool create gas ${createReceipt.gasUsed}, protected swap gas ${swapReceipt.gasUsed})`);
