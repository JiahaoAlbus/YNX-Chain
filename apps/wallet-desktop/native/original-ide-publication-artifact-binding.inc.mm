// Same user addon, bounded immutable DATA only. Never a Source/proof/effect,
// publisher identity or arbitrary path/FD. No Keychain/helper/network access.
#import "../../../packages/wallet-auth/native/original-ide-publication-artifact.h"
#include <set>
struct OriginalPublicationArtifactRef {
 napi_env env=nullptr;YNXOriginalIDEPublicationArtifact* __strong artifact=nil;
 size_t bytes=0;bool closed=false;
};
static const napi_type_tag originalPublicationArtifactTag={0x502d0c53c1f04259ULL,0x9fda29c7369ea207ULL};
static std::set<OriginalPublicationArtifactRef*> originalPublicationArtifacts;
static OriginalPublicationArtifactRef* OriginalPublicationArtifactRefFor(napi_env env,napi_value object){
 bool tagged=false;if(napi_check_object_type_tag(env,object,&originalPublicationArtifactTag,&tagged)!=napi_ok||!tagged)return nullptr;
 void*raw=nullptr;if(napi_unwrap(env,object,&raw)!=napi_ok||!raw)return nullptr;
 auto*r=static_cast<OriginalPublicationArtifactRef*>(raw);return originalPublicationArtifacts.count(r)&&r->env==env?r:nullptr;
}
// Private same-TU consumer obtains a concrete typed immutable artifact. It must
// separately adopt Source/effect custody and verify scope/proof/current/approval.
// This function does not create or qualify any such owner.
static YNXOriginalIDEPublicationArtifact* OriginalPublicationArtifactValue(napi_env env,napi_value object){
 auto*r=OriginalPublicationArtifactRefFor(env,object);return r&&!r->closed?r->artifact:nil;
}
static void OriginalPublicationArtifactFinalize(napi_env,void*raw,void*){
 auto*r=static_cast<OriginalPublicationArtifactRef*>(raw);if(!originalPublicationArtifacts.erase(r))return;r->artifact=nil;delete r;
}
static napi_value OriginalPublicationArtifactCapture(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"IDE_PUBLICATION_ARTIFACT_ARGUMENTS");
 size_t size=0;if(napi_get_value_string_utf8(env,a[0],nullptr,0,&size)!=napi_ok||!size||size>16384)return Error(env,"IDE_PUBLICATION_MANIFEST_BOUNDS");
 bool typed=false,ordinary=false,detached=false;napi_typedarray_type type;size_t length=0,offset=0;void*data=nullptr;napi_value array;
 if(napi_is_typedarray(env,a[1],&typed)!=napi_ok||!typed||napi_get_typedarray_info(env,a[1],&type,&length,&data,&array,&offset)!=napi_ok||type!=napi_uint8_array||!length||length>67108864||!data||napi_is_arraybuffer(env,array,&ordinary)!=napi_ok||!ordinary||napi_is_detached_arraybuffer(env,array,&detached)!=napi_ok||detached)return Error(env,"IDE_PUBLICATION_ARTIFACT_BYTES_REQUIRED");
 size_t live=0,count=0;for(auto*r:originalPublicationArtifacts)if(r->env==env&&!r->closed){live+=r->bytes;count++;}
 if(count>=8||live>134217728-length)return Error(env,"IDE_PUBLICATION_ARTIFACT_CAPACITY");
 try{@try{
  std::vector<char>text(size+1);size_t actual=0;if(napi_get_value_string_utf8(env,a[0],text.data(),text.size(),&actual)!=napi_ok||actual!=size)return Error(env,"IDE_PUBLICATION_MANIFEST_BOUNDS");
  NSData*manifest=[NSData dataWithBytes:text.data()length:size],*artifact=[NSData dataWithBytes:data length:length];
  NSError*e=nil;YNXOriginalIDEPublicationArtifact*captured=[YNXOriginalIDEPublicationArtifact captureOriginalManifest:manifest artifact:artifact error:&e];
  if(e||!captured)return Error(env,"IDE_PUBLICATION_ARTIFACT_CAPTURE_REFUSED");
  auto*r=new(std::nothrow)OriginalPublicationArtifactRef{};if(!r)return Error(env,"IDE_PUBLICATION_ARTIFACT_CAPACITY");r->env=env;r->artifact=captured;r->bytes=length;
  napi_value object;if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,&originalPublicationArtifactTag)!=napi_ok){delete r;return nullptr;}
  originalPublicationArtifacts.insert(r);
  if(napi_wrap(env,object,r,OriginalPublicationArtifactFinalize,nullptr,nullptr)!=napi_ok){originalPublicationArtifacts.erase(r);delete r;return nullptr;}
  if(napi_object_freeze(env,object)!=napi_ok)return nullptr;return object;
 }@catch(id){return Error(env,"IDE_PUBLICATION_ARTIFACT_CAPTURE_UNKNOWN");}}catch(const std::exception&){return Error(env,"IDE_PUBLICATION_ARTIFACT_CAPTURE_UNKNOWN");}
}
static napi_value OriginalPublicationArtifactRead(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"IDE_PUBLICATION_ARTIFACT_ARGUMENTS");auto*artifact=OriginalPublicationArtifactValue(env,a[0]);if(!artifact)return Error(env,"IDE_PUBLICATION_ARTIFACT_ORIGINAL_REQUIRED");
 NSData*raw=[artifact copyOriginalManifest];napi_value value;return napi_create_string_utf8(env,(const char*)raw.bytes,raw.length,&value)==napi_ok?value:nullptr;
}
static napi_value OriginalPublicationArtifactClose(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"IDE_PUBLICATION_ARTIFACT_ARGUMENTS");auto*r=OriginalPublicationArtifactRefFor(env,a[0]);if(!r)return Error(env,"IDE_PUBLICATION_ARTIFACT_ORIGINAL_REQUIRED");r->closed=true;r->artifact=nil;r->bytes=0;napi_value value;napi_get_boolean(env,true,&value);return value;
}
static napi_value RegisterOriginalIDEPublicationArtifactBinding(napi_env env,napi_value exports){
 const struct{const char*name;napi_callback callback;}methods[]={{"captureOriginalIDEPublicationArtifact",OriginalPublicationArtifactCapture},{"readOriginalIDEPublicationArtifactManifest",OriginalPublicationArtifactRead},{"closeOriginalIDEPublicationArtifact",OriginalPublicationArtifactClose}};
 for(const auto&m:methods){napi_property_descriptor p={m.name,nullptr,m.callback,nullptr,nullptr,nullptr,napi_default,nullptr};if(napi_define_properties(env,exports,1,&p)!=napi_ok)return nullptr;}return exports;
}
