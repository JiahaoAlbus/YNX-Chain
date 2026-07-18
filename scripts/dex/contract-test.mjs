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
const quoter = await ethers.deployContract("YNXDexQuoter", [await router.getAddress()]);
await quoter.waitForDeployment();
assert.equal(await quoter.router(), await router.getAddress(), "quoter is bound to the versioned router");

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
const directQuote = await quoter.quoteExactInput(exactIn, [tokens[0], tokens[1]]);
assert(directQuote[1] > 0n && directQuote[1] < exactIn, "constant-product quote is bounded");
const beforeB = await tokenB.balanceOf(trader.address);
await (await router.connect(trader).swapExactInput(exactIn, directQuote[1], [tokens[0], tokens[1]], trader.address, deadline)).wait();
assert.equal(await tokenB.balanceOf(trader.address) - beforeB, directQuote[1], "exact-input settles quoted output");
assert((await poolAB.protocolFees0()) + (await poolAB.protocolFees1()) > 0n, "protocol fee is explicitly accrued");
const expectedProtocolFee = (exactIn * 30n / 10_000n) * 1_667n / 10_000n;
const tokenAIsZero = (await poolAB.token0()).toLowerCase() === tokens[0].toLowerCase();
assert.equal(tokenAIsZero ? await poolAB.protocolFees0() : await poolAB.protocolFees1(), expectedProtocolFee, "protocol fee accounting matches the published share exactly");

const multiQuote = await quoter.quoteExactInput(exactIn, [tokens[0], tokens[1], tokens[2]]);
const beforeC = await tokenC.balanceOf(trader.address);
await (await router.connect(trader).swapExactInput(exactIn, multiQuote[2], [tokens[0], tokens[1], tokens[2]], trader.address, deadline)).wait();
assert.equal(await tokenC.balanceOf(trader.address) - beforeC, multiQuote[2], "multi-hop settles deterministically");

const wanted = 100n * unit;
const exactOutputQuote = await quoter.quoteExactOutput(wanted, [tokens[0], tokens[1]]);
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

for (let index = 1n; index <= 100n; index++) {
  const input = index * 97_531n + index * index;
  const expected = input * 9_970n * reserve1 / (reserve0 * 10_000n + input * 9_970n);
  assert.equal(await poolAB.getAmountOut(input, reserve0, reserve1), expected, `rounding differential vector ${index}`);
}
await assert.rejects(router.quoteExactInput(exactIn, [tokens[0], tokens[1], tokens[0], tokens[1], tokens[0], tokens[1]]), /InvalidRoute|revert/, "routes above four hops reject");
const balanceBeforeSlippage = await tokenA.balanceOf(trader.address);
const guardedQuote = await router.quoteExactInput(10n * unit, [tokens[0], tokens[1]]);
await assert.rejects(router.connect(trader).swapExactInput(10n * unit, guardedQuote[1] + 1n, [tokens[0], tokens[1]], trader.address, deadline), /InsufficientOutput|revert/);
assert.equal(await tokenA.balanceOf(trader.address), balanceBeforeSlippage, "failed slippage guard rolls back input");

await ethers.provider.send("evm_increaseTime", [60]);
await ethers.provider.send("evm_mine", []);
const [cumulative0, cumulative1] = await poolAB.currentCumulativePrices();
assert(cumulative0 > 0n && cumulative1 > 0n, "reviewable cumulative-price oracle advances with time");
const syncReceipt = await (await poolAB.sync()).wait();
const syncBlock = await ethers.provider.getBlock(syncReceipt.blockNumber);
const [oracleReserve0, oracleReserve1] = await poolAB.getReserves();
const cumulativeBeforeManipulation = await poolAB.price0CumulativeLast();
await ethers.provider.send("evm_increaseTime", [60]);
const manipulationInput = 20_000n * unit;
const manipulationQuote = await router.quoteExactInput(manipulationInput, [tokens[0], tokens[1]]);
const manipulationReceipt = await (await router.connect(trader).swapExactInput(manipulationInput, 1n, [tokens[0], tokens[1]], trader.address, deadline)).wait();
const manipulationBlock = await ethers.provider.getBlock(manipulationReceipt.blockNumber);
const elapsedBeforeManipulation = BigInt(manipulationBlock.timestamp - syncBlock.timestamp);
const cumulativeAfterManipulation = await poolAB.price0CumulativeLast();
assert.equal(cumulativeAfterManipulation - cumulativeBeforeManipulation, ((oracleReserve1 << 112n) / oracleReserve0) * elapsedBeforeManipulation, "a large swap cannot rewrite the prior TWAP interval");
assert(manipulationQuote[1] > 0n, "manipulation simulation executed against live reserves");

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

