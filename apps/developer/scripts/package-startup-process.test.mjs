import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const developer=fileURLToPath(new URL('../',import.meta.url));
test('normal Mac packager copies the complete startup probe import and preserves every listed source byte',async()=>{
 const script=await fs.readFile(path.join(developer,'scripts/package-local-macos.sh'),'utf8');
 const lines=script.split('\n').filter(x=>x.startsWith('cp desktop/local-workbench.mjs '));
 assert.equal(lines.length,1,'Exercise the actual original desktop cp command');
 const sources=lines[0].match(/desktop\/[a-zA-Z0-9._-]+/g);
 const target=await fs.mkdtemp(path.join(tmpdir(),'ynx-startup-package-'));
 try{
  const copied=spawnSync('/bin/cp',[...sources,target],{cwd:developer,encoding:'utf8'});
  assert.equal(copied.status,0,copied.stderr);
  const workbench=await fs.readFile(path.join(target,'local-workbench.mjs'),'utf8');
  const imports=[...workbench.matchAll(/from '\.\/([^']+)'/g)].map(x=>x[1]);
  assert.ok(imports.includes('local-startup-process.mjs'),'The real workbench must exercise its new startup dependency');
  const helper=path.join(target,'local-startup-process.mjs');
  assert.deepEqual(await fs.readFile(helper),await fs.readFile(path.join(developer,'desktop/local-startup-process.mjs')));
  const loaded=await import(pathToFileURL(helper));assert.equal(typeof loaded.inspectBundledNodeVersion,'function');
  for(const source of sources)assert.deepEqual(await fs.readFile(path.join(target,path.basename(source))),await fs.readFile(path.join(developer,source)));
 }finally{await fs.rm(target,{recursive:true,force:true});}
});
