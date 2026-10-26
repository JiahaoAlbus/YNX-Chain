#define main YNXExistingPublicReadControlMain
#include "service-read-proof-controlled-test.mm"
#undef main

int main(){@autoreleasepool{
 PublicDevice *b=device();b.loginAllowed=NO;NSError *error=nil;
 PublicReadObserver *o=observer(b);assert([b approveServiceRead:o requestID:rid error:&error]);
 NSDictionary *first=@{@"sessionRaw":YNXDeviceCanonical(b.sessionData),@"requestId":rid,@"device":@{@"id":b.sessionData[@"deviceId"],@"key":b.publicKey,@"scopes":b.sessionData[@"scopes"],@"purpose":@"Read reviewed project deployment status and logs"}};
 puts([[NSString alloc]initWithData:[NSJSONSerialization dataWithJSONObject:first options:0 error:nil] encoding:NSUTF8StringEncoding].UTF8String);fflush(stdout);
 char *line=NULL;size_t capacity=0;
 while(getline(&line,&capacity,stdin)>0){@autoreleasepool{
  NSDictionary *row=YNXAtomicJSON([NSString stringWithUTF8String:line]);if(![row isKindOfClass:NSDictionary.class])break;
  error=nil;id value=[b performServiceReadPort:row[@"input"] requestID:rid error:&error];
  NSDictionary *reply=@{@"id":row[@"id"]?:NSNull.null,@"ok":@(!error&&value!=nil),@"value":value?:NSNull.null};
  puts([[NSString alloc]initWithData:[NSJSONSerialization dataWithJSONObject:reply options:0 error:nil] encoding:NSUTF8StringEncoding].UTF8String);fflush(stdout);
 }}
 if(line)free(line);[b endServiceRead:nil];return 0;
}}
