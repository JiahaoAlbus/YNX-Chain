import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.create({ network: "dexTest" });
const [governance, treasury, alice, bob, solverA, solverB, challenger] = await ethers.getSigners();
const tokenA = await ethers.deployContract("MockDexToken", ["Fair A", "FA"]);
const tokenB = await ethers.deployContract("MockDexToken", ["Fair B", "FB"]);
await Promise.all([tokenA.waitForDeployment(), tokenB.waitForDeployment()]);
const tokenAddresses = [await tokenA.getAddress(), await tokenB.getAddress()];
const factory = await ethers.deployContract("YNXDexFactory", [governance.address, treasury.address, tokenAddresses]);
await factory.waitForDeployment();
const bond = ethers.parseEther("1");
const fair = await ethers.deployContract("YNXFairFlow", [governance.address, treasury.address, await factory.getAddress(), bond]);
const fairDeployment = await fair.deploymentTransaction().wait();
await fair.waitForDeployment();
const fairAddress = await fair.getAddress();
const unit = 10n ** 18n;

for (const [token, account, amount] of [
  [tokenA, alice, 10_000n * unit], [tokenB, bob, 10_000n * unit],
  [tokenA, solverA, 10_000n * unit], [tokenB, solverA, 10_000n * unit],
  [tokenA, solverB, 10_000n * unit], [tokenB, solverB, 10_000n * unit],
]) {
  await (await token.mint(account.address, amount)).wait();
  await (await token.connect(account).approve(fairAddress, ethers.MaxUint256)).wait();
}
for (const solver of [solverA, solverB, challenger]) await (await fair.connect(solver).depositSolverBond({ value: 2n * bond })).wait();

const advance = async (seconds) => { await ethers.provider.send("evm_increaseTime", [seconds]); await ethers.provider.send("evm_mine", []); };
const openBatch = async () => {
  const id = await fair.nextBatchId();
  await (await fair.connect(governance).openBatch(tokenAddresses[0], tokenAddresses[1], 30, 30, 30, 30)).wait();
  return id;
};
const submit = async (owner, batchId, sellToken, sellAmount, minBuyAmount) => {
  const schedule = await fair.batchSchedule(batchId);
  const args = [batchId, sellToken, sellAmount, minBuyAmount, schedule.settleEnd + 300n];
  const id = await fair.connect(owner).submitIntent.staticCall(...args);
  await (await fair.connect(owner).submitIntent(...args)).wait();
  return id;
};
const commit = async (solver, batchId, price, rebate, setHash, routeHash, salt) => {
  const digest = await fair.computeCommitment(batchId, solver.address, price, rebate, setHash, routeHash, salt);
  await (await fair.connect(solver).commitSolution(batchId, digest)).wait();
  return digest;
};

