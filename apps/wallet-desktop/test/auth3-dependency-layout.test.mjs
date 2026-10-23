import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {walletAuthDependencyPlan} from '../scripts/wallet-auth-dependencies.mjs';
import {canonicalArchivePlan,SDK_ALIAS} from '../scripts/canonical-package.mjs';

const prefix='code/packages/wallet-auth/node_modules/';
const relative=p=>p.startsWith('@noble/ciphers/')?'@noble/post-quantum/node_modules/'+p:p;
const dependencyRoot=process.env.PROVENANCE_SDK_DEPENDENCY_ROOT??fileURLToPath(new URL('../../../packages/wallet-auth/node_modules/',import.meta.url));
function fixture(t){
 const root=mkdtempSync(path.join(tmpdir(),'wallet-auth3-dependency-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(name,bytes)=>{const file=path.join(root,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes);};
 const bytes=readFileSync(new URL('../scripts/wallet-auth-runtime-dependencies.json',import.meta.url)),manifest=JSON.parse(bytes);
 put('apps/wallet-desktop/scripts/wallet-auth-runtime-dependencies.json',bytes);
 const sdk=JSON.parse(readFileSync(new URL('../../../packages/wallet-auth/package.json',import.meta.url)));
 put('packages/wallet-auth/package.json',JSON.stringify({...sdk,version:'1.3.0-pq.3.32-auth.3'}));
 // Frozen public bytes only; reproduce npm's distinct root and PQ-local graphs.
 for(const pin of manifest.files)put('packages/wallet-auth/node_modules/'+relative(pin.path),readFileSync(path.join(dependencyRoot,relative(pin.path))));
 const outer=Buffer.from('{"name":"@noble/ciphers","version":"1.3.0","main":"index.js"}');
 put('packages/wallet-auth/node_modules/@noble/ciphers/package.json',outer);
 put('packages/wallet-auth/node_modules/@noble/ciphers/index.js','module.exports="PUBLIC root 1.3";');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
 git('init','--quiet');git('add','apps','packages');git('-c','user.name=PUBLIC QA','-c','user.email=qa@example.invalid','commit','--quiet','-m','public dependency layout');
 return {root,put,outer,manifest,commit:git('rev-parse','HEAD')};
}
test('auth3 collects all 316 exact leaves from the real nested PQ graph without replacing root ciphers',t=>{
 const f=fixture(t),plan=walletAuthDependencyPlan(f.root,f.commit);
 assert.equal(plan.rows.length,316);
 for(const pin of f.manifest.files){const target=prefix+relative(pin.path);assert.equal(plan.rows.find(r=>r.path===target)?.sha256,pin.sha256,target);}
 assert.equal(plan.contents.has(prefix+'@noble/ciphers/package.json'),false);
 assert.deepEqual(readFileSync(path.join(f.root,'packages/wallet-auth/node_modules/@noble/ciphers/package.json')),f.outer);
 const pqRequire=createRequire(path.join(f.root,'packages/wallet-auth/node_modules/@noble/post-quantum/package.json'));
 assert.equal(pqRequire.resolve('@noble/ciphers/chacha.js'),realpathSync(path.join(f.root,'packages/wallet-auth/node_modules/@noble/post-quantum/node_modules/@noble/ciphers/chacha.js')));
 assert.equal(JSON.parse(plan.contents.get(prefix+'@noble/post-quantum/node_modules/@noble/ciphers/package.json')).version,'2.2.0');
});
test('auth3 canonical archive retains root ciphers and the independent nested PQ resolution path',t=>{
 const f=fixture(t),plan=walletAuthDependencyPlan(f.root,f.commit);
 const rootPath='node_modules/@noble/ciphers/package.json',rootRow={path:rootPath,type:'file',bytes:f.outer.length,sha256:'PUBLIC unchanged root identity',unpacked:false};
 const before=[rootRow,{path:SDK_ALIAS,type:'directory',unpacked:false},{path:'native/original-auth-identity.node',type:'file',unpacked:true}];
 const archive=canonicalArchivePlan(before,Buffer.from(JSON.stringify({main:'code/apps/wallet-desktop/src/main.mjs'})),plan.rows);
 assert.deepEqual(archive.after.find(r=>r.path===rootPath),rootRow);
 assert.equal(archive.after.some(r=>r.path===prefix+'@noble/ciphers/package.json'),false);
 const nested=prefix+'@noble/post-quantum/node_modules/@noble/ciphers/package.json';
 assert.equal(archive.after.find(r=>r.path===nested).sha256,plan.rows.find(r=>r.path===nested).sha256);
 assert.equal(archive.after.find(r=>r.path===SDK_ALIAS+'/node_modules/@noble/post-quantum/node_modules/@noble/ciphers/chacha.js').link,prefix+'@noble/post-quantum/node_modules/@noble/ciphers/chacha.js');
});
test('auth3 refuses a damaged nested leaf and never falls back to a valid flat copy',t=>{
 const f=fixture(t),pin=f.manifest.files.find(p=>p.path==='@noble/ciphers/package.json');
 const good=readFileSync(path.join(f.root,'packages/wallet-auth/node_modules/',relative(pin.path)));
 f.put('packages/wallet-auth/node_modules/'+pin.path,good);
 const damaged=Buffer.from(good);damaged[damaged.length-1]^=1;
 f.put('packages/wallet-auth/node_modules/'+relative(pin.path),damaged);
 assert.throws(()=>walletAuthDependencyPlan(f.root,f.commit),/SDK_RUNTIME_DEPENDENCY_INPUT_DIFFERS:@noble\/ciphers\/package.json/);
});
