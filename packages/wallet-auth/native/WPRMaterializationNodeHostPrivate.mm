#import "WPRMaterializationClientPrivate.h"
#include <node_api.h>
#include <vector>
#include <mutex>
// Additive private addon installation hook; not a renderer/HTTP export or
// generic RPC function. No external pointer, path or authority DTO is exposed.
namespace {
struct Handle{YNXWPRMaterializationClientPrivate*__strong owner;napi_ref first=nullptr;};
const napi_type_tag originalOwnerTag={0x5750524d41544552ULL,0x49414c4c4f414e31ULL};
std::mutex debtLock;std::vector<Handle*>unreachableDebt;size_t handleCount=0;
napi_value nullValue(napi_env e){napi_value v;napi_get_null(e,&v);return v;}
napi_value convert(napi_env e,id raw){napi_value v;if(!raw||raw==NSNull.null)return nullValue(e);
 if([raw isKindOfClass:NSString.class]){NSData*b=[raw dataUsingEncoding:NSUTF8StringEncoding];napi_create_string_utf8(e,(const char*)b.bytes,b.length,&v);return v;}
 if([raw isKindOfClass:NSData.class]){void*copy=nullptr;napi_create_buffer_copy(e,[raw length],[raw bytes],&copy,&v);return v;}
 if([raw isKindOfClass:NSNumber.class]){if(CFGetTypeID((__bridge CFTypeRef)raw)==CFBooleanGetTypeID())napi_get_boolean(e,[raw boolValue],&v);else napi_create_double(e,[raw doubleValue],&v);return v;}
 if([raw isKindOfClass:NSError.class]){napi_value message=convert(e,[(NSError*)raw localizedDescription]);napi_create_error(e,nullptr,message,&v);napi_set_named_property(e,v,"nativeDomain",convert(e,[(NSError*)raw domain]));napi_value code;napi_create_int64(e,[(NSError*)raw code],&code);napi_set_named_property(e,v,"nativeCode",code);return v;}
 if([raw isKindOfClass:NSDictionary.class]){napi_create_object(e,&v);for(NSString*k in raw)napi_set_named_property(e,v,k.UTF8String,convert(e,raw[k]));return v;}
 napi_throw_error(e,"WPR_NATIVE_REPLY_TYPE","Unrecognized private Native reply");return nullptr;
}
napi_value first(napi_env e,Handle*h){if(!h->owner.errorPresent)return nullValue(e);if(h->first){napi_value v;napi_get_reference_value(e,h->first,&v);return v;}napi_value v=convert(e,h->owner.firstCause);napi_create_reference(e,v,1,&h->first);return v;}
void finalize(napi_env e,void*data,void*){auto*h=(Handle*)data;if(!h->owner.isClosed){std::lock_guard<std::mutex>guard(debtLock);unreachableDebt.push_back(h);return;}if(h->first)napi_delete_reference(e,h->first);{std::lock_guard<std::mutex>guard(debtLock);--handleCount;}delete h;}
Handle*receiver(napi_env e,napi_callback_info info){size_t argc=1;napi_value arg,self;void*data=nullptr;napi_get_cb_info(e,info,&argc,&arg,&self,&data);if(argc){napi_throw_type_error(e,"WPR_ZERO_ARGUMENTS","Fixed Native method accepts no arguments");return nullptr;}Handle*h=nullptr;bool same=false;if(napi_check_object_type_tag(e,self,&originalOwnerTag,&same)!=napi_ok||!same||napi_unwrap(e,self,(void**)&h)!=napi_ok||!h){napi_throw_type_error(e,"WPR_SAME_NATIVE_OWNER","Original Native owner required");return nullptr;}return h;}
enum class Method{Captured,Independent,Current,Recheck,Retire,Join,Close,Closed};
napi_value method(napi_env e,napi_callback_info info){size_t argc=0;napi_value self;void*data=nullptr;napi_get_cb_info(e,info,&argc,nullptr,&self,&data);auto*h=receiver(e,info);if(!h)return nullptr;auto selected=(Method)(uintptr_t)data;NSError*cause=nil;id raw=nil;BOOL okay=YES;
 @try{switch(selected){case Method::Captured:raw=[h->owner readCapturedPublicOriginals:&cause];okay=raw!=nil;break;case Method::Independent:raw=[h->owner readIndependentMaterializationOriginals:&cause];okay=raw!=nil;break;case Method::Current:okay=[h->owner assertCurrent:&cause];break;case Method::Recheck:okay=[h->owner recheck:&cause];break;case Method::Retire:[h->owner retire];break;case Method::Join:okay=[h->owner join:&cause];break;case Method::Close:okay=[h->owner close:&cause];break;case Method::Closed:{napi_value out;napi_get_boolean(e,h->owner.isClosed,&out);return out;}}}
 @catch(NSException*){napi_throw_error(e,"WPR_NATIVE_EXCEPTION","Native custody remains retained");return nullptr;}
 // A raw dictionary can include a late actual partial. Expose it in a fixed
 // result envelope BEFORE the error; do not throw it away or fabricate grant.
 napi_value out;napi_create_object(e,&out);napi_set_named_property(e,out,"value",convert(e,raw));napi_value present;napi_get_boolean(e,!okay||cause||h->owner.errorPresent,&present);napi_set_named_property(e,out,"errorPresent",present);napi_set_named_property(e,out,"error",first(e,h));napi_value done;napi_get_boolean(e,h->owner.isClosed,&done);napi_set_named_property(e,out,"physicalDone",done);return out;
}
napi_value acquire(napi_env e,napi_callback_info info){size_t argc=1;napi_value arg;napi_get_cb_info(e,info,&argc,&arg,nullptr,nullptr);if(argc){napi_throw_type_error(e,"WPR_ZERO_ARGUMENTS","Original acquisition accepts no caller configuration");return nullptr;}
 {std::lock_guard<std::mutex>guard(debtLock);if(handleCount>=64){napi_throw_error(e,"WPR_NATIVE_CUSTODY_CAPACITY","Retained original Native custody debt prevents acquisition");return nullptr;}++handleCount;}
 NSError*cause=nil;auto*held=new Handle{[YNXWPRMaterializationClientPrivate acquireOriginal:&cause]};napi_value owner;napi_create_object(e,&owner);napi_type_tag_object(e,owner,&originalOwnerTag);napi_wrap(e,owner,held,finalize,nullptr,nullptr);
 const char*names[]={"readCapturedPublicOriginals","readIndependentMaterializationOriginals","assertCurrent","recheck","retire","join","close","isClosed"};for(size_t n=0;n<8;n++){napi_value fn;napi_create_function(e,names[n],NAPI_AUTO_LENGTH,method,(void*)n,&fn);napi_set_named_property(e,owner,names[n],fn);}
 napi_value out;napi_create_object(e,&out);napi_set_named_property(e,out,"owner",owner);napi_value present;napi_get_boolean(e,cause||held->owner.errorPresent,&present);napi_set_named_property(e,out,"errorPresent",present);napi_set_named_property(e,out,"error",first(e,held));return out;
}
}
extern "C" napi_status YNXInstallWPRMaterializationLoanV1(napi_env env,napi_value exports){napi_value fn;napi_status rc=napi_create_function(env,"acquireOriginalWPRMaterializationLoanV1",NAPI_AUTO_LENGTH,acquire,nullptr,&fn);if(rc!=napi_ok)return rc;return napi_set_named_property(env,exports,"acquireOriginalWPRMaterializationLoanV1",fn);}
