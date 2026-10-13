import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
test('R13 actual persistent channel and child custody callers close once and join exact drain',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ynx-auth-r13-public-'));
 const header=fileURLToPath(new URL('./original-auth-identity-source-authority.h',import.meta.url));
 const node=readFileSync(new URL('../../../apps/wallet-desktop/native/original-auth-identity-node.mm',import.meta.url),'utf8');
 const method=name=>{const value=node.match(new RegExp('static bool '+name+'\\([^]*?\\n\\}'))?.[0];assert.ok(value,`missing actual ${name}`);return value;};
 const helpers=['CloseTemporary','ChannelAvailable','CloseChannel','JoinReady','Close'].map(method).join('\n');
 const tail=node.match(/if\(!Current\(h\)\)return nullptr;if\(!CloseChannel\(h\)\)[^]*?return original;/)?.[0];assert.ok(tail);
 assert.ok(node.indexOf('if(!ChannelAvailable(h))')<node.indexOf('h->channel=socket('));
 assert.match(node,/channelDescriptor.hold\(h->channel\)/);
 assert.match(node,/if\(!JoinReady\(h\)\)return Error\(env,"AUTH_IDENTITY_CHILDREN_NOT_JOINED"\)/);
 assert.match(node,/h->parent->retired\|\|h->parent->closed\|\|h->parent->cleanupFailed/);
 const source=join(dir,'caller.mm'),binary=join(dir,'caller');
 writeFileSync(source,`#import <Foundation/Foundation.h>\n#include ${JSON.stringify(header)}\n#include <unordered_set>\n#include <cassert>\n#include <cstring>\n#include <iostream>\n@interface PublicSource:NSObject\n-(void)retire;-(BOOL)join:(NSError**)e;-(BOOL)close:(NSError**)e;\n@end\n@implementation PublicSource\n-(void)retire{} -(BOOL)join:(NSError**)e{return YES;} -(BOOL)close:(NSError**)e{return YES;}\n@end\nenum class Kind{administration,joint};struct OriginalAuthHandle{Kind kind=Kind::joint;bool retired=false,closed=false,closeSelected=false,cleanupFailed=false;unsigned children=0;int channel=-1,journalDir=-1;OriginalAuthHandle*parent=nullptr;PublicSource*source=nil;ynx_auth_private::JointLifecycle life;ynx_auth_private::TemporaryDescriptor commitDescriptor,readDescriptor,channelDescriptor;};\nstatic std::unordered_set<OriginalAuthHandle*>debt;static int calls=0,rc=0,last=-1;static int PUBLIC_CLOSE(int fd){++calls;last=fd;return rc;}\n#define close(fd) PUBLIC_CLOSE(fd)\n${helpers}\n#undef close\nstatic bool current=true;static bool Current(OriginalAuthHandle*){return current;}static void*Error(void*,const char*){return nullptr;}\nstatic void*ChannelTail(OriginalAuthHandle*h){void*env=nullptr;void*original=(void*)1;${tail}}\nint main(int n,char**v){assert(n==2);\nif(!strcmp(v[1],"children")){OriginalAuthHandle p,c;p.children=1;c.parent=&p;assert(!JoinReady(&p));assert(!Close(&p));assert(p.retired&&!p.closeSelected&&!p.cleanupFailed&&!JoinReady(&p));assert(Close(&c));assert(p.children==0&&c.parent==nullptr&&JoinReady(&p));assert(Close(&p)&&p.closed&&!debt.count(&p));assert(Close(&p));assert(calls==0);}\nelse if(!strcmp(v[1],"channel")){OriginalAuthHandle h;h.channel=80;assert(h.channelDescriptor.hold(80));rc=-1;assert(!ChannelTail(&h));assert(calls==1&&h.channel==80&&h.channelDescriptor.identity()==80&&!ChannelAvailable(&h));rc=0;assert(!Close(&h));assert(!Close(&h));assert(calls==1&&last==80&&debt.count(&h));assert(!h.channelDescriptor.hold(81));}\nelse if(!strcmp(v[1],"nooverwrite")){OriginalAuthHandle h;assert(ChannelAvailable(&h));h.channel=90;assert(h.channelDescriptor.hold(90));assert(!ChannelAvailable(&h));assert(CloseChannel(&h)&&ChannelAvailable(&h));h.channel=91;assert(h.channelDescriptor.hold(91));assert(CloseChannel(&h));assert(calls==2&&last==91);assert(Close(&h));assert(calls==2);}\nelse if(!strcmp(v[1],"prior-debt")){OriginalAuthHandle p,c;p.children=1;p.cleanupFailed=true;c.parent=&p;assert(!Close(&p));assert(Close(&c));assert(p.children==0&&JoinReady(&p));assert(!Close(&p));assert(p.cleanupFailed&&debt.count(&p));}\nelse if(!strcmp(v[1],"uncertain-child")){OriginalAuthHandle p,c;p.children=1;c.parent=&p;c.channel=50;assert(c.channelDescriptor.hold(50));rc=-1;assert(!Close(&c));assert(c.parent==&p&&p.children==1);assert(!Close(&p));assert(!JoinReady(&p));assert(calls==1);}\nelse if(!strcmp(v[1],"late-fence")){OriginalAuthHandle h;h.channel=60;assert(h.channelDescriptor.hold(60));current=false;assert(!ChannelTail(&h));assert(calls==0&&!ChannelAvailable(&h));assert(Close(&h));assert(calls==1&&last==60&&h.closed);}\nelse return 2;std::cout<<"R13_ACTUAL_CALLER_PUBLIC_"<<v[1]<<"_PASS_NO_REAL_FD_NO_GRANT\\n";return 0;}`);
 const compiled=spawnSync('/usr/bin/clang++',['-std=c++17','-fobjc-arc',source,'-framework','Foundation','-o',binary],{encoding:'utf8'});assert.equal(compiled.status,0,compiled.stderr);
 for(const name of ['children','channel','nooverwrite','prior-debt','uncertain-child','late-fence']){const run=spawnSync(binary,[name],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);console.log(run.stdout.trim());}
});
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
