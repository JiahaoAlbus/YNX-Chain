import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,writeFile,rm}from'node:fs/promises';import{execFileSync}from'node:child_process';import{join}from'node:path';
test('actual native credit parser bounds replay and leaves readiness gate intact',async()=>{
 const source=await readFile(new URL('./macos/main.m',import.meta.url),'utf8');const start=source.indexOf('- (NSTimeInterval)localSignatureCredit {'),end=source.indexOf('- (void)pollLocalReadiness:',start);assert.ok(start>0&&end>start);
 const dir=await mkdtemp(decodeURIComponent(new URL('../../../.native-budget-',import.meta.url).pathname));try{
 const file=join(dir,'test.m'),out=join(dir,'test');
 await writeFile(file,`#import <Foundation/Foundation.h>\n#include <math.h>\n@interface Probe:NSObject {NSURL *_serverLogURL; double _signatureCreditReadAt,_signatureCreditCached;}\n-(void)run:(NSString*)path;\n@end\n@implementation Probe\n${source.slice(start,end)}\n-(void)run:(NSString*)path{_serverLogURL=[NSURL fileURLWithPath:path];NSString *line=@"YNX_SIGNATURE_STAGE {\\\"phase\\\":\\\"before-copy\\\",\\\"state\\\":\\\"progress\\\",\\\"elapsedMs\\\":999999}\\n";[[line stringByAppendingString:line] writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];if([self localSignatureCredit]!=92)exit(2);_signatureCreditReadAt=0;[@"junk\\n" writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];if([self localSignatureCredit]!=0)exit(3);}\n@end\nint main(int argc,char**argv){@autoreleasepool{[[Probe new]run:[NSString stringWithUTF8String:argv[1]]];}return 0;}`);
 execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang',['-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk','-fobjc-arc','-framework','Foundation',file,'-o',out],{timeout:30000});execFileSync(out,[join(dir,'public.log')],{timeout:5000});
 assert.match(source,/responseReady&&receiptReady\?YNXLocalReadinessLoad/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
