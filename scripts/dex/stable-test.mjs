import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.create({ network: "dexTest" });
const [governance, lp, trader, feeRecipient, attacker] = await ethers.getSigners();
const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);

function difference(a, b) { return a >= b ? a - b : b - a; }
function invariant(x, y, amplification) {
  const sum = x + y;if (sum === 0n) return 0n;let d = sum;const ann = amplification * 2n;
  for (let i = 0; i < 255; i++) {const previous=d;let dp=d*d/(x*2n);dp=dp*d/(y*2n);d=(ann*sum+dp*2n)*d/((ann-1n)*d+dp*3n);if(difference(d,previous)<=1n)return d;}
  throw new Error("invariant did not converge");
}
function getY(known, d, amplification) {
  const ann=amplification*2n;let c=d*d/(known*2n);c=c*d/(ann*2n);const b=known+d/ann;let y=d;
  for(let i=0;i<255;i++){const previous=y;y=(y*y+c)/(2n*y+b-d);if(difference(y,previous)<=1n)return y;}
  throw new Error("y did not converge");
}
function amountOut(amountIn,reserveIn,reserveOut,multiplierIn,multiplierOut,amplification,feeBps){
  const x=reserveIn*multiplierIn,y=reserveOut*multiplierOut,d=invariant(x,y,amplification);const effective=amountIn*(10_000n-feeBps)/10_000n;const after=getY(x+effective*multiplierIn,d,amplification);return (y-after-1n)/multiplierOut;
}

const token18 = await ethers.deployContract("MockDecimalsDexToken", ["Stable 18", "S18", 18]);
const token6 = await ethers.deployContract("MockDecimalsDexToken", ["Stable 6", "S6", 6]);
const token8 = await ethers.deployContract("MockDecimalsDexToken", ["Stable 8", "S8", 8]);
await Promise.all([token18.waitForDeployment(), token6.waitForDeployment(),token8.waitForDeployment()]);
const token18Address=await token18.getAddress(),token6Address=await token6.getAddress(),token8Address=await token8.getAddress();
const factory = await ethers.deployContract("YNXStableFactory", [governance.address, feeRecipient.address, [token18Address,token6Address,token8Address]]);
const factoryReceipt = await factory.deploymentTransaction().wait();
const router = await ethers.deployContract("YNXDexRouter", [await factory.getAddress()]);
const quoter = await ethers.deployContract("YNXDexQuoter", [await router.getAddress()]);
await Promise.all([factory.waitForDeployment(),router.waitForDeployment(),quoter.waitForDeployment()]);
const createReceipt=await (await factory.createPool(token18Address,token6Address,200,4)).wait();
await(await factory.createPool(token6Address,token8Address,200,4)).wait();
const poolAddress=await factory.getPool(token18Address,token6Address);const pool=await ethers.getContractAt("YNXStablePool",poolAddress);
assert.equal(await pool.poolKind(),"ynx-stableswap-v1");assert.equal(await pool.amplification(),200n);assert.equal(await pool.baseSwapFeeBps(),4n);
await assert.rejects(factory.connect(attacker).createPool(token18Address,token6Address,100,4),/Unauthorized|revert/,"unreviewed actors cannot front-run immutable pool parameters");
assert.equal(await pool.precisionMultiplier0(),(await pool.token0()).toLowerCase()===token6Address.toLowerCase()?10n**12n:1n,"decimal normalization is ordered with tokens");

for(const [token,lpAmount,traderAmount] of [[token18,2_000_000n*E18,200_000n*E18],[token6,3_000_000n*E6,300_000n*E6],[token8,2_000_000n*10n**8n,200_000n*10n**8n]]){
  await (await token.mint(lp.address,lpAmount)).wait();await (await token.mint(trader.address,traderAmount)).wait();
  await (await token.connect(lp).approve(await router.getAddress(),ethers.MaxUint256)).wait();await (await token.connect(trader).approve(await router.getAddress(),ethers.MaxUint256)).wait();
}
await (await router.connect(lp).addLiquidity(token18Address,token6Address,1_000_000n*E18,1_000_000n*E6,lp.address,deadline)).wait();
await (await router.connect(lp).addLiquidity(token6Address,token8Address,1_000_000n*E6,1_000_000n*10n**8n,lp.address,deadline)).wait();
assert((await pool.currentInvariant())>0n,"normalized stable invariant is initialized");

