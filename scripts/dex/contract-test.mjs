import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.create({ network: "dexTest" });
const [governance, lp, trader, feeRecipient, attacker] = await ethers.getSigners();

const tokenA = await ethers.deployContract("MockDexToken", ["Test A", "TSTA"]);
const tokenB = await ethers.deployContract("MockDexToken", ["Test B", "TSTB"]);
const tokenC = await ethers.deployContract("MockDexToken", ["Test C", "TSTC"]);
await Promise.all([tokenA.waitForDeployment(), tokenB.waitForDeployment(), tokenC.waitForDeployment()]);
const tokens = [await tokenA.getAddress(), await tokenB.getAddress(), await tokenC.getAddress()];
const factory = await ethers.deployContract("YNXDexFactory", [governance.address, feeRecipient.address, tokens]);
await factory.waitForDeployment();
const router = await ethers.deployContract("YNXDexRouter", [await factory.getAddress()]);
await router.waitForDeployment();

await (await factory.createPool(tokens[0], tokens[1])).wait();
await (await factory.createPool(tokens[1], tokens[2])).wait();
const poolABAddress = await factory.getPool(tokens[0], tokens[1]);
const poolBCAddress = await factory.getPool(tokens[1], tokens[2]);
const poolAB = await ethers.getContractAt("YNXDexPool", poolABAddress);

const unit = 10n ** 18n;
for (const token of [tokenA, tokenB, tokenC]) {
  await (await token.mint(lp.address, 2_000_000n * unit)).wait();
  await (await token.mint(trader.address, 100_000n * unit)).wait();
  await (await token.connect(lp).approve(await router.getAddress(), ethers.MaxUint256)).wait();
  await (await token.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
}
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
await (await router.connect(lp).addLiquidity(tokens[0], tokens[1], 1_000_000n * unit, 1_000_000n * unit, lp.address, deadline)).wait();
await (await router.connect(lp).addLiquidity(tokens[1], tokens[2], 1_000_000n * unit, 500_000n * unit, lp.address, deadline)).wait();

const exactIn = 1_000n * unit;
const directQuote = await router.quoteExactInput(exactIn, [tokens[0], tokens[1]]);
assert(directQuote[1] > 0n && directQuote[1] < exactIn, "constant-product quote is bounded");
const beforeB = await tokenB.balanceOf(trader.address);
await (await router.connect(trader).swapExactInput(exactIn, directQuote[1], [tokens[0], tokens[1]], trader.address, deadline)).wait();
assert.equal(await tokenB.balanceOf(trader.address) - beforeB, directQuote[1], "exact-input settles quoted output");
assert((await poolAB.protocolFees0()) + (await poolAB.protocolFees1()) > 0n, "protocol fee is explicitly accrued");

const multiQuote = await router.quoteExactInput(exactIn, [tokens[0], tokens[1], tokens[2]]);
const beforeC = await tokenC.balanceOf(trader.address);
await (await router.connect(trader).swapExactInput(exactIn, multiQuote[2], [tokens[0], tokens[1], tokens[2]], trader.address, deadline)).wait();
assert.equal(await tokenC.balanceOf(trader.address) - beforeC, multiQuote[2], "multi-hop settles deterministically");

const wanted = 100n * unit;
const exactOutputQuote = await router.quoteExactOutput(wanted, [tokens[0], tokens[1]]);
const beforeExactB = await tokenB.balanceOf(trader.address);
await (await router.connect(trader).swapExactOutput(wanted, exactOutputQuote[0], [tokens[0], tokens[1]], trader.address, deadline)).wait();
assert((await tokenB.balanceOf(trader.address)) - beforeExactB >= wanted, "exact-output delivers requested amount");

const lpBalance = await poolAB.balanceOf(lp.address);
await (await poolAB.connect(lp).approve(await router.getAddress(), lpBalance / 4n)).wait();
const beforeRemoveA = await tokenA.balanceOf(lp.address);
await (await router.connect(lp).removeLiquidity(tokens[0], tokens[1], lpBalance / 4n, 1n, 1n, lp.address, deadline)).wait();
assert((await tokenA.balanceOf(lp.address)) > beforeRemoveA, "LP removal returns underlying assets");

await assert.rejects(factory.connect(attacker).scheduleTokenSupport(await tokenA.getAddress(), false), /Unauthorized|revert/);
await assert.rejects(factory.connect(attacker).scheduleProtocolFeeRecipient(attacker.address), /Unauthorized|revert/);
await assert.rejects(router.quoteExactInput(exactIn, [tokens[0], attacker.address]), /UnsupportedToken|revert/);
await assert.rejects(router.connect(trader).swapExactInput(exactIn, 1n, [tokens[0], tokens[1]], trader.address, 1n), /DeadlineExpired|revert/);

const [reserve0, reserve1] = await poolAB.getReserves();
assert(reserve0 > 0n && reserve1 > 0n, "reserves remain live");
assert(reserve0 * reserve1 > 0n, "constant-product invariant is non-zero");
assert.equal(await factory.getPool(tokens[1], tokens[0]), poolABAddress, "registry is order-independent");
assert.notEqual(poolABAddress, poolBCAddress, "distinct token pairs have distinct pools");

await ethers.provider.send("evm_increaseTime", [60]);
await ethers.provider.send("evm_mine", []);
const [cumulative0, cumulative1] = await poolAB.currentCumulativePrices();
assert(cumulative0 > 0n && cumulative1 > 0n, "reviewable cumulative-price oracle advances with time");

const safeToken = await ethers.deployContract("MockDexToken", ["Safe", "SAFE"]);
const reentrantToken = await ethers.deployContract("ReentrantDexToken");
await Promise.all([safeToken.waitForDeployment(), reentrantToken.waitForDeployment()]);
const attackTokens = [await safeToken.getAddress(), await reentrantToken.getAddress()];
const attackFactory = await ethers.deployContract("YNXDexFactory", [governance.address, feeRecipient.address, attackTokens]);
await attackFactory.waitForDeployment();
const attackRouter = await ethers.deployContract("YNXDexRouter", [await attackFactory.getAddress()]);
await attackRouter.waitForDeployment();
await (await attackFactory.createPool(attackTokens[0], attackTokens[1])).wait();
const attackPoolAddress = await attackFactory.getPool(attackTokens[0], attackTokens[1]);
for (const token of [safeToken, reentrantToken]) {
  await (await token.mint(lp.address, 100_000n * unit)).wait();
  await (await token.connect(lp).approve(await attackRouter.getAddress(), ethers.MaxUint256)).wait();
}
await (await safeToken.mint(trader.address, 1_000n * unit)).wait();
await (await safeToken.connect(trader).approve(await attackRouter.getAddress(), ethers.MaxUint256)).wait();
await (await attackRouter.connect(lp).addLiquidity(attackTokens[0], attackTokens[1], 50_000n * unit, 50_000n * unit, lp.address, deadline + 120n)).wait();
await (await reentrantToken.configureAttack(attackPoolAddress, ethers.getBytes(ethers.id("sync()").slice(0, 10)), true)).wait();
const attackPath = [await safeToken.getAddress(), await reentrantToken.getAddress()];
await assert.rejects(attackRouter.connect(trader).swapExactInput(10n * unit, 1n, attackPath, trader.address, deadline + 120n), /TransferFailed|reentrant|revert/);
assert.equal(await reentrantToken.balanceOf(trader.address), 0n, "reentrant output transfer rolls back atomically");

console.log("YNX DEX contract integration: PASS");
