import assert from "node:assert/strict";
import { network } from "hardhat";
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";

const { ethers } = await network.create();
const [deployer, beneficiary, guardian, destination] = await ethers.getSigners();
const owner = ethers.Wallet.createRandom().connect(ethers.provider);
const sessionKey = ethers.Wallet.createRandom().connect(ethers.provider);
const passkeySecret = p256.utils.randomPrivateKey();
const passkeyPublic = p256.getPublicKey(passkeySecret, false);
const passkeyX = ethers.hexlify(passkeyPublic.slice(1, 33));
const passkeyY = ethers.hexlify(passkeyPublic.slice(33));

await (await deployer.sendTransaction({ to: owner.address, value: ethers.parseEther("10") })).wait();
const entryPoint = await ethers.deployContract("YNXEntryPoint");
const account = await ethers.deployContract("YNXSmartAccount", [
  entryPoint.target,
  owner.address,
  passkeyX,
  passkeyY,
  guardian.address,
  86400,
]);
await (await deployer.sendTransaction({ to: account.target, value: ethers.parseEther("5") })).wait();

function pack128(high, low) {
  return ethers.toBeHex((BigInt(high) << 128n) | BigInt(low), 32);
}
async function operation(callData, nonce) {
  return {
    sender: account.target,
    nonce,
    initCode: "0x",
    callData,
    accountGasLimits: pack128(3_000_000n, 1_000_000n),
    preVerificationGas: 100_000n,
    gasFees: pack128(1_000_000_000n, 2_000_000_000n),
    paymasterAndData: "0x",
    signature: "0x",
  };
}
async function submit(op, signer, mode, extra = "0x") {
  const hash = await entryPoint.getUserOpHash(op);
  const signature = signer.signingKey.sign(hash).serialized;
  op.signature = ethers.concat([ethers.toBeHex(mode, 1), extra, signature]);
  return (await entryPoint.handleOps([op], beneficiary.address, { gasLimit: 8_000_000 })).wait();
}
async function expectFailed(op) {
  const receipt = await (await entryPoint.handleOps([op], beneficiary.address, { gasLimit: 8_000_000 })).wait();
  const events = receipt.logs.flatMap((log) => {
    try { return [entryPoint.interface.parseLog(log)]; } catch { return []; }
  });
  assert.equal(events.some((event) => event?.name === "UserOperationEvent" && event.args.success === false), true);
}
async function expectValidationFailed(op) {
  await assert.rejects(entryPoint.handleOps([op], beneficiary.address, { gasLimit: 12_000_000 }), /AA24 signature error/);
}
async function expectTimeRangeFailed(op) {
  await assert.rejects(entryPoint.handleOps([op], beneficiary.address, { gasLimit: 12_000_000 }), /AA22 expired or not due/);
}
async function signPasskeyOperation(op, flags) {
  const passkeyHash = await entryPoint.getUserOpHash(op);
  const challenge = Buffer.from(ethers.getBytes(passkeyHash)).toString("base64url");
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge}","origin":"https://wallet.testnet.ynx"}`;
  const authenticatorData = new Uint8Array(37);
  authenticatorData[32] = flags;
  const signedPayload = ethers.concat([authenticatorData, sha256(new TextEncoder().encode(clientDataJSON))]);
  const signature = p256.sign(sha256(ethers.getBytes(signedPayload)), passkeySecret, { lowS: true });
  const auth = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "bytes32", "uint256", "uint256", "bytes", "string"],
    [ethers.toBeHex(signature.r, 32), ethers.toBeHex(signature.s, 32), clientDataJSON.indexOf('"challenge"'), clientDataJSON.indexOf('"type"'), authenticatorData, clientDataJSON],
  );
  op.signature = ethers.concat(["0x01", auth]);
  return op;
}

const ownerCall = account.interface.encodeFunctionData("execute", [destination.address, ethers.parseEther("0.1"), "0x"]);
const destinationBeforeOwnerOp = await ethers.provider.getBalance(destination.address);
await submit(await operation(ownerCall, 0n), owner, 0);
assert.equal(await ethers.provider.getBalance(destination.address) - destinationBeforeOwnerOp, ethers.parseEther("0.1"));

