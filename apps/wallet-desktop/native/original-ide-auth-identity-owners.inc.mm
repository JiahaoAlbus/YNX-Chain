#include "original-ide-auth-request-source.inc.mm"
#include <node_api.h>
#include <chrono>
#include <cmath>
#include <unordered_set>
#include <pthread.h>
// Actual original Native callbacks, not the SDK type declaration, a JS shape
// adapter, an accepted-proof flag, or a serialized authority token.
enum class IDEIdentityKind:uintptr_t{receive=1,recover=2,keyCall=3};
enum class IDEIdentityMethod:uintptr_t{ready=1,request,proof,current,result,invoke,retire,join,close,status};
struct IDEIdentityRequestOwner{
 napi_env env;pthread_t thread;IDEIdentityKind kind;
 YNXAuthIdentitySourceAuthority *__strong source=nil;
 id<YNXOriginalIDEIdentityPrivateEffect> __strong effect=nil;
 YNXOriginalIDEPublicationArtifact *__strong artifact=nil;
 NSData *__strong expected=nil,*__strong invocation=nil;id __strong result=nil;
 uint64_t issued=0,expires=0,wallFloor=0,monoFloor=0,deadline=0;
 unsigned entered=0,peerChildren=0;bool ready=false,selected=false,verified=false,completed=false,unknown=false,retired=false,closeSelected=false,cleanupComplete=false;
 std::string first,closeFirst;
};
static std::unordered_set<IDEIdentityRequestOwner*> ideIdentityOriginals,ideIdentityDebt;
static const napi_type_tag ideIdentityTag={0x594e584944454155ULL,0x5448324f574e4552ULL};
static NSString *IDEIdentityPurpose(IDEIdentityKind kind){return kind==IDEIdentityKind::receive?@"AUTH-IDENTITY-RECEIVE":kind==IDEIdentityKind::recover?@"AUTH-IDENTITY-RECOVER":@"AUTH-PROTECTED-KEY-CALL";}
static uint64_t IDEIdentityMono(){return (uint64_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
static std::string IDEIdentityCode(NSError *error,const char *fallback){
 NSString *text=error.localizedDescription;NSData *b=[text dataUsingEncoding:NSASCIIStringEncoding allowLossyConversion:NO];
 if(!b||!b.length||b.length>128)return fallback;BOOL code=NO;for(NSString*prefix in @[@"AUTH_",@"IDE_",@"SOURCE_",@"ORIGINAL_",@"PQ_",@"PUBLIC_"])if([text hasPrefix:prefix])code=YES;if(!code)return fallback;
 for(NSUInteger i=0;i<b.length;i++){unsigned char c=((const unsigned char*)b.bytes)[i];if(!((c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'))return fallback;}return std::string((const char*)b.bytes,b.length);
}
static bool IDEIdentityFail(IDEIdentityRequestOwner *h,const std::string&cause){if(h->first.empty())h->first=cause;h->ready=false;h->unknown=true;return false;}
static napi_value IDEIdentityThrow(IDEIdentityRequestOwner*h,const char*fallback){return Error(h->env,h->first.empty()?fallback:h->first.c_str());}
static bool IDEIdentityClock(IDEIdentityRequestOwner*h){
 uint64_t wall=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0),mono=IDEIdentityMono();
 if(!h->expected||wall<h->issued||wall>=h->expires||wall<h->wallFloor||mono<h->monoFloor||!h->deadline||mono>=h->deadline)return IDEIdentityFail(h,"AUTH_IDENTITY_ORIGINAL_WINDOW_EXPIRED");
 h->wallFloor=wall;h->monoFloor=mono;return true;
}
static bool IDEIdentityCurrent(IDEIdentityRequestOwner*h){
 if(h->unknown||h->retired||h->closeSelected||!h->ready)return false;
 if(!IDEIdentityClock(h))return false;NSError *error=nil;
 if(h->artifact&&![[h->artifact copyOriginalManifest]isEqual:h->invocation])return IDEIdentityFail(h,"AUTH_IDENTITY_PUBLICATION_ARTIFACT_CHANGED");
 if(![h->source assertOriginalIDEIdentityRequestCurrent:h->expected invocation:h->invocation error:&error]||error)return IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_SOURCE_CURRENT_REFUSED"));
 if(h->effect&&(![h->effect assertCurrent:&error]||error))return IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_EFFECT_CURRENT_REFUSED"));
 return IDEIdentityClock(h); // final local fence after every foreign callback
}
static bool IDEIdentityEffectComplete(id<YNXOriginalIDEIdentityPrivateEffect>e){
 return e&&[e conformsToProtocol:@protocol(YNXOriginalIDEIdentityPrivateEffect)]&&[e respondsToSelector:@selector(assertCurrent:)]&&[e respondsToSelector:@selector(invokeOriginal:)]&&[e respondsToSelector:@selector(copyOriginalPublicResult:)]&&[e respondsToSelector:@selector(retire)]&&[e respondsToSelector:@selector(join:)]&&[e respondsToSelector:@selector(close:)];
}
static bool IDEIdentityJoin(IDEIdentityRequestOwner*h){
 if(h->entered||h->peerChildren)return false;NSError*error=nil;
 if(h->effect&&(![h->effect join:&error]||error))return IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_EFFECT_JOIN_PENDING"));
 if(h->source&&(![h->source join:&error]||error))return IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_SOURCE_JOIN_PENDING"));return true;
}
static bool IDEIdentityClose(IDEIdentityRequestOwner*h){
 if(h->closeSelected)return h->cleanupComplete;if(h->entered)return false;
 h->retired=true;@try{[h->effect retire];[h->source retire];if(!IDEIdentityJoin(h))return false;
  h->closeSelected=true;bool done=true;NSError*error=nil;
  if(h->effect&&(![h->effect close:&error]||error)){
   h->closeFirst=IDEIdentityCode(error,"AUTH_IDENTITY_EFFECT_CLOSE_UNKNOWN");
   IDEIdentityFail(h,h->closeFirst);ideIdentityDebt.insert(h);return false;
  }
  error=nil;if(h->source&&(![h->source close:&error]||error)){done=false;if(h->closeFirst.empty())h->closeFirst=IDEIdentityCode(error,"AUTH_IDENTITY_SOURCE_CLOSE_UNKNOWN");}
  h->cleanupComplete=done;if(done){h->effect=nil;h->artifact=nil;h->source=nil;}else{IDEIdentityFail(h,h->closeFirst);ideIdentityDebt.insert(h);}return done;
 }@catch(NSException*){if(h->closeFirst.empty())h->closeFirst="AUTH_IDENTITY_CLOSE_EXCEPTION";h->closeSelected=true;IDEIdentityFail(h,h->closeFirst);ideIdentityDebt.insert(h);return false;}
}
static void IDEIdentityFinalize(napi_env,void *raw,void*){
 auto*h=static_cast<IDEIdentityRequestOwner*>(raw);if(!ideIdentityOriginals.count(h))return;
 if(!IDEIdentityClose(h)){ideIdentityDebt.insert(h);return;}ideIdentityOriginals.erase(h);ideIdentityDebt.erase(h);delete h;
}
static bool IDEIdentityArgc(napi_env env,napi_callback_info info,size_t wanted,napi_value *args,napi_value *self,void **data){
 size_t count=0;if(napi_get_cb_info(env,info,&count,nullptr,self,data)!=napi_ok||count!=wanted)return false;
 if(wanted){count=wanted;return napi_get_cb_info(env,info,&count,args,self,data)==napi_ok&&count==wanted;}return true;
}
static NSData *IDEIdentityString(napi_env env,napi_value value,size_t cap){
 size_t n=0;if(napi_get_value_string_utf8(env,value,nullptr,0,&n)!=napi_ok||!n||n>cap)return nil;
 std::string s(n+1,'\0');size_t written=0;if(napi_get_value_string_utf8(env,value,s.data(),s.size(),&written)!=napi_ok||written!=n||memchr(s.data(),0,n))return nil;
 return [NSData dataWithBytes:s.data() length:n];
}
static IDEIdentityRequestOwner *IDEIdentityOriginal(napi_env env,napi_value self){
 bool tag=false;void *p=nullptr;
 if(napi_check_object_type_tag(env,self,&ideIdentityTag,&tag)!=napi_ok||!tag||napi_unwrap(env,self,&p)!=napi_ok)return nullptr;
 auto*h=static_cast<IDEIdentityRequestOwner*>(p);if(!ideIdentityOriginals.count(h)||h->env!=env||!pthread_equal(h->thread,pthread_self())||!pthread_main_np())return nullptr;return h;
}
static id IDEIdentitySnapshot(id value,unsigned depth=0,size_t *remaining=nullptr){
 size_t budget=1048576;if(!remaining)remaining=&budget;if(depth>16||!*remaining)return nil;
 if(value==NSNull.null)return NSNull.null;
 if([value isKindOfClass:NSString.class]||[value isKindOfClass:NSData.class]){
  NSUInteger n=[value isKindOfClass:NSData.class]?[value length]:[[value dataUsingEncoding:NSUTF8StringEncoding]length];if(n>*remaining)return nil;*remaining-=n;return [value copy];
 }
 if([value isKindOfClass:NSNumber.class])return [value copy];
 if([value isKindOfClass:NSArray.class]){if([value count]>65536)return nil;NSMutableArray*a=[NSMutableArray array];for(id v in value){id copy=IDEIdentitySnapshot(v,depth+1,remaining);if(!copy)return nil;[a addObject:copy];}return [a copy];}
 if([value isKindOfClass:NSDictionary.class]){if([value count]>256)return nil;NSMutableDictionary*d=[NSMutableDictionary dictionary];for(id key in value){if(![key isKindOfClass:NSString.class])return nil;NSData*b=[key dataUsingEncoding:NSUTF8StringEncoding];if(!b.length||b.length>256||b.length>*remaining||memchr(b.bytes,0,b.length))return nil;*remaining-=b.length;id copy=IDEIdentitySnapshot(value[key],depth+1,remaining);if(!copy)return nil;d[[key copy]]=copy;}return [d copy];}
 return nil;
}
static napi_value IDEIdentityPublic(napi_env env,id value,unsigned depth=0,size_t *remaining=nullptr){
 size_t budget=1048576;if(!remaining)remaining=&budget;if(depth>16||!*remaining)return Error(env,"AUTH_IDENTITY_PUBLIC_RESULT_BOUND");
 napi_value out;if(!value||value==NSNull.null){napi_get_null(env,&out);return out;}
 if([value isKindOfClass:NSString.class]){NSData*b=[value dataUsingEncoding:NSUTF8StringEncoding];if(!b||b.length>*remaining)return Error(env,"AUTH_IDENTITY_PUBLIC_RESULT_BOUND");*remaining-=b.length;return napi_create_string_utf8(env,(const char*)b.bytes,b.length,&out)==napi_ok?out:nullptr;}
 if([value isKindOfClass:NSNumber.class]){
  if(CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID())napi_get_boolean(env,[value boolValue],&out);
  else{double n=[value doubleValue];if(!std::isfinite(n)||n!=floor(n)||fabs(n)>9007199254740991.0)return Error(env,"AUTH_IDENTITY_PUBLIC_RESULT_NUMBER");napi_create_double(env,n,&out);}return out;
 }
 if([value isKindOfClass:NSData.class]){NSData*b=value;if(b.length>*remaining)return Error(env,"AUTH_IDENTITY_PUBLIC_RESULT_BOUND");*remaining-=b.length;void*p=nullptr;napi_value array;if(napi_create_arraybuffer(env,b.length,&p,&array)!=napi_ok)return nullptr;memcpy(p,b.bytes,b.length);return napi_create_typedarray(env,napi_uint8_array,b.length,array,0,&out)==napi_ok?out:nullptr;}
 if([value isKindOfClass:NSArray.class]){NSArray*a=value;if(a.count>65536||napi_create_array_with_length(env,a.count,&out)!=napi_ok)return Error(env,"AUTH_IDENTITY_PUBLIC_RESULT_BOUND");for(NSUInteger i=0;i<a.count;i++){napi_value child=IDEIdentityPublic(env,a[i],depth+1,remaining);if(!child||napi_set_element(env,out,(uint32_t)i,child)!=napi_ok)return nullptr;}return napi_object_freeze(env,out)==napi_ok?out:nullptr;}
 if([value isKindOfClass:NSDictionary.class]){NSDictionary*d=value;if(d.count>256||napi_create_object(env,&out)!=napi_ok)return Error(env,"AUTH_IDENTITY_PUBLIC_RESULT_BOUND");for(id key in d){if(![key isKindOfClass:NSString.class])return Error(env,"AUTH_IDENTITY_PUBLIC_RESULT_KEY");NSData*b=[key dataUsingEncoding:NSUTF8StringEncoding];if(!b||!b.length||b.length>256||memchr(b.bytes,0,b.length)||b.length>*remaining)return Error(env,"AUTH_IDENTITY_PUBLIC_RESULT_KEY");*remaining-=b.length;napi_value child=IDEIdentityPublic(env,d[key],depth+1,remaining);if(!child)return nullptr;std::string name((const char*)b.bytes,b.length);napi_property_descriptor p={name.c_str(),nullptr,nullptr,nullptr,nullptr,child,napi_default,nullptr};if(napi_define_properties(env,out,1,&p)!=napi_ok)return nullptr;}return napi_object_freeze(env,out)==napi_ok?out:nullptr;}
 return Error(env,"AUTH_IDENTITY_PUBLIC_RESULT_TYPE");
}
static napi_value IDEIdentityStatus(IDEIdentityRequestOwner*h){
 NSString *phase=h->closeSelected?(h->cleanupComplete?@"closed":@"disposed-error"):h->retired?@"retired":h->unknown?@"unknown":h->completed?@"completed":h->verified?@"verified":h->selected?@"proof-selected":h->ready?@"ready":@"partial";
 return IDEIdentityPublic(h->env,@{@"phase":phase,@"ready":@(h->ready&&!h->unknown&&!h->retired&&!h->closeSelected),@"unknown":@(h->unknown),@"retired":@(h->retired),@"cleanupComplete":@(h->cleanupComplete),@"disposed":@(h->closeSelected),@"firstCauseCode":h->first.empty()?(id)NSNull.null:[NSString stringWithUTF8String:h->first.c_str()]});
}
struct IDEIdentityEntered{IDEIdentityRequestOwner*h;explicit IDEIdentityEntered(IDEIdentityRequestOwner*p):h(p){h->entered++;}~IDEIdentityEntered(){h->entered--;}};
static napi_value IDEIdentityOperation(napi_env env,napi_callback_info info){
 napi_value self,args[1];void*raw=nullptr;size_t n=0;if(napi_get_cb_info(env,info,&n,nullptr,&self,&raw)!=napi_ok)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto method=static_cast<IDEIdentityMethod>((uintptr_t)raw);if(!IDEIdentityArgc(env,info,method==IDEIdentityMethod::proof?1:0,args,&self,&raw))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto*h=IDEIdentityOriginal(env,self);if(!h)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");
 try{@try{
  if(method==IDEIdentityMethod::status)return IDEIdentityStatus(h);
  if(method==IDEIdentityMethod::retire){h->retired=true;[h->effect retire];[h->source retire];return Undefined(env);}
  if(method==IDEIdentityMethod::join){if(h->entered)return Error(env,"AUTH_IDENTITY_OWNER_CALL_PENDING");if(!h->retired)return Error(env,"AUTH_IDENTITY_OWNER_NOT_RETIRED");return IDEIdentityJoin(h)?Undefined(env):IDEIdentityThrow(h,"AUTH_IDENTITY_OWNER_JOIN_PENDING");}
  if(method==IDEIdentityMethod::close){if(h->entered)return Error(env,"AUTH_IDENTITY_OWNER_CALL_PENDING");if(!h->closeFirst.empty())return Error(env,h->closeFirst.c_str());return IDEIdentityClose(h)?Undefined(env):IDEIdentityThrow(h,"AUTH_IDENTITY_OWNER_CLOSE_UNKNOWN");}
  IDEIdentityEntered call(h);if(!IDEIdentityCurrent(h))return IDEIdentityThrow(h,"AUTH_IDENTITY_OWNER_NOT_READY");
  if(method==IDEIdentityMethod::ready||method==IDEIdentityMethod::current)return Undefined(env);
  if(method==IDEIdentityMethod::request){napi_value value;bool ok=napi_create_string_utf8(env,(const char*)h->expected.bytes,h->expected.length,&value)==napi_ok;if(!IDEIdentityCurrent(h))return IDEIdentityThrow(h,"AUTH_IDENTITY_SOURCE_POST_CURRENT_REFUSED");return ok?value:nullptr;}
  if(method==IDEIdentityMethod::result){if(!h->completed)return Error(env,"AUTH_IDENTITY_RESULT_NOT_COMPLETED");napi_value value=IDEIdentityPublic(env,h->result);if(!IDEIdentityCurrent(h))return IDEIdentityThrow(h,"AUTH_IDENTITY_SOURCE_POST_CURRENT_REFUSED");return value;}
  if(method==IDEIdentityMethod::proof){
   if(h->selected)return Error(env,"AUTH_IDENTITY_PROOF_ALREADY_SELECTED");
   bool typed=false;if(napi_is_typedarray(env,args[0],&typed)!=napi_ok||!typed)return Error(env,"AUTH_IDENTITY_PROOF_BYTES_REQUIRED");
   napi_typedarray_type type;size_t length=0,offset=0;void*data=nullptr;napi_value array;bool ordinary=false,detached=false;
   if(napi_get_typedarray_info(env,args[0],&type,&length,&data,&array,&offset)!=napi_ok||type!=napi_uint8_array||!length||length>262144||napi_is_arraybuffer(env,array,&ordinary)!=napi_ok||!ordinary||napi_is_detached_arraybuffer(env,array,&detached)!=napi_ok||detached)return Error(env,"AUTH_IDENTITY_PROOF_BYTES_REQUIRED");
   NSData *wire=[NSData dataWithBytes:data length:length];h->selected=true;NSError*error=nil;
   if(![h->source verifyOriginalIDEIdentityProof:wire expectedRequest:h->expected invocation:h->invocation error:&error]||error){IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_PROOF_REFUSED"));return IDEIdentityThrow(h,"AUTH_IDENTITY_PROOF_REFUSED");}
   if(!IDEIdentityCurrent(h))return IDEIdentityThrow(h,"AUTH_IDENTITY_SOURCE_POST_CURRENT_REFUSED");h->verified=true;
   if(h->kind==IDEIdentityKind::receive){h->result=[h->source installOriginalIDEIdentityPublicOriginals:&error];}
   else if(h->kind==IDEIdentityKind::recover){h->effect=[h->source recoverOriginalIDEIdentityForRequest:h->expected error:&error];if(!IDEIdentityEffectComplete(h->effect)){IDEIdentityFail(h,"AUTH_IDENTITY_RECOVERY_OWNER_REQUIRED");return IDEIdentityThrow(h,"AUTH_IDENTITY_RECOVERY_OWNER_REQUIRED");}if(!error)h->result=[h->effect copyOriginalPublicResult:&error];}
   if(error||(h->kind!=IDEIdentityKind::keyCall&&!h->result)){IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_EFFECT_RESULT_UNKNOWN"));return IDEIdentityThrow(h,"AUTH_IDENTITY_EFFECT_RESULT_UNKNOWN");}
   if(h->result){id captured=IDEIdentitySnapshot(h->result);if(!captured){IDEIdentityFail(h,"AUTH_IDENTITY_EFFECT_PUBLIC_RESULT_INVALID");return IDEIdentityThrow(h,"AUTH_IDENTITY_EFFECT_PUBLIC_RESULT_INVALID");}h->result=captured;}
   if(!IDEIdentityCurrent(h))return IDEIdentityThrow(h,"AUTH_IDENTITY_EFFECT_POST_CURRENT_REFUSED");if(h->kind!=IDEIdentityKind::keyCall)h->completed=true;return Undefined(env);
  }
  if(method==IDEIdentityMethod::invoke){
   if(h->kind!=IDEIdentityKind::keyCall||!h->verified||h->completed)return Error(env,"AUTH_IDENTITY_PROTECTED_CALL_NOT_AVAILABLE");
   h->completed=true; // Select before entering the actual protected call; never replay.
   NSError*error=nil;h->result=[h->effect invokeOriginal:&error];
   if(error||!h->result){IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_PROTECTED_CALL_UNKNOWN"));return IDEIdentityThrow(h,"AUTH_IDENTITY_PROTECTED_CALL_UNKNOWN");}
   id captured=IDEIdentitySnapshot(h->result);if(!captured){IDEIdentityFail(h,"AUTH_IDENTITY_EFFECT_PUBLIC_RESULT_INVALID");return IDEIdentityThrow(h,"AUTH_IDENTITY_EFFECT_PUBLIC_RESULT_INVALID");}h->result=captured;
   if(!IDEIdentityCurrent(h))return IDEIdentityThrow(h,"AUTH_IDENTITY_PROTECTED_CALL_POST_CURRENT_REFUSED");return IDEIdentityPublic(env,h->result);
  }
  return Error(env,"AUTH_IDENTITY_OPERATION_INVALID");
 }@catch(NSException*){IDEIdentityFail(h,"AUTH_IDENTITY_NATIVE_OPERATION_EXCEPTION");return IDEIdentityThrow(h,"AUTH_IDENTITY_NATIVE_OPERATION_EXCEPTION");}}catch(const std::exception&){IDEIdentityFail(h,"AUTH_IDENTITY_NATIVE_OPERATION_EXCEPTION");return IDEIdentityThrow(h,"AUTH_IDENTITY_NATIVE_OPERATION_EXCEPTION");}
}
static napi_value IDEIdentityConstruct(napi_env env,napi_callback_info info){
 napi_value args[3];void*data=nullptr;size_t count=0;if(napi_get_cb_info(env,info,&count,nullptr,nullptr,&data)!=napi_ok)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 const bool publication=(uintptr_t)data==4;
 auto kind=publication?IDEIdentityKind::keyCall:static_cast<IDEIdentityKind>((uintptr_t)data);if(kind!=IDEIdentityKind::receive&&kind!=IDEIdentityKind::recover&&kind!=IDEIdentityKind::keyCall)return Error(env,"AUTH_IDENTITY_OPERATION_INVALID");
 if(!IDEIdentityArgc(env,info,publication?3:kind==IDEIdentityKind::keyCall?2:1,args,nullptr,&data)||!pthread_main_np()||getuid()!=geteuid()||getgid()!=getegid())return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 NSData *entryRaw=IDEIdentityString(env,args[0],8192),*invocation=kind==IDEIdentityKind::keyCall?IDEIdentityString(env,args[1],16384):[NSData data];
 if(!entryRaw||!invocation)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");NSString*entry=[[NSString alloc]initWithData:entryRaw encoding:NSUTF8StringEncoding];
 YNXOriginalIDEPublicationArtifact*artifact=publication?OriginalPublicationArtifactValue(env,args[2]):nil;
 if(publication&&(!artifact||![[artifact copyOriginalManifest]isEqual:invocation]))return Error(env,"AUTH_IDENTITY_PUBLICATION_ARTIFACT_ORIGINAL_REQUIRED");
 try{NSString*resources=ynx_auth_ide_private::actualNodeParentResources();if(!ynx_auth_ide_private::actualNodeEntry(resources,entry))return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");}catch(const std::exception&){return Error(env,"IDE_NODE_ACTUAL_PARENT_ENTRY_UNAVAILABLE");}
 if(ideIdentityOriginals.size()>=32)return Error(env,"AUTH_IDENTITY_OWNER_CAPACITY");
 auto*h=new(std::nothrow)IDEIdentityRequestOwner{};if(!h)return Error(env,"AUTH_IDENTITY_OWNER_CAPACITY");h->env=env;h->thread=pthread_self();h->kind=kind;h->invocation=[invocation copy];h->artifact=artifact;
 napi_value object;if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,&ideIdentityTag)!=napi_ok){delete h;return nullptr;}
 ideIdentityOriginals.insert(h);if(napi_wrap(env,object,h,IDEIdentityFinalize,nullptr,nullptr)!=napi_ok){ideIdentityOriginals.erase(h);delete h;return nullptr;}
 const char *names[]={"assertReady","copyRequestOriginal","completeProof","current","result","invoke","retire","join","close","status"};
 for(uintptr_t i=0;i<10;i++){if(i==5&&kind!=IDEIdentityKind::keyCall)continue;napi_property_descriptor p={names[i],nullptr,IDEIdentityOperation,nullptr,nullptr,nullptr,napi_default,(void*)(i+1)};if(napi_define_properties(env,object,1,&p)!=napi_ok)return nullptr;}
 if(napi_object_freeze(env,object)!=napi_ok)return nullptr;
 try{@try{IDEIdentityEntered call(h);NSError*error=nil;
  h->source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEConsumerSource:&error]; // capture BEFORE inspecting error
  if(error||!h->source){IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_ORIGINAL_SOURCE_UNAVAILABLE"));return object;}
  h->expected=[h->source copyOriginalIDEIdentityRequestForPurpose:IDEIdentityPurpose(kind) invocation:h->invocation error:&error];
  if(error||!h->expected){IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_ORIGINAL_REQUEST_UNAVAILABLE"));return object;}
  NSDictionary*request=IDERequestDictionary(h->expected,16384);uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0),mono=IDEIdentityMono();
  if(!IDERequestDecimal(request[@"issuedAtMs"],&h->issued,NO)||!IDERequestDecimal(request[@"expiresAtMs"],&h->expires,NO)||now<h->issued||now>=h->expires||h->expires-h->issued>30000||mono>UINT64_MAX-(h->expires-now)){IDEIdentityFail(h,"AUTH_IDENTITY_ORIGINAL_WINDOW_EXPIRED");return object;}
  h->wallFloor=now;h->monoFloor=mono;h->deadline=mono+(h->expires-now);
  if(![h->source respondsToSelector:@selector(verifyOriginalIDEIdentityProof:expectedRequest:invocation:error:)]){IDEIdentityFail(h,"AUTH_IDENTITY_PROOF_CONSUMER_NOT_IMPLEMENTED");return object;}
  if(![h->source respondsToSelector:@selector(assertOriginalIDEIdentityProofConsumerReady:error:)]||![h->source assertOriginalIDEIdentityProofConsumerReady:h->expected error:&error]||error){IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_PROOF_CONSUMER_NOT_READY"));return object;}
  if(kind==IDEIdentityKind::receive&&(![h->source respondsToSelector:@selector(assertOriginalIDEIdentityReceiveExecutionAvailable:)]||![h->source assertOriginalIDEIdentityReceiveExecutionAvailable:&error]||error)){IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_PRIVILEGED_RECEIVER_NOT_CONNECTED"));return object;}
  if(kind==IDEIdentityKind::recover&&![h->source respondsToSelector:@selector(recoverOriginalIDEIdentityForRequest:error:)]){IDEIdentityFail(h,"AUTH_IDENTITY_RECOVERY_CONSUMER_NOT_IMPLEMENTED");return object;}
  if(kind==IDEIdentityKind::keyCall){
   if(publication){
    if(![h->source respondsToSelector:@selector(captureOriginalIDEProtectedPublicationKeyCall:expectedRequest:artifact:error:)]){IDEIdentityFail(h,"AUTH_IDENTITY_PUBLICATION_EFFECT_CONSUMER_NOT_IMPLEMENTED");return object;}
    h->effect=[h->source captureOriginalIDEProtectedPublicationKeyCall:h->invocation expectedRequest:h->expected artifact:h->artifact error:&error];
   }else{
    if(![h->source respondsToSelector:@selector(captureOriginalIDEProtectedKeyCall:expectedRequest:error:)]){IDEIdentityFail(h,"AUTH_IDENTITY_KEY_CALL_CONSUMER_NOT_IMPLEMENTED");return object;}
    h->effect=[h->source captureOriginalIDEProtectedKeyCall:h->invocation expectedRequest:h->expected error:&error];
   }
   if(error||!IDEIdentityEffectComplete(h->effect)){IDEIdentityFail(h,IDEIdentityCode(error,"AUTH_IDENTITY_PROTECTED_CALL_OWNER_REQUIRED"));return object;}
  }
  h->ready=true;if(!IDEIdentityCurrent(h))return object;return object;
 }@catch(NSException*){IDEIdentityFail(h,"AUTH_IDENTITY_CONSTRUCTOR_EXCEPTION");return object;}}catch(const std::exception&){IDEIdentityFail(h,"AUTH_IDENTITY_CONSTRUCTOR_EXCEPTION");return object;}
}