// Uniform-price settlement, CoW netting, external liquidity and transparent rebate.
const batch1 = await openBatch();
const aliceIntent = await submit(alice, batch1, await tokenA.getAddress(), 100n * unit, 190n * unit);
const bobIntent = await submit(bob, batch1, await tokenB.getAddress(), 160n * unit, 75n * unit);
assert.equal((await fair.batchSchedule(batch1)).activeIntentCount, 2n);
const q96 = await fair.Q96();
await assert.rejects(fair.scoreSolution(batch1, q96 * 1900n / 1000n, 0), /InvalidSolution|revert/, "floor-rounded boundary below minBuy rejects");
for (let i = 0n; i < 32n; i++) {
  const price = q96 * (1901n + i * 6n) / 1000n;
  const rebate = Number(i % 11n);
  const aliceBase = 100n * unit * price / q96;
  const aliceBuy = aliceBase + aliceBase * BigInt(rebate) / 10_000n;
  const bobBase = 160n * unit * q96 / price;
  const bobBuy = bobBase + bobBase * BigInt(rebate) / 10_000n;
  const expected = (aliceBuy - 190n * unit) * q96 / price + (bobBuy - 75n * unit);
  assert.equal(await fair.scoreSolution(batch1, price, rebate), expected, `uniform-score differential vector ${i}`);
}
await advance(31);
const setHash1 = await fair.activeSetHash(batch1);
const price = 2n * q96;
const routeA = ethers.id("cow-only");
const routeB = ethers.id("cow-plus-external-liquidity");
const saltA = ethers.id("solver-a-batch-1");
const saltB = ethers.id("solver-b-batch-1");
await commit(solverA, batch1, price, 0, setHash1, routeA, saltA);
await commit(solverB, batch1, price, 100, setHash1, routeB, saltB);
await commit(challenger, batch1, price, 50, setHash1, routeA, ethers.id("non-reveal"));
await assert.rejects(fair.connect(solverA).withdrawSolverBond(2n * bond), /InsufficientBond|revert/, "locked bond cannot be withdrawn");
await advance(31);
await assert.rejects(fair.connect(solverA).revealSolution(batch1, price, 0, setHash1, routeA, ethers.id("tampered")), /InvalidCommitment|revert/);
await (await fair.connect(solverA).revealSolution(batch1, price, 0, setHash1, routeA, saltA)).wait();
await (await fair.connect(solverB).revealSolution(batch1, price, 100, setHash1, routeB, saltB)).wait();
const beforeFinalizeChallenger = await fair.solvers(challenger.address);
await advance(31);
await (await fair.finalizeWinner(batch1)).wait();
const winner1 = await fair.batchWinner(batch1);
assert.equal(winner1.solver, solverB.address, "higher verified user surplus wins");
assert.equal(winner1.routeHash, routeB, "winning external-liquidity route commitment is public");
assert.notEqual(winner1.bestExecutionDigest, ethers.ZeroHash, "best execution proof digest is public");
assert.equal((await fair.batchSchedule(batch1)).status, 2n, "batch is finalized");
assert.equal((await fair.solvers(solverA.address)).locked, 0n, "revealed losing solver unlocks");
assert.equal((await fair.solvers(challenger.address)).bond, beforeFinalizeChallenger.bond - bond, "non-reveal is slashable liveness failure");
const beforeAliceA = await tokenA.balanceOf(alice.address);
const beforeAliceB = await tokenB.balanceOf(alice.address);
const beforeBobA = await tokenA.balanceOf(bob.address);
const beforeBobB = await tokenB.balanceOf(bob.address);
await (await tokenB.connect(bob).approve(fairAddress, 0)).wait();
await assert.rejects(fair.connect(solverB).settleBatch(batch1, [bobIntent, aliceIntent]), /TransferFailed|revert/);
assert.equal(await tokenA.balanceOf(alice.address), beforeAliceA, "failed atomic settlement rolls back first user pull");
assert.equal(await tokenB.balanceOf(alice.address), beforeAliceB, "failed settlement creates no output");
await (await tokenB.connect(bob).approve(fairAddress, ethers.MaxUint256)).wait();
const settlement = await (await fair.connect(solverB).settleBatch(batch1, [bobIntent, aliceIntent])).wait();
assert(settlement.gasUsed < 6_000_000n, "two-Intent settlement stays within the explicit local gas ceiling");
assert.equal(await tokenA.balanceOf(alice.address), beforeAliceA - 100n * unit);
assert.equal(await tokenB.balanceOf(alice.address), beforeAliceB + 202n * unit, "uniform price plus 1% solver-funded rebate reaches user");
assert.equal(await tokenB.balanceOf(bob.address), beforeBobB - 160n * unit);
assert.equal(await tokenA.balanceOf(bob.address), beforeBobA + 80_800_000_000_000_000_000n);
assert.equal(await tokenA.balanceOf(fairAddress), 0n, "settlement contract retains no user token0");
assert.equal(await tokenB.balanceOf(fairAddress), 0n, "settlement contract retains no user token1");
assert.equal((await fair.solvers(solverB.address)).completed, 1n);
assert.equal(await fair.solverReputation(solverB.address), 100n, "successful settlement raises public reputation");
assert.equal((await fair.batchSchedule(batch1)).status, 3n, "batch is settled");
const settlementEvent = settlement.logs.map((log) => { try { return fair.interface.parseLog(log); } catch { return null; } }).find((event) => event?.name === "BatchSettled");
assert(settlementEvent, "settlement evidence event exists");
assert.equal(settlementEvent.args.externalInput1, 42n * unit, "solver supplies only net token1 deficit after CoW");
assert.equal(settlementEvent.args.solverOutput0, 19_200_000_000_000_000_000n, "solver receives only net token0 surplus");