const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
const arbitrarySelector = "0x12345678";
await (await account.connect(owner).configureSession(
  sessionKey.address,
  destination.address,
  arbitrarySelector,
  ethers.keccak256(arbitrarySelector),
  now,
  now + 3600n,
  ethers.parseEther("0.2"),
  ethers.parseEther("0.3"),
)).wait();
const sessionCall = account.interface.encodeFunctionData("executeSession", [
  sessionKey.address,
  destination.address,
  ethers.parseEther("0.1"),
  arbitrarySelector,
]);
await submit(await operation(sessionCall, 1n), sessionKey, 2, sessionKey.address);
const session = await account.sessions(sessionKey.address);
assert.equal(session.spentToday, ethers.parseEther("0.1"));
assert.equal(await entryPoint.getNonce(account.target, 0), 2n);

const substitutedCalldataCall = account.interface.encodeFunctionData("executeSession", [
  sessionKey.address,
  destination.address,
  0n,
  ethers.concat([arbitrarySelector, ethers.zeroPadValue(owner.address, 32)]),
]);
await expectValidationFailed(await (async () => {
  const op = await operation(substitutedCalldataCall, 2n);
  const hash = await entryPoint.getUserOpHash(op);
  op.signature = ethers.concat(["0x02", sessionKey.address, sessionKey.signingKey.sign(hash).serialized]);
  return op;
})());
assert.equal(await entryPoint.getNonce(account.target, 0), 2n);
await expectValidationFailed(await (async () => {
  const op = await operation(ethers.concat([sessionCall, ethers.ZeroHash]), 2n);
  const hash = await entryPoint.getUserOpHash(op);
  op.signature = ethers.concat(["0x02", sessionKey.address, sessionKey.signingKey.sign(hash).serialized]);
  return op;
})());
assert.equal(await entryPoint.getNonce(account.target, 0), 2n);

const overLimitCall = account.interface.encodeFunctionData("executeSession", [
  sessionKey.address,
  destination.address,
  ethers.parseEther("0.25"),
  arbitrarySelector,
]);
await expectValidationFailed(await (async () => {
  const op = await operation(overLimitCall, 2n);
  const hash = await entryPoint.getUserOpHash(op);
  op.signature = ethers.concat(["0x02", sessionKey.address, sessionKey.signingKey.sign(hash).serialized]);
  return op;
})());
assert.equal(await entryPoint.getNonce(account.target, 0), 2n);

const wrongTargetCall = account.interface.encodeFunctionData("executeSession", [
  sessionKey.address,
  owner.address,
  0n,
  arbitrarySelector,
]);
await expectValidationFailed(await (async () => {
  const op = await operation(wrongTargetCall, 2n);
  const hash = await entryPoint.getUserOpHash(op);
  op.signature = ethers.concat(["0x02", sessionKey.address, sessionKey.signingKey.sign(hash).serialized]);
  return op;
})());
assert.equal(await entryPoint.getNonce(account.target, 0), 2n);

const passkeyCall = account.interface.encodeFunctionData("execute", [destination.address, 0n, "0x"]);
await expectValidationFailed(await signPasskeyOperation(await operation(passkeyCall, 2n), 0x01));
const passkeyOp = await signPasskeyOperation(await operation(passkeyCall, 2n), 0x05);
await (await entryPoint.handleOps([passkeyOp], beneficiary.address, { gasLimit: 12_000_000 })).wait();

const soakSamples = [];
const soakCount = 50;
for (let index = 0; index < soakCount; index += 1) {
  const zeroValueSessionCall = account.interface.encodeFunctionData("executeSession", [
    sessionKey.address,
    destination.address,
    0n,
    arbitrarySelector,
  ]);
  const started = performance.now();
  await submit(await operation(zeroValueSessionCall, 3n + BigInt(index)), sessionKey, 2, sessionKey.address);
  soakSamples.push(performance.now() - started);
}
const sortedSamples = [...soakSamples].sort((a, b) => a - b);
const percentile = (fraction) => sortedSamples[Math.ceil(sortedSamples.length * fraction) - 1];
const soakSeconds = soakSamples.reduce((sum, value) => sum + value, 0) / 1000;

