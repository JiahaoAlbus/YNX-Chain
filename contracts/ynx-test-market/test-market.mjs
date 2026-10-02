import assert from "node:assert/strict";
import hre from "hardhat";

const { ethers } = await hre.network.connect();
assert.equal((await ethers.provider.getNetwork()).chainId, 6423n);
const [admin, seller, buyer, treasury, outsider] = await ethers.getSigners();
const Asset = await ethers.getContractFactory("TestAsset");
const stock = await Asset.deploy("YNX Test AAPL", "TEST-AAPL", 1_000_000_000_000n, admin.address, admin.address);
const tusd = await Asset.deploy("YNX Test USD", "tUSD", 10_000_000_000_000n, admin.address, admin.address);
await Promise.all([stock.waitForDeployment(), tusd.waitForDeployment()]);
const DvP = await ethers.getContractFactory("TestDvP");
const codeHash = async (contract) => ethers.keccak256(await ethers.provider.getCode(await contract.getAddress()));
const deployDvP = async (stockToken, cashToken, feeRecipient = treasury.address) => {
  const settlement = await DvP.deploy(await stockToken.getAddress(), await cashToken.getAddress(),
    await codeHash(stockToken), await codeHash(cashToken), feeRecipient, 25n);
  await settlement.waitForDeployment();
  return settlement;
};
const dvp = await deployDvP(stock, tusd);
await dvp.waitForDeployment();

const orderTypes = {
  Order: [
    { name: "seller", type: "address" }, { name: "buyer", type: "address" },
    { name: "shares", type: "uint256" }, { name: "quote", type: "uint256" },
    { name: "expiry", type: "uint256" }, { name: "sellerNonce", type: "uint256" },
    { name: "buyerNonce", type: "uint256" }, { name: "salt", type: "bytes32" },
  ],
};
const domain = { name: "YNX Test Market DvP", version: "1", chainId: 6423, verifyingContract: await dvp.getAddress() };
const makeOrder = async (nonce, overrides = {}) => ({
  seller: seller.address, buyer: buyer.address, shares: 100_000_000n, quote: 200_000_000n,
  expiry: BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600),
  sellerNonce: nonce, buyerNonce: nonce,
  salt: ethers.keccak256(ethers.toUtf8Bytes(`test-order-${nonce}`)), ...overrides,
});
const signatures = async (order) => [await seller.signTypedData(domain, orderTypes, order), await buyer.signTypedData(domain, orderTypes, order)];
const expectRevert = async (promise, label) => {
  let reverted = false;
  try {
    const result = await promise;
    if (typeof result.waitForDeployment === "function") await result.waitForDeployment();
    else await result.wait();
  } catch { reverted = true; }
  assert.ok(reverted, `expected revert: ${label}`);
};
await expectRevert(DvP.deploy(await stock.getAddress(), await tusd.getAddress(), ethers.ZeroHash, await codeHash(tusd), treasury.address, 25n), "approved stock code hash required");
await expectRevert(DvP.deploy(await stock.getAddress(), await tusd.getAddress(), await codeHash(tusd), await codeHash(stock), treasury.address, 25n), "wrong nonzero asset code hashes rejected");
const snapshot = async () => [await stock.balanceOf(seller.address), await stock.balanceOf(buyer.address),
  await tusd.balanceOf(seller.address), await tusd.balanceOf(buyer.address), await tusd.balanceOf(treasury.address)];

await (await stock.mint(seller.address, 500_000_000n)).wait();
await (await tusd.mint(buyer.address, 1_000_000_000n)).wait();
assert.equal(await stock.totalSupply(), 500_000_000n);
await expectRevert(stock.connect(outsider).mint(outsider.address, 1n), "issuer role");
await expectRevert(stock.mint(seller.address, 1_000_000_000_000n), "inventory cap");
await (await stock.connect(seller).approve(await dvp.getAddress(), 500_000_000n)).wait();
await (await tusd.connect(buyer).approve(await dvp.getAddress(), 1_000_000_000n)).wait();

const FalseToken = await ethers.getContractFactory("MockFalseToken");
const falseStockToken = await FalseToken.deploy(false);
const falseCashToken = await FalseToken.deploy(true);
await Promise.all([falseStockToken.waitForDeployment(), falseCashToken.waitForDeployment()]);
const falseStockDvP = await deployDvP(falseStockToken, tusd);
await falseStockDvP.waitForDeployment();
const falseCashDvP = await deployDvP(stock, falseCashToken);
await falseCashDvP.waitForDeployment();
const badOrder = await makeOrder(6n);
const signFor = async (settlement, value) => {
  const localDomain = { ...domain, verifyingContract: await settlement.getAddress() };
  return [await seller.signTypedData(localDomain, orderTypes, value), await buyer.signTypedData(localDomain, orderTypes, value)];
};
const [badStockSeller, badStockBuyer] = await signFor(falseStockDvP, badOrder);
const beforeFalse = await snapshot();
await expectRevert(falseStockDvP.fill(badOrder, 1_000_000n, badStockSeller, badStockBuyer), "false-return stock");
assert.deepEqual(await snapshot(), beforeFalse);

