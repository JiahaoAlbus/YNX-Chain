#import <Foundation/Foundation.h>
#include "original-pq-host-catalog-task-exit.h"
#include <signal.h>
#include <unistd.h>
#include <cassert>
#include <cstring>
int main(int argc,char**argv){
 if(argc==2&&!strcmp(argv[1],"--PUBLIC-ignore-term")){signal(SIGTERM,SIG_IGN);write(STDOUT_FILENO,"R",1);usleep(700000);_exit(0);}
 @autoreleasepool{NSTask*t=[NSTask new];NSPipe*out=[NSPipe pipe];t.executableURL=[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[0]]];t.arguments=@[@"--PUBLIC-ignore-term"];t.environment=@{};t.standardOutput=out;
 NSError*e=nil;assert([t launchAndReturnError:&e]&&!e);char ready=0;assert(read(out.fileHandleForReading.fileDescriptor,&ready,1)==1&&ready=='R');
 const auto start=std::chrono::steady_clock::now();[t terminate];
 if(argc==2&&!strcmp(argv[1],"--PUBLIC-old-unbounded")){[t waitUntilExit];const auto elapsed=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-start).count();printf("RED original waitUntilExit blocked %lldms beyond 40ms observation budget\n",(long long)elapsed);return elapsed>300?65:1;}
 assert(!ynx_auth_private::observePQCatalogTaskExit(t,40));
 assert(std::chrono::steady_clock::now()-start<std::chrono::milliseconds(300));assert(t.running);
 // Retained original custody, not a timer/PID-based retry. Later observation
 // can prove actual natural exit but cannot clear the original UNKNOWN.
 assert(ynx_auth_private::observePQCatalogTaskExit(t,1000));assert(!t.running&&t.terminationStatus==0);
 assert([out.fileHandleForReading closeAndReturnError:&e]&&!e);puts("PASS actual ignored-TERM bounded observation, original custody retained until exit");}
}