const bundledLimitCall = account.interface.encodeFunctionData("executeSession", [
  sessionKey.address,
  destination.address,
  ethers.parseEther("0.15"),
  arbitrarySelector,
]);
const bundledLimitOps = await Promise.all([53n, 54n].map(async (nonce) => {
  const op = await operation(bundledLimitCall, nonce);
  const hash = await entryPoint.getUserOpHash(op);
  op.signature = ethers.concat(["0x02", sessionKey.address, sessionKey.signingKey.sign(hash).serialized]);
  return op;
}));
const destinationBeforeBundledLimit = await ethers.provider.getBalance(destination.address);
const bundledLimitReceipt = await (await entryPoint.handleOps(
  bundledLimitOps,
  beneficiary.address,
  { gasLimit: 16_000_000 },
)).wait();
const bundledLimitEvents = bundledLimitReceipt.logs.flatMap((log) => {
  try { return [entryPoint.interface.parseLog(log)]; } catch { return []; }
}).filter((event) => event?.name === "UserOperationEvent");
assert.equal(bundledLimitEvents.length, 2);
assert.equal(bundledLimitEvents.filter((event) => event.args.success === true).length, 1);
assert.equal(bundledLimitEvents.filter((event) => event.args.success === false).length, 1);
assert.equal(await ethers.provider.getBalance(destination.address) - destinationBeforeBundledLimit, ethers.parseEther("0.15"));
assert.equal((await account.sessions(sessionKey.address)).spentToday, ethers.parseEther("0.25"));
assert.equal(await entryPoint.getNonce(account.target, 0), 55n);

const timeBoundSessionKey = ethers.Wallet.createRandom().connect(ethers.provider);
const timeBoundaryNow = BigInt((await ethers.provider.getBlock("latest")).timestamp);
await (await account.connect(owner).configureSession(
  timeBoundSessionKey.address,
  destination.address,
  arbitrarySelector,
  ethers.keccak256(arbitrarySelector),
  timeBoundaryNow + 60n,
  timeBoundaryNow + 120n,
  ethers.parseEther("0.1"),
  ethers.parseEther("0.1"),
)).wait();
const timeBoundCall = account.interface.encodeFunctionData("executeSession", [
  timeBoundSessionKey.address,
  destination.address,
  0n,
  arbitrarySelector,
]);
async function timeBoundOperation(nonce) {
  const op = await operation(timeBoundCall, nonce);
  const hash = await entryPoint.getUserOpHash(op);
  op.signature = ethers.concat(["0x02", timeBoundSessionKey.address, timeBoundSessionKey.signingKey.sign(hash).serialized]);
  return op;
}
await expectTimeRangeFailed(await timeBoundOperation(55n));
assert.equal(await entryPoint.getNonce(account.target, 0), 55n);
await ethers.provider.send("evm_increaseTime", [61]);
await ethers.provider.send("evm_mine", []);
await (await entryPoint.handleOps([await timeBoundOperation(55n)], beneficiary.address, { gasLimit: 12_000_000 })).wait();
assert.equal(await entryPoint.getNonce(account.target, 0), 56n);
await ethers.provider.send("evm_increaseTime", [60]);
await ethers.provider.send("evm_mine", []);
await expectTimeRangeFailed(await timeBoundOperation(56n));
assert.equal(await entryPoint.getNonce(account.target, 0), 56n);

const batchTarget = await ethers.deployContract("YNXWalletCallTarget");
const ownerBatchCall = account.interface.encodeFunctionData("executeBatch", [[
  { target: batchTarget.target, value: 0n, data: batchTarget.interface.encodeFunctionData("increment", [2n]) },
  { target: batchTarget.target, value: 0n, data: batchTarget.interface.encodeFunctionData("increment", [3n]) },
]]);
await submit(await operation(ownerBatchCall, 56n), owner, 0);
assert.equal(await batchTarget.count(), 5n);
assert.equal(await entryPoint.getNonce(account.target, 0), 57n);

const passkeyBatchCall = account.interface.encodeFunctionData("executeBatch", [[
  { target: batchTarget.target, value: 0n, data: batchTarget.interface.encodeFunctionData("increment", [4n]) },
]]);
const passkeyBatchOp = await signPasskeyOperation(await operation(passkeyBatchCall, 57n), 0x05);
await (await entryPoint.handleOps([passkeyBatchOp], beneficiary.address, { gasLimit: 12_000_000 })).wait();
assert.equal(await batchTarget.count(), 9n);
assert.equal(await entryPoint.getNonce(account.target, 0), 58n);

