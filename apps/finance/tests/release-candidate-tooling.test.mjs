import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runtimeFiles,sha256} from '../scripts/finance-nonregressive-runtime.mjs';

const financeRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot=join(financeRoot,'web');

test('weekly v3 release tooling closes every served Finance runtime asset',()=>{
  const expected=[
    'app.js','health.json','index.html','manifest.webmanifest',
    'order-wallet-entry.js','order-wallet.js','read-sources.js','styles.css',
    'vercel.json','wallet-auth-entry.js','wallet-auth.js','ynx-logo.png',
  ];
  assert.equal(Object.isFrozen(runtimeFiles),true);
  assert.deepEqual(runtimeFiles,expected);
  assert.equal(new Set(runtimeFiles).size,runtimeFiles.length);
  for(const name of runtimeFiles)assert.equal(statSync(join(webRoot,name)).isFile(),true,name);

  const server=readFileSync(join(financeRoot,'../../internal/finance/server.go'),'utf8');
  const staticMap=server.match(/name := map\[string\]string\{([^\n]+)\}\[r\.URL\.Path\]/)?.[1];
  assert.ok(staticMap,'Finance static route map is missing');
  const served=[...staticMap.matchAll(/"\/[^"]*": "([^"]+)"/g)].map(match=>match[1]);
  assert.ok(served.includes('order-wallet.js'));
  for(const name of new Set(served)){
    if(name==='build-identity.json')continue;
    assert.ok(runtimeFiles.includes(name),`served runtime is absent from release: ${name}`);
  }

  const index=readFileSync(join(webRoot,'index.html'),'utf8');
  for(const script of ['wallet-auth.js','order-wallet.js','app.js','read-sources.js']){
    assert.match(index,new RegExp(`<script src="/${script.replace('.','\\.')}" defer></script>`));
  }
  assert.equal(sha256(Buffer.from('ynx-finance-release')),'17b99d3a55fae95ecefdb1bcab7c09a951f7af0bdc04acc47b28f5921d4bdbed');
});

test('weekly v3 builder imports the tracked runtime helper',()=>{
  const builder=readFileSync(join(financeRoot,'scripts/build-finance-weekly-v3-candidate.mjs'),'utf8');
  assert.match(builder,/import \{ runtimeFiles, sha256 \} from '\.\/finance-nonregressive-runtime\.mjs';/);
  assert.match(builder,/repeatedBuildByteExact: true/);
  assert.match(builder,/FINANCE_WEEKLY_V3_CANDIDATE_NONDETERMINISTIC/);
});