const amountIn=1_000n*E18;const quoted=await quoter.quoteExactInput(amountIn,[token18Address,token6Address]);
assert(quoted[1]>999n*E6&&quoted[1]<1_000n*E6,"amplified pool is capital-efficient near peg without promising a peg");
const beforeOut=await token6.balanceOf(trader.address);const invariantBefore=await pool.currentInvariant();
const swapReceipt=await (await router.connect(trader).swapExactInput(amountIn,quoted[1],[token18Address,token6Address],trader.address,deadline)).wait();
assert.equal((await token6.balanceOf(trader.address))-beforeOut,quoted[1],"exact input settles its stable quote");
assert((await pool.currentInvariant())>=invariantBefore,"D invariant cannot decrease after a successful swap");
assert((await pool.protocolFees0())+(await pool.protocolFees1())>0n,"published protocol share accrues separately");

const wanted=250n*E18;const exactOutput=await quoter.quoteExactOutput(wanted,[token6Address,token18Address]);
assert(exactOutput[0]>0n,"exact-output input is bounded");const before18=await token18.balanceOf(trader.address);
assert((await pool.getAmountOutFor(token6Address,exactOutput[0]))>=wanted,"exact-output inverse reaches its target");
if(exactOutput[0]>1n)assert((await pool.getAmountOutFor(token6Address,exactOutput[0]-1n))<wanted,"exact-output inverse is minimal");
await (await router.connect(trader).swapExactOutput(wanted,exactOutput[0],[token6Address,token18Address],trader.address,deadline)).wait();
assert((await token18.balanceOf(trader.address))-before18>=wanted,"exact output delivers at least the requested amount");
const multiInput=500n*E18;const multiQuote=await quoter.quoteExactInput(multiInput,[token18Address,token6Address,token8Address]);const before8=await token8.balanceOf(trader.address);await(await router.connect(trader).swapExactInput(multiInput,multiQuote[2],[token18Address,token6Address,token8Address],trader.address,deadline)).wait();assert.equal((await token8.balanceOf(trader.address))-before8,multiQuote[2],"typed StableSwap pools compose through bounded multi-hop routing");

let [raw0,raw1]=await pool.getReserves();const multiplier0=await pool.precisionMultiplier0(),multiplier1=await pool.precisionMultiplier1();
for(let index=1n;index<=64n;index++){
  const input=index*1_234_567n+index*index*97n;const expected=amountOut(input,raw0,raw1,multiplier0,multiplier1,200n,4n);
  assert.equal(await pool.getAmountOutFor(await pool.token0(),input),expected,`stable differential vector ${index}`);
}

for(let index=1n;index<=32n;index++){
  const zeroForOne=index%2n===1n;const input=zeroForOne?(index*7n+1n)*E18:(index*7n+1n)*E6;const path=zeroForOne?[token18Address,token6Address]:[token6Address,token18Address];
  const before=await pool.currentInvariant();const statefulQuote=await router.quoteExactInput(input,path);await (await router.connect(trader).swapExactInput(input,statefulQuote[1],path,trader.address,deadline)).wait();const after=await pool.currentInvariant();assert(after>=before,`stateful D invariant ${index}`);
}

const lpShares=await pool.balanceOf(lp.address);await (await pool.connect(lp).approve(await router.getAddress(),lpShares)).wait();
const lp18Before=await token18.balanceOf(lp.address);await (await router.connect(lp).removeLiquidity(token18Address,token6Address,lpShares/10n,1n,1n,lp.address,deadline)).wait();assert((await token18.balanceOf(lp.address))>lp18Before,"permissionless proportional exit returns assets");
const lpBalanceBeforeFailure=await token18.balanceOf(lp.address);
await assert.rejects(router.connect(lp).addLiquidity(token18Address,token6Address,10_000n*E18,1n*E6,lp.address,deadline),/ImbalancedDeposit|revert/);
assert.equal(await token18.balanceOf(lp.address),lpBalanceBeforeFailure,"imbalanced LP dilution attempt rolls back atomically");
await ethers.provider.send("evm_increaseTime",[60]);await ethers.provider.send("evm_mine",[]);const [cumulative0,cumulative1]=await pool.currentCumulativePrices();assert(cumulative0>0n&&cumulative1>0n,"balance-ratio TWAP accumulators advance without claiming an external peg");
await assert.rejects(factory.createPool(token18Address,token6Address,200,4),/PoolExists|revert/);await assert.rejects(factory.connect(governance).createPool(token18Address,token6Address,9,4),/InvalidParameters|revert/);