const sessionBatchOp = await operation(ownerBatchCall, 58n);
const sessionBatchHash = await entryPoint.getUserOpHash(sessionBatchOp);
sessionBatchOp.signature = ethers.concat([
  "0x02",
  sessionKey.address,
  sessionKey.signingKey.sign(sessionBatchHash).serialized,
]);
await expectValidationFailed(sessionBatchOp);
assert.equal(await batchTarget.count(), 9n);
assert.equal(await entryPoint.getNonce(account.target, 0), 58n);

const failingBatchCall = account.interface.encodeFunctionData("executeBatch", [[
  { target: batchTarget.target, value: 0n, data: batchTarget.interface.encodeFunctionData("increment", [7n]) },
  { target: batchTarget.target, value: 0n, data: batchTarget.interface.encodeFunctionData("fail") },
]]);
const failingBatchOp = await operation(failingBatchCall, 58n);
const failingBatchHash = await entryPoint.getUserOpHash(failingBatchOp);
failingBatchOp.signature = ethers.concat(["0x00", owner.signingKey.sign(failingBatchHash).serialized]);
await expectFailed(failingBatchOp);
assert.equal(await batchTarget.count(), 9n);
assert.equal(await entryPoint.getNonce(account.target, 0), 59n);

const newOwner = ethers.Wallet.createRandom();
const newPasskeySecret = p256.utils.randomPrivateKey();
const newPasskeyPublic = p256.getPublicKey(newPasskeySecret, false);
await (await account.connect(guardian).requestRecovery(
  newOwner.address,
  ethers.hexlify(newPasskeyPublic.slice(1, 33)),
  ethers.hexlify(newPasskeyPublic.slice(33)),
)).wait();
assert.equal(await account.sessionEpoch(), 2n);
assert.equal((await account.sessions(sessionKey.address)).epoch, 1n);
const pendingRecoverySessionOp = await operation(sessionCall, 59n);
const pendingRecoverySessionHash = await entryPoint.getUserOpHash(pendingRecoverySessionOp);
pendingRecoverySessionOp.signature = ethers.concat([
  "0x02",
  sessionKey.address,
  sessionKey.signingKey.sign(pendingRecoverySessionHash).serialized,
]);
await expectValidationFailed(pendingRecoverySessionOp);
await (await account.connect(owner).cancelRecovery()).wait();
assert.equal((await account.recovery()).executeAfter, 0n);
await expectValidationFailed(pendingRecoverySessionOp);
await (await account.connect(guardian).requestRecovery(
  newOwner.address,
  ethers.hexlify(newPasskeyPublic.slice(1, 33)),
  ethers.hexlify(newPasskeyPublic.slice(33)),
)).wait();
assert.equal(await account.sessionEpoch(), 3n);
await assert.rejects(account.executeRecovery());
await ethers.provider.send("evm_increaseTime", [86401]);
await ethers.provider.send("evm_mine", []);
await (await account.executeRecovery()).wait();
assert.equal(await account.owner(), newOwner.address);
assert.equal(await account.sessionEpoch(), 3n);
assert.equal((await account.sessions(sessionKey.address)).epoch, 1n);
const revokedSessionOp = await operation(sessionCall, 59n);
const revokedHash = await entryPoint.getUserOpHash(revokedSessionOp);
revokedSessionOp.signature = ethers.concat(["0x02", sessionKey.address, sessionKey.signingKey.sign(revokedHash).serialized]);
await expectValidationFailed(revokedSessionOp);

