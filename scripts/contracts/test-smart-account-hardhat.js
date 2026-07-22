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

const overLimitCall = account.interface.encodeFunctionData("executeSession", [
  sessionKey.address,
  destination.address,
  ethers.parseEther("0.25"),
  arbitrarySelector,
]);
await expectFailed(await (async () => {
  const op = await operation(overLimitCall, 2n);
  const hash = await entryPoint.getUserOpHash(op);
  op.signature = ethers.concat(["0x02", sessionKey.address, sessionKey.signingKey.sign(hash).serialized]);
  return op;
})());

const wrongTargetCall = account.interface.encodeFunctionData("executeSession", [
  sessionKey.address,
  owner.address,
  0n,
  arbitrarySelector,
]);
await expectFailed(await (async () => {
  const op = await operation(wrongTargetCall, 3n);
  const hash = await entryPoint.getUserOpHash(op);
  op.signature = ethers.concat(["0x02", sessionKey.address, sessionKey.signingKey.sign(hash).serialized]);
  return op;
})());

const passkeyCall = account.interface.encodeFunctionData("execute", [destination.address, 0n, "0x"]);
await expectValidationFailed(await signPasskeyOperation(await operation(passkeyCall, 4n), 0x01));
const passkeyOp = await signPasskeyOperation(await operation(passkeyCall, 4n), 0x05);
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
  await submit(await operation(zeroValueSessionCall, 5n + BigInt(index)), sessionKey, 2, sessionKey.address);
  soakSamples.push(performance.now() - started);
}
const sortedSamples = [...soakSamples].sort((a, b) => a - b);
const percentile = (fraction) => sortedSamples[Math.ceil(sortedSamples.length * fraction) - 1];
const soakSeconds = soakSamples.reduce((sum, value) => sum + value, 0) / 1000;

const newOwner = ethers.Wallet.createRandom();
const newPasskeySecret = p256.utils.randomPrivateKey();
const newPasskeyPublic = p256.getPublicKey(newPasskeySecret, false);
await (await account.connect(guardian).requestRecovery(
  newOwner.address,
  ethers.hexlify(newPasskeyPublic.slice(1, 33)),
  ethers.hexlify(newPasskeyPublic.slice(33)),
)).wait();
await assert.rejects(account.executeRecovery());
await ethers.provider.send("evm_increaseTime", [86401]);
await ethers.provider.send("evm_mine", []);
await (await account.executeRecovery()).wait();
assert.equal(await account.owner(), newOwner.address);
assert.equal(await account.sessionEpoch(), 2n);
assert.equal((await account.sessions(sessionKey.address)).epoch, 1n);
const revokedSessionOp = await operation(sessionCall, 55n);
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

console.log(JSON.stringify({
  entryPoint: entryPoint.target,
  account: account.target,
  ownerUserOperation: "passed",
  webAuthnUVUserOperation: "passed",
  boundedSessionUserOperation: "passed",
  overLimitRejection: "passed",
  wrongTargetRejection: "passed",
  userVerificationRequired: "passed",
  delayedGuardianRecovery: "passed",
  recoveryRevokedSessions: "passed",
  counterfactualFactoryUserOperation: "passed",
  benchmark: {
    environment: "Hardhat EDR in-process local chain; excludes bundler, RPC, persistence and network latency",
    samples: soakCount,
    failures: 0,
    throughputPerSecond: Number((soakCount / soakSeconds).toFixed(2)),
    p50Ms: Number(percentile(0.5).toFixed(3)),
    p95Ms: Number(percentile(0.95).toFixed(3)),
    p99Ms: Number(percentile(0.99).toFixed(3)),
  },
}, null, 2));
