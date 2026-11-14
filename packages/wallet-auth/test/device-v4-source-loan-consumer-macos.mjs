import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
if(process.platform!=='darwin')throw Error('DARWIN_REQUIRED_FOR_REAL_OBJC_BACKEND');
const native=process.env.YNX_V4_TEST_NATIVE_ROOT??fileURLToPath(new URL('../native/',import.meta.url)),candidate=process.env.YNX_V4_TEST_LOAN_METHODS??join(native,'device_v4_source_borrow_methods.inc.mm');
const body=readFileSync(candidate,'utf8');
const from=body.indexOf('- (id)reserveOriginalDeviceV4NativeReadLoan:'),end=body.indexOf('- (NSDictionary*)copyOriginalDeviceV4NativeReadSnapshot:');
if(from<0||end<=from)throw Error('EXACT_RESERVE_AND_RELEASE_REQUIRED');
const out=mkdtempSync(join(tmpdir(),'ynx-v4-loan-backend-'));
const fixture=`#import <Foundation/Foundation.h>
#include <stdexcept>
#include <cassert>
#include "DeviceV4SourceDarwinPrivate.hpp"
@implementation YNXAuthIdentitySourceAuthority { @public BOOL _closeSelected; NSHashTable *_deviceV4NativeReadLoans; unsigned _checks,_mode,_releaseCount; }
-(void)setMode:(unsigned)m {_mode=m;}
-(unsigned)loanCount {return (unsigned)_deviceV4NativeReadLoans.count;}
-(unsigned)releaseCount {return _releaseCount;}
-(BOOL)assertOriginalProductSessionDeviceV4SourceCurrent:(NSError**)error {if(error)*error=nil;++_checks;if(_checks==2){if(_mode==1)@throw [NSException exceptionWithName:@"TEST" reason:nil userInfo:nil];if(_mode==2)throw std::runtime_error("TEST");if(_mode==3){if(error)*error=[NSError errorWithDomain:@"TEST" code:0 userInfo:nil];@throw [NSException exceptionWithName:@"TEST" reason:nil userInfo:nil];}}return YES;}
${body.slice(from,end).replace('[_deviceV4NativeReadLoans removeObject:token];','++_releaseCount;[_deviceV4NativeReadLoans removeObject:token];')}
-(void)retire {}
-(BOOL)join:(NSError**)e {if(e)*e=nil;return YES;}
-(BOOL)close:(NSError**)e {if(e)*e=nil;return YES;}
-(BOOL)originalDeviceV4NativePhysicalClosed {return _deviceV4NativeReadLoans.count==0;}
@end
@interface YNXAuthIdentitySourceAuthority(TestProbe)
-(void)setMode:(unsigned)m;-(unsigned)loanCount;-(unsigned)releaseCount;
@end
namespace ynx::auth::devicev4 {Failure localFailure(int32_t code)noexcept{return {1,code,0,0};}}
int main(){@autoreleasepool{for(unsigned mode=0;mode<4;mode++){
 YNXAuthIdentitySourceAuthority*s=[YNXAuthIdentitySourceAuthority new];[s setMode:mode];
 auto actual=ynx::auth::devicev4::borrowRecognizedSource(s);assert(actual.owner);assert([s loanCount]==1);
 if(mode==0)assert(!actual.failure.present);else {assert(actual.failure.present);assert(actual.failure.code==(mode==3?0:73013));}
 auto joined=actual.owner->join();assert(joined.physical_done);assert([s loanCount]==0);assert([s releaseCount]==1);
 auto again=actual.owner->join();assert(again.physical_done);assert([s releaseCount]==1);
 auto closed=actual.owner->close();assert(closed.physical_done);assert([s releaseCount]==1);if(mode)assert(closed.failure.present);
 }puts("actual Backend + PUBLIC Source injected late failures: 4 pass, same token released once");}}
`;
writeFileSync(join(out,'fixture.mm'),fixture);
const args=['-std=c++17','-fobjc-arc','-fobjc-exceptions','-fblocks','-Wno-incomplete-implementation','-I'+native,join(out,'fixture.mm'),join(native,'DeviceV4SourceDarwin.mm'),'-framework','Foundation','-o',join(out,'test')];
const env={...process.env,TMPDIR:out};const compile=spawnSync('/usr/bin/clang++',args,{encoding:'utf8',env,maxBuffer:4<<20});writeFileSync(join(out,'compile.stderr'),compile.stderr??'');
const run=compile.status===0?spawnSync(join(out,'test'),[],{encoding:'utf8',env}):null;writeFileSync(join(out,'run.stdout'),run?.stdout??'');writeFileSync(join(out,'run.stderr'),run?.stderr??'');
const overlay={version:0,'case-sensitive':true,'use-external-names':false,roots:[{type:'file',name:join(native,'device_v4_source_borrow_methods.inc.mm'),'external-contents':candidate}]};writeFileSync(join(out,'overlay.json'),JSON.stringify(overlay));
const syntaxArgs=['-std=c++17','-fobjc-arc','-fobjc-exceptions','-fblocks','-DYNX_AUTH_DEVICE_V4_SOURCE_BORROW_STAGE=1','-I'+native,'-I'+join(native,'../../../apps/wallet-desktop/native'),'-ivfsoverlay',join(out,'overlay.json'),'-fsyntax-only',join(native,'original-auth-identity-source-authority.mm')];
const syntax=run?.status===0?spawnSync('/usr/bin/clang++',syntaxArgs,{encoding:'utf8',env,maxBuffer:8<<20}):null;writeFileSync(join(out,'syntax.stderr'),syntax?.stderr??'');
writeFileSync(join(out,'RESULT.json'),JSON.stringify({compileStatus:compile.status,compileSignal:compile.signal,runStatus:run?.status??null,runSignal:run?.signal??null,syntaxStatus:syntax?.status??null,scope:'actual SDK Backend TU + extracted candidate methods + PUBLIC Source fixture; actual Source TU syntax; not real Root or registration',cases:4},null,2)+'\n');
console.log(JSON.stringify({out,compile:compile.status,run:run?.status??null,syntax:syntax?.status??null,stderr:(compile.stderr||run?.stderr||syntax?.stderr||'').slice(-3000)}));if(compile.status!==0||run?.status!==0||syntax?.status!==0)process.exitCode=1;
