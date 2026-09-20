#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseTarGz,sha256} from './finance-v3-acceptance-recovery-lib.mjs';

const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error(`missing ${name}`);return args[i+1]};
const archivePath=arg('--archive'),source=arg('--source');
if(!/^[0-9a-f]{40}$/.test(source))throw new Error('source must be lowercase 40-hex');
const archive=readFileSync(archivePath),sidecar=JSON.parse(readFileSync(`${archivePath}.manifest.json`,'utf8'));
assert.equal(archive.length,sidecar.archive.bytes);assert.equal(sha256(archive),sidecar.archive.sha256);assert.equal(sidecar.source.commit,source);
const entries=parseTarGz(archive),byPath=new Map(entries.map(entry=>[entry.path,entry]));
assert.equal(byPath.size,entries.length);assert.equal(entries.length,sidecar.entryCount);
const manifestEntry=byPath.get(`${sidecar.bundleRoot}/manifest.json`);assert.ok(manifestEntry);
assert.equal(manifestEntry.body.length,sidecar.manifest.bytes);assert.equal(sha256(manifestEntry.body),sidecar.manifest.sha256);
const manifest=JSON.parse(manifestEntry.body);assert.equal(manifest.source.commit,source);assert.equal(manifest.source.tree,sidecar.source.tree);
assert.equal(manifest.scope.credentialsBundled,false);assert.equal(manifest.scope.deploymentPerformed,false);
assert.equal(manifest.walletReleaseEvidence.version,'1.0.18-testnet-preview');assert.equal(manifest.walletReleaseEvidence.productionSigned,false);assert.equal(manifest.walletReleaseEvidence.storeReleased,false);
for(const value of Object.values(manifest.externalTruth))assert.ok(value===false||value==='NOT_VERIFIED');
const expected=new Set([`${sidecar.bundleRoot}/manifest.json`]);
for(const file of manifest.files){
  const path=`${sidecar.bundleRoot}/repository/${file.path}`;expected.add(path);const entry=byPath.get(path);assert.ok(entry,file.path);assert.equal(entry.body.length,file.bytes,file.path);assert.equal(sha256(entry.body),file.sha256,file.path);assert.equal(entry.mode===0o755?'0755':'0644',file.mode,file.path);
}
assert.deepEqual([...byPath.keys()].sort(),[...expected].sort());
for(const required of ['internal/finance/broker.go','internal/finance/brokerage/alpaca.go','internal/finance/broker_activation.go','internal/finance/broker_order_contract.go','apps/finance/cmd/broker-tools/main.go','apps/finance/evidence/finance-revocation-strictness-20260921.json','apps/wallet/artifact-publication-1.0.18.json'])assert.ok(manifest.files.some(file=>file.path===required),required);
process.stdout.write(`${JSON.stringify({verified:true,source:manifest.source,archive:sidecar.archive,entries:entries.length,externalTruth:manifest.externalTruth})}\n`);
