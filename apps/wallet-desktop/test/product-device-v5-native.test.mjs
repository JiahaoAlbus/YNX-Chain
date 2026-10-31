import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)),native=path.join(root,'native'),fixtures=path.join(root,'test/native'),stub=path.join(fixtures,'v5-public-host');
const applicable=['darwin','linux'].includes(process.platform);
let directory,binary,dirfdBinary,sdkNative;
function run(command,args,timeout=30000){const r=spawnSync(command,args,{encoding:'utf8',timeout,maxBuffer:1024*1024});assert.equal(r.error,undefined,r.error?.message);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;}
const hash=b=>createHash('sha256').update(b).digest('hex');
before(async()=>{
 if(!applicable)return;
 directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-public-v5-cpp-'));binary=path.join(directory,'public-controls');dirfdBinary=path.join(directory,'actual-dirfd');
 const sdkEntry=createRequire(import.meta.url).resolve('@ynx-chain/wallet-auth');let at=path.dirname(sdkEntry);for(let i=0;i<4;i++,at=path.dirname(at))if(existsSync(path.join(at,'native/original-host-dirfd-journal.h'))){sdkNative=path.join(at,'native');break;}
 assert.ok(sdkNative,'Matching normal SDK native HostDirfdJournal input is required.');
 const header=await fs.readFile(path.join(stub,'device-v5-protocol/product_session_http_v5.h'));assert.equal(header.length,3429);assert.equal(hash(header),'00100302fe9ee1c0e0ab81d6c1c52975f31f4a35967b73d51691ab8b275e28b7');
 const common=['-std=c++17','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-pthread'];
 run(process.platform==='darwin'?'/usr/bin/clang++':'c++',[...common,'-I'+stub,'-I'+native,'-I'+sdkNative,path.join(fixtures,'product-device-v5-public.cpp'),...(process.platform==='linux'?['-lcrypto']:[]),'-o',binary]);
 // Header include resolution here selects the REAL SDK HostDirfdJournal.
 run(process.platform==='darwin'?'/usr/bin/clang++':'c++',[...common,'-I'+sdkNative,'-I'+native,'-I'+stub,path.join(fixtures,'product-device-v5-dirfd-public.cpp'),...(process.platform==='linux'?['-lcrypto']:[]),'-o',dirfdBinary]);
});
after(async()=>{if(directory)await fs.rm(directory,{recursive:true,force:true});});
const scenarios=['success','max-member','no-reserve','constructor-bounds','span-bounds','thread','reserve-list','reserve-before-entered','reserve-ack-entered','reserve-read-entered','collision-body','collision-ctype','collision-original','collision-pair','collision-owner','domain-identity','large-body','orphan','corrupt-terminal','changed-body','changed-body-length','changed-null-body','changed-unsigned-length','changed-ctype','changed-original','changed-network','changed-owner','changed-pair','changed-pair-b','changed-borrow-pair','changed-layout','changed-version','relocated-equal-body','negative-rc','bad-cleanup','zero','throw','dual-failure','dual-readback','oversize','terminal-before-terminal','terminal-ack-terminal','terminal-read-terminal','terminal-allocation-terminal'];
for(const scenario of scenarios)test('PUBLIC V5 once/typed HTTP '+scenario,{skip:!applicable},()=>{assert.match(run(binary,[scenario]),new RegExp('PUBLIC_V5_'+scenario+'_PASS'));});
test('actual protected HostDirfdJournal keeps V5 original and cold read never signs twice',{skip:!applicable},async()=>{
 const original=await fs.mkdtemp(path.join(homedir(),'.ynx-public-v5-dirfd-'));await fs.chmod(original,0o700);try{assert.match(run(dirfdBinary,[await fs.realpath(original)]),/ACTUAL_DIRFD_COLD_NO_REPLAY_PASS/);}finally{await fs.rm(original,{recursive:true,force:true});}
});
