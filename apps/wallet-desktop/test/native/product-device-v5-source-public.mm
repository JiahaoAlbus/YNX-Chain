// PUBLIC OS/Source/factory doubles. No Root, Keychain, signing or HTTP.
#import <Foundation/Foundation.h>
#include <node_api.h>
#include <pthread.h>
#include <vector>
#include <string>
#include <memory>
#include <stdexcept>
#include "original-auth-identity-source-authority.h"
#include "original-product-device-v5-factory.h"
#include "original-auth-runtime-image-private.h"
static NSDictionary*PUBLICScope=nil;static NSString*PUBLICPath=nil;static bool PUBLICStale=false,PUBLICAcquireError=false,PUBLICSourceCloseFailure=false,PUBLICJoinPending=false,PUBLICFactoryError=false,PUBLICFactoryStale=false,PUBLICCoreCloseFailure=false,PUBLICImageCloseFailure=false,PUBLICImageError=false;
static unsigned PUBLICAcquires=0,PUBLICFactories=0,PUBLICSourceJoins=0,PUBLICSourceCloses=0,PUBLICCoreCloses=0,PUBLICImageCloses=0;static const void*PUBLICAddress=nullptr;
static NSError*PUBLICError(){return[NSError errorWithDomain:@"PUBLIC" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PUBLIC_NATIVE_FAILURE"}];}
@implementation YNXAuthIdentitySourceAuthority
+ (instancetype)acquireOriginalProductSessionHTTPProofV5Source:(NSError**)e{PUBLICAcquires++;auto*s=[self new];if(PUBLICAcquireError)*e=PUBLICError();return s;}
- (BOOL)assertOriginalProductSessionHTTPProofV5SourceCurrent:(NSError**)e{if(PUBLICStale){*e=PUBLICError();return NO;}return YES;}
- (NSDictionary*)copyOriginalProductSessionHTTPProofV5Scope:(NSError**)e{(void)e;return PUBLICScope;}
- (NSString*)copyOriginalProductSessionHTTPProofV5ModulePath:(NSError**)e{(void)e;return PUBLICPath;}
- (void)retire{}
- (BOOL)join:(NSError**)e{PUBLICSourceJoins++;if(PUBLICJoinPending){*e=PUBLICError();return NO;}return YES;}
- (BOOL)close:(NSError**)e{PUBLICSourceCloses++;if(PUBLICSourceCloseFailure){*e=PUBLICError();return NO;}return YES;}
@end
namespace ynx_auth_private {
struct OriginalRuntimeImageReadLeaseV1::State{OriginalRuntimeImageViewV1 view;bool selected=false,closed=false;};
OriginalRuntimeImageReadLeaseV1::OriginalRuntimeImageReadLeaseV1(YNXAuthIdentitySourceAuthority*,const void*address,NSError**e):state_(new State){PUBLICAddress=address;state_->view={"/PUBLIC/only.node",std::string(64,'a'),"/PUBLIC",PUBLICPath.UTF8String,[NSURL fileURLWithPath:PUBLICPath].absoluteString.UTF8String,1,2,3};if(PUBLICImageError)*e=PUBLICError();}
std::shared_ptr<OriginalRuntimeImageReadLeaseV1>borrowOriginalRuntimeImageReadLeaseV1(YNXAuthIdentitySourceAuthority*s,const void*a,NSError**e){return std::shared_ptr<OriginalRuntimeImageReadLeaseV1>(new OriginalRuntimeImageReadLeaseV1(s,a,e));}
OriginalRuntimeImageReadLeaseV1::~OriginalRuntimeImageReadLeaseV1()=default;
void OriginalRuntimeImageReadLeaseV1::assertCurrent(){if(PUBLICStale)throw std::runtime_error("PUBLIC_IMAGE_STALE");}
const OriginalRuntimeImageViewV1&OriginalRuntimeImageReadLeaseV1::readOriginalRuntimeImageView(){return state_->view;}
void OriginalRuntimeImageReadLeaseV1::retire()noexcept{}
bool OriginalRuntimeImageReadLeaseV1::close()noexcept{if(state_->selected)return state_->closed;state_->selected=true;PUBLICImageCloses++;return state_->closed=!PUBLICImageCloseFailure;}
struct ProductDeviceV5ProofOperation::Impl{bool retired=false,selected=false,closed=false;};
ProductDeviceV5ProofOperation::ProductDeviceV5ProofOperation():impl_(new Impl){}
ProductDeviceV5ProofOperation::~ProductDeviceV5ProofOperation()=default;
std::unique_ptr<ProductDeviceV5ProofOperation>ProductDeviceV5Factory::produce(YNXAuthIdentitySourceAuthority*,ProductDeviceV5Transport&,std::string&e){PUBLICFactories++;auto p=std::unique_ptr<ProductDeviceV5ProofOperation>(new ProductDeviceV5ProofOperation);if(PUBLICFactoryError)e="PUBLIC_FACTORY_LATE_ERROR";if(PUBLICFactoryStale)PUBLICStale=true;return p;}
std::vector<unsigned char>ProductDeviceV5ProofOperation::copyOriginalMemberDATA()const{return{5,0,1,2};}
NSData*ProductDeviceV5ProofOperation::copyOriginalUnsignedDATA()const{return[@"{\"PUBLIC\":true}" dataUsingEncoding:NSUTF8StringEncoding];}
ProductDeviceV5ProofStatusDATA ProductDeviceV5ProofOperation::copyOriginalStatusDATA()const{return{-9,7,98303,true,true,false,true};}
bool ProductDeviceV5ProofOperation::assertCurrent(std::string&e){if(PUBLICStale||impl_->retired){e="PUBLIC_CORE_STALE";return false;}return true;}
void ProductDeviceV5ProofOperation::retire(){impl_->retired=true;}
bool ProductDeviceV5ProofOperation::join(std::string&){return impl_->retired;}
bool ProductDeviceV5ProofOperation::close(std::string&e){if(impl_->selected)return impl_->closed;impl_->selected=true;PUBLICCoreCloses++;if(PUBLICCoreCloseFailure){e="PUBLIC_CORE_CLOSE_UNKNOWN";return false;}return impl_->closed=true;}
}
@implementation YNXAuthIdentitySourceAuthority(RuntimeImageNativePrivateV1)
- (std::shared_ptr<ynx_auth_private::OriginalRuntimeImageReadLeaseV1>)borrowOriginalRuntimeImageReadLeaseForNativeAddress:(const void*)a error:(NSError**)e{return ynx_auth_private::borrowOriginalRuntimeImageReadLeaseV1(self,a,e);}
@end
static napi_value DeviceV4Undefined(napi_env e){napi_value v=nullptr;napi_get_undefined(e,&v);return v;}
static napi_value DeviceV4Error(napi_env e,const char*code){napi_value s=nullptr,v=nullptr;napi_create_string_utf8(e,code,NAPI_AUTO_LENGTH,&s);napi_create_error(e,nullptr,s,&v);napi_set_named_property(e,v,"code",s);return v;}
static napi_value DeviceV4Throw(napi_env e,const char*code){napi_throw(e,DeviceV4Error(e,code));return nullptr;}
struct ProductDeviceV4SourceOwner{napi_env env;};static napi_value DeviceV4First(ProductDeviceV4SourceOwner*p,NSString*c){return DeviceV4Error(p->env,c.UTF8String);}
#include "PUBLIC-device-v4-read-intrinsics.inc.mm"
static bool PUBLICDeleteFail=false;static unsigned PUBLICDeleteCalls=0;
static napi_status PUBLICDelete(napi_env e,napi_ref r){PUBLICDeleteCalls++;if(PUBLICDeleteFail){PUBLICDeleteFail=false;return napi_generic_failure;}return napi_delete_reference(e,r);}
#define napi_delete_reference PUBLICDelete
#include "PUBLIC-source-stage.inc.mm"
#undef napi_delete_reference
static napi_value configure(napi_env e,napi_callback_info info){size_t n=1;napi_value v=nullptr;napi_get_cb_info(e,info,&n,&v,nullptr,nullptr);size_t length=0;napi_get_value_string_utf8(e,v,nullptr,0,&length);std::vector<char>b(length+1);napi_get_value_string_utf8(e,v,b.data(),b.size(),&length);NSData*raw=[NSData dataWithBytes:b.data() length:length];NSDictionary*d=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];if(d[@"scope"])PUBLICScope=d[@"scope"];if(d[@"path"])PUBLICPath=d[@"path"];PUBLICStale=[d[@"stale"]boolValue];PUBLICAcquireError=[d[@"acquireError"]boolValue];PUBLICSourceCloseFailure=[d[@"sourceCloseFailure"]boolValue];PUBLICJoinPending=[d[@"joinPending"]boolValue];PUBLICFactoryError=[d[@"factoryError"]boolValue];PUBLICFactoryStale=[d[@"factoryStale"]boolValue];PUBLICCoreCloseFailure=[d[@"coreCloseFailure"]boolValue];PUBLICImageCloseFailure=[d[@"imageCloseFailure"]boolValue];PUBLICImageError=[d[@"imageError"]boolValue];return DeviceV4Undefined(e);}
static napi_value counts(napi_env e,napi_callback_info){napi_value out=nullptr,v=nullptr;napi_create_object(e,&out);for(auto p:{std::pair<const char*,unsigned>{"acquires",PUBLICAcquires},{"factories",PUBLICFactories},{"sourceJoins",PUBLICSourceJoins},{"sourceCloses",PUBLICSourceCloses},{"coreCloses",PUBLICCoreCloses},{"imageCloses",PUBLICImageCloses},{"deleteCalls",PUBLICDeleteCalls},{"actualAddressCaptured",PUBLICAddress?1U:0U}}){napi_create_uint32(e,p.second,&v);napi_set_named_property(e,out,p.first,v);}return out;}
static napi_value failDelete(napi_env e,napi_callback_info){PUBLICDeleteFail=true;return DeviceV4Undefined(e);}
static napi_value init(napi_env e,napi_value exports){if(!DeviceV4ReadInitialize(e)||!RegisterOriginalProductDeviceV5SourceStage(e,exports))return nullptr;napi_property_descriptor d[]={{"PUBLICConfigure",nullptr,configure,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICCounts",nullptr,counts,nullptr,nullptr,nullptr,napi_default,nullptr},{"PUBLICFailDeleteOnce",nullptr,failDelete,nullptr,nullptr,nullptr,napi_default,nullptr}};napi_define_properties(e,exports,3,d);return exports;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
