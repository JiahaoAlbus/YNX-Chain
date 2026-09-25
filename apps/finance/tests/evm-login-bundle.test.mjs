import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from '../web/node_modules/esbuild/lib/main.js';

const source=new URL('../scripts/evm-product-login-authority.mjs',import.meta.url);
const bundle=new URL('../scripts/evm-product-login-authority.bundle.mjs',import.meta.url);

test('Finance release carries the byte-reproducible accepted Wallet/Auth verifier without runtime node_modules',async()=>{
  const options={absWorkingDir:fileURLToPath(new URL('../../../',import.meta.url)),entryPoints:[fileURLToPath(source)],bundle:true,platform:'node',target:'node22',format:'esm',write:false};
  const [first,second,committed]=await Promise.all([build(options),build(options),readFile(bundle)]);
  assert.equal(first.outputFiles.length,1);
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents),Buffer.from(second.outputFiles[0].contents));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents),committed);
  assert.equal(committed.includes(Buffer.from('@ynx-chain/wallet-auth')),false);
  const runtime=await readFile(new URL('../scripts/finance-nonregressive-runtime.mjs',import.meta.url),'utf8');
  assert.match(runtime,/evm-product-login-authority\.bundle\.mjs/);
});
