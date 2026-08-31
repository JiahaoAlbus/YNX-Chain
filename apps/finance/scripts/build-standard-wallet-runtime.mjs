#!/usr/bin/env node
/**
 * Rebuild the Finance browser-only Standard Wallet runtime from the accepted
 * Wallet/Auth source tree.  The generated asset is a product packaging step;
 * it never changes the shared Wallet/Auth source directory.
 */
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';

const SOURCE_COMMIT='98c6d5d784d212df8981a53b17118a511e246ad2';
const SOURCE_TREE='51a60a362d4ad5dd748bcdefb101f71b1d9e0cee';
const EVIDENCE_COMMIT='c3ab255c32bdeb9c8e056882c315f8ad43c29c7f';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const OUTPUT=join(ROOT,'apps/finance/web/standard-wallet-runtime.js');
const MODULES=Object.freeze([
  'wallet-provider-discovery.js',
  'standard-wallet-connect-state.js',
  'canonical.js',
]);

function source(path){
  const result=spawnSync('git',['show',`${SOURCE_COMMIT}:packages/wallet-auth/src/${path}`],{cwd:ROOT,encoding:'utf8'});
  if(result.status!==0)throw new Error(`Cannot read accepted Wallet/Auth source ${path}: ${(result.stderr||'unknown git failure').trim()}`);
  return result.stdout;
}

const dir=await mkdtemp(join(tmpdir(),'ynx-finance-standard-wallet-'));
try{
  for(const file of MODULES)await writeFile(join(dir,file),source(file));
  await writeFile(join(dir,'entry.js'),[
    `// Accepted shared authority: ${SOURCE_COMMIT} / ${SOURCE_TREE} / ${EVIDENCE_COMMIT}`,
    "export * from './wallet-provider-discovery.js';",
    "export * from './standard-wallet-connect-state.js';",
  ].join('\n'));
  await build({
    absWorkingDir:ROOT,
    entryPoints:[join(dir,'entry.js')],
    bundle:true,
    minify:true,
    platform:'browser',
    target:'es2022',
    format:'iife',
    globalName:'YNXFinanceStandardWalletRuntime',
    nodePaths:[join(ROOT,'packages/wallet-auth/node_modules')],
    banner:{js:`/* Finance browser packaging of Wallet/Auth ${SOURCE_COMMIT}; source tree ${SOURCE_TREE}; evidence ${EVIDENCE_COMMIT}. */`},
    outfile:OUTPUT,
  });
}finally{await rm(dir,{recursive:true,force:true});}
