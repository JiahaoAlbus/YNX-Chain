#import "ynx-original-service-pipe.h"
#include <assert.h>
#include <stdio.h>

int main(int argc,const char **argv){@autoreleasepool{
    assert(argc==2);NSString *directory=[NSString stringWithUTF8String:argv[1]];
    NSDictionary *base=@{@"id":@"11111111-1111-4111-8111-111111111111",@"document":@"22222222-2222-4222-8222-222222222222",@"instance":@"33333333-3333-4333-8333-333333333333",@"projectId":@"44444444-4444-4444-8444-444444444444",@"workspace":@"/public/transport-only"};
    NSString *raw=@"{\"body\":\"PUBLIC exact \\\"body\\\"\",\"headers\":{},\"status\":200}";
    NSMutableDictionary *row=[base mutableCopy];row[@"resultRaw"]=raw;row[@"resultDigest"]=YNXOriginalServiceDigest(raw);
    NSMutableDictionary *p=[base mutableCopy];p[@"schema"]=YNXOriginalServiceSchema;p[@"status"]=@"response-pending-terminal";p[@"entered"]=@YES;p[@"unknown"]=@YES;p[@"resultRaw"]=raw;p[@"resultDigest"]=row[@"resultDigest"];
    assert(YNXOriginalServiceProvisional(p,row));
    NSMutableDictionary *terminal=[base mutableCopy];terminal[@"schema"]=YNXOriginalServiceSchema;terminal[@"status"]=@"terminal";terminal[@"entered"]=@YES;terminal[@"unknown"]=@NO;terminal[@"resultDigest"]=row[@"resultDigest"];
    assert(YNXOriginalServiceTerminal(terminal,row));
    for(NSString *key in @[@"id",@"document",@"instance",@"projectId",@"workspace"]){NSMutableDictionary *wrong=[p mutableCopy];wrong[key]=@"FOREIGN";assert(!YNXOriginalServiceProvisional(wrong,row));}
    NSMutableDictionary *wrong=[p mutableCopy];wrong[@"entered"]=@1;assert(!YNXOriginalServiceProvisional(wrong,row));
    wrong=[p mutableCopy];wrong[@"unknown"]=@NO;assert(!YNXOriginalServiceProvisional(wrong,row));
    wrong=[p mutableCopy];wrong[@"resultRaw"]=[raw stringByAppendingString:@" "];assert(!YNXOriginalServiceProvisional(wrong,row));
    wrong=[terminal mutableCopy];wrong[@"resultDigest"]=[@"f" stringByPaddingToLength:64 withString:@"f" startingAtIndex:0];assert(!YNXOriginalServiceTerminal(wrong,row));
    wrong=[terminal mutableCopy];wrong[@"unknown"]=@YES;assert(!YNXOriginalServiceTerminal(wrong,row));
    NSMutableDictionary *failure=[base mutableCopy];failure[@"schema"]=YNXOriginalServiceSchema;failure[@"status"]=@"failed";failure[@"entered"]=@NO;failure[@"unknown"]=@YES;failure[@"error"]=@"ORIGINAL_PRIVATE_SOURCE_UNRESOLVED";assert(YNXOriginalServiceFailure(failure,row));
    failure[@"error"]=@"PRIVATE_RAW_CAUSE";assert(!YNXOriginalServiceFailure(failure,row));
    assert(YNXOriginalServiceInputLimit==262144&&YNXOriginalServiceFrameLimit==576*1024&&YNXOriginalServiceResultFileLimit==192*1024);
    NSString *large=[@"x" stringByPaddingToLength:65536 withString:@"x" startingAtIndex:0];assert(YNXOriginalServiceDigest(large));assert(!YNXOriginalServiceDigest([large stringByAppendingString:@"x"]));
    NSString *file=[directory stringByAppendingPathComponent:@"provisional.json"];
    NSData *bytes=[NSJSONSerialization dataWithJSONObject:p options:0 error:NULL];assert([bytes writeToFile:file atomically:NO]);assert(chmod(file.fileSystemRepresentation,0600)==0);
    assert(YNXOriginalServiceProvisional(YNXOriginalServiceReadRecord(file),row));
    // The old shared JSON reader stops at 16KiB. Exercise a real larger private
    // service result without enlarging that reader or the SDK's 64KiB limit.
    NSString *largeBody=[@"x" stringByPaddingToLength:60000 withString:@"x" startingAtIndex:0];
    NSData *largeJSON=[NSJSONSerialization dataWithJSONObject:@{@"status":@200,@"headers":@{},@"body":largeBody} options:NSJSONWritingSortedKeys error:NULL];
    NSString *largeRaw=[[NSString alloc]initWithData:largeJSON encoding:NSUTF8StringEncoding];
    NSMutableDictionary *largeRecord=[p mutableCopy],*largeRow=[row mutableCopy];
    largeRecord[@"resultRaw"]=largeRaw;largeRecord[@"resultDigest"]=YNXOriginalServiceDigest(largeRaw);
    largeRow[@"resultRaw"]=largeRaw;largeRow[@"resultDigest"]=largeRecord[@"resultDigest"];
    NSData *largeBytes=[NSJSONSerialization dataWithJSONObject:largeRecord options:0 error:NULL];assert(largeBytes.length>16384&&largeBytes.length<=YNXOriginalServiceResultFileLimit);
    NSString *largeFile=[directory stringByAppendingPathComponent:@"large-provisional.json"];assert([largeBytes writeToFile:largeFile atomically:NO]);assert(chmod(largeFile.fileSystemRepresentation,0600)==0);
    assert(YNXOriginalServiceProvisional(YNXOriginalServiceReadRecord(largeFile),largeRow));
    NSString *other=[directory stringByAppendingPathComponent:@"staging-link"];assert(link(file.fileSystemRepresentation,other.fileSystemRepresentation)==0);assert(!YNXOriginalServiceReadRecord(file));assert(unlink(other.fileSystemRepresentation)==0);
    assert(chmod(file.fileSystemRepresentation,0644)==0);assert(!YNXOriginalServiceReadRecord(file));assert(chmod(file.fileSystemRepresentation,0600)==0);
    NSString *alias=[directory stringByAppendingPathComponent:@"alias"];assert(symlink(file.fileSystemRepresentation,alias.fileSystemRepresentation)==0);assert(!YNXOriginalServiceReadRecord(alias));
    NSMutableData *oversized=[NSMutableData dataWithLength:YNXOriginalServiceResultFileLimit+1];assert([oversized writeToFile:file atomically:NO]);assert(!YNXOriginalServiceReadRecord(file));
    puts("PUBLIC_NATIVE_PIPE_RECORD_CONTROLS_PASS");return 0;
}}