// User cancellation after the intent phase aborts the batch and releases every solver bond.
const batch2 = await openBatch();
const cancelId = await submit(alice, batch2, await tokenA.getAddress(), 10n * unit, 19n * unit);
await advance(31);
const setHash2 = await fair.activeSetHash(batch2);
await commit(solverA, batch2, price, 0, setHash2, routeA, ethers.id("cancel-batch"));
assert.equal((await fair.solvers(solverA.address)).locked, bond);
await (await fair.connect(alice).cancelIntent(cancelId)).wait();
assert.equal((await fair.batchSchedule(batch2)).status, 4n, "late cancellation aborts instead of silently changing competition");
assert.equal((await fair.solvers(solverA.address)).locked, 0n, "aborted batch releases solver bond");

// Direct-address self trade is an objective fraud proof and slashes the winner.
const batch3 = await openBatch();
const selfIntent = await submit(solverA, batch3, await tokenA.getAddress(), 10n * unit, 19n * unit);
await advance(31);
const setHash3 = await fair.activeSetHash(batch3);
const selfSalt = ethers.id("self-trade-proof");
await commit(solverA, batch3, price, 0, setHash3, routeA, selfSalt);
await advance(31);
await (await fair.connect(solverA).revealSolution(batch3, price, 0, setHash3, routeA, selfSalt)).wait();
await advance(31);
await (await fair.finalizeWinner(batch3)).wait();
const solverABeforeFraud = await fair.solvers(solverA.address);
await (await fair.connect(challenger).proveWinningSolverSelfTrade(batch3, selfIntent)).wait();
const solverAAfterFraud = await fair.solvers(solverA.address);
assert.equal(solverAAfterFraud.bond, solverABeforeFraud.bond - bond);
assert.equal(solverAAfterFraud.fraud, solverABeforeFraud.fraud + 1n);
assert.equal(await fair.solverReputation(solverA.address), -100n, "proven fraud has an explicit reputation penalty");
assert.equal((await fair.batchSchedule(batch3)).status, 5n, "proven fraud fails the batch without touching user assets");

// A winner that does not settle is slashed; the user's assets remain recoverable.
const batch4 = await openBatch();
const timeoutIntent = await submit(alice, batch4, await tokenA.getAddress(), 10n * unit, 19n * unit);
await advance(31);
const setHash4 = await fair.activeSetHash(batch4);
const timeoutSalt = ethers.id("timeout");
await commit(solverB, batch4, price, 0, setHash4, routeA, timeoutSalt);
await advance(31);
await (await fair.connect(solverB).revealSolution(batch4, price, 0, setHash4, routeA, timeoutSalt)).wait();
await advance(31);
await (await fair.finalizeWinner(batch4)).wait();
const aliceBeforeTimeout = await tokenA.balanceOf(alice.address);
await advance(31);
await (await fair.timeoutBatch(batch4)).wait();
assert.equal(await tokenA.balanceOf(alice.address), aliceBeforeTimeout, "timeout never moves user assets");
assert.equal((await fair.batchSchedule(batch4)).status, 5n);
await (await fair.connect(alice).cancelIntent(timeoutIntent)).wait();
assert.equal((await fair.intents(timeoutIntent)).status, 2n, "failed-batch intent remains user-cancellable");

