import { Interface, dataSlice, getAddress, getBytes, hexlify, keccak256, zeroPadValue } from 'ethers';

// Pins verified against Circle's contract-addresses and USDC address tables on
// 2026-10-18. ABI/layout source: circlefin/evm-cctp-contracts commit
// 7d703109a2cfcb3f76375fef5f1a97f03c447b94. This module never signs or sends.
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
const MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_NONCE = `0x${'00'.repeat(32)}`;
const HEADER_BYTES = 148;
const BURN_BODY_BYTES = 228;

export const ROUTE = Object.freeze({
  id: 'cctp-v2-sepolia-base-sepolia-usdc',
  testnet: true,
  asset: 'USDC',
  decimals: 6,
  minFinalityThreshold: 2000,
  apiBaseUrl: 'https://iris-api-sandbox.circle.com',
  source: Object.freeze({
    name: 'Ethereum Sepolia', chainId: 11155111, domain: 0,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenMessenger: TOKEN_MESSENGER, messageTransmitter: MESSAGE_TRANSMITTER,
  }),
  destination: Object.freeze({
    name: 'Base Sepolia', chainId: 84532, domain: 6,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokenMessenger: TOKEN_MESSENGER, messageTransmitter: MESSAGE_TRANSMITTER,
  }),
});

const tokenInterface = new Interface(['function approve(address spender,uint256 value) returns (bool)']);
const messengerInterface = new Interface([
  'function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold)',
]);
const transmitterInterface = new Interface(['function receiveMessage(bytes message,bytes attestation) returns (bool)']);

function invalid(field, reason) {
  const error = new Error(`CCTP_INVALID_${field}: ${reason}`);
  error.code = `CCTP_INVALID_${field}`;
  throw error;
}

function units(value, field, { positive = false } = {}) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    invalid(field, 'an exact unsigned integer is required');
  }
  if (!['string', 'bigint', 'number'].includes(typeof value) || !/^(0|[1-9][0-9]*)$/.test(String(value))) {
    invalid(field, 'an exact unsigned decimal integer is required');
  }
  const result = BigInt(value);
  if (result > UINT256_MAX || (positive && result === 0n)) invalid(field, 'outside uint256 bounds');
  return result;
}

function address(value, field) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) invalid(field, 'an EVM address is required');
  let result;
  try { result = getAddress(value); } catch { invalid(field, 'invalid address checksum'); }
  if (/^0x0{40}$/.test(result)) invalid(field, 'zero address is not allowed');
  return result;
}

function bytes(value, field) {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) invalid(field, 'nonempty even-length hex is required');
  return getBytes(value);
}

function transferAmounts(amountUnits, maxFeeUnits) {
  const amount = units(amountUnits, 'AMOUNT', { positive: true });
  const maxFee = units(maxFeeUnits, 'MAX_FEE');
  if (maxFee >= amount) invalid('MAX_FEE', 'must be less than the burn amount');
  return { amount, maxFee };
}

/** Exact allowance for the pinned source USDC; the caller binds tx.to/chain. */
export function encodeApprove(amountUnits) {
  return tokenInterface.encodeFunctionData('approve', [ROUTE.source.tokenMessenger, units(amountUnits, 'AMOUNT', { positive: true })]);
}

/** Standard CCTP only. Claim authority is bound to the selected external account. */
export function encodeBurn({ amountUnits, recipient, maxFeeUnits, account }) {
  const { amount, maxFee } = transferAmounts(amountUnits, maxFeeUnits);
  return messengerInterface.encodeFunctionData('depositForBurn', [
    amount, ROUTE.destination.domain, zeroPadValue(address(recipient, 'RECIPIENT'), 32),
    ROUTE.source.usdc, zeroPadValue(address(account, 'ACCOUNT'), 32), maxFee, ROUTE.minFinalityThreshold,
  ]);
}

function parseMessage(message) {
  const raw = bytes(message, 'MESSAGE');
  // This route deliberately does not authorize hooks or arbitrary message data.
  if (raw.length !== HEADER_BYTES + BURN_BODY_BYTES) invalid('MESSAGE', 'expected the 376-byte CCTP V2 burn message without hooks');
  const hex = hexlify(raw);
  const uint = (offset, length) => BigInt(dataSlice(hex, offset, offset + length));
  const addressAt = (offset, field) => {
    if (uint(offset, 12) !== 0n) invalid(field, 'noncanonical bytes32 EVM address');
    return address(dataSlice(hex, offset + 12, offset + 32), field);
  };
  return {
    message: hex, messageHash: keccak256(hex),
    version: Number(uint(0, 4)), sourceDomain: Number(uint(4, 4)), destinationDomain: Number(uint(8, 4)),
    nonce: dataSlice(hex, 12, 44), sender: addressAt(44, 'SENDER'), recipient: addressAt(76, 'MESSAGE_RECIPIENT'),
    destinationCaller: addressAt(108, 'DESTINATION_CALLER'),
    minFinalityThreshold: Number(uint(140, 4)), finalityThresholdExecuted: Number(uint(144, 4)),
    messageBody: dataSlice(hex, HEADER_BYTES), bodyVersion: Number(uint(148, 4)),
    burnToken: addressAt(152, 'BURN_TOKEN'), mintRecipient: addressAt(184, 'MINT_RECIPIENT'),
    amountUnits: uint(216, 32).toString(), messageSender: addressAt(248, 'MESSAGE_SENDER'),
    maxFeeUnits: uint(280, 32).toString(), feeExecuted: uint(312, 32).toString(), expirationBlock: uint(344, 32).toString(),
  };
}