const factoryOwner = ethers.Wallet.createRandom();
const factory = await ethers.deployContract("YNXSmartAccountFactory", [entryPoint.target]);
const factorySalt = ethers.keccak256(ethers.toUtf8Bytes("YNX_TESTNET_FACTORY_VECTOR_V1"));
const predictedAccount = await factory["getAddress(address,bytes32,bytes32,address,uint48,bytes32)"](
  factoryOwner.address,
  passkeyX,
  passkeyY,
  guardian.address,
  86400,
  factorySalt,
);
await (await deployer.sendTransaction({ to: predictedAccount, value: ethers.parseEther("1") })).wait();
const factoryCallData = account.interface.encodeFunctionData("execute", [destination.address, 0n, "0x"]);
const createCall = factory.interface.encodeFunctionData("createAccount", [
  factoryOwner.address,
  passkeyX,
  passkeyY,
  guardian.address,
  86400,
  factorySalt,
]);
const factoryOperation = {
  sender: predictedAccount,
  nonce: 0n,
  initCode: ethers.concat([factory.target, createCall]),
  callData: factoryCallData,
  accountGasLimits: pack128(5_000_000n, 1_000_000n),
  preVerificationGas: 150_000n,
  gasFees: pack128(1_000_000_000n, 2_000_000_000n),
  paymasterAndData: "0x",
  signature: "0x",
};
const factoryOperationHash = await entryPoint.getUserOpHash(factoryOperation);
factoryOperation.signature = ethers.concat(["0x00", factoryOwner.signingKey.sign(factoryOperationHash).serialized]);
await (await entryPoint.handleOps([factoryOperation], beneficiary.address, { gasLimit: 12_000_000 })).wait();
assert.notEqual(await ethers.provider.getCode(predictedAccount), "0x");
const counterfactualAccount = await ethers.getContractAt("YNXSmartAccount", predictedAccount);
assert.equal(await counterfactualAccount.owner(), factoryOwner.address);

const policySigner = ethers.Wallet.createRandom();
const sponsorOwner = ethers.Wallet.createRandom();
const sponsoredAccount = await ethers.deployContract("YNXSmartAccount", [
  entryPoint.target,
  sponsorOwner.address,
  passkeyX,
  passkeyY,
  guardian.address,
  86400,
]);
const paymaster = await ethers.deployContract("YNXSponsorPaymaster", [entryPoint.target, policySigner.address, guardian.address]);
await (await paymaster.deposit({ value: ethers.parseEther("10") })).wait();
const productId = ethers.keccak256(ethers.toUtf8Bytes("ynx.wallet.testnet"));
const subjectId = ethers.keccak256(ethers.toUtf8Bytes("anti-sybil:test-subject"));
const policyId = ethers.keccak256(ethers.toUtf8Bytes("first-action-policy-v1"));
await (await paymaster.configureProduct(
  productId,
  policyId,
  ethers.parseEther("10"),
  ethers.parseEther("0.1"),
  ethers.parseEther("5"),
  ethers.parseEther("0.1"),
  0x0f,
  destination.address,
  true,
)).wait();
await (await paymaster.setMerchant(productId, destination.address, true)).wait();
await (await paymaster.setSponsorshipEnabled(true)).wait();
const sponsorAuthType = "tuple(bytes32 authorizationId,bytes32 productId,bytes32 subjectId,bytes32 policyId,uint8 sponsorType,address destination,uint128 authorizationMaxCost,uint48 validAfter,uint48 validUntil)";
const paymasterStatic = ethers.solidityPacked(
  ["address", "uint128", "uint128"],
  [paymaster.target, 2_000_000n, 500_000n],
);
const sponsorshipNow = BigInt((await ethers.provider.getBlock("latest")).timestamp);
async function sponsoredOperation(
  nonce,
  sponsorType,
  authorizationId,
  callDestination = destination.address,
  authorizationPolicyId = policyId,
  callDataOverride,
) {
  const callData = callDataOverride ?? sponsoredAccount.interface.encodeFunctionData("execute", [callDestination, 0n, "0x"]);
  const op = {
    sender: sponsoredAccount.target,
    nonce,
    initCode: "0x",
    callData,
    accountGasLimits: pack128(3_000_000n, 1_000_000n),
    preVerificationGas: 100_000n,
    gasFees: pack128(1_000_000_000n, 2_000_000_000n),
    paymasterAndData: paymasterStatic,
    signature: "0x",
  };
  const authorization = {
    authorizationId,
    productId,
    subjectId,
    policyId: authorizationPolicyId,
    sponsorType,
    destination: callDestination,
    authorizationMaxCost: ethers.parseEther("0.1"),
    validAfter: sponsorshipNow - 1n,
    validUntil: sponsorshipNow + 3600n,
  };
  const sponsorHash = await paymaster.getSponsorHash(op, authorization);
  const sponsorSignature = policySigner.signingKey.sign(sponsorHash).serialized;
  const encodedAuthorization = ethers.AbiCoder.defaultAbiCoder().encode(
    [sponsorAuthType, "bytes"],
    [authorization, sponsorSignature],
  );
  op.paymasterAndData = ethers.concat([paymasterStatic, encodedAuthorization]);
  const accountHash = await entryPoint.getUserOpHash(op);
  op.signature = ethers.concat(["0x00", sponsorOwner.signingKey.sign(accountHash).serialized]);
  return op;
}

