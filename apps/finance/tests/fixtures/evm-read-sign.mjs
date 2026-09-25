import { readFileSync } from 'node:fs';
import { p256 } from '../../../../packages/wallet-auth/node_modules/@noble/curves/nist.js';
import { secp256k1 } from '../../../../packages/wallet-auth/node_modules/@noble/curves/secp256k1.js';
import { keccak_256 } from '../../../../packages/wallet-auth/node_modules/@noble/hashes/sha3.js';
import { bytesToHex, concatBytes } from '../../../../packages/wallet-auth/node_modules/@noble/hashes/utils.js';
import {
  createEvmProductSessionHttpProof, createEvmProductSessionLoginProof,
  createEvmProductSessionRevokeProof, ethereumPersonalMessageDigest,
  evmProductSessionMessage,
} from '@ynx-chain/wallet-auth';

// Deterministic TEST KEYS ONLY. Never import this fixture into a runtime build.
const wallet = new Uint8Array(32).fill(7);
const device = new Uint8Array(32).fill(9);
const account = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(wallet, false).slice(1)).slice(-20))}`;
const deviceKey = Buffer.from(p256.getPublicKey(device, true)).toString('base64url');
const secret = Buffer.from(device).toString('base64url');
const input = JSON.parse(readFileSync(0, 'utf8'));
let result;
if (input.action === 'identity') {
  result = { account, deviceId: 'finance-test-browser-device-000001', deviceKey };
} else if (input.action === 'login') {
  const message = evmProductSessionMessage(input.challenge);
  const signed = secp256k1.sign(ethereumPersonalMessageDigest(message), wallet, { prehash: false, format: 'recovered' });
  const walletSignature = `0x${bytesToHex(concatBytes(signed.slice(1), Uint8Array.of(signed[0] + 27)))}`;
  result = createEvmProductSessionLoginProof(input.challenge, walletSignature, secret);
} else if (input.action === 'read') {
  result = createEvmProductSessionHttpProof(input.session, input.request, secret);
} else if (input.action === 'revoke') {
  result = createEvmProductSessionRevokeProof(input.session, input.request, secret);
} else {
  throw new Error('unsupported test fixture action');
}
process.stdout.write(`${JSON.stringify(result)}\n`);
