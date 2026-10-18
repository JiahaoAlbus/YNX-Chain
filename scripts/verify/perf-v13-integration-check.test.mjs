import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
for(const kind of ['current-runtime','bundle-manifest'])test('fixed V13 consumer rejects '+kind+' substitution before immutable-source acceptance',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-perf-v13-input-'));
 try{
  const bundle='release/integration/candidates/perf-state-v13';
  const map=JSON.parse(fs.readFileSync(path.join(root,bundle,'source-map.json'),'utf8'));
  const files=[...Object.keys(map.files),...fs.readdirSync(path.join(root,bundle)).map(n=>path.join(bundle,n)),'scripts/verify/perf-v13-integration-check.mjs'];
  for(const f of files){const out=path.join(tmp,f);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(root,f),out);}
  const target=kind==='current-runtime'?'internal/consensus/state.go':path.join(bundle,'SHA256SUMS');
  fs.appendFileSync(path.join(tmp,target),'\nsubstituted input\n');
  const r=spawnSync(process.execPath,[path.join(tmp,'scripts/verify/perf-v13-integration-check.mjs')],{encoding:'utf8',timeout:5000});
  assert.equal(r.status,1,r.stderr);
  assert.match(r.stderr,kind==='current-runtime'?/current runtime\/source differs from fixed V13 candidate: internal\/consensus\/state.go/:/fixed original V13 bundle manifest differs/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
