import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const developer=fileURLToPath(new URL('../',import.meta.url));
test('normal package copy recipe retains the linked private transport and refuses either missing new module',async()=>{
  const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-private-package-'));
  const app=path.join(fixture,'App.app'),root=path.join(app,'Contents/Resources/code/apps/developer');
  await fs.mkdir(path.join(root,'desktop'),{recursive:true});
  try{
    const recipe=await fs.readFile(path.join(developer,'scripts/package-local-macos.sh'),'utf8');
    const commands=recipe.split('\n').map(line=>line.trim()).filter(line=>line.startsWith('cp desktop/')&&line.endsWith('/desktop/"')&&/wallet-admission-delivery|original-service-pipe|private-payload-pump/.test(line));
    for(const command of commands)execFileSync('/bin/bash',['-c',command],{cwd:developer,env:{...process.env,app},stdio:'pipe'});
    const entry=path.join(root,'desktop/original-service-pipe.mjs');
    for(const name of ['original-service-pipe.mjs','private-payload-pump.mjs'])assert.deepEqual(await fs.readFile(path.join(root,'desktop',name)),await fs.readFile(path.join(developer,'desktop',name)));
    const run=()=>spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(pathToFileURL(entry).href)+');'],{encoding:'utf8',timeout:5000});
    const linked=run();assert.equal(linked.status,0,linked.stderr);
    for(const name of ['original-service-pipe.mjs','private-payload-pump.mjs']){
      const source=path.join(root,'desktop',name);await fs.rename(source,source+'.retained');
      const failed=run();assert.notEqual(failed.status,0);assert.match(failed.stderr,/ERR_MODULE_NOT_FOUND/);
      await fs.rename(source+'.retained',source);
    }
  }finally{await fs.rm(fixture,{recursive:true,force:true});}
});
