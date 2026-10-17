#import <Foundation/Foundation.h>
#include "original-source-verifier-io.h"
#include <cassert>
#include <string>
int main(){@autoreleasepool{
 NSTask *task=[NSTask new];NSPipe *in=[NSPipe pipe],*out=[NSPipe pipe],*err=[NSPipe pipe];
 task.executableURL=[NSURL fileURLWithPath:@"/usr/bin/printf"];task.arguments=@[@"{\"ok\":true}"];task.environment=@{};task.standardInput=in;task.standardOutput=out;task.standardError=err;
 NSError *error=nil;assert([task launchAndReturnError:&error]);bool closed=false;
 auto raw=ynx_auth_private::boundedVerifierIO(in.fileHandleForWriting.fileDescriptor,out.fileHandleForReading.fileDescriptor,err.fileHandleForReading.fileDescriptor,nullptr,0,[&](){assert(!closed);closed=true;NSError *cause=nil;return (bool)[in.fileHandleForWriting closeAndReturnError:&cause];},[&](){return (bool)task.running;},2000);
 assert(closed&&!task.running&&task.terminationStatus==0);assert(std::string(raw.begin(),raw.end())=="{\"ok\":true}");
 for(NSFileHandle *handle in @[in.fileHandleForReading,out.fileHandleForReading,out.fileHandleForWriting,err.fileHandleForReading,err.fileHandleForWriting]){NSError *cause=nil;[handle closeAndReturnError:&cause];}
 puts("PASS actual NSTask/NSPipe borrowed-fd bridge, fixed output bytes and termination status; PUBLIC fixture only");
}return 0;}
