import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.resolve(base,'../desktop/macos/original-ide-parent-supplier.mm'),'utf8');
const start=source.indexOf('- (void)retire {');
const end=source.indexOf('\n- (BOOL)finish:',start);
if(start<0||end<=start||source.indexOf('- (void)retire {',start+1)>=0)throw Error('RETIRE_SELECTOR_NOT_UNIQUE');
// Compile the exact production method text, not a model of its behavior.
// All other objects are PUBLIC failure doubles, not native authority.
const method=source.slice(start,end);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-auth-retire-drain-'));
const fixture=`#import <Foundation/Foundation.h>
#include <cassert>
static unsigned endpointCalls=0,sourceCalls=0;
static bool endpointThrows=false,endpointFails=false,sourceThrows=false;
static NSError *endpointError;
static id endpointException,sourceException;
static NSError *ParentFailure(NSString *code){return [NSError errorWithDomain:@"PUBLIC" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];}
struct Life {unsigned retireCalls=0;void retire(){++retireCalls;}};
struct Observation {bool retireEndpoint(NSError **error){++endpointCalls;if(endpointThrows)@throw endpointException;if(endpointFails){*error=endpointError;return false;}return true;}};
@interface PublicSource:NSObject
- (void)retire;
@end
@implementation PublicSource
- (void)retire {++sourceCalls;if(sourceThrows)@throw sourceException;}
@end
@interface TestGuard:NSObject {
@public BOOL _retired,_retireSelected,_peerAdmitted;
Life _lifetime;Observation _observation;PublicSource *_source;
NSError *_first,*_cleanup;id _originalCause;
}
- (void)retire;
@end
@implementation TestGuard
${method}
@end
static void run(bool throws,bool fails,bool sourceFault){
endpointCalls=sourceCalls=0;endpointThrows=throws;endpointFails=fails;sourceThrows=sourceFault;
TestGuard *guard=[TestGuard new];guard->_peerAdmitted=YES;guard->_source=[PublicSource new];
[guard retire];assert(endpointCalls==1);assert(sourceCalls==1);assert(guard->_retired&&guard->_retireSelected);
NSError *firstCleanup=guard->_cleanup;id firstCause=guard->_originalCause;
if(throws)assert(firstCause==endpointException);
if(fails)assert(firstCleanup==endpointError);
if(!throws&&sourceFault)assert(firstCause==sourceException);
if(!throws&&!fails&&!sourceFault)assert(!firstCleanup&&!firstCause);
[guard retire];assert(endpointCalls==1&&sourceCalls==1);assert(guard->_cleanup==firstCleanup&&guard->_originalCause==firstCause);
}
int main(){@autoreleasepool{endpointError=ParentFailure(@"endpoint-first");endpointException=ParentFailure(@"endpoint-exception");sourceException=ParentFailure(@"source-exception");run(false,false,false);run(true,false,false);run(false,true,true);run(true,false,true);run(false,false,true);puts("PASS actual retire method: independent Source drain, original first cause/cleanup, no second resource attempt; PUBLIC only");}return 0;}
`;
fs.writeFileSync(path.join(directory,'fixture.mm'),fixture,{flag:'wx',mode:0o600});
const binary=path.join(directory,'fixture');
for(const [name,cmd,args] of [
 ['compile','/Library/Developer/CommandLineTools/usr/bin/clang++',['-std=c++17','-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk','-mmacosx-version-min=13.0','-fobjc-arc','-Wall','-Wextra','-Werror','-framework','Foundation',path.join(directory,'fixture.mm'),'-o',binary]],
 ['execute',binary,[]]
]){
 const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 for(const k of ['stdout','stderr'])fs.writeFileSync(path.join(directory,name+'.'+k),r[k]??'',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({name,directory,status:r.status,signal:r.signal,error:r.error?.code??null,stdout:r.stdout,stderr:r.stderr}));
 if(r.error||r.status!==0){process.exitCode=1;break;}
}
