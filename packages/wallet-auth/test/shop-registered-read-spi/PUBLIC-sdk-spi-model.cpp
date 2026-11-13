// PUBLIC NAPI model only: no Auth producer, Root, key, registered device or wire.
#define napi_delete_reference PUBLIC_delete_reference
#include "shop_registered_read_sdk_bridge.cpp"
#undef napi_delete_reference
static int allocationCountdown=-1;
static void checkAllocationFault() {
 if (allocationCountdown == 0) {
  allocationCountdown = -1;
  throw std::bad_alloc();
 }
 if (allocationCountdown > 0) --allocationCountdown;
}
#if defined(__linux__)
// Linker wrapping targets references from this fixture. ELF preemption can
// otherwise resolve its operator new calls to the host Node executable.
extern "C" void* __real__Znwm(std::size_t);
extern "C" void* __wrap__Znwm(std::size_t size) {
 checkAllocationFault();
 return __real__Znwm(size);
}
#else
void* operator new(std::size_t size) {
 checkAllocationFault();
 if (auto* value = std::malloc(size)) return value;
 throw std::bad_alloc();
}
void operator delete(void* value) noexcept { std::free(value); }
#endif
static bool failDrop=false,nsUnknown=false;static int nsCloses=0;static napi_ref fixtureNS=nullptr,fixtureThen=nullptr;
extern "C" napi_status napi_delete_reference(napi_env,napi_ref);
extern "C" napi_status PUBLIC_delete_reference(napi_env e,napi_ref r){if(failDrop)return napi_generic_failure;return napi_delete_reference(e,r);}
struct ynx_auth_shop_product_source_borrow_v4{};static ynx_auth_shop_product_source_borrow_v4 token;
extern "C" S ynx_auth_shop_product_source_current_v4(void*,ynx_auth_shop_product_source_borrow_v4*p){return p==&token?S{0,0,0,0}:foreign();}
extern "C" S ynx_auth_shop_product_source_copy_scope_v4(void*,ynx_auth_shop_product_source_borrow_v4*,uint8_t*b,size_t n,ynx_auth_shop_product_scope_data_v4*out){
 if(n!=32768)return foreign();size_t at=0;auto span=[&](std::string s){auto*p=b+at;memcpy(p,s.data(),s.size());at+=s.size();return ynx_auth_shop_span_v1{p,s.size()};};
 *out={};out->version=1;out->size=sizeof(*out);out->network_id=span(std::string(64,'1'));out->account=span("0x"+std::string(40,'2'));out->protected_resource_ref=span("PUBLIC-resource");out->operation_count=1;out->product_count=1;out->operations[0]=span("readOriginalInvoiceIntent");out->products[0]={span("shop.order"),span("PUBLIC-order")};return {};}
