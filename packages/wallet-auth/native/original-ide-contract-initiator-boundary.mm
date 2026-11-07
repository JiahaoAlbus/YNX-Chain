#import "original-ide-contract-initiator-private.h"
#include <pthread.h>
@implementation YNXOriginalIDEContractInitiatorCodeBoundary {
 YNXAuthIdentitySourceAuthority*_source;NSDictionary*_original;
 NSError*_first;BOOL _retired,_active,_closed;
}
- (BOOL)fail:(NSString*)code actual:(NSError*)actual error:(NSError**)error {
 if(!_first)_first=actual?:[NSError errorWithDomain:@"YNXOriginalContractInitiator" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=_first;return NO;
}
+ (instancetype)captureFromOriginalSource:(YNXAuthIdentitySourceAuthority*)source error:(NSError**)error {
 if(!pthread_main_np()||![source isMemberOfClass:YNXAuthIdentitySourceAuthority.class]){if(error)*error=[NSError errorWithDomain:@"YNXOriginalContractInitiator" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_CONTRACT_INITIATOR_ORIGINAL_SOURCE_REQUIRED"}];return nil;}
 auto*s=[self new];s->_source=source;
 @try{try{NSError*actual=nil;s->_original=[source copyOriginalIDEContractInitiatorCodeInputsLocal:&actual];
  if(!s->_original||actual){[s fail:@"IDE_CONTRACT_INITIATOR_CODE_UNQUALIFIED" actual:actual error:error];return s;}
  [s assertCurrent:error];return s;
 }catch(...){[s fail:@"IDE_CONTRACT_INITIATOR_CAPTURE_UNKNOWN" actual:nil error:error];return s;}}
 @catch(id){[s fail:@"IDE_CONTRACT_INITIATOR_CAPTURE_UNKNOWN" actual:nil error:error];return s;}
 // Every nonnull partial precedes classification; no Source close is inferred.
}
- (BOOL)assertCurrent:(NSError**)error {
 if(!pthread_main_np()){if(error)*error=[NSError errorWithDomain:@"YNXOriginalContractInitiator" code:4 userInfo:@{NSLocalizedDescriptionKey:@"IDE_CONTRACT_INITIATOR_THREAD_REQUIRED"}];return NO;}
 if(_retired||_closed||_active||_first)return [self fail:@"IDE_CONTRACT_INITIATOR_NOT_CURRENT" actual:nil error:error];
 _active=YES;
 @try{try{NSError*actual=nil;NSDictionary*now=[_source copyOriginalIDEContractInitiatorCodeInputsLocal:&actual];
  if(!now||actual||![now isEqual:_original]||_retired||_closed)return [self fail:@"IDE_CONTRACT_INITIATOR_POST_INPUT_CHANGED" actual:actual error:error];
  return YES;
 }catch(...){return [self fail:@"IDE_CONTRACT_INITIATOR_CURRENT_UNKNOWN" actual:nil error:error];}
 }@catch(id){return [self fail:@"IDE_CONTRACT_INITIATOR_CURRENT_UNKNOWN" actual:nil error:error];}
 @finally{_active=NO;}
}
- (void)retire {if(pthread_main_np())_retired=YES;}
- (BOOL)join:(NSError**)error {
 if(!pthread_main_np()||!_retired||_active){if(error)*error=[NSError errorWithDomain:@"YNXOriginalContractInitiator" code:3 userInfo:@{NSLocalizedDescriptionKey:@"IDE_CONTRACT_INITIATOR_JOIN_PENDING"}];return NO;}if(error)*error=_first;return YES;
}
- (BOOL)close:(NSError**)error {
 if(!pthread_main_np()){if(error)*error=[NSError errorWithDomain:@"YNXOriginalContractInitiator" code:4 userInfo:@{NSLocalizedDescriptionKey:@"IDE_CONTRACT_INITIATOR_THREAD_REQUIRED"}];return NO;}
 if(_closed){if(error)*error=_first;return YES;}if(![self join:error])return NO;
 // Own Native value/Source reference only. Never retire/close shared Source.
 _source=nil;_original=nil;_closed=YES;if(error)*error=_first;return YES;
}
@end
