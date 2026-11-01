#!/usr/bin/env node
// Public RPC bytes and temporary QA signatures only. Never a production issuer
// or actual person's consent. Private fixture keys remain in this process.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const directory = process.argv[2];
if (process.argv.length !== 3 || !directory || !path.isAbsolute(directory) || fs.realpathSync(directory) !== directory) throw Error('One existing absolute private QA directory required');
const info = fs.lstatSync(directory);
if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid()) throw Error('Private current-user 0700 QA directory required');
const save = (name, bytes) => fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx', mode: 0o600 });
const digest = (algorithm, bytes) => crypto.createHash(algorithm).update(bytes).digest('hex');
const bind = bytes => ({bytes: String(bytes.length), sha3_512: digest('sha3-512', bytes), sha512: digest('sha512', bytes)});
const source = 'https://rpc.ynxweb4.com';
async function read(endpoint, maximum) {
  const response = await fetch(source + endpoint, {redirect: 'error', signal: AbortSignal.timeout(15000)});
  if (response.status !== 200) throw Error(`Public RPC status ${response.status}`);
  const parts = []; let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > maximum) throw Error('Public RPC response bound');
    parts.push(part);
  }
  const raw = Buffer.concat(parts);
  const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw));
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('Public RPC JSON object required');
  return {raw, value};
}
const status = await read('/status', 1 << 20);
// Select the numeric URL directly from the original lexeme, without converting
// a potentially large chain height through a JavaScript Number.
const heights = [...status.raw.toString('utf8').matchAll(/"height"\s*:\s*([0-9]+)(?=\s*[,}])/g)];
if (heights.length !== 1 || !/^[1-9][0-9]{0,19}$/.test(heights[0][1])) throw Error('Single canonical public height required');
const height = heights[0][1];
const block = await read('/blocks/' + height, 4 << 20);
save('public-status.json', status.raw);
save('public-block.json', block.raw);
const issuer = crypto.generateKeyPairSync('ed25519'), consent = crypto.generateKeyPairSync('ed25519');
const publicBytes = key => Buffer.from(key.export({format: 'jwk'}).x, 'base64url');
const issuerPublic = publicBytes(issuer.publicKey), consentPublic = publicBytes(consent.publicKey);
const limits = {cpuMilli: '1000', memoryBytes: String(129*65536 + 2*block.raw.length + 65536), storageBytes: '0', egressBytes: '0', durationMillis: '5000'};
const expiresAt = new Date(Date.now() + 3600000).toISOString();
const work = {job: 'qa-block-' + height + '-' + crypto.randomBytes(8).toString('hex'), kind: 'public_block_histogram', issuer: 'temporary-fixture-issuer', input: bind(block.raw), limits, expiresAt};
const manifestPayload = Buffer.from(JSON.stringify({domain: 'YNX_NETWORK_PUBLIC_BLOCK_HISTOGRAM_SANDBOX_V1', work}));
const approval = {principal: 'temporary-fixture-person', job: work.job, manifest: bind(manifestPayload), limits, expiresAt, nonce: 'qa-' + crypto.randomBytes(16).toString('hex'), allow: true};
const consentPayload = Buffer.from(JSON.stringify({domain: 'YNX_NETWORK_CONSENT_SANDBOX_V1', consent: approval}));
const packet = {version: 'YNX-NETWORK-CONTROLLED-WASM-PACKET/v1', classification: 'CONTROLLED_SANDBOX', work, consent: approval, issuerPublicKey: issuerPublic.toString('hex'), consentPublicKey: consentPublic.toString('hex'), manifestSignature: crypto.sign(null, manifestPayload, issuer.privateKey).toString('hex'), consentSignature: crypto.sign(null, consentPayload, consent.privateKey).toString('hex'), input: block.raw.toString('base64')};
save('packet.json', JSON.stringify(packet) + '\n');
const readback = {classification: 'CONTROLLED_SANDBOX', productionEnabled: false, humanConsentEstablished: false, publisherAuthority: 'CONTROLLED_FIXTURE_ONLY', publicSourceClassification: 'RPC_ONLY', observedAt: new Date().toISOString(), source, height, blockBytes: block.raw.length, blockSHA256: digest('sha256', block.raw), issuerKeySHA256: digest('sha256', issuerPublic), consentKeySHA256: digest('sha256', consentPublic), packet: path.join(directory, 'packet.json')};
save('fixture-readback.json', JSON.stringify(readback, null, 2) + '\n');
process.stdout.write(JSON.stringify(readback) + '\n');