const sponsoredBatchAuthorizationId = ethers.keccak256(ethers.toUtf8Bytes("sponsored-batch-authorization"));
const sponsoredBatchCall = sponsoredAccount.interface.encodeFunctionData("executeBatch", [[
  { target: batchTarget.target, value: 0n, data: batchTarget.interface.encodeFunctionData("increment", [11n]) },
  { target: destination.address, value: 0n, data: "0x" },
]]);
const budgetBeforeSponsoredBatch = await paymaster.productBudgets(productId);
const usageBeforeSponsoredBatch = await paymaster.subjectUsage(productId, subjectId);
await assert.rejects(
  entryPoint.handleOps(
    [await sponsoredOperation(
      0n,
      0,
      sponsoredBatchAuthorizationId,
      destination.address,
      policyId,
      sponsoredBatchCall,
    )],
    beneficiary.address,
    { gasLimit: 12_000_000 },
  ),
  /AA33|PolicyViolation/,
);
const budgetAfterSponsoredBatch = await paymaster.productBudgets(productId);
const usageAfterSponsoredBatch = await paymaster.subjectUsage(productId, subjectId);
assert.equal(budgetAfterSponsoredBatch.reservedToday, budgetBeforeSponsoredBatch.reservedToday);
assert.equal(budgetAfterSponsoredBatch.observedToday, budgetBeforeSponsoredBatch.observedToday);
assert.equal(usageAfterSponsoredBatch.reservedToday, usageBeforeSponsoredBatch.reservedToday);
assert.equal(await paymaster.consumedAuthorizations(sponsoredBatchAuthorizationId), false);
assert.equal(await entryPoint.getNonce(sponsoredAccount.target, 0), 0n);
assert.equal(await batchTarget.count(), 9n);

const firstActionId = ethers.keccak256(ethers.toUtf8Bytes("first-action-authorization"));
await (await entryPoint.handleOps(
  [await sponsoredOperation(0n, 1, firstActionId)],
  beneficiary.address,
  { gasLimit: 12_000_000 },
)).wait();
assert.equal(await paymaster.firstActionUsed(productId, subjectId), true);
assert.equal(await ethers.provider.getBalance(sponsoredAccount.target), 0n);
let budget = await paymaster.productBudgets(productId);
assert.equal(budget.reservedToday > 0n, true);
assert.equal(budget.observedToday > 0n, true);

const wrongPolicyAuthorizationId = ethers.keccak256(ethers.toUtf8Bytes("wrong-policy-authorization"));
const budgetBeforeWrongPolicy = await paymaster.productBudgets(productId);
const usageBeforeWrongPolicy = await paymaster.subjectUsage(productId, subjectId);
await assert.rejects(
  entryPoint.handleOps(
    [await sponsoredOperation(
      1n,
      0,
      wrongPolicyAuthorizationId,
      destination.address,
      ethers.keccak256(ethers.toUtf8Bytes("retired-policy-v0")),
    )],
    beneficiary.address,
    { gasLimit: 12_000_000 },
  ),
  /AA33|PolicyViolation/,
);
const budgetAfterWrongPolicy = await paymaster.productBudgets(productId);
const usageAfterWrongPolicy = await paymaster.subjectUsage(productId, subjectId);
assert.equal(budgetAfterWrongPolicy.reservedToday, budgetBeforeWrongPolicy.reservedToday);
assert.equal(budgetAfterWrongPolicy.observedToday, budgetBeforeWrongPolicy.observedToday);
assert.equal(usageAfterWrongPolicy.reservedToday, usageBeforeWrongPolicy.reservedToday);
assert.equal(await paymaster.consumedAuthorizations(wrongPolicyAuthorizationId), false);
assert.equal(await entryPoint.getNonce(sponsoredAccount.target, 0), 1n);

await assert.rejects(
  entryPoint.handleOps(
    [await sponsoredOperation(1n, 1, ethers.keccak256(ethers.toUtf8Bytes("second-first-action")))],
    beneficiary.address,
    { gasLimit: 12_000_000 },
  ),
  /AA33|BudgetExceeded/,
);

