// Fixed private DATA calls for the pending collector.
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalJSON } from '../src/canonical.js';
import {
  createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA as allocationFromSeed,
  createOriginalDeviceRegistrationPublicOriginalsCanonicalDATA,
} from '../src/original-device-registration-public-originals-core.mjs';

const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const Bytes = Uint8Array;
const copyBytes = Uint8Array.prototype.set;

function invalidArguments() {
  return Object.assign(Error('DEVICE_REGISTRATION_PUBLIC_ORIGINALS_ARGUMENTS'), {
    code: 'DEVICE_REGISTRATION_PUBLIC_ORIGINALS_ARGUMENTS',
  });
}

function originalHex(value, size) {
  const copied = new Bytes(size);
  try {
    if (byteLength.call(value) !== size) throw invalidArguments();
    copyBytes.call(copied, new Bytes(value));
    if (byteLength.call(value) !== size) throw invalidArguments();
  } catch {
    throw invalidArguments();
  }
  return bytesToHex(copied);
}

export function createOriginalDeviceRegistrationPublicOriginalsDATA(
  creationIntentOriginal, pkAOriginal, pkBOriginal, allocationOriginal,
) {
  if (arguments.length !== 4 || typeof creationIntentOriginal !== 'string' ||
      typeof allocationOriginal !== 'string') throw invalidArguments();

  return createOriginalDeviceRegistrationPublicOriginalsCanonicalDATA(canonicalJSON({
    creationIntentOriginal,
    publicPair: {
      pkA: originalHex(pkAOriginal, 2592),
      pkB: originalHex(pkBOriginal, 64),
    },
    allocationOriginal,
  }));
}

export function createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA(seedOriginal) {
  if (arguments.length !== 1 || typeof seedOriginal !== 'string') throw invalidArguments();
  return allocationFromSeed(seedOriginal);
}
