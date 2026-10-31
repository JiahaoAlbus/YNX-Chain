// Explicit PUBLIC negative component check; separate from stub/Source tests.
// Usage: node this-file.mjs /absolute/main/native/device-v5-protocol /absolute/matching/sdk/native
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');assert.equal(process.argv.length,4);
const [delivery,sdkNative]=process.argv.slice(2);for(const p of [delivery,sdkNative])assert.ok(path.isAbsolute(p)&&path.normalize(p)===p);
const fixtures=fileURLToPath(new URL('.',import.meta.url)),native=path.resolve(fixtures,'../../native'),hash=b=>createHash('sha256').update(b).digest('hex');
const header=await fs.readFile(path.join(delivery,'product_session_http_v5.h')),archive=path.join(delivery,'libynx_artifact_release.a');
assert.equal(header.length,3429);assert.equal(hash(header),'00100302fe9ee1c0e0ab81d6c1c52975f31f4a35967b73d51691ab8b275e28b7');
const archiveHash=hash(await fs.readFile(archive));assert.equal(archiveHash,'f078524c371648a284343d69496e4d37276f3a90bea220af7ef99e568e883c6a');
const dir=await fs.mkdtemp(path.join(homedir(),'.ynx-public-v5-negative-'));await fs.chmod(dir,0o700);
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});assert.equal(r.error,undefined,r.error?.message);assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout;}
try{const binary=path.join(dir,'negative');run('/usr/bin/clang++',['-std=c++17','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-mmacosx-version-min=13.0','-I'+path.dirname(delivery),'-I'+delivery,'-I'+sdkNative,'-I'+native,path.join(fixtures,'product-device-v5-core-negative.cpp'),archive,'-pthread','-lm','-lresolv','-framework','CoreFoundation','-framework','Security','-o',binary]);const output=run(binary,[await fs.realpath(dir)]);assert.match(output,/ACTUAL_CORE_V5_NEGATIVE_4_PREFLIGHTS_COLD_UNKNOWN_PASS/);assert.equal(hash(await fs.readFile(archive)),archiveHash);process.stdout.write(JSON.stringify({actualCoreCABI:true,archiveSHA256:archiveHash,headerSHA256:hash(header),publicNegativeCases:4,coldUnknownRead:true,positiveMath:false,Source:false,HTTP:false,output:output.trim()})+'\n');}
finally{await fs.rm(dir,{recursive:true,force:true});}
