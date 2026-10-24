// PUBLIC NAPI lifecycle fixture only. No Source, Keychain, user approval or
// signature. Native approval semantics run separately in the store tests.
#import <Foundation/Foundation.h>
#include <node_api.h>
#include <pthread.h>
#include <unordered_set>
#include <string>
#include <new>
#import "../../native/original-artifact-publisher-store.h"
static napi_value Error(napi_env env,const char*code){napi_throw_error(env,code,code);return nullptr;}
static napi_value Undefined(napi_env env){napi_value value;napi_get_undefined(env,&value);return value;}
static bool IDEIdentityArgc(napi_env env,napi_callback_info info,size_t wanted,napi_value*args,napi_value*self,void**raw){size_t n=wanted+1;napi_value values[3];if(wanted>2||napi_get_cb_info(env,info,&n,values,self,raw)!=napi_ok||n!=wanted)return false;for(size_t i=0;i<wanted;i++)args[i]=values[i];return true;}
static NSData*IDEIdentityString(napi_env env,napi_value value,size_t cap){size_t n=0;if(napi_get_value_string_utf8(env,value,nullptr,0,&n)!=napi_ok||!n||n>cap)return nil;std::string text(n+1,'\0');if(napi_get_value_string_utf8(env,value,text.data(),text.size(),&n)!=napi_ok)return nil;return [NSData dataWithBytes:text.data() length:n];}
static std::string IDEIdentityCode(NSError*e,const char*fallback){return e?e.localizedDescription.UTF8String:fallback;}
static napi_value IDEIdentityPublic(napi_env env,id value){napi_value result;if(value==NSNull.null){napi_get_null(env,&result);return result;}if([value isKindOfClass:NSData.class]){void*bytes=nullptr;napi_value array;napi_create_arraybuffer(env,[value length],&bytes,&array);memcpy(bytes,[value bytes],[value length]);napi_create_typedarray(env,napi_uint8_array,[value length],array,0,&result);return result;}if([value isKindOfClass:NSString.class]){napi_create_string_utf8(env,[value UTF8String],NAPI_AUTO_LENGTH,&result);return result;}if([value isKindOfClass:NSNumber.class]){napi_get_boolean(env,[value boolValue],&result);return result;}napi_create_object(env,&result);for(NSString*key in value){napi_value item=IDEIdentityPublic(env,value[key]);napi_property_descriptor d={key.UTF8String,nullptr,nullptr,nullptr,nullptr,item,napi_default,nullptr};napi_define_properties(env,result,1,&d);}napi_object_freeze(env,result);return result;}
static bool Same(napi_env env,napi_ref ref,napi_value value){napi_value held;bool same=false;return ref&&napi_get_reference_value(env,ref,&held)==napi_ok&&napi_strict_equals(env,held,value,&same)==napi_ok&&same;}
struct IDEWalletSourceOwner {napi_env env;YNXOriginalIDEWalletIdentitySource*__strong source=nil;YNXOriginalIDEWalletPeerLaunch*__strong transport=nil;unsigned busy=0;bool closed=false,closing=false,retired=false,bound=true;std::string first;};
static std::unordered_set<IDEWalletSourceOwner*>parents;
static IDEWalletSourceOwner*IDEWalletOriginal(napi_env env,napi_value value){void*raw=nullptr;if(napi_unwrap(env,value,&raw)!=napi_ok)return nullptr;auto*p=static_cast<IDEWalletSourceOwner*>(raw);return parents.count(p)&&p->env==env?p:nullptr;}
static bool IDEWalletCurrent(IDEWalletSourceOwner*p,bool bound){return p&&!p->closed&&!p->retired&&p->first.empty()&&(!bound||p->bound);}
static unsigned publicSendCalls=0;static NSData*__strong publicSentResult=nil;
static bool publicHoldQueue=false,publicFailQueue=false;static napi_deferred publicDeferred=nullptr;static IDEWalletSourceOwner*publicQueuedParent=nullptr;
@interface YNXOriginalIDEWalletPeerLaunch : NSObject
-(BOOL)selectOriginalArtifactResult:(NSData*)bytes error:(NSError**)error;
@end
@implementation YNXOriginalIDEWalletPeerLaunch
-(BOOL)selectOriginalArtifactResult:(NSData*)bytes error:(NSError**)error {(void)error;publicSentResult=[bytes copy];return YES;}
@end
#if defined(YNX_ORIGINAL_WALLET_ARTIFACT_CABI)
static napi_value IDEWalletQueue(napi_env env,napi_value self,IDEWalletSourceOwner*p,bool sending){if(!sending||IDEWalletOriginal(env,self)!=p||p->busy!=1)return Error(env,"PUBLIC_QUEUE_OWNER_INVALID");publicSendCalls++;if(publicFailQueue){publicFailQueue=false;return Error(env,"PUBLIC_QUEUE_UNKNOWN");}napi_deferred deferred;napi_value promise;napi_create_promise(env,&deferred,&promise);if(publicHoldQueue){publicHoldQueue=false;p->busy++;publicDeferred=deferred;publicQueuedParent=p;}else napi_resolve_deferred(env,deferred,Undefined(env));return promise;}
#endif
static bool publicPendingOutcome=false;
static unsigned publicSigningCalls=0;
static IDEWalletSourceOwner*publicRetireOnSign=nullptr;
@implementation YNXOriginalArtifactReleaseApproval {BOOL approved,retired,pendingOutcome,signedOnce;}
+(instancetype)captureWalletSource:(YNXOriginalIDEWalletIdentitySource*)source transport:(YNXOriginalIDEWalletPeerLaunch*)transport error:(NSError**)error {(void)source;(void)transport;(void)error;YNXOriginalArtifactReleaseApproval*p=[[super alloc]init];p->pendingOutcome=publicPendingOutcome;publicPendingOutcome=false;return p;}
-(NSDictionary*)copyOriginalReview:(NSError**)error {if(retired){if(error)*error=[NSError errorWithDomain:@"PUBLIC" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PUBLIC_RETIRED"}];return nil;}return approved?@{@"reviewId":@"PUBLIC-review",@"actualApprovalRef":@"PUBLIC-ref"}:@{@"reviewId":@"PUBLIC-review"};}
-(BOOL)approveOriginalReview:(NSString*)review error:(NSError**)error {(void)error;if(approved||retired||![review isEqual:@"PUBLIC-review"])return NO;approved=YES;return YES;}
-(BOOL)assertOriginalApprovalCurrent:(NSString*)ref error:(NSError**)error {(void)error;return approved&&!retired&&[ref isEqual:@"PUBLIC-ref"];}
-(NSDictionary*)selectOriginalSigning:(NSString*)ref error:(NSError**)error {(void)ref;(void)error;return nil;}
-(NSDictionary*)signOriginalRelease:(NSString*)ref error:(NSError**)error {if(!approved||retired||signedOnce||![ref isEqual:@"PUBLIC-ref"]){if(error)*error=[NSError errorWithDomain:@"PUBLIC" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PUBLIC_SIGN_REFUSED"}];return nil;}signedOnce=YES;publicSigningCalls++;if(publicRetireOnSign){publicRetireOnSign->retired=true;publicRetireOnSign=nullptr;}if(pendingOutcome){if(error)*error=[NSError errorWithDomain:@"PUBLIC" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PUBLIC_OUTCOME_SAVE_REQUIRED"}];return nil;}return [self copyOriginalSigningOutcome:error];}
-(NSDictionary*)copyOriginalSigningOutcome:(NSError**)error {(void)error;return @{@"phase":pendingOutcome?@"signed-outcome-unknown":@"signed-unhanded",@"stored":@(!pendingOutcome&&signedOnce),@"hasSignedResult":@(signedOnce),@"active":@NO,@"record":signedOnce?(id)@{@"requestOriginal":@"PUBLIC-request",@"manifestOriginal":@"PUBLIC-manifest",@"publisherOriginal":@"AQ",@"actualApprovalRef":@"PUBLIC-ref",@"publisherRegistrationRef":@"PUBLIC-registration",@"publisherRevision":@"1",@"publisherKeyVersion":@"2",@"memberOriginal":@"AQID",@"phase":@"signed-unhanded",@"status":@"0",@"cleanup":@"2",@"invoked":@YES,@"errorCode":NSNull.null}:NSNull.null};}
-(BOOL)saveOriginalSigningOutcome:(NSError**)error {(void)error;pendingOutcome=NO;return YES;}
-(void)retire {retired=YES;}
-(BOOL)close:(NSError**)error {if(pendingOutcome){if(error)*error=[NSError errorWithDomain:@"PUBLIC" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PUBLIC_OUTCOME_SAVE_REQUIRED"}];return NO;}retired=YES;return YES;}
@end
#include "../../native/original-artifact-publisher-binding.inc.mm"
static napi_value Parent(napi_env env,napi_callback_info info){(void)info;auto*p=new IDEWalletSourceOwner{};p->env=env;p->transport=[YNXOriginalIDEWalletPeerLaunch new];napi_value result;napi_create_object(env,&result);parents.insert(p);napi_wrap(env,result,p,[](napi_env,void*raw,void*){auto*p=static_cast<IDEWalletSourceOwner*>(raw);parents.erase(p);delete p;},nullptr,nullptr);return result;}
static napi_value RetireParent(napi_env env,napi_callback_info info){napi_value value;if(!IDEIdentityArgc(env,info,1,&value,nullptr,nullptr))return Error(env,"PUBLIC_ARGS");auto*p=IDEWalletOriginal(env,value);if(!p)return Error(env,"PUBLIC_PARENT");p->retired=true;return Undefined(env);}
static napi_value PendingOutcome(napi_env env,napi_callback_info info){(void)info;publicPendingOutcome=true;return Undefined(env);}
static napi_value RetireOnSign(napi_env env,napi_callback_info info){napi_value value;if(!IDEIdentityArgc(env,info,1,&value,nullptr,nullptr))return Error(env,"PUBLIC_ARGS");publicRetireOnSign=IDEWalletOriginal(env,value);return Undefined(env);}
static napi_value SigningCalls(napi_env env,napi_callback_info info){(void)info;napi_value value;napi_create_uint32(env,publicSigningCalls,&value);return value;}
static napi_value SendCalls(napi_env env,napi_callback_info info){(void)info;napi_value value;napi_create_uint32(env,publicSendCalls,&value);return value;}
static napi_value SentResult(napi_env env,napi_callback_info info){(void)info;napi_value value;napi_create_string_utf8(env,(const char*)publicSentResult.bytes,publicSentResult.length,&value);return value;}
static napi_value HoldQueue(napi_env env,napi_callback_info info){(void)info;publicHoldQueue=true;return Undefined(env);}
static napi_value FailQueue(napi_env env,napi_callback_info info){(void)info;publicFailQueue=true;return Undefined(env);}
static napi_value FinishQueue(napi_env env,napi_callback_info info){(void)info;if(!publicDeferred||!publicQueuedParent)return Error(env,"PUBLIC_NO_QUEUED_PARENT");publicQueuedParent->busy--;napi_resolve_deferred(env,publicDeferred,Undefined(env));publicDeferred=nullptr;publicQueuedParent=nullptr;return Undefined(env);}
static napi_value Register(napi_env env,napi_value exports){napi_property_descriptor methods[]={{"PUBLICParent",nullptr,Parent,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICRetireParent",nullptr,RetireParent,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICPendingOutcome",nullptr,PendingOutcome,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICRetireOnSign",nullptr,RetireOnSign,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICSigningCalls",nullptr,SigningCalls,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICSendCalls",nullptr,SendCalls,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICSentResult",nullptr,SentResult,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICHoldSend",nullptr,HoldQueue,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICFailSend",nullptr,FailQueue,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICFinishSend",nullptr,FinishQueue,nullptr,nullptr,nullptr,napi_default,nullptr}};napi_define_properties(env,exports,10,methods);return RegisterOriginalArtifactPublisherBinding(env,exports)?exports:nullptr;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,Register)
