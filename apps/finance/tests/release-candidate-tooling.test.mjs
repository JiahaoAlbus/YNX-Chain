import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {authorityRuntimeFiles,runtimeFiles,sha256} from '../scripts/finance-nonregressive-runtime.mjs';

const financeRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const webRoot=join(financeRoot,'web');

test('weekly v3 release tooling closes every served Finance runtime asset',()=>{
  const expected=[
    'app.js','evm-read-session.js','finance-locale.js','health.json','index.html','manifest.webmanifest',
    'order-wallet-entry.js','order-wallet.js','product-catalog.js','read-sources.js','styles.css',
    'vercel.json','wallet-auth-entry.js','wallet-auth.js','ynx-logo.png',
  ];
  assert.equal(Object.isFrozen(runtimeFiles),true);
  assert.deepEqual(runtimeFiles,expected);
  assert.equal(new Set(runtimeFiles).size,runtimeFiles.length);
  for(const name of runtimeFiles)assert.equal(statSync(join(webRoot,name)).isFile(),true,name);
  assert.deepEqual(authorityRuntimeFiles.map(value=>value.destination),[
    'authority-runtime/apps/finance/scripts/evm-read-browser-entry.mjs',
    'authority-runtime/apps/finance/scripts/evm-read-session-authority.mjs',
    'authority-runtime/apps/finance/scripts/evm-subject-authority.mjs',
    'authority-runtime/apps/finance/scripts/evm-product-login-authority.bundle.mjs',
    'authority-runtime/apps/finance/scripts/evm-read-session-authority.bundle.mjs',
    'authority-runtime/apps/finance/scripts/evm-subject-authority.bundle.mjs',
    'authority-runtime/apps/finance/scripts/finance-endpoint-authority-v2.mjs',
    'authority-runtime/apps/finance/authority/adapter.mjs',
    'authority-runtime/apps/finance/authority/config.mjs',
    'authority-runtime/apps/finance/authority/checkpoint-node.mjs',
    'authority-runtime/sdk/js/endpoint-authority-v2.js',
  ]);
  for(const file of authorityRuntimeFiles)assert.equal(statSync(join(financeRoot,'../..',file.source)).isFile(),true,file.source);

  const server=readFileSync(join(financeRoot,'../../internal/finance/server.go'),'utf8');
  const staticMap=server.match(/name := map\[string\]string\{([^\n]+)\}\[r\.URL\.Path\]/)?.[1];
  assert.ok(staticMap,'Finance static route map is missing');
  const served=[...staticMap.matchAll(/"\/[^"]*": "([^"]+)"/g)].map(match=>match[1]);
  assert.ok(served.includes('order-wallet.js'));
  assert.ok(served.includes('evm-read-session.js'));
  for(const name of new Set(served)){
    if(name==='build-identity.json')continue;
    assert.ok(runtimeFiles.includes(name),`served runtime is absent from release: ${name}`);
  }

  const index=readFileSync(join(webRoot,'index.html'),'utf8');
  for(const script of ['finance-locale.js','wallet-auth.js','order-wallet.js','evm-read-session.js','app.js','read-sources.js','product-catalog.js']){
    assert.match(index,new RegExp(`<script src="/${script.replace('.','\\.')}" defer></script>`));
  }
  assert.equal(sha256(Buffer.from('ynx-finance-release')),'17b99d3a55fae95ecefdb1bcab7c09a951f7af0bdc04acc47b28f5921d4bdbed');
});

test('weekly v3 builder imports the tracked runtime helper',()=>{
  const builder=readFileSync(join(financeRoot,'scripts/build-finance-weekly-v3-candidate.mjs'),'utf8');
  assert.match(builder,/import \{ authorityRuntimeFiles, runtimeFiles, sha256 \} from '\.\/finance-nonregressive-runtime\.mjs';/);
  assert.match(builder,/FINANCE_AUTHORITY_RUNTIME_SOURCE_BINDING_MISMATCH/);
  assert.match(builder,/repeatedBuildByteExact: true/);
  assert.match(builder,/FINANCE_WEEKLY_V3_CANDIDATE_NONDETERMINISTIC/);
});
