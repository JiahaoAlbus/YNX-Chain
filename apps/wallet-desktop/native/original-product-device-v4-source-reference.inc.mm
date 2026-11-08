// Private readonly namespace DATA from SAME qualified Native Source. This is
// not a Source constructor, DEVICE/Shop relation grant, epoch or JSON setter.
#import "DeviceV4SourceDarwinPrivate.hpp"
#include <cmath>
struct DeviceV4SourceReferenceLoan {
 ProductDeviceV4SourceOwner*parent=nullptr;napi_ref parentObject=nullptr;
 YNXAuthIdentitySourceAuthority*__strong source=nil;id __strong token=nil;
 NSError*__strong firstNative=nil;NSString*__strong code=nil;
 bool reserveEntered=false,reserveReturned=false,releaseSelected=false,released=false;
};
static thread_local std::unordered_set<DeviceV4SourceReferenceLoan*>deviceV4SourceReferenceDebts;
static void DeviceV4SourceReferenceDrop(napi_env env,DeviceV4SourceReferenceLoan*h){if(h->parentObject)napi_delete_reference(env,h->parentObject);h->token=nil;h->source=nil;delete h;}
static void DeviceV4SourceReferenceRelease(DeviceV4SourceReferenceLoan*h){
 if(h->reserveEntered&&!h->reserveReturned){h->releaseSelected=true;h->code=h->code?:@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_BORROW_UNKNOWN";return;}
 if(!h->token){h->released=true;return;}if(h->releaseSelected)return;h->releaseSelected=true;
 try{@try{NSError*e=nil;BOOL released=NO;BOOL ok=[h->source releaseOriginalDeviceV4NativeReadLoan:h->token released:&released error:&e];
  h->released=released;if(released)h->token=nil;
  if(e&&!h->firstNative)h->firstNative=e;
  if((!ok||e)&&!h->code)h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_RELEASE_ERROR";
 }@catch(id){if(!h->code)h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_RELEASE_EXCEPTION";}}
 catch(...){if(!h->code)h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_RELEASE_CPP_EXCEPTION";}
}
static bool DeviceV4SourceReferenceShape(NSDictionary*n){
 if(![n isKindOfClass:NSDictionary.class]||n.count!=6)return false;
 NSSet*keys=[NSSet setWithArray:@[@"purpose",@"sourceId",@"instanceId",@"generation",@"accountIssuer",@"accountSubject"]];
 if(![[NSSet setWithArray:n.allKeys]isEqual:keys]||![n[@"purpose"]isEqual:@"product-session-device-source-v4"])return false;
 for(NSString*k in @[@"purpose",@"sourceId",@"instanceId",@"accountIssuer",@"accountSubject"]){id v=n[k];if(![v isKindOfClass:NSString.class])return false;NSData*b=[v dataUsingEncoding:NSUTF8StringEncoding];size_t cap=([k isEqual:@"sourceId"]||[k isEqual:@"instanceId"])?512:2048;if(!b.length||b.length>cap||std::memchr(b.bytes,0,b.length))return false;}
 id g=n[@"generation"];if(![g isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)g)==CFBooleanGetTypeID())return false;double d=[g doubleValue];return std::isfinite(d)&&d==std::floor(d)&&d>=1&&d<=9007199254740991.0;
}
static napi_value DeviceV4ReadOriginalSourceReferenceDATA(napi_env env,napi_callback_info info){
 size_t count=1;napi_value arg=nullptr,self=nullptr;if(napi_get_cb_info(env,info,&count,&arg,&self,nullptr)!=napi_ok||count)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ARGUMENTS_INVALID");
 auto*p=DeviceV4Original(env,self);if(!p)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_ORIGINAL_SOURCE_REQUIRED");
 if(!DeviceV4Current(p))return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_SOURCE_NOT_CURRENT");
 auto*h=new(std::nothrow)DeviceV4SourceReferenceLoan;if(!h)return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_CAPACITY");h->parent=p;h->source=p->source;
 if(!DeviceV4Keep(env,self,h->parentObject)){DeviceV4SourceReferenceDrop(env,h);return DeviceV4Throw(env,"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_CUSTODY_FAILED");}
 NSDictionary*original=nil;bool sourceFailed=false;
 try{@try{
  if([h->source class]!=YNXAuthIdentitySourceAuthority.class)h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_SOURCE_REQUIRED";
  else if(![h->source respondsToSelector:@selector(reserveOriginalDeviceV4NativeReadLoan:)]||![h->source respondsToSelector:@selector(releaseOriginalDeviceV4NativeReadLoan:released:error:)]||![h->source respondsToSelector:@selector(copyOriginalDeviceV4AccountNamespaceForNativeRead:error:)])h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_NOT_SUPPLIED";
  else{NSError*e=nil;h->reserveEntered=true;h->token=[h->source reserveOriginalDeviceV4NativeReadLoan:&e];h->reserveReturned=true; // adopt nonnull before NSError, including code0
   if(e)h->firstNative=e;if(e||!h->token)h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_BORROW_NOT_SUPPLIED";
   if(!h->code){original=[[h->source copyOriginalDeviceV4AccountNamespaceForNativeRead:h->token error:&e]copy];
    if(e){h->firstNative=e;h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_NATIVE_ERROR";}
    else if(!original)h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_NOT_SUPPLIED";
    else if(!DeviceV4SourceReferenceShape(original))h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_SHAPE";
   }
   if(!h->code){NSDictionary*scope=[h->source copyOriginalProductSessionDeviceV4Scope:&e];if(e){h->firstNative=e;h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_SCOPE_ERROR";}else if(![scope[@"expected"][@"account"]isEqual:original[@"accountSubject"]])h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_ACCOUNT_MISMATCH";}
   if(!h->code){NSDictionary*again=[h->source copyOriginalDeviceV4AccountNamespaceForNativeRead:h->token error:&e];if(e){h->firstNative=e;h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_NATIVE_ERROR";}else if(![again isEqual:original])h->code=@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_CHANGED";}
  }
  if(!DeviceV4Current(p)||p->source!=h->source)sourceFailed=true;
 }@catch(id){h->code=h->code?:@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_EXCEPTION";}}
 catch(...){h->code=h->code?:@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_CPP_EXCEPTION";}
 // Cleanup does not call current/retire/join/close on the borrowed Source.
 // Actual released is independent of NSError/BOOL; UNKNOWN is never retried.
 DeviceV4SourceReferenceRelease(h);
 if(!h->released){deviceV4SourceReferenceDebts.insert(h);productDeviceV4SourceDebts.insert(p);return DeviceV4ReadSourceRefuse(p,h->code?:@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_RELEASE_UNKNOWN");}
 NSString*code=h->code;NSError*native=h->firstNative;DeviceV4SourceReferenceDrop(env,h);
 if(sourceFailed)return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_NOT_CURRENT");
 // Optional namespace absent/invalid is local to this DATA method, not a
 // reason to retire an otherwise valid Source or its existing four methods.
 if(code){if(native)return DeviceV4Throw(env,(native.localizedDescription?:code).UTF8String);return DeviceV4Throw(env,code.UTF8String);}
 if(!DeviceV4Current(p))return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_NOT_CURRENT");
 napi_value result=nullptr;if(napi_create_object(env,&result)!=napi_ok)return nullptr;
 for(NSString*k in @[@"purpose",@"sourceId",@"instanceId",@"generation",@"accountIssuer",@"accountSubject"]){napi_value v=nullptr;if([k isEqual:@"generation"]){if(napi_create_double(env,[original[k]doubleValue],&v)!=napi_ok)return nullptr;}else{NSString*s=original[k];if(napi_create_string_utf8(env,s.UTF8String,[s lengthOfBytesUsingEncoding:NSUTF8StringEncoding],&v)!=napi_ok)return nullptr;}if(napi_set_named_property(env,result,k.UTF8String,v)!=napi_ok)return nullptr;}
 if(napi_object_freeze(env,result)!=napi_ok)return nullptr;
 if(!DeviceV4Current(p))return DeviceV4ReadSourceRefuse(p,@"PRODUCT_DEVICE_V4_SOURCE_REFERENCE_NOT_CURRENT");return result;
}