const tampered = await sponsoredOperation(1n, 0, ethers.keccak256(ethers.toUtf8Bytes("tamper-authorization")));
tampered.callData = sponsoredAccount.interface.encodeFunctionData("execute", [owner.address, 0n, "0x"]);
const tamperedAccountHash = await entryPoint.getUserOpHash(tampered);
tampered.signature = ethers.concat(["0x00", sponsorOwner.signingKey.sign(tamperedAccountHash).serialized]);
await assert.rejects(
  entryPoint.handleOps([tampered], beneficiary.address, { gasLimit: 12_000_000 }),
  /AA34|signature error/,
);

const gasTampered = await sponsoredOperation(1n, 0, ethers.keccak256(ethers.toUtf8Bytes("gas-tamper-authorization")));
const gasTamperedBytes = ethers.getBytes(gasTampered.paymasterAndData);
gasTamperedBytes[51] ^= 1;
gasTampered.paymasterAndData = ethers.hexlify(gasTamperedBytes);
const gasTamperedAccountHash = await entryPoint.getUserOpHash(gasTampered);
gasTampered.signature = ethers.concat(["0x00", sponsorOwner.signingKey.sign(gasTamperedAccountHash).serialized]);
await assert.rejects(
  entryPoint.handleOps([gasTampered], beneficiary.address, { gasLimit: 12_000_000 }),
  /AA34|signature error/,
);

await assert.rejects(
  entryPoint.handleOps(
    [await sponsoredOperation(1n, 2, ethers.keccak256(ethers.toUtf8Bytes("unapproved-merchant")), owner.address)],
    beneficiary.address,
    { gasLimit: 12_000_000 },
  ),
  /AA33|PolicyViolation/,
);

await (await entryPoint.handleOps(
  [await sponsoredOperation(1n, 2, ethers.keccak256(ethers.toUtf8Bytes("merchant-authorization")))],
  beneficiary.address,
  { gasLimit: 12_000_000 },
)).wait();
await (await entryPoint.handleOps(
  [await sponsoredOperation(2n, 3, ethers.keccak256(ethers.toUtf8Bytes("developer-authorization")))],
  beneficiary.address,
  { gasLimit: 12_000_000 },
)).wait();

const sponsorSamples = [];
const sponsorSoakCount = 25;
for (let index = 0; index < sponsorSoakCount; index += 1) {
  const started = performance.now();
  const authorizationId = ethers.keccak256(ethers.toUtf8Bytes(`product-soak-${index}`));
  await (await entryPoint.handleOps(
    [await sponsoredOperation(3n + BigInt(index), 0, authorizationId)],
    beneficiary.address,
    { gasLimit: 12_000_000 },
  )).wait();
  sponsorSamples.push(performance.now() - started);
}
const sponsorSorted = [...sponsorSamples].sort((a, b) => a - b);
const sponsorPercentile = (fraction) => sponsorSorted[Math.ceil(sponsorSorted.length * fraction) - 1];
const sponsorSeconds = sponsorSamples.reduce((sum, value) => sum + value, 0) / 1000;
budget = await paymaster.productBudgets(productId);
const usage = await paymaster.subjectUsage(productId, subjectId);
assert.equal(budget.reservedToday <= budget.dailyLimit, true);
assert.equal(usage.reservedToday <= budget.perSubjectDailyLimit, true);