const NoopToken = await ethers.getContractFactory("MockNoopToken");
const noopStockToken = await NoopToken.deploy(false);
const noopCashToken = await NoopToken.deploy(true);
await Promise.all([noopStockToken.waitForDeployment(), noopCashToken.waitForDeployment()]);
const noopStockDvP = await deployDvP(noopStockToken, tusd);
const noopCashDvP = await deployDvP(stock, noopCashToken);
const [noopStockSeller, noopStockBuyer] = await signFor(noopStockDvP, badOrder);
await (await tusd.connect(buyer).approve(await noopStockDvP.getAddress(), 1_000_000n)).wait();
await expectRevert(noopStockDvP.fill(badOrder, 1_000_000n, noopStockSeller, noopStockBuyer), "true-return no-op stock");
assert.equal(await noopStockDvP.filledShares(await noopStockDvP.orderHash(badOrder)), 0n);
const [noopCashSeller, noopCashBuyer] = await signFor(noopCashDvP, badOrder);
await (await stock.connect(seller).approve(await noopCashDvP.getAddress(), 1_000_000n)).wait();
await expectRevert(noopCashDvP.fill(badOrder, 1_000_000n, noopCashSeller, noopCashBuyer), "true-return no-op cash rolls back stock");
assert.deepEqual(await snapshot(), beforeFalse);
assert.equal(await noopCashDvP.filledShares(await noopCashDvP.orderHash(badOrder)), 0n);

const buyerFeeDvP = await deployDvP(stock, tusd, buyer.address);
const [buyerFeeSeller, buyerFeeBuyer] = await signFor(buyerFeeDvP, badOrder);
await expectRevert(buyerFeeDvP.fill(badOrder, 1_000_000n, buyerFeeSeller, buyerFeeBuyer), "buyer cannot collect their own reported fee");
assert.equal(await buyerFeeDvP.filledShares(await buyerFeeDvP.orderHash(badOrder)), 0n);
const sellerFeeDvP = await deployDvP(stock, tusd, seller.address);
const [sellerFeeSeller, sellerFeeBuyer] = await signFor(sellerFeeDvP, badOrder);
await expectRevert(sellerFeeDvP.fill(badOrder, 1_000_000n, sellerFeeSeller, sellerFeeBuyer), "seller cannot also collect separately reported fee");
assert.equal(await sellerFeeDvP.filledShares(await sellerFeeDvP.orderHash(badOrder)), 0n);
const [badCashSeller, badCashBuyer] = await signFor(falseCashDvP, badOrder);
await (await stock.connect(seller).approve(await falseCashDvP.getAddress(), 1_000_000n)).wait();
await expectRevert(falseCashDvP.fill(badOrder, 1_000_000n, badCashSeller, badCashBuyer), "false-return cash rolls back stock");
assert.deepEqual(await snapshot(), beforeFalse);

const order = await makeOrder(1n);
const [sellerSig, buyerSig] = await signatures(order);
assert.equal(await dvp.orderHash(order), ethers.TypedDataEncoder.hash(domain, orderTypes, order));
await expectRevert(dvp.fill(order, 1n, sellerSig, sellerSig), "both distinct signatures required");
await (await dvp.fill(order, 40_000_000n, sellerSig, buyerSig)).wait();
assert.deepEqual(await snapshot(), [460_000_000n, 40_000_000n, 80_000_000n, 919_800_000n, 200_000n]);
await (await dvp.fill(order, 60_000_000n, sellerSig, buyerSig)).wait();
assert.deepEqual(await snapshot(), [400_000_000n, 100_000_000n, 200_000_000n, 799_500_000n, 500_000n]);
await expectRevert(dvp.fill(order, 1n, sellerSig, buyerSig), "filled replay");
assert.equal(await dvp.filledShares(await dvp.orderHash(order)), 100_000_000n);

const cancelled = await makeOrder(2n);
const [cancelSeller, cancelBuyer] = await signatures(cancelled);
await (await dvp.connect(buyer).cancel(cancelled)).wait();
await expectRevert(dvp.fill(cancelled, 1_000_000n, cancelSeller, cancelBuyer), "buyer cancelled");
await expectRevert(dvp.connect(outsider).cancel(await makeOrder(3n)), "outsider cancel");
await (await dvp.connect(seller).invalidateNonce(3n, true)).wait();
const invalidated = await makeOrder(3n);
const [invalidSeller, invalidBuyer] = await signatures(invalidated);
await expectRevert(dvp.fill(invalidated, 1_000_000n, invalidSeller, invalidBuyer), "seller nonce invalidation");

