import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
test('R12 actual temporary-close caller retains uncertain descriptor and owner debt without retry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ynx-auth-fd-public-'));
 const header=fileURLToPath(new URL('./original-auth-identity-source-authority.h',import.meta.url));
 const node=readFileSync(new URL('../../../apps/wallet-desktop/native/original-auth-identity-node.mm',import.meta.url),'utf8');
 const caller=node.match(/static bool CloseTemporary\([^]*?\n\}/)?.[0];
 assert.ok(caller,'real Node CloseTemporary caller missing');
 assert.match(node,/h->closed=!h->cleanupFailed&&!h->commitDescriptor.unresolved\(\)&&!h->readDescriptor.unresolved\(\)/);
 assert.match(node,/CloseTemporary\(h,h->commitDescriptor\)/);
 assert.match(node,/if\(fd>=0\)CloseTemporary\(h,h->readDescriptor\)/);
 assert.match(node,/bool closeFailed=!CloseTemporary\(h,h->readDescriptor\)/);
 const source=join(dir,'fd.cc'),binary=join(dir,'fd');
 writeFileSync(source,`#include ${JSON.stringify(header)}\n#include <cassert>\n#include <unordered_set>\nstruct OriginalAuthHandle {bool cleanupFailed=false;};\nstatic std::unordered_set<OriginalAuthHandle*> debt;\nstatic int calls=0,rc=0,last=-1;\nstatic int close(int fd){++calls;last=fd;return rc;}\n${caller}\nint main(){using ynx_auth_private::TemporaryDescriptor;OriginalAuthHandle h;TemporaryDescriptor ok;assert(ok.hold(7));assert(CloseTemporary(&h,ok));assert(calls==1&&last==7&&!ok.unresolved());assert(CloseTemporary(&h,ok));assert(calls==1);assert(ok.hold(8));rc=-1;assert(!CloseTemporary(&h,ok));assert(calls==2&&last==8&&ok.unresolved()&&ok.identity()==8);assert(h.cleanupFailed&&debt.count(&h));assert(!CloseTemporary(&h,ok));assert(calls==2);assert(!ok.hold(9));assert(ok.identity()==8);TemporaryDescriptor invalid;assert(invalid.hold(11));assert(!CloseTemporary(&h,invalid));assert(calls==3&&invalid.unresolved());assert(!CloseTemporary(&h,invalid));assert(calls==3);}`);
 const compiled=spawnSync('/usr/bin/clang++',['-std=c++17',source,'-o',binary],{encoding:'utf8'});assert.equal(compiled.status,0,compiled.stderr);
 const run=spawnSync(binary,[],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
});
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
