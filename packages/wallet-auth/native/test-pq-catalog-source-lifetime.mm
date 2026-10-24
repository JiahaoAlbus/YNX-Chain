#import <Foundation/Foundation.h>
#include "original-pq-host-catalog-source-state.h"
#include "original-source-verifier-io.h"
#include "original-pq-host-catalog-receipt.h"
#include <cassert>
#include <string>
using ynx_auth_private::PQCatalogSourceAttempt;
int main(){@autoreleasepool{
 auto parse=[](NSString*s){return PQSourceReceipt([s dataUsingEncoding:NSUTF8StringEncoding]);};
 assert([parse(@"{\"catalogPath\":\"/PUBLIC/\\u003cfile\\u003e\",\"catalogSha256\":\"abc\"}\n")[@"catalogPath"]isEqual:@"/PUBLIC/<file>"]);
 for(NSString*s in @[@"{\"catalogPath\":\"x\",\"catalogPath\":\"y\"}",@"{\"catalogPath\":\"x\",\"unknown\":\"y\"}",@"{\"catalogPath\":\"x\",\"catalogSha256\":\"y\",\"other\":\"z\"}",@"{\"catalogPath\":4,\"catalogSha256\":\"y\"}",@"{\"catalogPath\":\"x\",\"catalogSha256\":\"y\"}{}",@"{\"catalogPath\":\"\\q\",\"catalogSha256\":\"y\"}"])assert(!parse(s));
 {PQCatalogSourceAttempt s;assert(!s.enter());assert(s.select());assert(!s.select());assert(s.unknown());assert(s.enter());s.captureResult();s.fail("late-current");assert(s.result());assert(!s.complete());assert(!s.joinReady());s.joined();assert(s.joinReady());assert(s.selectClose());s.closeResult(false);s.closeResult(true);assert(!s.closed());assert(std::string(s.firstCause())=="late-current");s.fail("second");assert(std::string(s.firstCause())=="late-current");assert(!s.select());}
 {PQCatalogSourceAttempt s;assert(s.select());assert(s.enter());s.joined();assert(!s.enter());s.captureResult();assert(s.complete());assert(!s.unknown());s.retire();assert(!s.complete());assert(s.result());assert(s.selectClose());s.closeResult(true);assert(s.closed());}
 // Exercise real Foundation pipe ownership, not a model of NSTask. Supplying
 // NSPipe to NSTask lets Foundation own/close the parent's unused ends.
 NSPipe*in=[NSPipe pipe],*out=[NSPipe pipe],*err=[NSPipe pipe];NSTask*t=[NSTask new];
 t.executableURL=[NSURL fileURLWithPath:@"/bin/cat"];t.environment=@{};t.standardInput=in;t.standardOutput=out;t.standardError=err;
 NSError*e=nil;assert([t launchAndReturnError:&e]&&!e);unsigned closes=0;
 const std::string input="PUBLIC_ONLY_SOURCE_IO\n";std::vector<unsigned char>captured,errors;
 auto bytes=ynx_auth_private::boundedVerifierIO(in.fileHandleForWriting.fileDescriptor,out.fileHandleForReading.fileDescriptor,err.fileHandleForReading.fileDescriptor,(const unsigned char*)input.data(),input.size(),[&](){closes++;NSError*x=nil;return(bool)[in.fileHandleForWriting closeAndReturnError:&x]&&!x;},[&](){return(bool)t.running;},1500,4096,16384,&captured,&errors);
 [t waitUntilExit];assert(t.terminationStatus==0);assert(closes==1);assert(errors.empty());assert(bytes==captured);assert(std::string(bytes.begin(),bytes.end())==input);
 for(NSFileHandle*h in @[out.fileHandleForReading,err.fileHandleForReading]){NSError*x=nil;assert([h closeAndReturnError:&x]&&!x);}
 // Real partial stdout is retained even when stderr rejects the child. No
 // second invocation/permission is created from retained DATA.
 in=[NSPipe pipe];out=[NSPipe pipe];err=[NSPipe pipe];t=[NSTask new];t.executableURL=[NSURL fileURLWithPath:@"/bin/sh"];t.arguments=@[@"-c",@"printf PUBLIC-partial; /bin/sleep 0.04; printf PUBLIC-error >&2"];t.environment=@{};t.standardInput=in;t.standardOutput=out;t.standardError=err;e=nil;assert([t launchAndReturnError:&e]&&!e);captured.clear();errors.clear();closes=0;bool rejected=false;
 try{ynx_auth_private::boundedVerifierIO(in.fileHandleForWriting.fileDescriptor,out.fileHandleForReading.fileDescriptor,err.fileHandleForReading.fileDescriptor,nullptr,0,[&](){closes++;NSError*x=nil;return(bool)[in.fileHandleForWriting closeAndReturnError:&x]&&!x;},[&](){return(bool)t.running;},1500,4096,16384,&captured,&errors);}catch(const std::exception&x){rejected=std::string(x.what())=="AUTH_IDENTITY_VERIFIER_STDERR_REJECTED";}
 [t waitUntilExit];assert(rejected&&closes==1);assert(std::string(captured.begin(),captured.end())=="PUBLIC-partial");assert(std::string(errors.begin(),errors.end())=="PUBLIC-error");for(NSFileHandle*h in @[out.fileHandleForReading,err.fileHandleForReading]){NSError*x=nil;assert([h closeAndReturnError:&x]&&!x);}
 puts("PASS actual lifetime first-close/UNKNOWN and Foundation bounded IO");
}}