const feeToken = await ethers.deployContract("FeeOnTransferDexToken");
const plainToken = await ethers.deployContract("MockDexToken", ["Plain", "PLN"]);
await Promise.all([feeToken.waitForDeployment(), plainToken.waitForDeployment()]);
const exoticTokens = [await feeToken.getAddress(), await plainToken.getAddress()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
const exoticFactory = await ethers.deployContract("YNXDexFactory", [governance.address, feeRecipient.address, exoticTokens]);
await exoticFactory.waitForDeployment();
const exoticRouter = await ethers.deployContract("YNXDexRouter", [await exoticFactory.getAddress()]);
await exoticRouter.waitForDeployment();
await (await exoticFactory.createPool(exoticTokens[0], exoticTokens[1])).wait();
for (const token of [feeToken, plainToken]) {
  await (await token.mint(lp.address, 100_000n * unit)).wait();
  await (await token.connect(lp).approve(await exoticRouter.getAddress(), ethers.MaxUint256)).wait();
}
await (await feeToken.mint(trader.address, 1_000n * unit)).wait();
await (await feeToken.connect(trader).approve(await exoticRouter.getAddress(), ethers.MaxUint256)).wait();
await (await exoticRouter.connect(lp).addLiquidity(await feeToken.getAddress(), await plainToken.getAddress(), 50_000n * unit, 50_000n * unit, lp.address, deadline + 120n)).wait();
const feePath = [await feeToken.getAddress(), await plainToken.getAddress()];
const taxedQuote = await exoticRouter.quoteExactInput(100n * unit, feePath);
const taxedBefore = await feeToken.balanceOf(trader.address);
await assert.rejects(exoticRouter.connect(trader).swapExactInput(100n * unit, taxedQuote[1], feePath, trader.address, deadline + 120n), /InsufficientOutput|revert/, "fee-on-transfer input fails its quoted minimum");
assert.equal(await feeToken.balanceOf(trader.address), taxedBefore, "taxed-token failure rolls back transfer and burn");

const rebaseToken = await ethers.deployContract("RebasingDexToken");
const rebasePairToken = await ethers.deployContract("MockDexToken", ["Pair", "PAIR"]);
await Promise.all([rebaseToken.waitForDeployment(), rebasePairToken.waitForDeployment()]);
const rebaseTokens = [await rebaseToken.getAddress(), await rebasePairToken.getAddress()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
const rebaseFactory = await ethers.deployContract("YNXDexFactory", [governance.address, feeRecipient.address, rebaseTokens]);
await rebaseFactory.waitForDeployment();
const rebaseRouter = await ethers.deployContract("YNXDexRouter", [await rebaseFactory.getAddress()]);
await rebaseRouter.waitForDeployment();
await (await rebaseFactory.createPool(rebaseTokens[0], rebaseTokens[1])).wait();
for (const token of [rebaseToken, rebasePairToken]) { await (await token.mint(lp.address, 100_000n * unit)).wait(); await (await token.connect(lp).approve(await rebaseRouter.getAddress(), ethers.MaxUint256)).wait(); }
await (await rebaseRouter.connect(lp).addLiquidity(await rebaseToken.getAddress(), await rebasePairToken.getAddress(), 50_000n * unit, 50_000n * unit, lp.address, deadline + 120n)).wait();
const rebasePoolAddress = await rebaseFactory.getPool(rebaseTokens[0], rebaseTokens[1]);
const rebasePool = await ethers.getContractAt("YNXDexPool", rebasePoolAddress);
await (await rebaseToken.slash(rebasePoolAddress, 1n)).wait();
await assert.rejects(rebasePool.sync(), /panic|revert/, "negative rebase fails closed rather than inventing reserves");

const overflowA = await ethers.deployContract("MockDexToken", ["Overflow A", "OVA"]);
const overflowB = await ethers.deployContract("MockDexToken", ["Overflow B", "OVB"]);
await Promise.all([overflowA.waitForDeployment(), overflowB.waitForDeployment()]);
const overflowTokens = [await overflowA.getAddress(), await overflowB.getAddress()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
const overflowFactory = await ethers.deployContract("YNXDexFactory", [governance.address, feeRecipient.address, overflowTokens]);
await overflowFactory.waitForDeployment();
const overflowRouter = await ethers.deployContract("YNXDexRouter", [await overflowFactory.getAddress()]);
await overflowRouter.waitForDeployment();
await (await overflowFactory.createPool(overflowTokens[0], overflowTokens[1])).wait();
const tooLarge = 1n << 112n;
for (const token of [overflowA, overflowB]) { await (await token.mint(lp.address, tooLarge)).wait(); await (await token.connect(lp).approve(await overflowRouter.getAddress(), ethers.MaxUint256)).wait(); }
await assert.rejects(overflowRouter.connect(lp).addLiquidity(await overflowA.getAddress(), await overflowB.getAddress(), tooLarge, tooLarge, lp.address, deadline + 120n), /Overflow|revert/, "uint112 reserve overflow rejects atomically");

const extremeA = await ethers.deployContract("MockDexToken", ["Extreme A", "EXA"]);
const extremeB = await ethers.deployContract("MockDexToken", ["Extreme B", "EXB"]);
await Promise.all([extremeA.waitForDeployment(), extremeB.waitForDeployment()]);
const extremeTokens = [await extremeA.getAddress(), await extremeB.getAddress()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
const extremeFactory = await ethers.deployContract("YNXDexFactory", [governance.address, feeRecipient.address, extremeTokens]);await extremeFactory.waitForDeployment();
const extremeRouter = await ethers.deployContract("YNXDexRouter", [await extremeFactory.getAddress()]);await extremeRouter.waitForDeployment();await (await extremeFactory.createPool(extremeTokens[0], extremeTokens[1])).wait();
for (const [token,amount] of [[extremeA,1_000_000n],[extremeB,10n**30n]]) { await (await token.mint(lp.address,amount)).wait();await (await token.connect(lp).approve(await extremeRouter.getAddress(),ethers.MaxUint256)).wait(); }
await (await extremeRouter.connect(lp).addLiquidity(await extremeA.getAddress(),await extremeB.getAddress(),1_000_000n,10n**30n,lp.address,deadline+120n)).wait();
const extremeQuote=await extremeRouter.quoteExactInput(1n,[await extremeA.getAddress(),await extremeB.getAddress()]);assert(extremeQuote[1]>0n&&extremeQuote[1]<10n**30n,"extreme reserve ratio remains bounded and executable");

const feeBalanceBefore = await tokenA.balanceOf(feeRecipient.address);
await (await poolAB.connect(feeRecipient).claimProtocolFees()).wait();
assert((await tokenA.balanceOf(feeRecipient.address)) >= feeBalanceBefore, "authorized fee recipient can claim accrued fees");
await assert.rejects(poolAB.connect(attacker).claimProtocolFees(), /Unauthorized|revert/);

await (await factory.connect(governance).scheduleTokenSupport(tokens[2], false)).wait();
await (await factory.connect(governance).scheduleProtocolFeeRecipient(attacker.address)).wait();
await assert.rejects(factory.executeTokenSupport(tokens[2]), /DelayNotElapsed|revert/);
await assert.rejects(factory.executeProtocolFeeRecipient(), /DelayNotElapsed|revert/);
await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]);
await ethers.provider.send("evm_mine", []);
await (await factory.executeTokenSupport(tokens[2])).wait();
await (await factory.executeProtocolFeeRecipient()).wait();
assert.equal(await factory.supportedToken(tokens[2]), false, "delayed token removal executes publicly");
assert.equal(await factory.protocolFeeRecipient(), attacker.address, "delayed fee-recipient change executes publicly");

console.log("YNX DEX contract integration: PASS");
