#import "ynx-project-service-observation.mm"
static NSError *failure(NSString*s){return [NSError errorWithDomain:@"PUBLIC-MOCK-NOT-SOURCE" code:1 userInfo:@{NSLocalizedDescriptionKey:s}];}
static YNXIDEProjectServiceObserver *nextOwner;
static NSError *acquireError,*readError,*currentError,*joinError,*closeError;
static BOOL currentOK=YES,joinOK=YES,closeOK=YES;
static int retires,joins,closes,reads,currents;
static NSDictionary *data;
@implementation YNXIDEProjectServiceObserver
+ (instancetype)acquireOriginalObserver:(NSError**)error{if(error)*error=acquireError;return nextOwner;}
- (NSDictionary*)copyCurrentServiceRegistration:(NSError**)error{++reads;if(error)*error=readError;return data;}
- (BOOL)assertCurrent:(NSError**)error{++currents;if(error)*error=currentError;return currentOK;}
- (void)retire{++retires;}
- (BOOL)join:(NSError**)error{++joins;if(error)*error=joinError;return joinOK;}
- (BOOL)close:(NSError**)error{++closes;if(error)*error=closeError;return closeOK;}
@end
static void expect(BOOL yes){if(!yes)abort();}
static void reset(void){
 nextOwner=[YNXIDEProjectServiceObserver new];
 acquireError=readError=currentError=joinError=closeError=nil;
 currentOK=joinOK=closeOK=YES;retires=joins=closes=reads=currents=0;
 data=@{@"principal":@{@"account":@"PUBLIC"},@"project":@{@"projectId":@"PUBLIC"},@"serviceRegistration":@{@"registrationId":@"PUBLIC"},@"expiresMS":@((long long)(NSDate.date.timeIntervalSince1970*1000)+60000)};
}
int main(){@autoreleasepool{
 // PUBLIC fake Native owner only: no original Source, Keychain or HTTP.
 reset();acquireError=failure(@"factory-original");NSError *e=nil;
 YNXProjectServiceObservation *o=[YNXProjectServiceObservation captureOriginal:&e];
 expect(o!=nil&&e==acquireError);expect([o readCurrent:nil]==nil&&reads==0);
 expect([o originalFirstCause]==acquireError);
 expect([o finish:nil]&&retires==1&&joins==1&&closes==1);
 expect([o finish:nil]&&retires==1&&joins==1&&closes==1);

 reset();o=[YNXProjectServiceObservation captureOriginal:nil];closeError=failure(@"close-original");
 expect(![o finish:&e]&&e==closeError&&[o originalFirstCause]==closeError);
 NSError *saved=e;closeError=nil;expect(![o finish:&e]&&e==saved&&closes==1);
 expect([YNXServiceObservationCustody() containsObject:o]);

 reset();o=[YNXProjectServiceObservation captureOriginal:nil];currentError=failure(@"true-plus-error");
 expect([o readCurrent:&e]==nil&&e==currentError&&reads==0);expect([o finish:nil]);

 reset();o=[YNXProjectServiceObservation captureOriginal:nil];
 NSDictionary *result=[o readCurrent:&e];expect(result!=nil&&currents==2&&reads==1);
 NSMutableDictionary *changed=[data mutableCopy];changed[@"project"]=@{@"projectId":@"PUBLIC-other"};data=changed;
 expect([o readCurrent:&e]==nil);expect([o originalFirstCause]!=nil);expect([o finish:nil]);

 reset();o=[YNXProjectServiceObservation captureOriginal:nil];readError=failure(@"data-plus-error");
 expect([o readCurrent:&e]==nil&&e==readError);expect([o finish:nil]);

 reset();o=[YNXProjectServiceObservation captureOriginal:nil];[o retire];
 expect([o readCurrent:nil]==nil&&reads==0);expect([o finish:nil]&&retires==1);

 reset();o=[YNXProjectServiceObservation captureOriginal:nil];
 data=@{@"principal":@{},@"project":@{},@"serviceRegistration":@{},@"expiresMS":@0};
 expect([o readCurrent:nil]==nil);expect([o finish:nil]);
 puts("PUBLIC_OBSERVER_CALLER_7_CONTROLS_PASS_NO_SOURCE_NO_HTTP");
}}

