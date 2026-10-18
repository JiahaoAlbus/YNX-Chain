import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, concat, getAddress, keccak256, solidityPacked, toBeHex, zeroPadValue } from 'ethers';
import { ROUTE, encodeApprove, encodeBurn, encodeMint, decodeAndValidateMessage } from './cctp-wire.mjs';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
const NONCE = `0x${'ab'.repeat(32)}`;
const ATTESTATION = `0x${'12'.repeat(65)}`; // Encoding fixture, not a valid Circle proof.
const INTENT = { account: ACCOUNT, recipient: RECIPIENT, amountUnits: '1000000', maxFeeUnits: '100' };

function message({ source = false, fee = 75n, expiry = 0n } = {}) {
  const body = solidityPacked(
    ['uint32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'uint256', 'uint256', 'uint256'],
    [1, zeroPadValue(ROUTE.source.usdc, 32), zeroPadValue(RECIPIENT, 32), 1000000n,
      zeroPadValue(ACCOUNT, 32), 100n, source ? 0n : fee, source ? 0n : expiry],
  );
  return solidityPacked(
    ['uint32', 'uint32', 'uint32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint32', 'uint32', 'bytes'],
    [1, 0, 6, source ? zeroPadValue('0x00', 32) : NONCE,
      zeroPadValue(ROUTE.source.tokenMessenger, 32), zeroPadValue(ROUTE.destination.tokenMessenger, 32),
      zeroPadValue(ACCOUNT, 32), 2000, source ? 0 : 2000, body],
  );
}

function replace(raw, offset, length, value) {
  return concat([raw.slice(0, 2 + offset * 2), zeroPadValue(value, length), `0x${raw.slice(2 + (offset + length) * 2)}`]);
}

test('CCTP pins domain IDs separately from testnet chain IDs and freezes nested configuration', () => {
  assert.equal(ROUTE.id, 'cctp-v2-sepolia-base-sepolia-usdc');
  assert.equal(ROUTE.source.chainId, 11155111);
  assert.equal(ROUTE.destination.chainId, 84532);
  assert.equal(ROUTE.source.domain, 0);
  assert.equal(ROUTE.destination.domain, 6);
  assert.equal(ROUTE.decimals, 6);
  assert.throws(() => { ROUTE.destination.chainId = 1; }, TypeError);
});

test('approve and burn encode exact source asset, amount, destination, caller and Standard finality', () => {
  const erc20 = new Interface(['function approve(address,uint256) returns (bool)']);
  const approve = erc20.decodeFunctionData('approve', encodeApprove(INTENT.amountUnits));
  assert.equal(approve[0], getAddress(ROUTE.source.tokenMessenger));
  assert.equal(approve[1], 1000000n);
  const burnAbi = new Interface(['function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)']);
  const burn = burnAbi.decodeFunctionData('depositForBurn', encodeBurn(INTENT));
  assert.deepEqual(Array.from(burn), [1000000n, 6n, zeroPadValue(RECIPIENT, 32), getAddress(ROUTE.source.usdc), zeroPadValue(ACCOUNT, 32), 100n, 2000n]);
});

test('lossless amounts reject zero burns, rounding, negative values, uint256 overflow and fee >= amount', () => {
  for (const amountUnits of ['0', '-1', '1.1', '1e6', '01', NaN, 1.2, Number.MAX_SAFE_INTEGER + 1, 1n << 256n, null, true]) {
    assert.throws(() => encodeApprove(amountUnits), /CCTP_INVALID_AMOUNT/);
  }
  assert.throws(() => encodeBurn({ ...INTENT, maxFeeUnits: '1000000' }), /CCTP_INVALID_MAX_FEE/);
  assert.throws(() => encodeBurn({ ...INTENT, account: `0x${'00'.repeat(20)}` }), /CCTP_INVALID_ACCOUNT/);
  assert.throws(() => encodeBurn({ ...INTENT, recipient: 'not-an-address' }), /CCTP_INVALID_RECIPIENT/);
  const large = ((1n << 255n) + 37n).toString();
  const burn = new Interface(['function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)']).decodeFunctionData('depositForBurn', encodeBurn({ ...INTENT, amountUnits: large }));
  assert.equal(burn[0].toString(), large);
});

test('Standard zero protocol fee is valid; do not invent a minimum positive maxFee', () => {
  // The pinned TokenMessengerV2 contract requires maxFee < amount, not maxFee > 0.
  const intent = { ...INTENT, maxFeeUnits: '0' };
  const abi = new Interface(['function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)']);
  const burn = abi.decodeFunctionData('depositForBurn', encodeBurn(intent));
  assert.equal(burn[5], 0n);
  const freeMessage = replace(message({ fee: 0n }), 280, 32, '0x00');
  assert.equal(decodeAndValidateMessage(freeMessage, intent).amountReceived, '1000000');
  assert.throws(() => decodeAndValidateMessage(replace(freeMessage, 312, 32, '0x01'), intent), /CCTP_INVALID_FEE_EXECUTED/);
});

test('V2 packed 376-byte message returns assigned bytes32 nonce and exact amount after fee', () => {
  const raw = message();
  const decoded = decodeAndValidateMessage(raw, INTENT);
  assert.equal(decoded.nonce, NONCE);
  assert.equal(decoded.messageHash, keccak256(raw));
  assert.equal(decoded.feeExecuted, '75');
  assert.equal(decoded.amountReceived, '999925');
  assert.equal(decoded.messageBody.length, 2 + 228 * 2);
  assert.equal(decoded.sender, getAddress(ROUTE.source.tokenMessenger));
  assert.equal(decoded.mintRecipient, RECIPIENT);
  assert.equal(decoded.destinationCaller, ACCOUNT);
  assert.equal(decoded.mode, 'attested');
  assert.doesNotThrow(() => JSON.stringify(decoded));
});

test('source MessageSent zeros and Iris assigned fields cannot substitute for each other', () => {
  const source = message({ source: true });
  const decoded = decodeAndValidateMessage(source, { ...INTENT, mode: 'source' });
  assert.equal(decoded.nonce, zeroPadValue('0x00', 32));
  assert.equal(decoded.amountReceived, '1000000');
  assert.throws(() => decodeAndValidateMessage(source, INTENT), /CCTP_INVALID_NONCE/);
  assert.throws(() => decodeAndValidateMessage(message(), { ...INTENT, mode: 'source' }), /CCTP_INVALID_SOURCE_NONCE/);
  for (const [offset, value, error] of [[144, 2000, 'SOURCE_FINALITY'], [312, 1, 'SOURCE_FEE'], [344, 1, 'SOURCE_EXPIRY']]) {
    assert.throws(() => decodeAndValidateMessage(replace(source, offset, offset === 144 ? 4 : 32, toBeHex(value)), { ...INTENT, mode: 'source' }), new RegExp(`CCTP_INVALID_${error}`));
  }
  assert.throws(() => encodeMint({ message: source, attestation: ATTESTATION }), /CCTP_INVALID_NONCE/);
});

test('reject every substituted domain, token, sender, recipient, amount and fee binding', () => {
  const raw = message();
  const changes = [
    [0, 4, toBeHex(2), 'MESSAGE_VERSION'], [4, 4, toBeHex(1), 'SOURCE_DOMAIN'],
    [8, 4, toBeHex(11155111), 'DESTINATION_DOMAIN'], [44, 32, OTHER, 'SENDER'],
    [76, 32, OTHER, 'MESSAGE_RECIPIENT'], [108, 32, OTHER, 'DESTINATION_CALLER'],
    [140, 4, toBeHex(1000), 'MIN_FINALITY'], [144, 4, toBeHex(1000), 'FINALITY'],
    [148, 4, toBeHex(0), 'BODY_VERSION'], [152, 32, ROUTE.destination.usdc, 'BURN_TOKEN'],
    [184, 32, ACCOUNT, 'MINT_RECIPIENT'], [216, 32, toBeHex(1000001), 'AMOUNT'],
    [248, 32, RECIPIENT, 'MESSAGE_SENDER'], [280, 32, toBeHex(99), 'MAX_FEE'],
  ];
  for (const [offset, length, value, code] of changes) {
    assert.throws(() => decodeAndValidateMessage(replace(raw, offset, length, value), INTENT), new RegExp(`CCTP_INVALID_${code}`), code);
  }
  assert.throws(() => decodeAndValidateMessage(raw, { ...INTENT, account: OTHER }), /CCTP_INVALID_DESTINATION_CALLER/);
  assert.throws(() => decodeAndValidateMessage(raw, { ...INTENT, recipient: OTHER }), /CCTP_INVALID_MINT_RECIPIENT/);
  assert.throws(() => decodeAndValidateMessage(raw, { ...INTENT, mode: 'fast' }), /CCTP_INVALID_MODE/);
});

test('malformed length, hooks, noncanonical address padding and invalid hex fail closed', () => {
  const raw = message();
  for (const malformed of [raw.slice(0, -2), `${raw}00`, '0x', '0x1', '0xzz', null, 'abc']) {
    assert.throws(() => decodeAndValidateMessage(malformed, INTENT), /CCTP_INVALID_MESSAGE/);
  }
  for (const offset of [44, 76, 108, 152, 184, 248]) {
    assert.throws(() => decodeAndValidateMessage(replace(raw, offset, 1, '0x01'), INTENT), /noncanonical bytes32 EVM address/);
  }
});

test('fee cap and exclusive expiration boundary are checked without losing uint256 precision', () => {
  assert.throws(() => decodeAndValidateMessage(message({ fee: 101n }), INTENT), /CCTP_INVALID_FEE_EXECUTED/);
  assert.throws(() => decodeAndValidateMessage(message({ fee: 1000000n }), INTENT), /CCTP_INVALID_FEE_EXECUTED/);
  const expiring = message({ expiry: 987654321987654321n });
  assert.throws(() => decodeAndValidateMessage(expiring, INTENT), /CCTP_INVALID_EXPIRY/);
  assert.throws(() => decodeAndValidateMessage(expiring, { ...INTENT, destinationBlockNumber: '987654321987654321' }), /CCTP_INVALID_EXPIRY/);
  assert.throws(() => decodeAndValidateMessage(expiring, { ...INTENT, destinationBlockNumber: '987654321987654322' }), /CCTP_INVALID_EXPIRY/);
  assert.equal(decodeAndValidateMessage(expiring, { ...INTENT, destinationBlockNumber: '987654321987654320' }).expirationBlock, '987654321987654321');
  assert.equal(decodeAndValidateMessage(message({ fee: 0n }), INTENT).amountReceived, '1000000');
});

test('mint encoding preserves message and signature bytes, rejects pending and malformed attestations', () => {
  const raw = message();
  const abi = new Interface(['function receiveMessage(bytes,bytes) returns (bool)']);
  const decoded = abi.decodeFunctionData('receiveMessage', encodeMint({ message: raw, attestation: ATTESTATION }));
  assert.deepEqual(Array.from(decoded), [raw.toLowerCase(), ATTESTATION]);
  for (const attestation of ['', 'PENDING', '0x', '0x01', `0x${'12'.repeat(64)}`, `0x${'12'.repeat(66)}`, null]) {
    assert.throws(() => encodeMint({ message: raw, attestation }), /CCTP_INVALID_ATTESTATION/);
  }
  assert.doesNotThrow(() => encodeMint({ message: raw, attestation: concat([ATTESTATION, ATTESTATION]) }));
  assert.throws(() => encodeMint({ message: message({ fee: 101n }), attestation: ATTESTATION }), /CCTP_INVALID_FEE_EXECUTED/);
});
