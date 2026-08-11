import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.create({ network: "dexTest" });
const [controller, alice, bob, carol, dave, attacker] = await ethers.getSigners();

function ordered(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

function key(owner, lower, upper) {
  return `${owner.address.toLowerCase()}:${lower}:${upper}`;
}

function active(lower, upper) {
  return lower <= 0 && 0 < upper;
}

function expectedTicks(model) {
  const ticks = new Map();
  for (const position of model.values()) {
    if (position.liquidity === 0n) continue;
    for (const [tick, grossDelta, netDelta] of [
      [position.lower, position.liquidity, position.liquidity],
      [position.upper, position.liquidity, -position.liquidity],
    ]) {
      const current = ticks.get(tick) ?? { gross: 0n, net: 0n };
      current.gross += grossDelta;
      current.net += netDelta;
      ticks.set(tick, current);
    }
  }
  return ticks;
}

function expectedActive(model) {
  let total = 0n;
  for (const position of model.values()) {
    if (active(position.lower, position.upper)) total += position.liquidity;
  }
  return total;
}

async function collect(book, position) {
  const quoted = await book.connect(position.owner).collectAccounting.staticCall(position.lower, position.upper);
  await (await book.connect(position.owner).collectAccounting(position.lower, position.upper)).wait();
  return [quoted[0], quoted[1]];
}

const tokenA = await ethers.deployContract("MockDexToken", ["Concentrated A", "CLA"]);
const tokenB = await ethers.deployContract("MockDexToken", ["Concentrated B", "CLB"]);
await Promise.all([tokenA.waitForDeployment(), tokenB.waitForDeployment()]);
const [token0, token1] = ordered(await tokenA.getAddress(), await tokenB.getAddress());

await assert.rejects(
  ethers.deployContract("YNXConcentratedLiquidityBook", [token1, token0, 3_000, 60, 0]),
  /InvalidToken|revert/,
  "token order is immutable and canonical",
);
await assert.rejects(
  ethers.deployContract("YNXConcentratedLiquidityBook", [token0, token1, 0, 60, 0]),
  /InvalidFeeTier|revert/,
);
await assert.rejects(
  ethers.deployContract("YNXConcentratedLiquidityBook", [token0, token1, 10_001, 60, 0]),
  /InvalidFeeTier|revert/,
);
await assert.rejects(
  ethers.deployContract("YNXConcentratedLiquidityBook", [token0, token1, 3_000, 0, 0]),
  /InvalidTickSpacing|revert/,
);
await assert.rejects(
  ethers.deployContract("YNXConcentratedLiquidityBook", [token0, token1, 3_000, 60, 1]),
  /InvalidTickSpacing|revert/,
);

const emptyBook = await ethers.deployContract("YNXConcentratedLiquidityBook", [token0, token1, 3_000, 60, 0]);
await emptyBook.waitForDeployment();
await assert.rejects(emptyBook.recordFees(1, 1), /NoActiveLiquidity|revert/);

const book = await ethers.deployContract("YNXConcentratedLiquidityBook", [token0, token1, 3_000, 60, 0]);
const deploymentReceipt = await book.deploymentTransaction().wait();
await book.waitForDeployment();
assert.equal(await book.poolKind(), "ynx-concentrated-liquidity-book-v1");
assert.equal(await book.supportsSwaps(), false);
assert.equal(await book.supportsCallbacks(), false);
assert.equal(await book.custodiesTokens(), false);
assert.equal(await book.currentTick(), 0n);
assert.equal(await book.tickSpacing(), 60n);
assert.equal(await book.feePips(), 3_000n);
assert.equal(await book.controller(), controller.address);
const functions = book.interface.fragments.filter((fragment) => fragment.type === "function").map((fragment) => fragment.name);
const callbackEntrypoints = functions.filter((name) => name !== "supportsCallbacks" && /callback/i.test(name));
assert(!functions.includes("swap") && callbackEntrypoints.length === 0, "accounting slice exposes no swap or callback entrypoint");

await assert.rejects(book.connect(alice).mintPosition(-61, 60, 1), /InvalidRange|revert/);
await assert.rejects(book.connect(alice).mintPosition(60, 60, 1), /InvalidRange|revert/);
await assert.rejects(book.connect(alice).mintPosition(-60, 60, 0), /InvalidLiquidity|revert/);
await assert.rejects(book.connect(alice).burnPosition(-60, 60, 1), /InsufficientLiquidity|revert/);

const model = new Map();
const basePositions = [
  { owner: alice, lower: -120, upper: 120, liquidity: 1_000_000n },
  { owner: bob, lower: -60, upper: 60, liquidity: 3_000_000n },
  { owner: carol, lower: 60, upper: 180, liquidity: 2_000_000n },
];
for (const position of basePositions) {
  await (await book.connect(position.owner).mintPosition(position.lower, position.upper, position.liquidity)).wait();
  model.set(key(position.owner, position.lower, position.upper), { ...position });
}
assert.equal(await book.activeLiquidity(), 4_000_000n);
await assert.rejects(book.connect(attacker).recordFees(4_000_000, 8_000_000), /Unauthorized|revert/);
await (await book.recordFees(4_000_000, 8_000_000)).wait();

const aliceInitial = await book.getPosition(alice.address, -120, 120);
const bobInitial = await book.getPosition(bob.address, -60, 60);
const carolInitial = await book.getPosition(carol.address, 60, 180);
assert.deepEqual([aliceInitial.pending0, aliceInitial.pending1], [1_000_000n, 2_000_000n]);
assert.deepEqual([bobInitial.pending0, bobInitial.pending1], [3_000_000n, 6_000_000n]);
assert.deepEqual([carolInitial.pending0, carolInitial.pending1], [0n, 0n], "inactive range earns no fee growth");

const davePosition = { owner: dave, lower: -180, upper: 180, liquidity: 2_000_000n };
await (await book.connect(dave).mintPosition(davePosition.lower, davePosition.upper, davePosition.liquidity)).wait();
model.set(key(dave, davePosition.lower, davePosition.upper), davePosition);
assert.deepEqual(await collect(book, davePosition), [0n, 0n], "new range cannot claim historical fees");
await (await book.recordFees(6_000_000, 12_000_000)).wait();

let exactCollected0 = 0n;
let exactCollected1 = 0n;
for (const position of model.values()) {
  const [amount0, amount1] = await collect(book, position);
  exactCollected0 += amount0;
  exactCollected1 += amount1;
}
assert.equal(exactCollected0, 10_000_000n);
assert.equal(exactCollected1, 20_000_000n);
assert.equal(await book.totalRecordedFees0(), 10_000_000n);
assert.equal(await book.totalRecordedFees1(), 20_000_000n);
assert.equal(await book.totalCollectedAccounting0(), 10_000_000n);
assert.equal(await book.totalCollectedAccounting1(), 20_000_000n);

const vectorPositions = [
  ...model.values(),
  { owner: alice, lower: -240, upper: -120, liquidity: 0n },
  { owner: bob, lower: 120, upper: 240, liquidity: 0n },
  { owner: carol, lower: -180, upper: 60, liquidity: 0n },
];
for (const position of vectorPositions) {
  model.set(key(position.owner, position.lower, position.upper), position);
}

let seed = 0x9e3779b9n;
const next = () => {
  seed ^= seed << 13n;
  seed ^= seed >> 17n;
  seed ^= seed << 5n;
  seed &= 0xffff_ffffn;
  return seed;
};

const knownTicks = new Set(vectorPositions.flatMap((position) => [position.lower, position.upper]));
for (let index = 1; index <= 64; index += 1) {
  const position = vectorPositions[Number(next() % BigInt(vectorPositions.length))];
  const delta = 1n + (next() % 10_000n);
  const shouldMint = position.liquidity < delta || (next() & 1n) === 0n;
  if (shouldMint) {
    await (await book.connect(position.owner).mintPosition(position.lower, position.upper, delta)).wait();
    position.liquidity += delta;
  } else {
    await (await book.connect(position.owner).burnPosition(position.lower, position.upper, delta)).wait();
    position.liquidity -= delta;
  }
  assert.equal(await book.activeLiquidity(), expectedActive(model), `active-liquidity invariant ${index}`);
  const ticks = expectedTicks(model);
  for (const tick of knownTicks) {
    const actual = await book.tickInfo(tick);
    const expected = ticks.get(tick) ?? { gross: 0n, net: 0n };
    assert.equal(actual.liquidityGross, expected.gross, `tick gross ${tick} vector ${index}`);
    assert.equal(actual.liquidityNet, expected.net, `tick net ${tick} vector ${index}`);
    assert.equal(actual.initialized, expected.gross !== 0n, `tick initialized ${tick} vector ${index}`);
  }
  const state = await book.getPosition(position.owner.address, position.lower, position.upper);
  assert.equal(state.liquidity, position.liquidity, `position liquidity vector ${index}`);
}

let feeVectorCollected0 = 0n;
let feeVectorCollected1 = 0n;
for (let index = 1n; index <= 32n; index += 1n) {
  const activeLiquidity = expectedActive(model);
  assert(activeLiquidity > 0n);
  const amount0 = activeLiquidity * index;
  const amount1 = activeLiquidity * (index + 1n);
  await (await book.recordFees(amount0, amount1)).wait();
  let round0 = 0n;
  let round1 = 0n;
  for (const position of model.values()) {
    const [collected0, collected1] = await collect(book, position);
    round0 += collected0;
    round1 += collected1;
  }
  assert.equal(round0, amount0, `exact fee conservation token0 vector ${index}`);
  assert.equal(round1, amount1, `exact fee conservation token1 vector ${index}`);
  feeVectorCollected0 += round0;
  feeVectorCollected1 += round1;
}
assert((await book.totalCollectedAccounting0()) <= (await book.totalRecordedFees0()));
assert((await book.totalCollectedAccounting1()) <= (await book.totalRecordedFees1()));
assert.equal(await book.globalRoundingDust0(), 0n, "exact vectors produce no global token0 dust");
assert.equal(await book.globalRoundingDust1(), 0n, "exact vectors produce no global token1 dust");

for (let index = 1; index <= 16; index += 1) {
  const activeLiquidity = expectedActive(model);
  const amount0 = 1n + (next() % activeLiquidity);
  const amount1 = 1n + (next() % activeLiquidity);
  const recorded0Before = await book.totalRecordedFees0();
  const recorded1Before = await book.totalRecordedFees1();
  const collected0Before = await book.totalCollectedAccounting0();
  const collected1Before = await book.totalCollectedAccounting1();
  await (await book.recordFees(amount0, amount1)).wait();
  for (const position of model.values()) await collect(book, position);
  const recorded0Delta = (await book.totalRecordedFees0()) - recorded0Before;
  const recorded1Delta = (await book.totalRecordedFees1()) - recorded1Before;
  const collected0Delta = (await book.totalCollectedAccounting0()) - collected0Before;
  const collected1Delta = (await book.totalCollectedAccounting1()) - collected1Before;
  assert.equal(recorded0Delta, amount0, `arbitrary fee record token0 vector ${index}`);
  assert.equal(recorded1Delta, amount1, `arbitrary fee record token1 vector ${index}`);
  assert(collected0Delta <= amount0, `round-down conservation token0 vector ${index}`);
  assert(collected1Delta <= amount1, `round-down conservation token1 vector ${index}`);
}
assert((await book.totalCollectedAccounting0()) <= (await book.totalRecordedFees0()));
assert((await book.totalCollectedAccounting1()) <= (await book.totalRecordedFees1()));

const reentrant = await ethers.deployContract("ReentrantDexToken");
const taxed = await ethers.deployContract("FeeOnTransferDexToken");
await Promise.all([reentrant.waitForDeployment(), taxed.waitForDeployment()]);
const [hostile0, hostile1] = ordered(await reentrant.getAddress(), await taxed.getAddress());
const hostileBook = await ethers.deployContract("YNXConcentratedLiquidityBook", [hostile0, hostile1, 500, 10, 0]);
await hostileBook.waitForDeployment();
await (await hostileBook.connect(alice).mintPosition(-10, 10, 1_000)).wait();
await (await hostileBook.recordFees(1_000, 2_000)).wait();
assert.equal(await reentrant.balanceOf(await hostileBook.getAddress()), 0n);
assert.equal(await taxed.balanceOf(await hostileBook.getAddress()), 0n);
assert.equal(await hostileBook.custodiesTokens(), false, "hostile token identities never become custody claims");

await assert.rejects(book.connect(alice).burnPosition(-120, 120, 2n ** 127n), /InsufficientLiquidity|InvalidLiquidity|revert/);

console.log(
  `YNX concentrated-liquidity accounting core: PASS (64 stateful tick/range vectors + 32 exact + 16 arbitrary round-down fee vectors, deploy gas ${deploymentReceipt.gasUsed}, exact vector fees ${feeVectorCollected0}/${feeVectorCollected1})`,
);
