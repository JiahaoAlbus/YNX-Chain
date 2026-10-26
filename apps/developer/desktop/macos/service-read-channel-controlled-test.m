#import "ynx-service-read-channel.h"
#include <assert.h>
int main(int argc,const char *argv[]){@autoreleasepool{
 assert(argc==2);NSString *file=[NSString stringWithUTF8String:argv[1]];
 [NSFileManager.defaultManager createFileAtPath:file contents:[NSData data] attributes:nil];
 NSFileHandle *log=[NSFileHandle fileHandleForWritingAtPath:file];__block NSInteger messages=0;
 YNXServiceReadChannel *c=[[YNXServiceReadChannel alloc]initWithLog:log receive:^(NSDictionary *frame){assert([frame[@"version"]isEqual:@1]);messages++;}];
 NSString *input=@"ordinary error\n@YNX_NATIVE_SERVICE_READ_V1:{\"version\":1}\n@YNX_NATIVE_SERVICE_READ_V1:PUBLIC-SHOULD-NOT-BE-LOGGED\nlast ordinary line\n";
 NSData *bytes=[input dataUsingEncoding:NSUTF8StringEncoding];
 for(NSUInteger n=0;n<bytes.length;n++)[c acceptData:[bytes subdataWithRange:NSMakeRange(n,1)]];
 assert(messages==1);
 NSString *longLine=[[@"" stringByPaddingToLength:80000 withString:@"x" startingAtIndex:0]stringByAppendingString:@"\n"];
 [c acceptData:[longLine dataUsingEncoding:NSUTF8StringEncoding]];
 [c acceptData:[@"@YNX_NATIVE_SERVICE_READ_V1:{\"version\":1}\n" dataUsingEncoding:NSUTF8StringEncoding]];
 assert(messages==2);[c close];[log closeFile];
 NSString *raw=[NSString stringWithContentsOfFile:file encoding:NSUTF8StringEncoding error:nil];
 assert([raw isEqual:[@"ordinary error\nlast ordinary line\n" stringByAppendingString:longLine]]);
 [c acceptData:[@"@YNX_NATIVE_SERVICE_READ_V1:{\"version\":1}\n" dataUsingEncoding:NSUTF8StringEncoding]];assert(messages==2);
 puts("ACTUAL_PRIVATE_CHILD_FRAME_CONTROLS_PASS_NO_SECRET_LOGGING");return 0;
}}