const noAllowance = await makeOrder(4n);
const [noAllowanceSeller, noAllowanceBuyer] = await signatures(noAllowance);
await (await stock.connect(seller).approve(await dvp.getAddress(), 0n)).wait();
const beforeFailed = await snapshot();
await expectRevert(dvp.fill(noAllowance, 1_000_000n, noAllowanceSeller, noAllowanceBuyer), "stock allowance rollback");
assert.deepEqual(await snapshot(), beforeFailed);
assert.equal(await dvp.filledShares(await dvp.orderHash(noAllowance)), 0n);
await (await stock.connect(seller).approve(await dvp.getAddress(), 500_000_000n)).wait();
await (await tusd.connect(buyer).approve(await dvp.getAddress(), 0n)).wait();
await expectRevert(dvp.fill(noAllowance, 1_000_000n, noAllowanceSeller, noAllowanceBuyer), "cash allowance rollback");
assert.deepEqual(await snapshot(), beforeFailed);
await (await tusd.connect(buyer).approve(await dvp.getAddress(), 1_000_000_000n)).wait();

const spendable = await tusd.balanceOf(buyer.address);
await (await tusd.connect(buyer).transfer(outsider.address, spendable)).wait();
const beforeNoFunds = await snapshot();
await expectRevert(dvp.fill(noAllowance, 1_000_000n, noAllowanceSeller, noAllowanceBuyer), "insufficient cash rollback");
assert.deepEqual(await snapshot(), beforeNoFunds);
assert.equal(await dvp.filledShares(await dvp.orderHash(noAllowance)), 0n);
await (await tusd.mint(buyer.address, 5_000_000_000n)).wait();
await (await tusd.connect(buyer).approve(await dvp.getAddress(), 5_000_000_000n)).wait();

const past = await makeOrder(5n, { expiry: 1n });
const [pastSeller, pastBuyer] = await signatures(past);
await expectRevert(dvp.fill(past, 1_000_000n, pastSeller, pastBuyer), "expired");
const changed = { ...noAllowance, quote: noAllowance.quote + 1n };
await expectRevert(dvp.fill(changed, 1_000_000n, noAllowanceSeller, noAllowanceBuyer), "order tamper");

// Deterministic property sweep: every positive partition settles the same
// total stock, quote and fee, regardless of fill count or ordering.
await (await stock.mint(seller.address, 2_000_000_000n)).wait();
await (await stock.connect(seller).approve(await dvp.getAddress(), 3_000_000_000n)).wait();
for (let nonce = 10n; nonce < 26n; nonce++) {
  const propertyOrder = await makeOrder(nonce, { quote: 201_000_003n });
  const [sellerProof, buyerProof] = await signatures(propertyOrder);
  const starting = await snapshot();
  const a = (nonce * 17_123n % 30_000_000n) + 1n;
  const b = (nonce * 31_337n % 30_000_000n) + 1n;
  const c = 100_000_000n - a - b;
  for (const part of [a, b, c]) await (await dvp.fill(propertyOrder, part, sellerProof, buyerProof)).wait();
  const ending = await snapshot();
  const fee = propertyOrder.quote * 25n / 10_000n;
  assert.deepEqual(ending, [starting[0] - propertyOrder.shares, starting[1] + propertyOrder.shares,
    starting[2] + propertyOrder.quote, starting[3] - propertyOrder.quote - fee, starting[4] + fee]);
  assert.equal(await dvp.filledShares(await dvp.orderHash(propertyOrder)), propertyOrder.shares);
  await expectRevert(dvp.fill(propertyOrder, 1n, sellerProof, buyerProof), "property overfill");
}

const partialCancel = await makeOrder(30n);
const [partialSeller, partialBuyer] = await signatures(partialCancel);
await (await dvp.fill(partialCancel, 10_000_000n, partialSeller, partialBuyer)).wait();
const beforeCancel = await snapshot();
await (await dvp.connect(seller).cancel(partialCancel)).wait();
await expectRevert(dvp.fill(partialCancel, 90_000_000n, partialSeller, partialBuyer), "cancel after partial fill");
assert.deepEqual(await snapshot(), beforeCancel);

await (await stock.connect(buyer).redeem(1_000_000n)).wait();
assert.equal(await stock.totalSupply(), 2_499_000_000n);
await (await stock.connect(buyer).approve(admin.address, 1_000_000n)).wait();
await (await stock.redeemFrom(buyer.address, 1_000_000n)).wait();
assert.equal(await stock.totalSupply(), 2_498_000_000n);
await (await stock.setPaused(true)).wait();
await expectRevert(stock.connect(seller).transfer(buyer.address, 1n), "asset pause");
await (await stock.setPaused(false)).wait();

console.log(JSON.stringify({ status: "PASS", chainId: 6423, tests: "bilateral signatures, 16 partition properties, exact balance deltas, fee reconciliation, replay, cancellation race, expiry, nonce, insufficient funds and allowance, false/no-op ERC20 returns, self-fee rejection, atomic rollback, bounded mint/redeem, pause", contracts: 3 }));
