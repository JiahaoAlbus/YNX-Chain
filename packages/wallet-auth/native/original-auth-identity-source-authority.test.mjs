import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
test('R11 PUBLIC actual portable C++ current/lifecycle primitive enforces floor generation revoke and UNKNOWN once',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ynx-auth-source-public-'));
 // Isolated PUBLIC fixture only: executes actual header methods, never Cocoa,
 // Node addon, private profile, signatures, Source authority or resources.
 const header=fileURLToPath(new URL('./original-auth-identity-source-authority.h',import.meta.url));
 const source=join(dir,'fixture.cc'),binary=join(dir,'fixture');
 writeFileSync(source,`#include ${JSON.stringify(header)}\n#include <cassert>\nint main(){ynx_auth_private::SourceClock c;assert(c.observe(100,50,200,1,1,false));assert(!c.observe(99,50,200,1,1,false));assert(!c.observe(200,50,200,1,1,false));assert(!c.observe(100,50,200,1,1,true));assert(!c.observe(100,50,200,2,1,false));assert(c.observe(110,50,200,2,2,false));assert(!c.observe(110,50,200,1,1,false));ynx_auth_private::JointLifecycle j;assert(j.enterCommit());assert(!j.enterCommit());assert(j.phase==ynx_auth_private::JointPhase::unknown);assert(j.completeReadback());assert(!j.completeReadback());assert(j.selectCleanup());assert(!j.selectCleanup());j.completedCleanup(false);assert(!j.cleanupComplete);j.completedCleanup(true);assert(j.phase==ynx_auth_private::JointPhase::closed);}`);
 const compiler=spawnSync('/usr/bin/clang++',['-std=c++17',source,'-o',binary],{encoding:'utf8'});assert.equal(compiler.status,0,compiler.stderr);
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 console.log('PUBLIC_CXX_HEADER_COMPILE=0 PUBLIC_CXX_HEADER_RUN=0');
});
