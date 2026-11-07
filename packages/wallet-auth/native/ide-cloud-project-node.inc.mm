// Textual same-image append AFTER original parent joint and workspace selector
// inventories; no public generic Source/provider/import/path setter.
#import "ide-cloud-project-mapping-private.h"
#include <pthread.h>
struct IDECloudProjectRef{
 napi_env env=nullptr;OriginalIDENodeHandle*parent=nullptr;WorkspaceProjectSelection*workspace=nullptr;
 napi_ref parentRef=nullptr,workspaceRef=nullptr;
 YNXOriginalIDECloudProjectMapping*__strong mapping=nil;
 bool retired=false,returned=false,closed=false;
};
static std::unordered_set<IDECloudProjectRef*>ideCloudProjectRefs;
static const napi_type_tag ideCloudProjectTag={0x72630968ba144c1dULL,0x9f56eb91ae257c08ULL};
static IDECloudProjectRef*IDECloudProjectOriginal(napi_env env,napi_value v){bool tag=false;void*p=nullptr;if(napi_check_object_type_tag(env,v,&ideCloudProjectTag,&tag)!=napi_ok||!tag||napi_unwrap(env,v,&p)!=napi_ok)return nullptr;auto*r=(IDECloudProjectRef*)p;return r&&ideCloudProjectRefs.count(r)&&r->env==env?r:nullptr;}
static bool IDECloudProjectCurrent(IDECloudProjectRef*r){
 auto deny=[&](){r->retired=true;return false;};
 if(r->retired||r->closed||!r->parent||!r->workspace||r->parent->cloudClosing||r->parent->closeSelected||r->parent->closeComplete||r->workspace->first||r->workspace->closeSelected)return deny();
 NSError*e=nil;if(![r->parent->owner assertCurrentExpected:nil error:&e]||e)return deny();
 NSDictionary*selected=WorkspaceSelectionSnapshot(r->workspace);if(!selected||![selected isEqual:r->workspace->original]||!WorkspaceSelectionDirectories(r->workspace))return deny();
 e=nil;if(![r->mapping assertCurrent:&e]||e)return deny();
 if(r->retired||r->parent->cloudClosing||r->parent->closeSelected||r->workspace->closeSelected||r->workspace->first)return deny();return true;
}
static bool IDECloudProjectClose(IDECloudProjectRef*r){
 if(r->closed)return true;r->retired=true;[r->mapping retire];NSError*e=nil;
 if(r->mapping&&(![r->mapping join:&e]||e||![r->mapping close:&e]||e))return false;
 if(!r->returned){if(!r->parent||!r->workspace||!r->parent->cloudLoans||!r->workspace->cloudLoans)return false;--r->parent->cloudLoans;--r->workspace->cloudLoans;r->returned=true;}
 if(r->parentRef){napi_delete_reference(r->env,r->parentRef);r->parentRef=nullptr;}if(r->workspaceRef){napi_delete_reference(r->env,r->workspaceRef);r->workspaceRef=nullptr;}
 r->mapping=nil;r->closed=true;return true;
}
static void IDECloudProjectFinalize(napi_env,void*p,void*){auto*r=(IDECloudProjectRef*)p;if(!ideCloudProjectRefs.count(r))return;if(IDECloudProjectClose(r)){ideCloudProjectRefs.erase(r);delete r;}}
static napi_value IDECloudProjectAcquire(napi_env env,napi_callback_info info){
 if(!pthread_main_np())return Error(env,"IDE_CLOUD_ORIGINAL_OWNER_THREAD_REQUIRED");
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"IDE_CLOUD_PROJECT_ARGUMENTS");void*parentRaw=nullptr;if(napi_unwrap(env,a[0],&parentRaw)!=napi_ok)return Error(env,"IDE_CLOUD_SAME_PARENT_REQUIRED");auto*p=(OriginalIDENodeHandle*)parentRaw;auto*w=WorkspaceSelectionOriginal(env,a[1]);
 if(!p||!ideNodeOwners.count(p)||p->env!=env||p->closeSelected||p->cloudClosing||!w||w->first||w->closeSelected||w->cloudLoans||p->cloudLoans==UINT_MAX)return Error(env,"IDE_CLOUD_ORIGINAL_OWNERS_REQUIRED");
 NSError*e=nil;if(![p->owner assertCurrentExpected:nil error:&e]||e||!WorkspaceSelectionSnapshot(w)||!WorkspaceSelectionDirectories(w))return Error(env,"IDE_CLOUD_ORIGINAL_CURRENT_REQUIRED");
 auto*r=new(std::nothrow)IDECloudProjectRef;if(!r)return Error(env,"IDE_CLOUD_CAPACITY");r->env=env;r->parent=p;r->workspace=w;
 napi_value out;if(napi_create_object(env,&out)!=napi_ok||napi_type_tag_object(env,out,&ideCloudProjectTag)!=napi_ok||napi_wrap(env,out,r,IDECloudProjectFinalize,nullptr,nullptr)!=napi_ok){delete r;return Error(env,"IDE_CLOUD_RESULT_UNAVAILABLE");}
 ++p->cloudLoans;++w->cloudLoans;ideCloudProjectRefs.insert(r);
 // Publish opaque owner BEFORE late allocation/Root0 errors. Failure remains
 // cleanup-only; no script/header/body can turn this partial into authority.
 if(napi_create_reference(env,a[0],1,&r->parentRef)!=napi_ok||napi_create_reference(env,a[1],1,&r->workspaceRef)!=napi_ok){r->retired=true;return out;}
 @try{r->mapping=[YNXOriginalIDECloudProjectMapping borrowOriginalParent:p->owner projectSource:w->source error:&e];if(e||!r->mapping||!IDECloudProjectCurrent(r))r->retired=true;}@catch(id){r->retired=true;}
 return out;
}
static napi_value IDECloudProjectRead(napi_env env,napi_callback_info info){if(!pthread_main_np())return Error(env,"IDE_CLOUD_ORIGINAL_OWNER_THREAD_REQUIRED");napi_value a[1];if(!Args(env,info,1,a))return Error(env,"IDE_CLOUD_PROJECT_ARGUMENTS");auto*r=IDECloudProjectOriginal(env,a[0]);if(!r||!IDECloudProjectCurrent(r))return Error(env,"IDE_CLOUD_PROJECT_CURRENT_REQUIRED");NSError*e=nil;NSDictionary*d=[r->mapping copyOriginalMappingDATA:&e];napi_value out=d&&!e?ProjectData(env,d):nullptr;if(!out||!IDECloudProjectCurrent(r)){r->retired=true;return Error(env,"IDE_CLOUD_PROJECT_LATE_CURRENT");}return out;}
static napi_value IDECloudProjectCurrentFailure(napi_env env,IDECloudProjectRef*r){NSString*c=r?r->mapping.firstCause.localizedDescription:nil;return Error(env,(c?:@"IDE_CLOUD_PROJECT_CURRENT_REQUIRED").UTF8String);}
static napi_value IDECloudProjectLifecycle(napi_env env,napi_callback_info info){if(!pthread_main_np())return Error(env,"IDE_CLOUD_ORIGINAL_OWNER_THREAD_REQUIRED");napi_value a[1];void*op=nullptr;if(!Args(env,info,1,a,&op))return Error(env,"IDE_CLOUD_PROJECT_ARGUMENTS");auto*r=IDECloudProjectOriginal(env,a[0]);if(!r)return Error(env,"IDE_CLOUD_ORIGINAL_REQUIRED");
 switch((uintptr_t)op){case 0:return IDECloudProjectCurrent(r)?Undefined(env):IDECloudProjectCurrentFailure(env,r);case 1:r->retired=true;[r->mapping retire];return Undefined(env);case 2:{NSError*e=nil;return r->retired&&(!r->mapping||([r->mapping join:&e]&&!e))?Undefined(env):Error(env,"IDE_CLOUD_PROJECT_JOIN_PENDING");}case 3:return IDECloudProjectClose(r)?Undefined(env):Error(env,"IDE_CLOUD_PROJECT_CLOSE_PENDING");default:return Error(env,"IDE_CLOUD_PROJECT_OPERATION");}}
static napi_value RegisterOriginalIDECloudProjectLookup(napi_env env,napi_value exports){const struct{const char*n;napi_callback cb;void*op;}methods[]={{"acquireOriginalIDECloudProjectLookup",IDECloudProjectAcquire,nullptr},{"readOriginalIDECloudProjectLookupDATA",IDECloudProjectRead,nullptr},{"assertOriginalIDECloudProjectLookupCurrent",IDECloudProjectLifecycle,(void*)0},{"retireOriginalIDECloudProjectLookup",IDECloudProjectLifecycle,(void*)1},{"joinOriginalIDECloudProjectLookup",IDECloudProjectLifecycle,(void*)2},{"closeOriginalIDECloudProjectLookup",IDECloudProjectLifecycle,(void*)3}};for(const auto&m:methods){napi_property_descriptor d={m.n,nullptr,m.cb,nullptr,nullptr,nullptr,napi_default,m.op};if(napi_define_properties(env,exports,1,&d)!=napi_ok)return nullptr;}return exports;}