assert((await fair.treasuryCredit()) >= 3n * bond, "all slashing is publicly accounted to treasury credit");
const credit = await fair.treasuryCredit();
const contractNativeBefore = await ethers.provider.getBalance(fairAddress);
await (await fair.connect(treasury).withdrawTreasuryCredit()).wait();
assert.equal(await fair.treasuryCredit(), 0n);
assert.equal(await ethers.provider.getBalance(fairAddress), contractNativeBefore - credit, "treasury withdraws only accumulated slash credit");
await assert.rejects(fair.connect(alice).withdrawTreasuryCredit(), /Unauthorized|revert/);
const remainingBonds = (await fair.solvers(solverA.address)).bond + (await fair.solvers(solverB.address)).bond + (await fair.solvers(challenger.address)).bond;
assert.equal(await ethers.provider.getBalance(fairAddress), remainingBonds, "native balance equals solver bond ledger after slash withdrawal");

// Exact-delta settlement rejects taxed tokens atomically even if governance allow-lists one by mistake.
const taxed = await ethers.deployContract("FeeOnTransferDexToken");
const plain = await ethers.deployContract("MockDexToken", ["Fair Plain", "FPL"]);
await Promise.all([taxed.waitForDeployment(), plain.waitForDeployment()]);
const exoticFactory = await ethers.deployContract("YNXDexFactory", [governance.address, treasury.address, [await taxed.getAddress(), await plain.getAddress()]]);
await exoticFactory.waitForDeployment();
const exoticFair = await ethers.deployContract("YNXFairFlow", [governance.address, treasury.address, await exoticFactory.getAddress(), bond]);
await exoticFair.waitForDeployment();
const exoticAddress = await exoticFair.getAddress();
await (await taxed.mint(alice.address, 1_000n * unit)).wait();
await (await plain.mint(solverA.address, 1_000n * unit)).wait();
await (await taxed.connect(alice).approve(exoticAddress, ethers.MaxUint256)).wait();
await (await plain.connect(solverA).approve(exoticAddress, ethers.MaxUint256)).wait();
await (await exoticFair.connect(solverA).depositSolverBond({value:bond})).wait();
await (await exoticFair.connect(governance).openBatch(await taxed.getAddress(), await plain.getAddress(), 30, 30, 30, 30)).wait();
const exoticSchedule = await exoticFair.batchSchedule(1);
const exoticArgs = [1, await taxed.getAddress(), 100n * unit, 90n * unit, exoticSchedule.settleEnd + 300n];
const exoticIntent = await exoticFair.connect(alice).submitIntent.staticCall(...exoticArgs);
await (await exoticFair.connect(alice).submitIntent(...exoticArgs)).wait();
await advance(31);
const exoticSet = await exoticFair.activeSetHash(1);
const exoticSalt = ethers.id("taxed-token-reject");
const exoticCommitment = await exoticFair.computeCommitment(1, solverA.address, q96, 0, exoticSet, routeA, exoticSalt);
await (await exoticFair.connect(solverA).commitSolution(1, exoticCommitment)).wait();
await advance(31);
await (await exoticFair.connect(solverA).revealSolution(1, q96, 0, exoticSet, routeA, exoticSalt)).wait();
await advance(31);
await (await exoticFair.finalizeWinner(1)).wait();
const taxedBefore = await taxed.balanceOf(alice.address);
await assert.rejects(exoticFair.connect(solverA).settleBatch(1, [exoticIntent]), /TransferFailed|revert/);
assert.equal(await taxed.balanceOf(alice.address), taxedBefore, "taxed-token rejection rolls back user burn and transfer");
assert.equal(await taxed.balanceOf(exoticAddress), 0n);
assert.equal(await plain.balanceOf(exoticAddress), 0n);

console.log(`YNX FairFlow uniform batch/solver/adversarial: PASS (32 differential vectors, deploy gas ${fairDeployment.gasUsed}, two-Intent settlement gas ${settlement.gasUsed})`);
