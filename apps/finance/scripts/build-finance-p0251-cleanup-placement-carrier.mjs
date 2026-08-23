#!/usr/bin/env node
// Deterministically frames the two non-secret placement objects. The signed
// cleanup lease is supplied by Central only after this source is reviewed.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [executor, lease, output] = process.argv.slice(2);
if (!executor || !lease || !output) throw new Error('usage: build <executor> <signed-lease> <output>');
const digest = value => createHash('sha256').update(value).digest('hex');
const item = (name, mode, path) => {
  const data = readFileSync(path);
  return { name, mode, bytes: data.length, sha256: digest(data), data: data.toString('base64') };
};
const frames = [item('executor', '0700', executor), item('lease', '0600', lease)];
const carrier = ['YNX-FINANCE-P0251-CLEANUP-PLACEMENT-1', ...frames.flatMap(frame => [`FRAME ${frame.name} ${frame.mode} ${frame.bytes} ${frame.sha256}`, frame.data]), 'END', ''].join('\n');
writeFileSync(output, carrier);
const bytes = readFileSync(output);
process.stdout.write(`${JSON.stringify({ path: output, bytes: bytes.length, sha256: digest(bytes), frames })}\n`);
