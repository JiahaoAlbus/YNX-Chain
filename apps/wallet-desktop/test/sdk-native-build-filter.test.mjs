import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const project=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(new URL('../package.json',import.meta.url));
const {FileMatcher,getNodeModuleFileMatcher}=require('app-builder-lib/out/fileMatcher.js');
const config=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).build;
const bad='node_modules/@ynx-chain/wallet-auth/native/tests/ide-close-order/run.mjs';
const keep=['src/main.mjs','node_modules/@ynx-chain/wallet-auth/src/index.js','node_modules/@ynx-chain/wallet-auth/native/original-auth-identity-joint-owner.test.mjs','node_modules/@ynx-chain/wallet-auth/native/original-auth-identity-source-authority.test.mjs','node_modules/@ynx-chain/wallet-auth/native/publication-readonly-source-r28-20261018/source/index.mjs','node_modules/@noble/ciphers/package.json'];
const stat={isDirectory:()=>false};
test('normal app file matcher excludes undeclared SDK native test runners without dropping fixed source evidence',()=>{
 const filter=new FileMatcher(project,'/PUBLIC/output',value=>value,config.files).createFilter();
 assert.equal(filter(path.join(project,bad),stat),false);
 for(const name of keep)assert.equal(filter(path.join(project,name),stat),true,name);
});
test('actual normal node-module matcher also applies the scoped exclusion to relocated SDK files',()=>{
 const matcher=getNodeModuleFileMatcher(project,'/PUBLIC/output',value=>value,{}, {config,debugLogger:{isEnabled:false}}),filter=matcher.isEmpty()?()=>true:matcher.createFilter();
 assert.equal(filter('/PUBLIC/SDK/native/tests/ide-close-order/run.mjs',{...stat,moduleFullFilePath:bad}),false);
 for(const name of keep.filter(n=>n.startsWith('node_modules/')))assert.equal(filter('/PUBLIC/SDK/file',{...stat,moduleFullFilePath:name}),true,name);
});