const safe=await ethers.deployContract("MockDexToken",["Safe","SAFE"]),reentrant=await ethers.deployContract("ReentrantDexToken");await Promise.all([safe.waitForDeployment(),reentrant.waitForDeployment()]);
await assert.rejects(ethers.deployContract("YNXStableFactory",[governance.address,feeRecipient.address,[await safe.getAddress(),await safe.getAddress()]]),/InvalidToken|revert/,"duplicate reviewed-token entries reject");
const attackFactory=await ethers.deployContract("YNXStableFactory",[governance.address,feeRecipient.address,[await safe.getAddress(),await reentrant.getAddress()]]);await attackFactory.waitForDeployment();const attackRouter=await ethers.deployContract("YNXDexRouter",[await attackFactory.getAddress()]);await attackRouter.waitForDeployment();await (await attackFactory.createPool(await safe.getAddress(),await reentrant.getAddress(),100,4)).wait();const attackPool=await attackFactory.getPool(await safe.getAddress(),await reentrant.getAddress());
for(const token of [safe,reentrant]){await(await token.mint(lp.address,100_000n*E18)).wait();await(await token.connect(lp).approve(await attackRouter.getAddress(),ethers.MaxUint256)).wait();}await(await safe.mint(trader.address,1_000n*E18)).wait();await(await safe.connect(trader).approve(await attackRouter.getAddress(),ethers.MaxUint256)).wait();await(await attackRouter.connect(lp).addLiquidity(await safe.getAddress(),await reentrant.getAddress(),50_000n*E18,50_000n*E18,lp.address,deadline)).wait();await(await reentrant.configureAttack(attackPool,ethers.getBytes(ethers.id("sync()").slice(0,10)),true)).wait();await assert.rejects(attackRouter.connect(trader).swapExactInput(10n*E18,1n,[await safe.getAddress(),await reentrant.getAddress()],trader.address,deadline),/TransferFailed|reentrant|revert/);assert.equal(await reentrant.balanceOf(trader.address),0n,"reentrant stable output rolls back");
const attackStable=await ethers.getContractAt("YNXStablePool",attackPool);await assert.rejects(attackStable.getAmountOut(1n,50_000n*E18,50_000n*E18),/InvalidConfiguration|revert/,"ambiguous reserve-only quote rejects; token-specific quote is mandatory");

const taxed=await ethers.deployContract("FeeOnTransferDexToken"),plain=await ethers.deployContract("MockDexToken",["Plain","PLN"]);await Promise.all([taxed.waitForDeployment(),plain.waitForDeployment()]);const taxedFactory=await ethers.deployContract("YNXStableFactory",[governance.address,feeRecipient.address,[await taxed.getAddress(),await plain.getAddress()]]);await taxedFactory.waitForDeployment();const taxedRouter=await ethers.deployContract("YNXDexRouter",[await taxedFactory.getAddress()]);await taxedRouter.waitForDeployment();await(await taxedFactory.createPool(await taxed.getAddress(),await plain.getAddress(),100,4)).wait();for(const token of [taxed,plain]){await(await token.mint(lp.address,100_000n*E18)).wait();await(await token.connect(lp).approve(await taxedRouter.getAddress(),ethers.MaxUint256)).wait();}await(await taxed.mint(trader.address,1_000n*E18)).wait();await(await taxed.connect(trader).approve(await taxedRouter.getAddress(),ethers.MaxUint256)).wait();await(await taxedRouter.connect(lp).addLiquidity(await taxed.getAddress(),await plain.getAddress(),50_000n*E18,50_000n*E18,lp.address,deadline)).wait();const taxedPath=[await taxed.getAddress(),await plain.getAddress()];const taxedQuote=await taxedRouter.quoteExactInput(100n*E18,taxedPath);const taxedBefore=await taxed.balanceOf(trader.address);await assert.rejects(taxedRouter.connect(trader).swapExactInput(100n*E18,taxedQuote[1],taxedPath,trader.address,deadline),/InsufficientOutput|revert/);assert.equal(await taxed.balanceOf(trader.address),taxedBefore,"taxed input failure is atomic");

