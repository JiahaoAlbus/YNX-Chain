// Normal user-addon consuming bridge for the original purpose-isolated Source.
// No caller Source/provider/endpoint/Root input, registration, approval or signer.
#include <set>
struct OriginalIDEProjectRef {
 napi_env env=nullptr;
 YNXAuthIdentitySourceAuthority* __strong source=nil;
 NSError* __strong firstCause=nil;
 NSError* __strong closeCause=nil;
 const char* failure=nullptr;
 bool busy=false,retired=false,closeSelected=false,closed=false;
};
static std::set<OriginalIDEProjectRef*> originalIDEProjects;
static const napi_type_tag originalIDEProjectTag={0xf29731e05252416fULL,0xa98f024418dae4c9ULL};
static napi_value ProjectFailure(napi_env env,const char*code){return Error(env,code);}
static bool ProjectFail(OriginalIDEProjectRef*r,const char*code,NSError*cause=nil){
 if(!r->failure){r->failure=code;r->firstCause=cause;}return false;
}
static OriginalIDEProjectRef* ProjectOriginal(napi_env env,napi_value object){
 bool tagged=false;void*p=nullptr;
 if(napi_check_object_type_tag(env,object,&originalIDEProjectTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,object,&p)!=napi_ok||!p)return nullptr;
 auto*r=static_cast<OriginalIDEProjectRef*>(p);return originalIDEProjects.count(r)&&r->env==env?r:nullptr;
}
static bool ProjectClose(OriginalIDEProjectRef*r){
 if(r->closeSelected)return r->closed;
 if(r->busy)return false; // No close races with an in-flight current callback.
 r->retired=true;r->closeSelected=true;
 @try{[r->source retire];NSError*e=nil;
  if(![r->source join:&e]){r->closeCause=e;return false;}
  e=nil;if(![r->source close:&e]){r->closeCause=e;return false;}
  r->source=nil;r->closed=true;return true;
 }@catch(id){return false;}
}
static void ProjectFinalize(napi_env,void*p,void*){
 auto*r=static_cast<OriginalIDEProjectRef*>(p);if(!originalIDEProjects.count(r))return;
 // UNKNOWN cleanup keeps the actual native owner; no fabricated close success.
 if(ProjectClose(r)){originalIDEProjects.erase(r);delete r;}
}
static bool ProjectCurrent(OriginalIDEProjectRef*r){
 if(r->failure)return false;
 if(r->retired||r->closeSelected||r->closed)return ProjectFail(r,"IDE_PROJECT_OWNER_RETIRED");
 NSError*e=nil;if(![r->source assertCurrent:&e])return ProjectFail(r,"IDE_PROJECT_SOURCE_CURRENT_FAILED",e);return true;
}
static NSString* ProjectText(napi_env env,napi_value value){
 napi_valuetype t;if(napi_typeof(env,value,&t)!=napi_ok||t!=napi_string)return nil;
 size_t n=0;if(napi_get_value_string_utf8(env,value,nullptr,0,&n)!=napi_ok||!n||n>256)return nil;
 char bytes[257];size_t read=0;if(napi_get_value_string_utf8(env,value,bytes,sizeof(bytes),&read)!=napi_ok||read!=n)return nil;
 NSString*s=[[NSString alloc]initWithBytes:bytes length:n encoding:NSUTF8StringEncoding];
 if(!s||![[s stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]isEqual:s])return nil;
 for(NSUInteger i=0;i<s.length;i++){unichar c=[s characterAtIndex:i];if(c<33||c==127)return nil;}return s;
}
// NAPI-only conversion: never calls mutable JSON.parse/stringify or user getters.
// Public originals are independent Uint8Array copies, never an authority handle.
static napi_value ProjectData(napi_env env,id value,unsigned depth=0){
 if(depth>6)return nullptr;napi_value out=nullptr;
 if([value isKindOfClass:NSData.class]){void*p=nullptr;napi_value array;
  if([value length]>8192||napi_create_arraybuffer(env,[value length],&p,&array)!=napi_ok)return nullptr;
  memcpy(p,[value bytes],[value length]);return napi_create_typedarray(env,napi_uint8_array,[value length],array,0,&out)==napi_ok?out:nullptr;}
 if([value isKindOfClass:NSString.class]){NSData*b=[value dataUsingEncoding:NSUTF8StringEncoding];if(!b||b.length>32768)return nullptr;return napi_create_string_utf8(env,(const char*)b.bytes,b.length,&out)==napi_ok?out:nullptr;}
 if([value isKindOfClass:NSNumber.class]){napi_status rc=CFGetTypeID((__bridge CFTypeRef)value)==CFBooleanGetTypeID()?napi_get_boolean(env,[value boolValue],&out):napi_create_double(env,[value doubleValue],&out);return rc==napi_ok?out:nullptr;}
 if([value isKindOfClass:NSDictionary.class]){
  if([value count]>32||napi_create_object(env,&out)!=napi_ok)return nullptr;
  for(NSString*k in value){if(![k isKindOfClass:NSString.class])return nullptr;napi_value child=ProjectData(env,value[k],depth+1);if(!child)return nullptr;
   napi_property_descriptor d={k.UTF8String,nullptr,nullptr,nullptr,nullptr,child,napi_enumerable,nullptr};if(napi_define_properties(env,out,1,&d)!=napi_ok)return nullptr;}
  return napi_object_freeze(env,out)==napi_ok?out:nullptr;}
 return nullptr;
}
static napi_value ProjectAcquire(napi_env env,napi_callback_info info){
 napi_value unused[1];if(!Args(env,info,0,unused))return ProjectFailure(env,"IDE_PROJECT_ARGUMENTS_INVALID");
 size_t live=0;for(auto*r:originalIDEProjects)if(r->env==env&&!r->closed)live++;
 if(live>=8)return ProjectFailure(env,"IDE_PROJECT_OWNER_CAPACITY");
 auto*r=new(std::nothrow)OriginalIDEProjectRef{};if(!r)return ProjectFailure(env,"IDE_PROJECT_OWNER_CAPACITY");r->env=env;
 @try{NSError*e=nil;r->source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEProjectAuthoritySource:&e];
  if(!r->source){delete r;return ProjectFailure(env,"IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED");}
  // Capture actual partial+error before status. The caller can always close it.
  if(e)ProjectFail(r,"IDE_PROJECT_SOURCE_ACQUISITION_FAILED",e);
  napi_value object;if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,&originalIDEProjectTag)!=napi_ok){if(!ProjectClose(r))originalIDEProjects.insert(r);else delete r;return nullptr;}
  originalIDEProjects.insert(r);if(napi_wrap(env,object,r,ProjectFinalize,nullptr,nullptr)!=napi_ok){ProjectFinalize(env,r,nullptr);return nullptr;}
  return napi_object_freeze(env,object)==napi_ok?object:nullptr;
 }@catch(id){if(r->source){ProjectFail(r,"IDE_PROJECT_SOURCE_ACQUISITION_UNKNOWN");if(!ProjectClose(r))originalIDEProjects.insert(r);else delete r;}else delete r;return ProjectFailure(env,"IDE_PROJECT_SOURCE_ACQUISITION_UNKNOWN");}
}
static napi_value ProjectRead(napi_env env,napi_callback_info info){
 napi_value a[4];void*data=nullptr;size_t count=4;if(napi_get_cb_info(env,info,&count,a,nullptr,&data)!=napi_ok)return ProjectFailure(env,"IDE_PROJECT_ARGUMENTS_INVALID");
 const bool publisher=data!=nullptr;if(count!=(publisher?3:2))return ProjectFailure(env,"IDE_PROJECT_ARGUMENTS_INVALID");
 auto*r=ProjectOriginal(env,a[0]);if(!r)return ProjectFailure(env,"IDE_PROJECT_ORIGINAL_OWNER_REQUIRED");
 NSString*project=ProjectText(env,a[1]),*key=publisher?ProjectText(env,a[2]):nil;
 if(!project||(publisher&&!key))return ProjectFailure(env,"IDE_PROJECT_ARGUMENTS_INVALID");
 if(r->busy){ProjectFail(r,"IDE_PROJECT_OWNER_REENTRANT");return ProjectFailure(env,r->failure);}
 r->busy=true;
 @try{
  if(!ProjectCurrent(r))return ProjectFailure(env,r->failure);NSError*e=nil;
  NSDictionary*first=publisher?[r->source copyOriginalIDECurrentPublisher:key forProject:project error:&e]:[r->source copyOriginalIDECurrentProject:project error:&e];
  if(e||!first){ProjectFail(r,"IDE_PROJECT_READ_CURRENT_FAILED",e);return ProjectFailure(env,r->failure);}
  napi_value result=ProjectData(env,first);if(!result){ProjectFail(r,"IDE_PROJECT_OUTPUT_INVALID");return ProjectFailure(env,r->failure);}
  if(!ProjectCurrent(r))return ProjectFailure(env,r->failure);e=nil;
  NSDictionary*last=publisher?[r->source copyOriginalIDECurrentPublisher:key forProject:project error:&e]:[r->source copyOriginalIDECurrentProject:project error:&e];
  if(e||!last||![first isEqual:last]){ProjectFail(r,"IDE_PROJECT_POST_COMPLETION_CURRENT_FAILED",e);return ProjectFailure(env,r->failure);}
  // The last native getter itself has the post-completion clock/current fence.
  // Do not refresh Source AFTER that snapshot comparison and return stale DATA.
  if(r->failure||r->retired||r->closeSelected){ProjectFail(r,"IDE_PROJECT_OWNER_RETIRED");return ProjectFailure(env,r->failure);}return result;
 }@catch(id){ProjectFail(r,"IDE_PROJECT_READ_UNKNOWN");return ProjectFailure(env,r->failure);}@finally{r->busy=false;}
}
static napi_value ProjectDispose(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return ProjectFailure(env,"IDE_PROJECT_ARGUMENTS_INVALID");auto*r=ProjectOriginal(env,a[0]);
 if(!r)return ProjectFailure(env,"IDE_PROJECT_ORIGINAL_OWNER_REQUIRED");
 if(r->busy){ProjectFail(r,"IDE_PROJECT_OWNER_REENTRANT");return ProjectFailure(env,r->failure);}
 return ProjectClose(r)?Undefined(env):ProjectFailure(env,"IDE_PROJECT_CLOSE_UNKNOWN");
}
static napi_value RegisterOriginalIDEProjectAuthorityBinding(napi_env env,napi_value exports){
 const struct{const char*name;napi_callback cb;void*data;}methods[]={
  {"acquireOriginalIDEProjectAuthority",ProjectAcquire,nullptr},
  {"readOriginalIDECurrentProject",ProjectRead,nullptr},
  {"readOriginalIDECurrentPublisher",ProjectRead,(void*)1},
  {"closeOriginalIDEProjectAuthority",ProjectDispose,nullptr}};
 for(auto&m:methods){napi_property_descriptor d={m.name,nullptr,m.cb,nullptr,nullptr,nullptr,napi_default,m.data};if(napi_define_properties(env,exports,1,&d)!=napi_ok)return nullptr;}return exports;
}
