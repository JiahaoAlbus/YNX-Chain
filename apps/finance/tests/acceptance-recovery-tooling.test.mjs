import assert from 'node:assert/strict';
import test from 'node:test';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createTarGz,parseTarGz,sha256} from '../scripts/finance-v3-acceptance-recovery-lib.mjs';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('acceptance recovery archive is byte-exact and canonical',()=>{
  const entries=[{path:'bundle/z.txt',body:Buffer.from('z'),mode:0o644},{path:'bundle/a.sh',body:Buffer.from('#!/bin/sh\n'),mode:0o755}];
  const options={mtime:'2026-09-21T00:00:00.000Z'};
  const first=createTarGz(entries,options),second=createTarGz([...entries].reverse(),options);
  assert.equal(sha256(first),sha256(second));
  assert.deepEqual(parseTarGz(first).map(({path,body,mode})=>({path,body:body.toString(),mode})),[{path:'bundle/a.sh',body:'#!/bin/sh\n',mode:0o755},{path:'bundle/z.txt',body:'z',mode:0o644}]);
});

test('acceptance recovery archive rejects traversal and duplicates',()=>{
  const options={mtime:'2026-09-21T00:00:00.000Z'};
  assert.throws(()=>createTarGz([{path:'../secret',body:Buffer.alloc(0)}],options),/UNSAFE_PATH/);
  assert.throws(()=>createTarGz([{path:'a',body:Buffer.alloc(0)},{path:'a',body:Buffer.alloc(0)}],options),/DUPLICATE_PATH/);
});

test('acceptance recovery archive rejects checksum tampering and truncation',()=>{
  const archive=createTarGz([{path:'bundle/a',body:Buffer.from('alpha')}],{mtime:'2026-09-21T00:00:00.000Z'});
  const tar=gunzipSync(archive),headerTamper=Buffer.from(tar);headerTamper[0]^=1;
  assert.throws(()=>parseTarGz(gzipSync(headerTamper,{mtime:0})),/CHECKSUM_MISMATCH/);
  const sizeTamper=Buffer.from(tar);sizeTamper.write('77777777777\0',124,'ascii');sizeTamper.fill(0x20,148,156);const sum=[...sizeTamper.subarray(0,512)].reduce((a,b)=>a+b,0);sizeTamper.write(`${sum.toString(8).padStart(6,'0')}\0 `,148,'ascii');
  assert.throws(()=>parseTarGz(gzipSync(sizeTamper,{mtime:0})),/TRUNCATED_ENTRY/);
});

test('builder keeps the recovery command independent from its output pathname',()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const body=readFileSync(join(root,'scripts/build-finance-v3-acceptance-recovery.mjs'),'utf8');
  assert.match(body,/--archive \$\{prefix\}\.tar\.gz --source \$\{source\}/);
  assert.doesNotMatch(body,/--archive \$\{basename\(output\)\}/);
  for(const required of ["'apps/finance/'","'internal/accountaddress/'","'internal/buildinfo/'","'internal/chain/'","'internal/consensus/'","'internal/ethnative/'","'internal/productsessionv2/'","'internal/readintegration/'","'docs/integration/'","'release/integration/'","'sdk/js/'"])assert.ok(body.includes(required),required);
  const verifier=readFileSync(join(root,'scripts/verify-finance-v3-acceptance-recovery.mjs'),'utf8');
  for(const command of ["run('npm',['--prefix','apps/finance/web','ci']","run('go',['test','-race'","run('go',['vet'","run('go',['build'","run('npm',['--prefix','apps/finance','test']","run('npm',['--prefix','apps/finance','run','security']","run('npm',['--prefix','apps/finance','run','smoke']"])assert.ok(verifier.includes(command),command);
});