const rebasing=await ethers.deployContract("RebasingDexToken"),pair=await ethers.deployContract("MockDexToken",["Pair","PAIR"]);await Promise.all([rebasing.waitForDeployment(),pair.waitForDeployment()]);const rebaseFactory=await ethers.deployContract("YNXStableFactory",[governance.address,feeRecipient.address,[await rebasing.getAddress(),await pair.getAddress()]]);await rebaseFactory.waitForDeployment();const rebaseRouter=await ethers.deployContract("YNXDexRouter",[await rebaseFactory.getAddress()]);await rebaseRouter.waitForDeployment();await(await rebaseFactory.createPool(await rebasing.getAddress(),await pair.getAddress(),100,4)).wait();for(const token of [rebasing,pair]){await(await token.mint(lp.address,100_000n*E18)).wait();await(await token.connect(lp).approve(await rebaseRouter.getAddress(),ethers.MaxUint256)).wait();}await(await rebaseRouter.connect(lp).addLiquidity(await rebasing.getAddress(),await pair.getAddress(),50_000n*E18,50_000n*E18,lp.address,deadline)).wait();const rebasePool=await ethers.getContractAt("YNXStablePool",await rebaseFactory.getPool(await rebasing.getAddress(),await pair.getAddress()));await(await rebasing.slash(await rebasePool.getAddress(),1n)).wait();await assert.rejects(rebasePool.sync(),/panic|revert/,"negative rebase cannot be legitimized by sync");

const tooPrecise=await ethers.deployContract("MockDecimalsDexToken",["Bad decimals","BAD",19]);await tooPrecise.waitForDeployment();await assert.rejects(ethers.deployContract("YNXStableFactory",[governance.address,feeRecipient.address,[await tooPrecise.getAddress()]]),/InvalidToken|revert/,"unsupported decimal precision fails closed");
const overflow6=await ethers.deployContract("MockDecimalsDexToken",["Overflow 6","OV6",6]),overflow18=await ethers.deployContract("MockDecimalsDexToken",["Overflow 18","OV18",18]);await Promise.all([overflow6.waitForDeployment(),overflow18.waitForDeployment()]);const overflowFactory=await ethers.deployContract("YNXStableFactory",[governance.address,feeRecipient.address,[await overflow6.getAddress(),await overflow18.getAddress()]]);await overflowFactory.waitForDeployment();const overflowRouter=await ethers.deployContract("YNXDexRouter",[await overflowFactory.getAddress()]);await overflowRouter.waitForDeployment();await(await overflowFactory.createPool(await overflow6.getAddress(),await overflow18.getAddress(),100,4)).wait();for(const [token,amount] of [[overflow6,10n**24n+1n],[overflow18,1n*E18]]){await(await token.mint(lp.address,amount)).wait();await(await token.connect(lp).approve(await overflowRouter.getAddress(),ethers.MaxUint256)).wait();}await assert.rejects(overflowRouter.connect(lp).addLiquidity(await overflow6.getAddress(),await overflow18.getAddress(),10n**24n+1n,1n*E18,lp.address,deadline),/Overflow|revert/,"normalized reserve cap rejects overflow atomically");
await assert.rejects(pool.connect(attacker).claimProtocolFees(),/Unauthorized|revert/);const feeToken0=(await pool.token0()).toLowerCase()===token18Address.toLowerCase()?token18:token6;const feeBefore=await feeToken0.balanceOf(feeRecipient.address);await(await pool.connect(feeRecipient).claimProtocolFees()).wait();assert((await feeToken0.balanceOf(feeRecipient.address))>=feeBefore,"only the published recipient claims protocol fees");
await assert.rejects(factory.connect(attacker).scheduleTokenSupport(token18Address,false),/Unauthorized|revert/);await(await factory.connect(governance).scheduleProtocolFeeRecipient(attacker.address)).wait();await assert.rejects(factory.executeProtocolFeeRecipient(),/DelayNotElapsed|revert/);await ethers.provider.send("evm_increaseTime",[2*24*60*60+1]);await ethers.provider.send("evm_mine",[]);await(await factory.executeProtocolFeeRecipient()).wait();assert.equal(await factory.protocolFeeRecipient(),attacker.address,"delayed fee governance is publicly executable");

console.log(`YNX StableSwap integration/invariant/differential/chaos: PASS (64 differential + 32 stateful vectors, factory deploy gas ${factoryReceipt.gasUsed}, pool create gas ${createReceipt.gasUsed}, stable swap gas ${swapReceipt.gasUsed})`);