function requireEqual(actual, expected, field) {
  if (actual !== expected) invalid(field, 'does not match the confirmed transfer');
}

function validateRoute(decoded) {
  requireEqual(decoded.version, 1, 'MESSAGE_VERSION');
  requireEqual(decoded.bodyVersion, 1, 'BODY_VERSION');
  requireEqual(decoded.sourceDomain, ROUTE.source.domain, 'SOURCE_DOMAIN');
  requireEqual(decoded.destinationDomain, ROUTE.destination.domain, 'DESTINATION_DOMAIN');
  requireEqual(decoded.sender, getAddress(ROUTE.source.tokenMessenger), 'SENDER');
  requireEqual(decoded.recipient, getAddress(ROUTE.destination.tokenMessenger), 'MESSAGE_RECIPIENT');
  requireEqual(decoded.burnToken, getAddress(ROUTE.source.usdc), 'BURN_TOKEN');
  requireEqual(decoded.minFinalityThreshold, ROUTE.minFinalityThreshold, 'MIN_FINALITY');
}

/**
 * Validate immutable user intent before using Iris data or source MessageSent.
 * Monetary values are decimal strings for lossless journal persistence.
 * source mode validates the emitted message's empty offchain fields; attested
 * mode validates Iris' populated fields. A nonzero expiry needs a fresh target
 * block read. Signature authenticity remains the pinned transmitter's job.
 */
export function decodeAndValidateMessage(message, {
  account, recipient, amountUnits, maxFeeUnits, mode = 'attested', destinationBlockNumber,
}) {
  if (!['attested', 'source'].includes(mode)) invalid('MODE', 'expected source or attested');
  const { amount, maxFee } = transferAmounts(amountUnits, maxFeeUnits);
  const decoded = parseMessage(message);
  validateRoute(decoded);
  requireEqual(decoded.destinationCaller, address(account, 'ACCOUNT'), 'DESTINATION_CALLER');
  requireEqual(decoded.messageSender, address(account, 'ACCOUNT'), 'MESSAGE_SENDER');
  requireEqual(decoded.mintRecipient, address(recipient, 'RECIPIENT'), 'MINT_RECIPIENT');
  requireEqual(decoded.amountUnits, amount.toString(), 'AMOUNT');
  requireEqual(decoded.maxFeeUnits, maxFee.toString(), 'MAX_FEE');

  const fee = BigInt(decoded.feeExecuted);
  const expiry = BigInt(decoded.expirationBlock);
  if (fee > maxFee || fee >= amount) invalid('FEE_EXECUTED', 'exceeds the confirmed fee cap or burn amount');
  if (mode === 'source') {
    requireEqual(decoded.nonce, ZERO_NONCE, 'SOURCE_NONCE');
    requireEqual(decoded.finalityThresholdExecuted, 0, 'SOURCE_FINALITY');
    requireEqual(decoded.feeExecuted, '0', 'SOURCE_FEE');
    requireEqual(decoded.expirationBlock, '0', 'SOURCE_EXPIRY');
  } else {
    if (decoded.nonce === ZERO_NONCE) invalid('NONCE', 'Iris must assign a nonzero V2 nonce');
    requireEqual(decoded.finalityThresholdExecuted, ROUTE.minFinalityThreshold, 'FINALITY');
    if (expiry !== 0n) {
      if (destinationBlockNumber === undefined) invalid('EXPIRY', 'a fresh destination block is required');
      if (expiry <= units(destinationBlockNumber, 'DESTINATION_BLOCK')) invalid('EXPIRY', 'message expired; re-attestation is required');
    }
  }
  return Object.freeze({ ...decoded, mode, amountReceived: (amount - fee).toString() });
}

/** Calldata encoding only: callers MUST first validate against persisted intent. */
export function encodeMint({ message, attestation }) {
  const decoded = parseMessage(message);
  validateRoute(decoded);
  if (decoded.nonce === ZERO_NONCE) invalid('NONCE', 'source messages cannot be minted');
  requireEqual(decoded.finalityThresholdExecuted, ROUTE.minFinalityThreshold, 'FINALITY');
  const { amount, maxFee } = transferAmounts(decoded.amountUnits, decoded.maxFeeUnits);
  const fee = BigInt(decoded.feeExecuted);
  if (fee > maxFee || fee >= amount) invalid('FEE_EXECUTED', 'exceeds the fee cap or burn amount');
  const signatures = bytes(attestation, 'ATTESTATION');
  if (signatures.length % 65 !== 0) invalid('ATTESTATION', 'expected concatenated 65-byte Circle signatures');
  return transmitterInterface.encodeFunctionData('receiveMessage', [decoded.message, hexlify(signatures)]);
}
