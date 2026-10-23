#import "original-ide-helper-listener.h"
#import "original-ide-helper-effect-contract.h"
#include <unistd.h>
#include <CommonCrypto/CommonDigest.h>
static NSError*ReceiverError(NSString*code){return [NSError errorWithDomain:@"YNXIDEHelperReceiver" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];}
static BOOL ReceiverBytes(id raw,NSUInteger cap){return [raw isKindOfClass:NSData.class]&&[raw length]>0&&[raw length]<=cap;}
static NSString*ReceiverSHA(NSData*raw){unsigned char b[32];CC_SHA256(raw.bytes,(CC_LONG)raw.length,b);NSMutableString*s=[NSMutableString string];for(auto v:b)[s appendFormat:@"%02x",v];return s;}
static BOOL ReceiverEffect(id e){return e&&[e conformsToProtocol:@protocol(YNXOriginalIDEIdentityPrivateEffect)]&&[e respondsToSelector:@selector(assertCurrent:)]&&[e respondsToSelector:@selector(invokeOriginal:)]&&[e respondsToSelector:@selector(copyOriginalPublicResult:)]&&[e respondsToSelector:@selector(retire)]&&[e respondsToSelector:@selector(join:)]&&[e respondsToSelector:@selector(close:)];}
@implementation YNXIDEHelperReceiver{
 YNXIDEHelperMessagePeer*_peer;YNXAuthIdentitySourceAuthority*_source;
 id<YNXOriginalIDEIdentityPrivateEffect>_effect;
 NSData*_request,*_proof,*_invocation;NSDictionary*_actualResult;
 id _actualPartial;
 NSError*_first,*_cleanupFirst;BOOL _selected,_busy,_retired,_closeSelected,_closed;
 BOOL _prepareSelected,_prepared;
}
- (instancetype)initWithOriginalPeer:(YNXIDEHelperMessagePeer*)peer{if((self=[super init]))_peer=peer;return self;}
- (void)fail:(NSError*)error code:(NSString*)code{if(!_first)_first=error?:ReceiverError(code);}
- (BOOL)current:(NSError**)error{
 if(_retired||!_peer||![_peer assertCurrentMessage:error])return NO;
 if(_source&&![_source assertOriginalIDEIdentityRequestCurrent:_request invocation:_invocation error:error])return NO;
 if(_effect&&![_effect assertCurrent:error])return NO;
 return [_peer assertCurrentMessage:error];
}
- (void)drain{
 if(_busy||_closed||_closeSelected)return;
 if(_effect&&!ReceiverEffect(_effect)){if(!_cleanupFirst)_cleanupFirst=ReceiverError(@"AUTH_IDENTITY_EFFECT_CLEANUP_CONTRACT_MISSING");return;}
 [_effect retire];[_source retire];NSError*error=nil;
 // Pending child is a join fence, not permission to close its parent.
 if(_effect&&![_effect join:&error]){if(!_cleanupFirst)_cleanupFirst=error?:ReceiverError(@"AUTH_IDENTITY_EFFECT_JOIN_PENDING");return;}
 if(_source&&![_source join:&error]){if(!_cleanupFirst)_cleanupFirst=error?:ReceiverError(@"AUTH_IDENTITY_SOURCE_JOIN_PENDING");return;}
 _closeSelected=YES;
 if(_effect){BOOL done=[_effect close:&error];if(!done||error){if(!_cleanupFirst)_cleanupFirst=error?:ReceiverError(@"AUTH_IDENTITY_EFFECT_CLOSE_UNKNOWN");return;}_effect=nil;}
 error=nil;if(_source){BOOL done=[_source close:&error];if(!done||error){if(!_cleanupFirst)_cleanupFirst=error?:ReceiverError(@"AUTH_IDENTITY_SOURCE_CLOSE_UNKNOWN");return;}_source=nil;}
 _closed=YES;
}
- (void)prepareOriginalReceiveRequest:(NSData*)request reply:(void(^)(NSDictionary*,NSError*))reply{
 if(!reply)return;
 @synchronized(self){
  if(_prepareSelected||_selected||_busy||_retired){reply(nil,_first?:ReceiverError(@"AUTH_IDENTITY_RECEIVER_PREPARE_ALREADY_SELECTED"));return;}
  _prepareSelected=_busy=YES;_request=[request copy];_invocation=[NSData data];NSDictionary*packet=nil;
  @try{
   NSError*error=nil;if(!ReceiverBytes(_request,16384)||![self current:&error]){[self fail:error code:@"AUTH_IDENTITY_HELPER_MESSAGE_REQUIRED"];return;}
   _source=[YNXAuthIdentitySourceAuthority acquireOriginalHelperSourceForMessagePeer:_peer error:&error];
   if(error||!_source){[self fail:error code:@"AUTH_IDENTITY_ORIGINAL_SOURCE_UNAVAILABLE"];return;}
   NSDictionary*body=[NSJSONSerialization JSONObjectWithData:_request options:0 error:nil];
   if(![body isKindOfClass:NSDictionary.class]||![body[@"purpose"]isEqual:@"AUTH-IDENTITY-RECEIVE"]||![self current:&error]||![_source assertOriginalIDEIdentityProofConsumerReady:_request error:&error]||![_source assertOriginalIDEIdentityReceiveExecutionAvailable:&error]){[self fail:error code:@"AUTH_IDENTITY_RECEIVE_PREPARE_REFUSED"];return;}
   NSNumber*sequence=[_source copyOriginalCurrentSequence:&error];NSNumber*uid=[_peer copyOriginalUserIdentifier:&error];
   if(error||!sequence||!uid||![self current:&error]){[self fail:error code:@"AUTH_IDENTITY_RECEIVE_PREPARE_POST_CURRENT_REFUSED"];return;}
   packet=@{@"requestSHA256":ReceiverSHA(_request),@"kernelUID":uid,@"sourceSequence":sequence,@"dataOnly":@YES,@"nativeAdmission":@NO};_prepared=YES;
  }@catch(NSException*){[self fail:nil code:@"AUTH_IDENTITY_RECEIVE_PREPARE_UNKNOWN"];}
  @finally{_busy=NO;if(!_prepared){_selected=YES;[self drain];}reply(packet,_first?:_cleanupFirst);}
 }
}
- (void)perform:(NSUInteger)kind request:(NSData*)request invocation:(NSData*)invocation proof:(NSData*)proof reply:(void(^)(NSDictionary*,NSError*))reply{
 if(!reply)return;
 @synchronized(self){
  if(_selected||_busy||_retired){reply(_actualResult,_first?:ReceiverError(@"AUTH_IDENTITY_RECEIVER_ALREADY_SELECTED"));return;}
  _selected=_busy=YES; // BEFORE any Source, verifier or side effect. No retry.
  NSData*incoming=[request copy];if(!_prepared){_request=incoming;_invocation=[invocation copy];}_proof=[proof copy];
  @try{
   NSError*error=nil;
   if(_prepared&&(kind!=1||![_request isEqual:incoming]||![invocation isKindOfClass:NSData.class]||invocation.length)){[self fail:nil code:@"AUTH_IDENTITY_PREPARED_REQUEST_CHANGED"];return;}
   if(!ReceiverBytes(_request,16384)||!ReceiverBytes(_proof,262144)||![_invocation isKindOfClass:NSData.class]||(kind==3?!ReceiverBytes(_invocation,16384):_invocation.length!=0)){[self fail:nil code:@"AUTH_IDENTITY_RECEIVER_ARGUMENTS_INVALID"];return;}
   if(![self current:&error]){[self fail:error code:@"AUTH_IDENTITY_HELPER_MESSAGE_REQUIRED"];return;}
   // Keep actual partial before observing error. This does NOT construct a
   // different profile/Root or borrow RECEIVE for another identity purpose.
   if(!_source)_source=[YNXAuthIdentitySourceAuthority acquireOriginalHelperSourceForMessagePeer:_peer error:&error];
   if(error||!_source){[self fail:error code:@"AUTH_IDENTITY_ORIGINAL_SOURCE_UNAVAILABLE"];return;}
   NSDictionary*body=[NSJSONSerialization JSONObjectWithData:_request options:0 error:nil];
   NSString*purpose=kind==1?@"AUTH-IDENTITY-RECEIVE":kind==2?@"AUTH-IDENTITY-RECOVER":@"AUTH-PROTECTED-KEY-CALL";
   if(![body isKindOfClass:NSDictionary.class]||![body[@"purpose"]isEqual:purpose]){[self fail:nil code:@"AUTH_IDENTITY_RECEIVER_PURPOSE_MISMATCH"];return;}
   if(kind==3){
    if(![self current:&error]){[self fail:error code:@"AUTH_IDENTITY_KEY_CALL_CAPTURE_CURRENT_REFUSED"];return;}
    if(![_source respondsToSelector:@selector(captureOriginalIDEProtectedKeyCall:expectedRequest:error:)]){[self fail:nil code:@"AUTH_IDENTITY_KEY_CALL_CONSUMER_NOT_IMPLEMENTED"];return;}
    // Original R91 ordering: capture same partial BEFORE N1 proof, never
    // invoke/sign until proof verified. Constructor is not the invocation.
    _effect=[_source captureOriginalIDEProtectedKeyCall:_invocation expectedRequest:_request error:&error];
    if(error||!ReceiverEffect(_effect)){[self fail:error code:@"AUTH_IDENTITY_EFFECT_OWNER_REQUIRED"];return;}
   }
   if(![self current:&error]||![_source verifyOriginalIDEIdentityProof:_proof expectedRequest:_request invocation:_invocation error:&error]||error){[self fail:error code:@"AUTH_IDENTITY_PROOF_REFUSED"];return;}
   if(![self current:&error]){[self fail:error code:@"AUTH_IDENTITY_RECEIVER_POST_PROOF_REFUSED"];return;}
   if(kind==1){
    if(![_source assertOriginalIDEIdentityReceiveExecutionAvailable:&error]){[self fail:error code:@"AUTH_IDENTITY_PRIVILEGED_RECEIVER_NOT_CONNECTED"];return;}
    _actualResult=[_source installOriginalIDEIdentityPublicOriginals:&error];
   }else{
    SEL selector=kind==2?@selector(recoverOriginalIDEIdentityForRequest:error:):@selector(captureOriginalIDEProtectedKeyCall:expectedRequest:error:);
    if(![_source respondsToSelector:selector]){[self fail:nil code:kind==2?@"AUTH_IDENTITY_RECOVERY_CONSUMER_NOT_IMPLEMENTED":@"AUTH_IDENTITY_KEY_CALL_CONSUMER_NOT_IMPLEMENTED"];return;}
    if(kind==2)_effect=[_source recoverOriginalIDEIdentityForRequest:_request error:&error];
    if(error||!ReceiverEffect(_effect)){[self fail:error code:@"AUTH_IDENTITY_EFFECT_OWNER_REQUIRED"];return;}
    if(![self current:&error]){[self fail:error code:@"AUTH_IDENTITY_EFFECT_PRE_CURRENT_REFUSED"];return;}
    id actual=kind==2?[_effect copyOriginalPublicResult:&error]:[_effect invokeOriginal:&error];
    // Actual returned partial is adopted BEFORE late error/current/close.
    _actualPartial=actual;
    if([actual isKindOfClass:NSDictionary.class])_actualResult=[actual copy];
    else if(actual&&!error)error=ReceiverError(@"AUTH_IDENTITY_PUBLIC_RESULT_TYPE_INVALID");
   }
   if(error||!_actualResult){[self fail:error code:@"AUTH_IDENTITY_EFFECT_RESULT_UNKNOWN"];return;}
   if(![self current:&error]){[self fail:error code:@"AUTH_IDENTITY_EFFECT_POST_CURRENT_REFUSED"];return;}
  }@catch(NSException*){[self fail:nil code:@"AUTH_IDENTITY_RECEIVER_EXCEPTION_UNKNOWN"];}
  @finally{
   _busy=NO;[self drain];
   if(_cleanupFirst&&!_first)_first=_cleanupFirst;
   // A partial public result may accompany error. Never erase actual data or
   // report an UNKNOWN close/late refusal as success. Debt remains this owner.
   reply(_actualResult,_first);
  }
 }
}
- (void)receiveOriginalRequest:(NSData*)request proof:(NSData*)proof reply:(void(^)(NSDictionary*,NSError*))reply{[self perform:1 request:request invocation:[NSData data] proof:proof reply:reply];}
- (void)recoverOriginalRequest:(NSData*)request proof:(NSData*)proof reply:(void(^)(NSDictionary*,NSError*))reply{[self perform:2 request:request invocation:[NSData data] proof:proof reply:reply];}
- (void)invokeOriginalRequest:(NSData*)request invocation:(NSData*)invocation proof:(NSData*)proof reply:(void(^)(NSDictionary*,NSError*))reply{[self perform:3 request:request invocation:invocation proof:proof reply:reply];}
- (void)retireConnection{@synchronized(self){_retired=YES;[_peer retire];[self drain];if(_closed)_peer=nil;}}
- (BOOL)custodyDisposed{@synchronized(self){return _closed&&!_source&&!_effect;}}
@end
@implementation YNXIDEHelperListenerDelegate{
 NSMutableArray<YNXIDEHelperReceiver*>*_owners;
}
- (instancetype)init{if((self=[super init]))_owners=[NSMutableArray array];return self;}
- (void)terminalReceiver:(YNXIDEHelperReceiver*)receiver{
 [receiver retireConnection];
 if([receiver custodyDisposed]){@synchronized(self){[_owners removeObjectIdenticalTo:receiver];}}
}
- (BOOL)listener:(NSXPCListener*)listener shouldAcceptNewConnection:(NSXPCConnection*)connection{
 (void)listener;@synchronized(self){
  // Bounded retained custody; never drop an uncertain owner just to make room.
  if(_owners.count>=16)return NO;
  NSError*error=nil;YNXIDEHelperMessagePeer*peer=[YNXIDEHelperMessagePeer acceptOriginalNodeConnection:connection error:&error];if(!peer||error)return NO;
  YNXIDEHelperReceiver*receiver=[[YNXIDEHelperReceiver alloc]initWithOriginalPeer:peer];[_owners addObject:receiver];
  connection.exportedInterface=[NSXPCInterface interfaceWithProtocol:@protocol(YNXIDEIdentityReceiverService)];connection.exportedObject=receiver;
  __weak YNXIDEHelperListenerDelegate*weakSelf=self;
  void(^terminal)(void)=^{YNXIDEHelperListenerDelegate*owner=weakSelf;if(owner)[owner terminalReceiver:receiver];else [receiver retireConnection];};
  connection.interruptionHandler=terminal;connection.invalidationHandler=terminal;
  [connection resume];return YES;
 }
}
@end
BOOL YNXRunOriginalIDEHelper(NSError**error){
 if(![YNXIDEHelperMessagePeer assertOriginalHelperExecutable:error])return NO;
 YNXIDEHelperListenerDelegate*delegate=[YNXIDEHelperListenerDelegate new];
 NSXPCListener*listener=[[NSXPCListener alloc]initWithMachServiceName:YNXIDEIdentityHelperService];listener.delegate=delegate;[listener resume];
 [[NSRunLoop currentRunLoop]run];return YES;
}
