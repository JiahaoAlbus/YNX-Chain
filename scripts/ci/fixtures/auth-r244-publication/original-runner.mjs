// CI-only runner. PUBLIC temporary brand seam is confined to a disposable
// dependency copy; it is never a production release/service registration.
import fs from'node:fs/promises';import os from'node:os';import path from'node:path';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const source=fileURLToPath(new URL('../',import.meta.url)),root=await fs.mkdtemp(path.join(os.tmpdir(),'auth-r244-public-'));
for(const d of ['src','native'])await fs.cp(path.join(source,d),path.join(root,d),{recursive:true,dereference:true});
for(const f of await fs.readdir(source))if(f.endsWith('.json'))await fs.copyFile(path.join(source,f),path.join(root,f));
await fs.symlink(path.join(source,'node_modules'),path.join(root,'node_modules'));
await fs.appendFile(path.join(root,'src/original-auth-identity-source-current.js'),'\nexport function r244PUBLICBrand(s){services.add(s);}\n');
await fs.copyFile(path.join(source,'test-r244-publication-completion.mjs'),path.join(root,'test-r244.mjs'));
const r=spawnSync(process.execPath,['--test','test-r244.mjs'],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:2<<20});
await fs.writeFile(path.join(root,'stdout.log'),r.stdout??'');await fs.writeFile(path.join(root,'stderr.log'),r.stderr??'');
process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');console.log('PUBLIC fixture evidence retained:',root);process.exitCode=r.status===0?0:1;
