import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCapitalProductReview, parseCredentialCandidate, parseStrategyMandate, strategyMandateDigest, WalletAuthError, walletIdentity } from "../src/index.js";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const base = {
  schemaVersion:1, mandateId:"quant-dex-v1", account:walletIdentity(`${"00".repeat(31)}01`).account, productClientId:"ynx-quant-v1", sessionBinding:"01".repeat(32),
  strategyName:"Bounded testnet rebalance", strategyHash:"02".repeat(32), strategyVersion:"1.0.0", engineCommit:"03".repeat(20), engineRelease:"quant-1.0.0-testnet",
  executionKind:"dex-strategy-vault", executionAccount:"vault-testnet-7", allowedVenues:["ynx-dex"], allowedAssets:["USDC","YNXT"], allowedMarkets:["YNXT/USDC"],
  allowedMethods:["0x12345678"], allowedContracts:["0x1111111111111111111111111111111111111111"], maxCapital:100000, maxPosition:50000, maxLeverageBps:10000,
  maxOrder:10000, maxSlippageBps:100, maxGas:500000, maxFrequencyPerHour:12, dailyLossLimit:5000, drawdownLimit:10000,
  noWithdraw:true, ownerChangeAllowed:false, arbitraryTransferAllowed:false, unlimitedApprovalAllowed:false,
  computeDataFee:100, subscriptionFee:0, managementFeeBps:0, performanceFeeBps:1000, highWaterMark:true, lossCarryForward:true,
  killSwitch:"https://gateway.ynxweb4.com/mandates/quant-dex-v1/kill", revoke:"https://gateway.ynxweb4.com/mandates/quant-dex-v1/revoke", emergencyExit:"https://gateway.ynxweb4.com/mandates/quant-dex-v1/exit",
  userRiskAccepted:true, testnetNoValue:true, issuedAt:"2026-07-22T11:55:00.000Z", expiresAt:"2026-07-23T11:55:00.000Z", source:"https://gateway.ynxweb4.com/mandates/quant-dex-v1", asOf:"2026-07-22T11:55:00.000Z", version:"1",
};

test("strategy mandate binds engine, venue, methods, limits, fees, revoke and emergency exit", () => {
  const parsed = parseStrategyMandate(base);
  assert.equal(strategyMandateDigest(parsed).length, 64);
  assert.equal(parsed.noWithdraw, true);
  assert.equal(parsed.performanceFeeBps, 1000);
});

test("property/fuzz: every prohibited asset-control capability and inconsistent limit fails closed", () => {
  for (const mutation of [
    {noWithdraw:false}, {ownerChangeAllowed:true}, {arbitraryTransferAllowed:true}, {unlimitedApprovalAllowed:true},
    {maxOrder:50001}, {maxPosition:100001}, {performanceFeeBps:1000,highWaterMark:false}, {performanceFeeBps:1000,lossCarryForward:false},
    {extra:true},
  ]) assert.throws(() => parseStrategyMandate({...base,...mutation}), error => error instanceof WalletAuthError);
});

test("exchange API wallet is subaccount-only and cannot inherit DEX contracts", () => {
  const exchange = {...base, executionKind:"exchange-subaccount", executionAccount:"subaccount-ynx-test-01", allowedVenues:["official-exchange-sandbox"], allowedMethods:["0xabcdef01"], allowedContracts:[]};
  assert.equal(parseStrategyMandate(exchange).executionKind, "exchange-subaccount");
  assert.throws(() => parseStrategyMandate({...exchange,allowedContracts:base.allowedContracts}), error => error instanceof WalletAuthError && error.code === "INVALID_EXECUTION_BOUNDARY");
});

test("capital review requires provider, contract, yield source, history, fees, exits and non-guarantee", () => {
  const review={schemaVersion:1,productType:"native-staking",name:"YNX native staking candidate",provider:"YNX testnet protocol",contract:"0x2222222222222222222222222222222222222222",governance:"https://governance.ynxweb4.com/proposals/staking-v1",yieldSource:"Protocol testnet validator issuance less disclosed validator costs.",historicalYieldRange:"No production history; Testnet observations are not predictive.",nonGuarantee:true,fees:"Validator and network costs shown before confirmation.",lock:"Testnet epoch lock applies.",cooldown:"Exit enters the published queue.",slashing:"Validator faults can reduce principal.",drawdown:"Token price and protocol losses can cause drawdown.",withdrawalDelay:"Queue duration depends on protocol state.",reserveRatio:"Not applicable to native staking; displayed as N/A.",immediateExit:"https://wallet.ynxweb4.com/capital/native-staking/exit",revoke:"https://wallet.ynxweb4.com/capital/native-staking/revoke",risk:"No price, principal, yield or exit-time guarantee.",source:"https://status.ynxweb4.com/capital/native-staking",asOf:NOW.toISOString(),version:"1"};
  assert.equal(parseCapitalProductReview(review).nonGuarantee,true);
  assert.throws(()=>parseCapitalProductReview({...review,nonGuarantee:false}),error=>error instanceof WalletAuthError&&error.code==="MISLEADING_CAPITAL_REVIEW");
});

test("credential candidate discloses one bounded eligibility result with issuer, expiry, status and audit", () => {
  const candidate={schemaVersion:1,credentialId:"urn:uuid:123e4567-e89b-12d3-a456-426614174000",type:"age-eligibility",issuer:"https://issuer.test.ynxweb4.com/",subjectBinding:"11".repeat(32),claim:{kind:"age-eligibility",value:"eligible"},issuedAt:"2026-07-22T11:55:00.000Z",expiresAt:"2026-07-23T11:55:00.000Z",status:{type:"BitstringStatusListEntry",url:"https://issuer.test.ynxweb4.com/status/1",index:42},proofDigest:"22".repeat(32),auditId:"33".repeat(32),source:"https://issuer.test.ynxweb4.com/credentials/metadata",asOf:"2026-07-22T11:55:00.000Z",version:"1"};
  assert.equal(parseCredentialCandidate(candidate,NOW).claim.value,"eligible");
  assert.throws(()=>parseCredentialCandidate({...candidate,rawPassport:"secret"},NOW),error=>error instanceof WalletAuthError);
  assert.throws(()=>parseCredentialCandidate({...candidate,expiresAt:NOW.toISOString()},NOW),error=>error instanceof WalletAuthError&&error.code==="INACTIVE_CREDENTIAL");
});

test("credential fuzz and soak reject claim widening while bounded candidates remain stable", () => {
  const seed={schemaVersion:1,credentialId:"urn:uuid:123e4567-e89b-12d3-a456-426614174000",type:"region-eligibility",issuer:"https://issuer.test.ynxweb4.com/",subjectBinding:"11".repeat(32),claim:{kind:"region-eligibility",value:"eligible"},issuedAt:"2026-07-22T11:55:00.000Z",expiresAt:"2026-07-23T11:55:00.000Z",status:{type:"BitstringStatusListEntry",url:"https://issuer.test.ynxweb4.com/status/1",index:42},proofDigest:"22".repeat(32),auditId:"33".repeat(32),source:"https://issuer.test.ynxweb4.com/credentials/metadata",asOf:"2026-07-22T11:55:00.000Z",version:"1"};
  assert.throws(()=>parseCredentialCandidate({...seed,claim:{kind:"region-eligibility",value:"CN"}},NOW),error=>error instanceof WalletAuthError);
  for(let index=0;index<5000;index+=1) assert.equal(parseCredentialCandidate({...seed,status:{...seed.status,index:index%1000}},NOW).type,"region-eligibility");
});
