// Same original project-authority Source, separate concrete workspace selector.
// Local paths/id are restrictive DATA only. Canonical IDs come ONLY from its
// original signed projectSelection + CurrentProject/CurrentPublisher registry.
#include "../../../packages/wallet-auth/native/original-ide-contract-relay-launch.h"
#include "../../../packages/wallet-auth/native/original-ide-project-authority-data.h"
struct WorkspaceProjectSelection {
 napi_env env=nullptr;YNXAuthIdentitySourceAuthority* __strong source=nil;
 NSDictionary* __strong local=nil;NSDictionary* __strong original=nil;
 ynx_auth_private::TemporaryDescriptor workspace,profile;
 struct stat workspaceIdentity{},profileIdentity{};
 const char*first=nullptr;NSError* __strong cause=nil;
 bool busy=false,closeSelected=false,closed=false;uint64_t expires=0,floor=0;
};
static std::set<WorkspaceProjectSelection*> workspaceProjectSelections;
static const napi_type_tag workspaceProjectSelectionTag={0x7f5c59902da84175ULL,0xb86dddfc8abb5740ULL};
static bool WorkspaceSelectionFail(WorkspaceProjectSelection*s,const char*code,NSError*e=nil){if(!s->first){s->first=code;s->cause=e;}return false;}
static bool WorkspaceSelectionClose(WorkspaceProjectSelection*s){
 if(s->closeSelected)return s->closed;if(s->busy)return false;s->closeSelected=true;bool done=true;
 // Independent FDs drain even if another resource or Source close is UNKNOWN.
 for(auto*d:{&s->workspace,&s->profile})if(!d->available()&&!d->closeOnce([](int fd){return ::close(fd);}))done=false;
 @try{[s->source retire];NSError*e=nil;if(s->source&&(![s->source join:&e]||![s->source close:&e]||e)){if(!s->cause)s->cause=e;done=false;}}@catch(id){done=false;}
 if(done){s->source=nil;s->closed=true;}return done;
}
static void WorkspaceSelectionFinalize(napi_env,void*p,void*){auto*s=(WorkspaceProjectSelection*)p;if(!workspaceProjectSelections.count(s))return;if(WorkspaceSelectionClose(s)){workspaceProjectSelections.erase(s);delete s;}}
static WorkspaceProjectSelection*WorkspaceSelectionOriginal(napi_env env,napi_value object){bool tagged=false;void*p=nullptr;if(napi_check_object_type_tag(env,object,&workspaceProjectSelectionTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,object,&p)!=napi_ok||!p)return nullptr;auto*s=(WorkspaceProjectSelection*)p;return workspaceProjectSelections.count(s)&&s->env==env?s:nullptr;}
static NSString*WorkspaceSelectionString(napi_env env,napi_value v,NSUInteger cap){size_t n=0;if(napi_get_value_string_utf8(env,v,nullptr,0,&n)!=napi_ok||!n||n>cap)return nil;std::vector<char>b(n+1);size_t actual=0;if(napi_get_value_string_utf8(env,v,b.data(),b.size(),&actual)!=napi_ok||actual!=n)return nil;return [[NSString alloc]initWithBytes:b.data()length:n encoding:NSUTF8StringEncoding];}
static bool WorkspaceSelectionProcess(NSDictionary*node){
 if(!ynx_auth_ide_relay_private::exactKeys(node,@[@"pid",@"parent",@"uid",@"gid",@"startSeconds",@"startMicros"]))return false;
 struct proc_bsdinfo b{};if(proc_pidinfo(getpid(),PROC_PIDTBSDINFO,0,&b,sizeof(b))!=(int)sizeof(b))return false;
 const uint64_t values[]={b.pbi_pid,b.pbi_ppid,b.pbi_uid,b.pbi_gid,b.pbi_start_tvsec,b.pbi_start_tvusec};NSArray*keys=@[@"pid",@"parent",@"uid",@"gid",@"startSeconds",@"startMicros"];
 for(NSUInteger i=0;i<keys.count;i++){uint64_t value=0;if(!SourceProofU64(node[keys[i]],value)||value!=values[i])return false;}return true;
}
static NSDictionary*WorkspaceSelectionSnapshot(WorkspaceProjectSelection*s){
 if(s->first||s->closeSelected)return nil;NSError*e=nil;
 if(![s->source assertCurrent:&e]){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_SOURCE_CURRENT_FAILED",e);return nil;}
 NSDictionary*view=[s->source copyOriginalIDEProjectSelectionLocal:&e],*mapping=view[@"selection"],*authority=view[@"authority"];
 if(e||!ynx_auth_ide_relay_private::exactKeys(mapping,@[@"version",@"projectId",@"publisherId",@"projectRevision",@"catalogRevision",@"localProjectId",@"workspace",@"profile",@"node",@"expiresMS"])||![mapping[@"version"]isEqual:@"YNX-IDE-WORKSPACE-PROJECT-SELECTION/v1"]||!ynx_auth_ide_relay_private::localContext(s->local)||![mapping[@"localProjectId"]isEqual:s->local[@"id"]]||!WorkspaceSelectionProcess(mapping[@"node"])){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_SIGNED_SELECTION_REQUIRED",e);return nil;}
 NSString*projectID=mapping[@"projectId"];if(!SourceProjectText(projectID)||![authority[@"project"][@"projectId"]isEqual:projectID]||![authority[@"project"][@"projectRevision"]isEqual:mapping[@"projectRevision"]]||![authority[@"project"][@"catalogRevision"]isEqual:mapping[@"catalogRevision"]]){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_CANONICAL_BINDING");return nil;}
 NSDictionary*project=[s->source copyOriginalIDECurrentProject:projectID error:&e];if(e||!project){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_REGISTRY_CURRENT_FAILED",e);return nil;}
 id publisher=mapping[@"publisherId"];if(publisher==NSNull.null){if(authority[@"publisher"]!=NSNull.null){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_PUBLISHER_MISMATCH");return nil;}}
 else{if(!SourceProjectText(publisher)||![authority[@"publisher"][@"publisherId"]isEqual:publisher]){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_PUBLISHER_MISMATCH");return nil;}NSDictionary*current=[s->source copyOriginalIDECurrentPublisher:publisher forProject:projectID error:&e];if(e||!current){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_PUBLISHER_CURRENT_FAILED",e);return nil;}}
 uint64_t expires=0;if(!SourceProjectMS(mapping[@"expiresMS"],expires)){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_EXPIRY");return nil;}expires=std::min(expires,[project[@"expiresMS"]unsignedLongLongValue]);
 if(!s->expires)s->expires=expires;else s->expires=std::min(s->expires,expires);
 uint64_t n=(uint64_t)(NSDate.date.timeIntervalSince1970*1000);if(n<s->floor||n>=s->expires){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_EXPIRED");return nil;}s->floor=n;
 for(NSString*k in @[@"workspace",@"profile"]){NSDictionary*d=mapping[k];uint64_t device=0,inode=0;if(!ynx_auth_ide_relay_private::exactKeys(d,@[@"path",@"device",@"inode"])||![d[@"path"]isEqual:s->local[k]]||!SourceProofU64(d[@"device"],device)||!SourceProofU64(d[@"inode"],inode,true)){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_DIRECTORY_BINDING");return nil;}}
 return [NSJSONSerialization JSONObjectWithData:[NSJSONSerialization dataWithJSONObject:mapping options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil]options:0 error:nil];
}
static bool WorkspaceSelectionDirectories(WorkspaceProjectSelection*s){
 return ynx_auth_ide_relay_private::namedDirectory(s->local[@"workspace"],s->workspaceIdentity,s->workspace.identity())&&ynx_auth_ide_relay_private::namedDirectory(s->local[@"profile"],s->profileIdentity,s->profile.identity())&&s->profileIdentity.st_uid==getuid()&&!(s->profileIdentity.st_mode&0077);
}
static napi_value WorkspaceSelectionWrap(napi_env env,WorkspaceProjectSelection*s){napi_value object;if(napi_create_object(env,&object)!=napi_ok||napi_type_tag_object(env,object,&workspaceProjectSelectionTag)!=napi_ok){if(!WorkspaceSelectionClose(s))workspaceProjectSelections.insert(s);else delete s;return nullptr;}workspaceProjectSelections.insert(s);if(napi_wrap(env,object,s,WorkspaceSelectionFinalize,nullptr,nullptr)!=napi_ok){WorkspaceSelectionFinalize(env,s,nullptr);return nullptr;}return napi_object_freeze(env,object)==napi_ok?object:nullptr;}
static napi_value WorkspaceSelectionAcquire(napi_env env,napi_callback_info info){
 napi_value a[3];if(!Args(env,info,3,a))return Error(env,"IDE_WORKSPACE_PROJECT_ARGUMENTS");NSString*workspace=WorkspaceSelectionString(env,a[0],4096),*profile=WorkspaceSelectionString(env,a[1],4096),*localID=WorkspaceSelectionString(env,a[2],128);NSDictionary*local=workspace&&profile&&localID?@{@"workspace":workspace,@"profile":profile,@"id":localID}:nil;
 if(!ynx_auth_ide_relay_private::localContext(local))return Error(env,"IDE_WORKSPACE_PROJECT_ARGUMENTS");size_t count=0;for(auto*s:workspaceProjectSelections)if(s->env==env&&!s->closed)count++;if(count>=8)return Error(env,"IDE_WORKSPACE_PROJECT_CAPACITY");
 auto*s=new(std::nothrow)WorkspaceProjectSelection{};if(!s)return Error(env,"IDE_WORKSPACE_PROJECT_CAPACITY");s->env=env;s->local=local;
 @try{NSError*e=nil;s->source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEProjectAuthoritySource:&e];if(!s->source){delete s;return Error(env,"IDE_WORKSPACE_PROJECT_SOURCE_NOT_SUPPLIED");}if(e){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_SOURCE_PARTIAL",e);return WorkspaceSelectionWrap(env,s);}
  s->busy=true;s->original=WorkspaceSelectionSnapshot(s);s->busy=false;if(!s->original)return WorkspaceSelectionWrap(env,s);
  for(NSString*k in @[@"workspace",@"profile"]){auto&slot=[k isEqual:@"workspace"]?s->workspace:s->profile;auto&identity=[k isEqual:@"workspace"]?s->workspaceIdentity:s->profileIdentity;int fd=open([s->local[k]fileSystemRepresentation],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(fd<0){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_DIRECTORY_UNAVAILABLE");return WorkspaceSelectionWrap(env,s);}if(!slot.hold(fd))std::terminate();uint64_t dev=0,ino=0;SourceProofU64(s->original[k][@"device"],dev);SourceProofU64(s->original[k][@"inode"],ino,true);if(fstat(fd,&identity)||!S_ISDIR(identity.st_mode)||(uint64_t)identity.st_dev!=dev||(uint64_t)identity.st_ino!=ino){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_DIRECTORY_CHANGED");return WorkspaceSelectionWrap(env,s);}}
  if(!WorkspaceSelectionDirectories(s))WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_DIRECTORY_CHANGED");return WorkspaceSelectionWrap(env,s);
 }@catch(id){s->busy=false;WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_CAPTURE_UNKNOWN");return WorkspaceSelectionWrap(env,s);}
}
static napi_value WorkspaceSelectionRead(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"IDE_WORKSPACE_PROJECT_ARGUMENTS");auto*s=WorkspaceSelectionOriginal(env,a[0]);if(!s)return Error(env,"IDE_WORKSPACE_PROJECT_ORIGINAL_REQUIRED");if(s->first)return Error(env,s->first);if(s->closed||s->closeSelected)return Error(env,"IDE_WORKSPACE_PROJECT_CLOSED");if(s->busy){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_REENTRANT");return Error(env,s->first);}s->busy=true;
 @try{NSDictionary*current=WorkspaceSelectionSnapshot(s);if(!current||![current isEqual:s->original]||!WorkspaceSelectionDirectories(s)){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_CURRENT_CHANGED");return Error(env,s->first);}
  const uint64_t returnedExpires=s->expires;napi_value result=ProjectData(env,@{@"projectId":current[@"projectId"],@"publisherId":current[@"publisherId"],@"projectRevision":current[@"projectRevision"],@"catalogRevision":current[@"catalogRevision"],@"expiresMS":@(returnedExpires)});
  // No Source callback follows this final exact snapshot + filesystem fence.
  NSDictionary*last=WorkspaceSelectionSnapshot(s);uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000);if(!result||!last||![last isEqual:s->original]||!WorkspaceSelectionDirectories(s)||s->first||s->expires!=returnedExpires||after<s->floor||after>=s->expires){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_POST_COMPLETION_CURRENT_FAILED");return Error(env,s->first);}s->floor=after;return result;
 }@catch(id){WorkspaceSelectionFail(s,"IDE_WORKSPACE_PROJECT_READ_UNKNOWN");return Error(env,s->first);}@finally{s->busy=false;}
}
static napi_value WorkspaceSelectionDispose(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"IDE_WORKSPACE_PROJECT_ARGUMENTS");auto*s=WorkspaceSelectionOriginal(env,a[0]);if(!s)return Error(env,"IDE_WORKSPACE_PROJECT_ORIGINAL_REQUIRED");return WorkspaceSelectionClose(s)?Undefined(env):Error(env,"IDE_WORKSPACE_PROJECT_CLOSE_UNKNOWN");}
static napi_value RegisterOriginalIDEWorkspaceProjectSelection(napi_env env,napi_value exports){const struct{const char*name;napi_callback cb;}methods[]={{"acquireOriginalIDEWorkspaceProjectSelection",WorkspaceSelectionAcquire},{"readOriginalIDEWorkspaceProjectSelection",WorkspaceSelectionRead},{"closeOriginalIDEWorkspaceProjectSelection",WorkspaceSelectionDispose}};for(auto&m:methods){napi_property_descriptor d={m.name,nullptr,m.cb,nullptr,nullptr,nullptr,napi_default,nullptr};if(napi_define_properties(env,exports,1,&d)!=napi_ok)return nullptr;}return exports;}