namespace ynx::auth::shop::v4 {
struct OriginalShopSDKNamespaceLoan::Impl{};
OriginalShopSDKNamespaceLoan::OriginalShopSDKNamespaceLoan(std::shared_ptr<Impl>p):p_(std::move(p)){}
OriginalShopSDKNamespaceLoan::~OriginalShopSDKNamespaceLoan()=default;
struct ShopNamespaceAccess{static std::shared_ptr<OriginalShopSDKNamespaceLoan>make(){return std::shared_ptr<OriginalShopSDKNamespaceLoan>(new OriginalShopSDKNamespaceLoan(std::make_shared<OriginalShopSDKNamespaceLoan::Impl>()));}};
S OriginalShopSDKNamespaceLoan::current()noexcept{return {};}
S OriginalShopSDKNamespaceLoan::copy_original_refs(napi_value*ns,napi_value fn[2])noexcept{extern napi_env modelEnv;napi_get_reference_value(modelEnv,fixtureNS,ns);napi_get_named_property(modelEnv,*ns,"capture",&fn[0]);napi_get_named_property(modelEnv,*ns,"create",&fn[1]);return {};}
S OriginalShopSDKNamespaceLoan::copy_original_promise_then(napi_value*out)noexcept{extern napi_env modelEnv;napi_get_reference_value(modelEnv,fixtureThen,out);return {};}
S OriginalShopSDKNamespaceLoan::close()noexcept{nsCloses++;return nsUnknown?S{0,0,1,0}:S{0,0,0,1};}
napi_env modelEnv=nullptr;
ShopSDKNamespaceAcquisition borrow_original_shop_sdk_namespace_for_source(napi_env e,ynx_auth_shop_product_source_borrow_v4*)noexcept{modelEnv=e;return {ShopNamespaceAccess::make(),{}};}
}
static napi_value statusJS(napi_env e,S s){napi_value o,v;napi_create_object(e,&o);const char*k[]={"errorPresent","code","unknown","physicalDone"};int64_t a[]={s.error_present,s.first_code,s.unknown,s.physical_done};for(int i=0;i<4;i++){napi_create_int64(e,a[i],&v);napi_set_named_property(e,o,k[i],v);}return o;}
static napi_value run(napi_env e,napi_callback_info i){size_t n=3;napi_value a[3],out;void*d=nullptr;napi_get_cb_info(e,i,&n,a,nullptr,&d);auto op=static_cast<const char*>(d);
 if(!strcmp(op,"capture")){if(fixtureNS)napi_delete_reference(e,fixtureNS);napi_create_reference(e,a[0],1,&fixtureNS);auto r=ynx_sdk_shop_registered_read_capture_for_product_child_v4(e,a[1],&token);if(!r.owner){napi_get_null(e,&out);return out;}napi_create_external(e,r.owner,nullptr,nullptr,&out);return out;}
 if(!strcmp(op,"allocfail")){int32_t count=0;napi_get_value_int32(e,a[0],&count);allocationCountdown=count;napi_get_undefined(e,&out);return out;}
 void*p=nullptr;if(n)napi_get_value_external(e,a[0],&p);
 if(!strcmp(op,"begin")){std::string s="PUBLIC-order";auto q=ynx_sdk_shop_registered_read_begin_original_get_for_product_child_v4(e,static_cast<ynx_sdk_shop_registered_read_v4*>(p),&token,{reinterpret_cast<const uint8_t*>(s.data()),s.size()});napi_create_external(e,q.owner,nullptr,nullptr,&out);return out;}
 if(!strcmp(op,"copy")){uint8_t b[YNX_SHOP_V4_HEADER_MAX];ynx_sdk_shop_get_proof_original_v4 v{};S s=ynx_sdk_shop_get_proof_copy_original_v4(e,static_cast<ynx_sdk_shop_get_proof_v4*>(p),b,sizeof(b),&v);out=statusJS(e,s);napi_value x;napi_create_uint32(e,v.ready,&x);napi_set_named_property(e,out,"ready",x);if(v.ready){napi_create_string_utf8(e,reinterpret_cast<const char*>(v.header_original.bytes),v.header_original.length,&x);napi_set_named_property(e,out,"header",x);}return out;}
 if(!strcmp(op,"dropfail")){napi_get_value_bool(e,a[0],&failDrop);napi_get_undefined(e,&out);return out;}
 if(!strcmp(op,"nsunknown")){napi_get_value_bool(e,a[0],&nsUnknown);napi_get_undefined(e,&out);return out;}
 if(!strcmp(op,"nscloses")){napi_create_int32(e,nsCloses,&out);return out;}
 if(!strcmp(op,"sticky")){BridgeState s;s.remember({1,0,0,0});s.remember({0,9,1,0});return statusJS(e,s.status());}
 if(!strcmp(op,"rclose"))return statusJS(e,ynx_sdk_shop_registered_read_close_v4(e,static_cast<ynx_sdk_shop_registered_read_v4*>(p)));
 if(!strcmp(op,"rjoin"))return statusJS(e,ynx_sdk_shop_registered_read_join_v4(e,static_cast<ynx_sdk_shop_registered_read_v4*>(p)));
 if(!strcmp(op,"pclose"))return statusJS(e,ynx_sdk_shop_get_proof_close_v4(e,static_cast<ynx_sdk_shop_get_proof_v4*>(p)));
 if(!strcmp(op,"pjoin"))return statusJS(e,ynx_sdk_shop_get_proof_join_v4(e,static_cast<ynx_sdk_shop_get_proof_v4*>(p)));
 if(!strcmp(op,"pretire"))return statusJS(e,ynx_sdk_shop_get_proof_retire_v4(e,static_cast<ynx_sdk_shop_get_proof_v4*>(p)));
 napi_get_undefined(e,&out);return out;
}
static napi_value init(napi_env e,napi_value exports){napi_value global,promise,prototype,then;napi_get_global(e,&global);napi_get_named_property(e,global,"Promise",&promise);napi_get_named_property(e,promise,"prototype",&prototype);napi_get_named_property(e,prototype,"then",&then);napi_create_reference(e,then,1,&fixtureThen);for(const auto*name:{"allocfail","capture","begin","copy","dropfail","nsunknown","nscloses","sticky","rclose","rjoin","pclose","pjoin","pretire"}){napi_value fn;napi_create_function(e,name,NAPI_AUTO_LENGTH,run,const_cast<char*>(name),&fn);napi_set_named_property(e,exports,name,fn);}return exports;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
