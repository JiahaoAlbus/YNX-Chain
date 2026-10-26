#import "ynx-project-service-observation.h"
#import "original-ide-project-app-observer.h"
#include <math.h>

static NSMutableSet *YNXServiceObservationCustody(void){
 static NSMutableSet *value;static dispatch_once_t once;dispatch_once(&once,^{value=[NSMutableSet new];});return value;
}
@implementation YNXProjectServiceObservation {
 YNXIDEProjectServiceObserver *_owner;
 BOOL _failed,_retired,_retireSelected,_finishSelected,_finishOK;
 id _firstCause;NSError *_cleanupCause;NSData *_baseline;
}
- (void)remember:(id)cause {if(!_failed){_failed=YES;_firstCause=cause?:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_FAILED");}}
- (BOOL)reject:(NSError **)error {
 if(error)*error=[_firstCause isKindOfClass:NSError.class]?_firstCause:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_UNAVAILABLE");
 return NO;
}
+ (instancetype)captureOriginal:(NSError **)error {
 YNXProjectServiceObservation *holder=[self new];
 @synchronized(YNXServiceObservationCustody()){[YNXServiceObservationCustody() addObject:holder];}
 @try{
  NSError *failure=nil;
  // Capture the actual partial BEFORE looking at its accompanying error.
  holder->_owner=[YNXIDEProjectServiceObserver acquireOriginalObserver:&failure];
  if(failure||!holder->_owner){[holder remember:failure?:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_NOT_SUPPLIED")];[holder reject:error];}
 }@catch(id cause){[holder remember:cause];[holder reject:error];}
 return holder;
}
- (NSDictionary *)readCurrent:(NSError **)error {
 @synchronized(self){
  if(_failed||_retired||_finishSelected){if(!_failed)[self remember:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_RETIRED")];[self reject:error];return nil;}
  @try{
   NSError *failure=nil;BOOL current=[_owner assertCurrent:&failure];
   if(!current||failure){[self remember:failure?:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_CURRENT_FAILED")];[self reject:error];return nil;}
   NSDictionary *value=[_owner copyCurrentServiceRegistration:&failure];
   if(failure||![value isKindOfClass:NSDictionary.class]){[self remember:failure?:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_READ_FAILED")];[self reject:error];return nil;}
   NSSet *fields=[NSSet setWithArray:@[@"principal",@"project",@"serviceRegistration",@"expiresMS"]];
   if(![[NSSet setWithArray:value.allKeys]isEqual:fields]||![value[@"principal"]isKindOfClass:NSDictionary.class]||![value[@"project"]isKindOfClass:NSDictionary.class]||![value[@"serviceRegistration"]isKindOfClass:NSDictionary.class]||![value[@"expiresMS"]isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)value[@"expiresMS"])==CFBooleanGetTypeID()||![NSJSONSerialization isValidJSONObject:value]){
    [self remember:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_DATA_INVALID")];[self reject:error];return nil;
   }
   NSData *raw=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:&failure];
   if(failure||!raw||raw.length>65536){[self remember:failure?:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_DATA_INVALID")];[self reject:error];return nil;}
   // Independent copies prevent a consumer from mutating held observer DATA.
   NSDictionary *copy=[NSJSONSerialization JSONObjectWithData:raw options:0 error:&failure];
   if(failure||!copy){[self remember:failure?:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_DATA_INVALID")];[self reject:error];return nil;}
   double expires=[copy[@"expiresMS"]doubleValue];
   if(!isfinite(expires)||floor(expires)!=expires||expires>9007199254740991.0||expires<=NSDate.date.timeIntervalSince1970*1000){[self remember:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_EXPIRED")];[self reject:error];return nil;}
   current=[_owner assertCurrent:&failure];
   if(!current||failure||(_baseline&&![_baseline isEqual:raw])){[self remember:failure?:YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_CHANGED")];[self reject:error];return nil;}
   if(!_baseline)_baseline=raw;
   return copy;
  }@catch(id cause){[self remember:cause];[self reject:error];return nil;}
 }
}
- (void)retire {
 @synchronized(self){_retired=YES;if(_retireSelected)return;_retireSelected=YES;
  @try{[_owner retire];}@catch(id cause){[self remember:cause];if(!_cleanupCause)_cleanupCause=YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_RETIRE_UNKNOWN");}
 }
}
- (BOOL)finish:(NSError **)error {
 @synchronized(self){
  if(_finishSelected){if(!_finishOK&&error)*error=_cleanupCause;return _finishOK;}
  [self retire];_finishSelected=YES;
  NSError *joinFailure=nil,*closeFailure=nil;BOOL joined=YES,closed=YES;
  @try{if(_owner)joined=[_owner join:&joinFailure];}@catch(id cause){[self remember:cause];joined=NO;joinFailure=YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_JOIN_UNKNOWN");}
  @try{if(_owner)closed=[_owner close:&closeFailure];}@catch(id cause){[self remember:cause];closed=NO;closeFailure=YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_CLOSE_UNKNOWN");}
  if(!_cleanupCause)_cleanupCause=joinFailure?:closeFailure;
  if(_cleanupCause)[self remember:_cleanupCause];
  _finishOK=joined&&closed&&!_cleanupCause;
  if(_finishOK){_owner=nil;@synchronized(YNXServiceObservationCustody()){[YNXServiceObservationCustody() removeObject:self];}}
  else{if(!_cleanupCause)_cleanupCause=YNXServiceObservationFailure(@"IDE_SERVICE_OBSERVER_CLEANUP_UNKNOWN");if(error)*error=_cleanupCause;}
  return _finishOK;
 }
}
- (id)originalFirstCause {@synchronized(self){return _firstCause;}}
@end

