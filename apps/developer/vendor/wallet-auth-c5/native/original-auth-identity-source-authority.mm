#import "original-auth-identity-source-authority.h"
#import "original-auth-identity-joint-owner.h"
@implementation YNXAuthIdentitySourceAuthority {
 YNXAuthIdentityCurrentOwner *_custody;
 NSData *_profileOriginal,*_headOriginal;
 NSDictionary *_selection,*_head;
 ynx_auth_private::SourceClock _clock;
 BOOL _retired,_closeSelected,_cleanupComplete;
 NSError *_firstCause,*_cleanupCause;
}
- (BOOL)fail:(NSString *)code error:(NSError **)error {
 if(!_firstCause)_firstCause=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=_firstCause;return NO;
}
+ (instancetype)acquireOriginalSource:(NSError **)error {
 YNXAuthIdentitySourceAuthority *source=[self new];
 source->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalAdministrationProfile:error];
 if(!source->_custody)return nil;
 source->_profileOriginal=[source->_custody copyOriginalProfile:error];source->_headOriginal=[source->_custody copyOriginalHead:error];
 if(source->_profileOriginal&&source->_headOriginal){
  source->_selection=[NSJSONSerialization JSONObjectWithData:source->_profileOriginal options:0 error:nil];
  source->_head=[NSJSONSerialization JSONObjectWithData:source->_headOriginal options:0 error:nil];
  if([source assertCurrent:error])return source;
 }
 // Return the same retired custody when cleanup is uncertain; no lost owner.
 [source retire];if(![source close:nil])return source;return nil;
}
- (BOOL)assertCurrent:(NSError **)error {
 @synchronized(self){
  if(_retired||![_custody assertOriginalCurrent:error])return [self fail:@"AUTH_IDENTITY_SOURCE_CURRENT_UNAVAILABLE" error:error];
  if(![_selection isKindOfClass:NSDictionary.class]||![_head isKindOfClass:NSDictionary.class])return [self fail:@"AUTH_IDENTITY_PRIVATE_SOURCE_FORMAT_UNSPECIFIED" error:error];
  // Private ABI metadata only. Authenticity/approval is a separate operand.
  id issued=_selection[@"issuedAtMs"],expires=_selection[@"expiresAtMs"],generation=_selection[@"generation"],headGeneration=_head[@"generation"],revoked=_head[@"revoked"];
  for(id field in @[issued?:NSNull.null,expires?:NSNull.null,generation?:NSNull.null,headGeneration?:NSNull.null])if(![field isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)field)==CFBooleanGetTypeID()||[field doubleValue]!=(double)[field unsignedLongLongValue]||[field doubleValue]>9007199254740991.0)return [self fail:@"AUTH_IDENTITY_PRIVATE_SOURCE_FORMAT_UNSPECIFIED" error:error];
  if(![revoked isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)revoked)!=CFBooleanGetTypeID())return [self fail:@"AUTH_IDENTITY_PRIVATE_SOURCE_FORMAT_UNSPECIFIED" error:error];
  const double millis=NSDate.date.timeIntervalSince1970*1000.0;
  if(millis<0||!_clock.observe((uint64_t)millis,[issued unsignedLongLongValue],[expires unsignedLongLongValue],[headGeneration unsignedLongLongValue],[generation unsignedLongLongValue],[revoked boolValue]))return [self fail:@"AUTH_IDENTITY_HEAD_FLOOR_REVOKE_CHANGED" error:error];
  NSData *profile=[_custody copyOriginalProfile:error],*head=[_custody copyOriginalHead:error];
  if(!profile||!head||![profile isEqual:_profileOriginal]||![head isEqual:_headOriginal])return [self fail:@"AUTH_IDENTITY_ORIGINAL_RAW_CHANGED" error:error];return YES;
 }
}
- (BOOL)assertAuthenticatedNativePurpose:(NSError **)error {
 if(![self assertCurrent:error])return NO;
 // Matching original independent authentication contract is explicitly NONE.
 // Metadata, bundle custody, signatures relative to caller-selected keys and
 // local generation checks are not a qualifying Source/Identity authority.
 return [self fail:@"AUTH_IDENTITY_ORIGINAL_SOURCE_AUTHENTICATION_CODE_NOT_IMPLEMENTED" error:error];
}
- (NSDictionary *)copyOriginalSelection:(NSError **)error {
 if(![self assertAuthenticatedNativePurpose:error])return nil;
 NSDictionary *original=[_selection copy];if(![self assertCurrent:error])return nil;return original;
}
- (void)retire {@synchronized(self){_retired=YES;[_custody retire];}}
- (BOOL)join:(NSError **)error {@synchronized(self){if(!_retired)return [self fail:@"AUTH_IDENTITY_SOURCE_NOT_RETIRED" error:error];return [_custody join:error];}}
- (BOOL)close:(NSError **)error {
 @synchronized(self){[self retire];if(_closeSelected){if(error)*error=_cleanupCause;return _cleanupComplete;}
  if(![self join:error])return NO;_closeSelected=YES;NSError *cleanupCause=nil;_cleanupComplete=[_custody close:&cleanupCause];_cleanupCause=cleanupCause;if(error)*error=_cleanupCause;return _cleanupComplete;}
}
@end
