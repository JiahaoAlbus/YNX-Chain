#pragma once
#include <algorithm>
#include "original-ide-service-registration-data.h"
#include "original-ide-parent-kernel.h"
struct SourceObserverWindow {
 uint64_t beganWall=0,beganMono=0,lastWall=0,lastMono=0,expires=0;
 bool current(uint64_t wall,uint64_t mono){
  if(!expires||wall<lastWall||mono<lastMono||wall>=expires||mono-beganMono>=expires-beganWall)return false;
  lastWall=wall;lastMono=mono;return true;
 }
 bool observe(uint64_t wall,uint64_t mono,uint64_t limit){
  if(limit<=wall)return false;
  if(!expires){beganWall=lastWall=wall;beganMono=lastMono=mono;expires=limit;}
  expires=std::min(expires,limit);return current(wall,mono);
 }
};
// Signed metadata matching only. Kernel observations and original Source
// verification remain the owning factory's responsibility; DATA grants none.
static bool SourceObserverProcess(id value,const ynx_auth_ide_private::ProcessOriginal&actual){
 if(!SourceProjectKeys(value,@[@"pid",@"parent",@"uid",@"gid",@"startSeconds",@"startMicros"]))return false;
 const uint64_t fields[]={actual.pid,actual.parent,actual.uid,actual.gid,actual.startSeconds,actual.startMicros};
 unsigned i=0;for(NSString*k in @[@"pid",@"parent",@"uid",@"gid",@"startSeconds",@"startMicros"]){uint64_t n=0;if(!SourceProofU64(value[k],n)||n!=fields[i++])return false;}return true;
}
static bool SourceObserverBinding(NSDictionary*selection,const ynx_auth_ide_private::KernelProcess&app,const ynx_auth_ide_private::KernelProcess&node,uint64_t now,uint64_t sourceExpires,uint64_t&expires){
 id m=selection[@"ideProjectAppObserver"],a=selection[@"projectAuthority"],p=a[@"principal"],project=a[@"project"],service=selection[@"ideServiceRegistration"];
 if(!SourceProjectKeys(m,@[@"version",@"app",@"node",@"ideCodeIdentity",@"nodeCodeIdentity",@"nodeSHA256",@"entrySHA256",@"provenanceSHA256",@"projectId",@"serviceRegistrationId",@"serviceRegistrationRevision",@"serviceCurrentReference",@"expiresMS"])||![m[@"version"]isEqual:@"YNX-IDE-PROJECT-APP-OBSERVER/v1"]||!SourceProjectKeys(a,@[@"principal",@"project",@"publisher",@"endpoint",@"spki"]))return false;
 if(!app.original.uid||app.original.pid<=1||node.original.pid<=1||node.original.pid==app.original.pid||node.original.parent!=app.original.pid||node.original.uid!=app.original.uid||node.original.gid!=app.original.gid||!SourceObserverProcess(m[@"app"],app.original)||!SourceObserverProcess(m[@"node"],node.original)||![m[@"node"]isEqual:selection[@"projectSelection"][@"node"]])return false;
 NSData*appCode=SourceProjectBase64(m[@"ideCodeIdentity"]),*nodeCode=SourceProjectBase64(m[@"nodeCodeIdentity"]);
 if(appCode.length<20||appCode.length>64||nodeCode.length<20||nodeCode.length>64||![appCode isEqual:app.codeIdentity]||![nodeCode isEqual:node.codeIdentity])return false;
 for(NSString*k in @[@"nodeSHA256",@"entrySHA256",@"provenanceSHA256"])if(!SourceProofHex(m[k]))return false;
 uint64_t limit=0,pe=0,projectExpiry=0,serviceExpiry=0;
 if(!SourceProjectMS(m[@"expiresMS"],limit)||!SourceProjectMS(p[@"expiresMS"],pe)||!SourceProjectMS(project[@"expiresMS"],projectExpiry)||!SourceProofBoolean(project[@"read"],true)||![m[@"projectId"]isEqual:project[@"projectId"]]||!SourceProjectServiceRegistration(service,p,m[@"projectId"],now,serviceExpiry)||![m[@"serviceRegistrationId"]isEqual:service[@"registrationId"]]||![m[@"serviceRegistrationRevision"]isEqual:service[@"revision"]]||![m[@"serviceCurrentReference"]isEqual:service[@"currentReference"]])return false;
 expires=std::min(std::min(limit,sourceExpires),std::min(pe,std::min(projectExpiry,serviceExpiry)));return now<expires;
}
