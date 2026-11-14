import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const loader = join(root, 'apps/cloud/scripts/load-protected-cloud-image.sh');
const sha = data => createHash('sha256').update(data).digest('hex');

function fixture(t, {swapAfterHash = false, failLoad = false} = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'ynx-cloud-image-loader-'));
  t.after(() => rmSync(temp, {recursive: true, force: true}));
  const bin = join(temp, 'bin');
  const archive = join(temp, 'archive');
  const stage = join(temp, 'stage');
  for (const dir of [bin, archive, stage]) mkdirSync(dir, {mode: 0o700});
  const original = Buffer.from('PUBLIC EXPECTED IMAGE ARCHIVE\n');
  const replacement = Buffer.from('PUBLIC DIFFERENT IMAGE ARCHIVE\n');
  const image = `sha256:${'a'.repeat(64)}`;
  const input = join(archive, 'cloud-native-image.tar');
  const replacementPath = join(temp, 'replacement');
  const capture = join(temp, 'loaded-bytes');
  const loadedPath = join(temp, 'loaded-path');
  const events = join(temp, 'events');
  writeFileSync(input, original);
  writeFileSync(replacementPath, replacement);
  writeFileSync(join(archive, 'IMAGE-ID'), `${image}\n`);
  const shaStub = join(temp, 'sha-stub.cjs');
  const dockerStub = join(temp, 'docker-stub.cjs');
  writeFileSync(shaStub, `const fs=require('fs'),crypto=require('crypto');\nconst data=fs.readFileSync(0);\nprocess.stdout.write(crypto.createHash('sha256').update(data).digest('hex')+'  -\\n');\nif(process.env.P04_SWAP==='1')fs.renameSync(process.env.P04_REPLACEMENT,process.env.P04_INPUT);\n`);
  writeFileSync(dockerStub, `const fs=require('fs');\nconst a=process.argv.slice(2),event=x=>fs.appendFileSync(process.env.P04_EVENTS,x+'\\n');\nif(a[0]==='image'&&a[1]==='load'){event('load');const p=a[a.indexOf('--input')+1];fs.writeFileSync(process.env.P04_LOADED_PATH,p);fs.writeFileSync(process.env.P04_CAPTURE,fs.readFileSync(p));process.exit(process.env.P04_FAIL_LOAD==='1'?17:0)}\nif(a[0]==='image'&&a[1]==='inspect'){event('inspect');if(a[3].includes('Config.User'))console.log('linux 10001:10001 ["/usr/local/bin/ynx-cloudd","-require-ide-deployment"]');else console.log(process.env.P04_IMAGE);process.exit(0)}\nif(a[0]==='run'){event('verify');process.exit(0)}\nprocess.exit(2);\n`);
  writeFileSync(join(bin, 'sha256sum'), '#!/bin/sh\nexec "$P04_NODE" "$P04_SHA_STUB" "$@"\n', {mode: 0o700});
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexec "$P04_NODE" "$P04_DOCKER_STUB" "$@"\n', {mode: 0o700});
  const env = {
    PATH: `${bin}:/usr/bin:/bin:/sbin`, P04_NODE: process.execPath,
    P04_SHA_STUB: shaStub, P04_DOCKER_STUB: dockerStub,
    P04_INPUT: input, P04_REPLACEMENT: replacementPath, P04_CAPTURE: capture,
    P04_LOADED_PATH: loadedPath, P04_EVENTS: events, P04_IMAGE: image,
    P04_SWAP: swapAfterHash ? '1' : '0', P04_FAIL_LOAD: failLoad ? '1' : '0',
    YNX_CLOUD_IMAGE_STAGE_DIR: stage,
  };
  return {archive, stage, input, capture, loadedPath, events, image, original, replacement, env};
}

test('loads the verified private snapshot when the source path is replaced', t => {
  const f = fixture(t, {swapAfterHash: true});
  const result = spawnSync('sh', [loader, f.archive, f.image, sha(f.original)], {env: f.env, encoding: 'utf8', timeout: 10000});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(f.input), f.replacement);
  assert.deepEqual(readFileSync(f.capture), f.original);
  const path = readFileSync(f.loadedPath, 'utf8');
  assert.ok(path.startsWith(`${f.stage}/`));
  assert.equal(existsSync(path), false);
  assert.deepEqual(readdirSync(f.stage), []);
  assert.deepEqual(readFileSync(f.events, 'utf8').trim().split('\n'), ['load', 'inspect', 'inspect', 'verify']);
});

test('rejects an incorrect archive digest before image load and cleans staging', t => {
  const f = fixture(t);
  const result = spawnSync('sh', [loader, f.archive, f.image, 'b'.repeat(64)], {env: f.env, encoding: 'utf8', timeout: 10000});
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(f.capture), false);
  assert.equal(existsSync(f.events), false);
  assert.deepEqual(readdirSync(f.stage), []);
});

test('does not continue verification after a failed image load', t => {
  const f = fixture(t, {failLoad: true});
  const result = spawnSync('sh', [loader, f.archive, f.image, sha(f.original)], {env: f.env, encoding: 'utf8', timeout: 10000});
  assert.notEqual(result.status, 0);
  assert.deepEqual(readFileSync(f.capture), f.original);
  assert.deepEqual(readFileSync(f.events, 'utf8').trim().split('\n'), ['load']);
  assert.deepEqual(readdirSync(f.stage), []);
});