await assert.rejects(
  entryPoint.handleOps(
    [await sponsoredOperation(28n, 0, firstActionId)],
    beneficiary.address,
    { gasLimit: 12_000_000 },
  ),
  /AA33|AuthorizationReplay/,
);
const loweredSubjectLimit = usage.reservedToday - 1n;
await (await paymaster.configureProduct(
  productId,
  policyId,
  ethers.parseEther("10"),
  ethers.parseEther("0.1"),
  loweredSubjectLimit,
  ethers.parseEther("0.1"),
  0x0f,
  destination.address,
  true,
)).wait();
const loweredLimitAuthorizationId = ethers.keccak256(ethers.toUtf8Bytes("lowered-subject-limit"));
const loweredBudgetBefore = await paymaster.productBudgets(productId);
const loweredUsageBefore = await paymaster.subjectUsage(productId, subjectId);
await assert.rejects(
  entryPoint.handleOps(
    [await sponsoredOperation(28n, 0, loweredLimitAuthorizationId)],
    beneficiary.address,
    { gasLimit: 12_000_000 },
  ),
  /0x50b2c4e1|BudgetExceeded/,
);
const loweredBudgetAfter = await paymaster.productBudgets(productId);
const loweredUsageAfter = await paymaster.subjectUsage(productId, subjectId);
assert.equal(loweredBudgetAfter.reservedToday, loweredBudgetBefore.reservedToday);
assert.equal(loweredBudgetAfter.observedToday, loweredBudgetBefore.observedToday);
assert.equal(loweredUsageAfter.reservedToday, loweredUsageBefore.reservedToday);
assert.equal(await paymaster.consumedAuthorizations(loweredLimitAuthorizationId), false);
assert.equal(await entryPoint.getNonce(sponsoredAccount.target, 0), 28n);
await (await paymaster.configureProduct(
  productId,
  policyId,
  ethers.parseEther("10"),
  ethers.parseEther("0.1"),
  ethers.parseEther("5"),
  ethers.parseEther("0.1"),
  0x0f,
  destination.address,
  true,
)).wait();
await (await paymaster.connect(guardian).disableProduct(productId)).wait();
await (await paymaster.connect(guardian).setSponsorshipEnabled(false)).wait();
await assert.rejects(paymaster.connect(guardian).setSponsorshipEnabled(true), /UnauthorizedRiskAction/);
await (await paymaster.setSponsorshipEnabled(true)).wait();
await assert.rejects(
  entryPoint.handleOps(
    [await sponsoredOperation(28n, 0, ethers.keccak256(ethers.toUtf8Bytes("disabled-product")))],
    beneficiary.address,
    { gasLimit: 12_000_000 },
  ),
  /AA33|SponsorshipDisabled/,
);

console.log(JSON.stringify({
  entryPoint: entryPoint.target,
  account: account.target,
  ownerUserOperation: "passed",
  webAuthnUVUserOperation: "passed",
  boundedSessionUserOperation: "passed",
  exactSessionCalldataRejection: "passed",
  sessionPolicyRejectedBeforeNonceConsumption: "passed",
  noncanonicalSessionCallRejection: "passed",
  sameBundleDailyLimitLinearization: "passed",
  sessionValidAfterAndExpiry: "passed",
  ownerBatchUserOperation: "passed",
  webAuthnBatchUserOperation: "passed",
  sessionBatchBypassRejectedBeforeNonceConsumption: "passed",
  failedBatchAtomicRollback: "passed",
  overLimitRejection: "passed",
  wrongTargetRejection: "passed",
  userVerificationRequired: "passed",
  delayedGuardianRecovery: "passed",
  recoveryRequestRevokedSessionsImmediately: "passed",
  recoveryCancellationDidNotRestoreSessions: "passed",
  recoveryExecutionKeptSessionsRevoked: "passed",
  counterfactualFactoryUserOperation: "passed",
  sponsoredFirstActionUserOperation: "passed",
  merchantAndDeveloperSponsorship: "passed",
  exactSponsorPolicyIdRejection: "passed",
  loweredSubjectLimitCanonicalRejection: "passed",
  sponsoredBatchPolicyRejectionBeforeMutation: "passed",
  sponsorTamperReplayDisableRejection: "passed",
  benchmark: {
    environment: "Hardhat EDR in-process local chain; excludes bundler, RPC, persistence and network latency",
    samples: soakCount,
    failures: 0,
    throughputPerSecond: Number((soakCount / soakSeconds).toFixed(2)),
    p50Ms: Number(percentile(0.5).toFixed(3)),
    p95Ms: Number(percentile(0.95).toFixed(3)),
    p99Ms: Number(percentile(0.99).toFixed(3)),
  },
  sponsorBenchmark: {
    environment: "Hardhat EDR in-process local chain; excludes external Bundler, RPC, persistence and network latency",
    samples: sponsorSoakCount,
    failures: 0,
    throughputPerSecond: Number((sponsorSoakCount / sponsorSeconds).toFixed(2)),
    p50Ms: Number(sponsorPercentile(0.5).toFixed(3)),
    p95Ms: Number(sponsorPercentile(0.95).toFixed(3)),
    p99Ms: Number(sponsorPercentile(0.99).toFixed(3)),
  },
}, null, 2));
