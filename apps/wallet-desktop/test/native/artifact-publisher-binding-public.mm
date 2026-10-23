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
static bool IDEIdentityArgc(napi_env env,napi_callback_info info,size_t wanted,napi_value*args,napi_value*self,void**raw){size_t n=wanted+1;napi_value values[3];if(wanted>1||napi_get_cb_info(env,info,&n,values,self,raw)!=napi_ok||n!=wanted)return false;if(wanted)args[0]=values[0];return true;}
static NSData*IDEIdentityString(napi_env env,napi_value value,size_t cap){size_t n=0;if(napi_get_value_string_utf8(env,value,nullptr,0,&n)!=napi_ok||!n||n>cap)return nil;std::string text(n+1,'\0');if(napi_get_value_string_utf8(env,value,text.data(),text.size(),&n)!=napi_ok)return nil;return [NSData dataWithBytes:text.data() length:n];}
static std::string IDEIdentityCode(NSError*e,const char*fallback){return e?e.localizedDescription.UTF8String:fallback;}
static napi_value IDEIdentityPublic(napi_env env,id value){napi_value result;napi_create_object(env,&result);for(NSString*key in value){napi_value item;napi_create_string_utf8(env,[value[key] UTF8String],NAPI_AUTO_LENGTH,&item);napi_property_descriptor d={key.UTF8String,nullptr,nullptr,nullptr,nullptr,item,napi_default,nullptr};napi_define_properties(env,result,1,&d);}napi_object_freeze(env,result);return result;}
static bool Same(napi_env env,napi_ref ref,napi_value value){napi_value held;bool same=false;return ref&&napi_get_reference_value(env,ref,&held)==napi_ok&&napi_strict_equals(env,held,value,&same)==napi_ok&&same;}
struct IDEWalletSourceOwner {napi_env env;YNXOriginalIDEWalletIdentitySource*__strong source=nil;YNXOriginalIDEWalletPeerLaunch*__strong transport=nil;unsigned busy=0;bool closed=false,closing=false,retired=false,bound=true;std::string first;};
static std::unordered_set<IDEWalletSourceOwner*>parents;
static IDEWalletSourceOwner*IDEWalletOriginal(napi_env env,napi_value value){void*raw=nullptr;if(napi_unwrap(env,value,&raw)!=napi_ok)return nullptr;auto*p=static_cast<IDEWalletSourceOwner*>(raw);return parents.count(p)&&p->env==env?p:nullptr;}
static bool IDEWalletCurrent(IDEWalletSourceOwner*p,bool bound){return p&&!p->closed&&!p->retired&&p->first.empty()&&(!bound||p->bound);}
@implementation YNXOriginalArtifactReleaseApproval {BOOL approved,retired;}
+(instancetype)captureWalletSource:(YNXOriginalIDEWalletIdentitySource*)source transport:(YNXOriginalIDEWalletPeerLaunch*)transport error:(NSError**)error {(void)source;(void)transport;(void)error;return [[super alloc]init];}
-(NSDictionary*)copyOriginalReview:(NSError**)error {if(retired){if(error)*error=[NSError errorWithDomain:@"PUBLIC" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PUBLIC_RETIRED"}];return nil;}return approved?@{@"reviewId":@"PUBLIC-review",@"actualApprovalRef":@"PUBLIC-ref"}:@{@"reviewId":@"PUBLIC-review"};}
-(BOOL)approveOriginalReview:(NSString*)review error:(NSError**)error {(void)error;if(approved||retired||![review isEqual:@"PUBLIC-review"])return NO;approved=YES;return YES;}
-(BOOL)assertOriginalApprovalCurrent:(NSString*)ref error:(NSError**)error {(void)error;return approved&&!retired&&[ref isEqual:@"PUBLIC-ref"];}
-(NSDictionary*)selectOriginalSigning:(NSString*)ref error:(NSError**)error {(void)ref;(void)error;return nil;}
-(void)retire {retired=YES;}
-(BOOL)close:(NSError**)error {(void)error;retired=YES;return YES;}
@end
#include "../../native/original-artifact-publisher-binding.inc.mm"
static napi_value Parent(napi_env env,napi_callback_info info){(void)info;auto*p=new IDEWalletSourceOwner{};p->env=env;p->transport=(YNXOriginalIDEWalletPeerLaunch*)[NSObject new];napi_value result;napi_create_object(env,&result);parents.insert(p);napi_wrap(env,result,p,[](napi_env,void*raw,void*){auto*p=static_cast<IDEWalletSourceOwner*>(raw);parents.erase(p);delete p;},nullptr,nullptr);return result;}
static napi_value RetireParent(napi_env env,napi_callback_info info){napi_value value;if(!IDEIdentityArgc(env,info,1,&value,nullptr,nullptr))return Error(env,"PUBLIC_ARGS");auto*p=IDEWalletOriginal(env,value);if(!p)return Error(env,"PUBLIC_PARENT");p->retired=true;return Undefined(env);}
static napi_value Register(napi_env env,napi_value exports){napi_property_descriptor methods[]={{"PUBLICParent",nullptr,Parent,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICRetireParent",nullptr,RetireParent,nullptr,nullptr,nullptr,napi_default,nullptr}};napi_define_properties(env,exports,2,methods);return RegisterOriginalArtifactPublisherBinding(env,exports)?exports:nullptr;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,Register)
