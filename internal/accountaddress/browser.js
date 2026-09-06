// Browser address codec; parity-tested against Go and sdk/js/index.js.
// Address formatting only: no provider, RPC, keys, storage, or transactions.
(function (root) {
"use strict";
const YNX_ADDRESS_HRP = "ynx";
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_REVERSE = Object.freeze(Object.fromEntries([...BECH32_CHARSET].map((character, index) => [character, index])));


class YNXSDKError extends Error {
  constructor(message, {cause, status, code} = {}) {
    super(message, {cause});
    this.name = "YNXSDKError";
    this.status = status;
    this.code = code;
  }
}

function convertAddressBits(data, fromBits, toBits, pad) {
  let accumulator = 0;
  let bits = 0;
  const result = [];
  const maxValue = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) throw new YNXSDKError("address payload value exceeds conversion bit width");
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
  }
  if (pad && bits > 0) result.push((accumulator << (toBits - bits)) & maxValue);
  if (!pad && (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0)) {
    throw new YNXSDKError("address payload has invalid Bech32 padding");
  }
  return result;
}

function bech32HRPExpand(hrp) {
  return [...hrp].map((character) => character.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((character) => character.charCodeAt(0) & 31));
}

function bech32Polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    generators.forEach((generator, index) => {
      if ((top >>> index) & 1) checksum = (checksum ^ generator) >>> 0;
    });
  }
  return checksum >>> 0;
}

function decodeHexAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/i.test(value.trim())) {
    throw new YNXSDKError("account address must be 0x-prefixed with 40 hex characters");
  }
  const normalized = value.trim().slice(2).toLowerCase();
  return Array.from({length: 20}, (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16));
}

function toYNXAddress(value) {
  const payload = decodeHexAddress(toEVMAddress(value));
  const data = convertAddressBits(payload, 8, 5, true);
  const expanded = bech32HRPExpand(YNX_ADDRESS_HRP).concat(data, [0, 0, 0, 0, 0, 0]);
  const checksum = bech32Polymod(expanded) ^ 1;
  const checksumValues = Array.from({length: 6}, (_, index) => (checksum >>> (5 * (5 - index))) & 31);
  return `${YNX_ADDRESS_HRP}1${data.concat(checksumValues).map((item) => BECH32_CHARSET[item]).join("")}`;
}

function toEVMAddress(value) {
  if (typeof value !== "string") throw new YNXSDKError("account address must be a string");
  value = value.trim();
  if (!value.toLowerCase().startsWith(`${YNX_ADDRESS_HRP}1`)) {
    return `0x${decodeHexAddress(value).map((item) => item.toString(16).padStart(2, "0")).join("")}`;
  }
  if (value.length > 90) throw new YNXSDKError("YNX address exceeds Bech32 maximum length");
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) {
    throw new YNXSDKError("YNX address must not mix uppercase and lowercase");
  }
  value = value.toLowerCase();
  const separator = value.lastIndexOf("1");
  if (separator <= 0 || separator + 7 > value.length) throw new YNXSDKError("YNX address has an invalid Bech32 separator or checksum length");
  if (value.slice(0, separator) !== YNX_ADDRESS_HRP) throw new YNXSDKError('YNX address HRP must be "ynx"');
  const data = [...value.slice(separator + 1)].map((character) => {
    const decoded = BECH32_REVERSE[character];
    if (decoded === undefined) throw new YNXSDKError("YNX address contains an invalid Bech32 character");
    return decoded;
  });
  if (bech32Polymod(bech32HRPExpand(YNX_ADDRESS_HRP).concat(data)) !== 1) {
    throw new YNXSDKError("YNX address checksum is invalid");
  }
  const payload = convertAddressBits(data.slice(0, -6), 5, 8, false);
  if (payload.length !== 20) throw new YNXSDKError("YNX address payload must be 20 bytes");
  return `0x${payload.map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeYNXAddress(value) {
  const evmAddress = toEVMAddress(value);
  return Object.freeze({evmAddress, ynxAddress: toYNXAddress(evmAddress)});
}


root.YNXAddress = Object.freeze({toYNXAddress, toEVMAddress, normalizeYNXAddress});
})(globalThis);
