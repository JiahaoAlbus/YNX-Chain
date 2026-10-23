// Same original Source owner/signature domain/registered ledger verifier.
// No Root/table/ACL is created, no callback or caller-supplied authority.
#include "original-ide-project-authority-data.h"
- (NSDictionary*)copyOriginalIDEProjectAuthorityLocal:(NSError**)error {
 @synchronized(self){
  if(_projectLocalEntered||_entered||_relayLocalEntered||_relayRuntimeEntered){[self fail:@"IDE_PROJECT_SOURCE_REENTRANT" error:error];return nil;}
  _projectLocalEntered=YES;
  @try{
   if(_invalid||_retired||!_ideProjectConsumer||!_policy||_policy->purpose!="ide-project-authority-v1"||!_selection||!_currentOriginal.length||!_cachedCurrentExpiresMS||!_sequence||_floor>_sequence){[self fail:@"IDE_PROJECT_DEDICATED_SOURCE_REQUIRED" error:error];return nil;}
   NSDictionary*root=SourceProofDictionary(_rootOriginal,16384),*current=SourceOriginalBodyHint(_currentOriginal),*authority=_selection[@"projectAuthority"],*association=_selection[@"association"];
   if(![root[@"version"]isEqual:@2]||![root[@"algorithmVersion"]isEqual:@"YNX-BATCH/v0.1"]||!SourceProjectKeys(authority,@[@"principal",@"project",@"publisher",@"endpoint",@"spki"])){[self fail:@"IDE_PROJECT_VERIFIED_V2_REQUIRED" error:error];return nil;}
   NSString*endpoint=[NSString stringWithUTF8String:_policy->projectAuthorityEndpoint.c_str()],*spki=[NSString stringWithUTF8String:_policy->projectAuthoritySPKI.c_str()];NSURLComponents*u=[NSURLComponents componentsWithString:endpoint];
   if(!endpoint.length||![u.scheme isEqual:@"https"]||!u.host.length||u.user||u.password||u.query||u.fragment||!SourceProofHex(spki)||![authority[@"endpoint"]isEqual:endpoint]||![authority[@"spki"]isEqual:spki]){[self fail:@"IDE_PROJECT_ENDPOINT_RELEASE_NOT_SUPPLIED" error:error];return nil;}
   NSDictionary*p=authority[@"principal"],*a=authority[@"project"],*key=authority[@"publisher"];BOOL hasPublisher=(id)key!=NSNull.null;
   if(!SourceProjectKeys(p,@[@"account",@"deviceId",@"sessionRef",@"currentRef",@"accountGeneration",@"sessionGeneration",@"expiresMS"])||!SourceProjectKeys(a,@[@"projectId",@"ownerAccount",@"runtimeOrigin",@"currentReference",@"projectRevision",@"catalogRevision",@"read",@"publish",@"runtime",@"expiresMS"])||(hasPublisher&&!SourceProjectKeys(key,@[@"account",@"projectId",@"publisherId",@"keyRole",@"publicOriginal",@"publicSHA256",@"registrationRef",@"revision",@"expiresMS",@"revoked"]))){[self fail:@"IDE_PROJECT_ORIGINAL_SCHEMA" error:error];return nil;}
   for(NSString*k in @[@"account",@"deviceId",@"sessionRef",@"currentRef"])if(!SourceProjectText(p[k])){[self fail:@"IDE_PROJECT_PRINCIPAL_INVALID" error:error];return nil;}
   for(NSString*k in @[@"projectId",@"ownerAccount",@"currentReference"])if(!SourceProjectText(a[k])){[self fail:@"IDE_PROJECT_CURRENT_INVALID" error:error];return nil;}
   if(hasPublisher)for(NSString*k in @[@"account",@"projectId",@"publisherId",@"registrationRef"])if(!SourceProjectText(key[k])){[self fail:@"IDE_PROJECT_PUBLISHER_INVALID" error:error];return nil;}
   uint64_t counter=0;for(NSString*k in @[@"accountGeneration",@"sessionGeneration"])if(!SourceProofU64(p[k],counter,true)){[self fail:@"IDE_PROJECT_GENERATION_INVALID" error:error];return nil;}
   for(NSString*k in @[@"projectRevision",@"catalogRevision"])if(!SourceProofU64(a[k],counter,true)){[self fail:@"IDE_PROJECT_REVISION_INVALID" error:error];return nil;}
   if(![p[@"account"]isEqual:association[@"account"]]||![p[@"deviceId"]isEqual:association[@"deviceId"]]||(hasPublisher&&(!SourceProofU64(key[@"revision"],counter,true)||!SourceProofHex(key[@"publicSHA256"])||![key[@"keyRole"]isEqual:@"ide-artifact-publisher"]||!SourceProofBoolean(key[@"revoked"],false)||![key[@"account"]isEqual:p[@"account"]]||![key[@"projectId"]isEqual:a[@"projectId"]]))){[self fail:@"IDE_PROJECT_BINDING_REQUIRED" error:error];return nil;}
   for(NSString*k in @[@"read",@"publish",@"runtime"])if(!SourceProofBoolean(a[k],true)&&!SourceProofBoolean(a[k],false)){[self fail:@"IDE_PROJECT_PERMISSION_TYPE" error:error];return nil;}
   if(![a[@"read"]boolValue]&&![a[@"publish"]boolValue]&&![a[@"runtime"]boolValue]){[self fail:@"IDE_PROJECT_ACCESS_DENIED" error:error];return nil;}
   NSURLComponents*origin=[NSURLComponents componentsWithString:a[@"runtimeOrigin"]];if(![a[@"runtimeOrigin"]isKindOfClass:NSString.class]||([a[@"runtimeOrigin"]length]&&(![origin.scheme isEqual:@"https"]||!origin.host.length||origin.user||origin.password||origin.path.length||origin.query||origin.fragment))){[self fail:@"IDE_PROJECT_RUNTIME_ORIGIN_INVALID" error:error];return nil;}
   NSData*publisher=hasPublisher?SourceProjectBase64(key[@"publicOriginal"]):[NSData data];NSDictionary*r13=hasPublisher?SourceProjectR13(publisher):nil;
   if(hasPublisher&&(!r13||![SourceSHA(publisher)isEqual:key[@"publicSHA256"]]||![r13[@"account"]isEqual:key[@"account"]]||![r13[@"projectId"]isEqual:key[@"projectId"]]||![r13[@"publisherId"]isEqual:key[@"publisherId"]]||![r13[@"networkId"]isEqual:root[@"networkId"]]||![r13[@"subjectOwner"]isEqual:current[@"subjectOwner"]])){[self fail:@"IDE_PROJECT_ORIGINAL_R13_REQUIRED" error:error];return nil;}
   uint64_t pe=0,ae=0,ke=UINT64_MAX;if(!SourceProjectMS(p[@"expiresMS"],pe)||!SourceProjectMS(a[@"expiresMS"],ae)||(hasPublisher&&!SourceProjectMS(key[@"expiresMS"],ke))){[self fail:@"IDE_PROJECT_EXPIRY_INVALID" error:error];return nil;}
   const uint64_t expires=std::min(std::min(pe,ae),std::min(ke,_cachedCurrentExpiresMS)),seq=_sequence,floor=_floor,cache=_cachedCurrentExpiresMS;const auto*policy=_policy;NSData*originalCurrent=[_currentOriginal copy];
   NSData*raw=[NSJSONSerialization dataWithJSONObject:authority options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil],*whole=[NSJSONSerialization dataWithJSONObject:_selection options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil],*rootOriginal=[_rootOriginal copy];NSString*head=[_headDigest copy];if(!raw||raw.length>32768||!whole||whole.length>65536){[self fail:@"IDE_PROJECT_ORIGINAL_CAPACITY" error:error];return nil;}
   uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000);if(before<_timeFloor||before>=expires){[self fail:@"IDE_PROJECT_CURRENT_EXPIRED" error:error];return nil;}_timeFloor=before;
   NSError*actual=nil;if(![self heldCurrent:&actual]){if(!_firstCause&&actual)_firstCause=actual;[self fail:@"IDE_PROJECT_SOURCE_CURRENT_UNKNOWN" error:error];return nil;}
   NSDictionary*copied=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];NSDictionary*result=@{@"principal":copied[@"principal"],@"project":copied[@"project"],@"publisher":copied[@"publisher"],@"publisherOriginal":publisher,@"endpoint":endpoint,@"spki":spki,@"expiresMS":@(expires)};
   actual=nil;if(![self heldCurrent:&actual]){if(!_firstCause&&actual)_firstCause=actual;[self fail:@"IDE_PROJECT_SOURCE_POST_CURRENT_UNKNOWN" error:error];return nil;}
   NSData*post=[NSJSONSerialization dataWithJSONObject:_selection options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000);
   if(_invalid||_retired||!_ideProjectConsumer||_policy!=policy||_sequence!=seq||_floor!=floor||_cachedCurrentExpiresMS!=cache||![_headDigest isEqual:head]||![_rootOriginal isEqual:rootOriginal]||![_currentOriginal isEqual:originalCurrent]||![whole isEqual:post]||policy->projectAuthorityEndpoint!=endpoint.UTF8String||policy->projectAuthoritySPKI!=spki.UTF8String||after<_timeFloor||after>=expires){[self fail:@"IDE_PROJECT_POST_CURRENT_REFUSED" error:error];return nil;}_timeFloor=after;return result;
  }@catch(id){[self fail:@"IDE_PROJECT_CURRENT_UNKNOWN" error:error];return nil;}@finally{_projectLocalEntered=NO;}
 }
}
- (NSDictionary*)copyOriginalIDEProjectSelectionLocal:(NSError**)error {
 @synchronized(self){
 @try{
  NSDictionary*first=[self copyOriginalIDEProjectAuthorityLocal:error];if(!first)return nil;
  NSDictionary*mapping=_selection[@"projectSelection"];
  if(![mapping isKindOfClass:NSDictionary.class]){[self fail:@"IDE_PROJECT_WORKSPACE_SELECTION_NOT_SUPPLIED" error:error];return nil;}
  NSData*raw=[NSJSONSerialization dataWithJSONObject:mapping options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
  if(!raw||raw.length>16384){[self fail:@"IDE_PROJECT_WORKSPACE_SELECTION_CAPACITY" error:error];return nil;}
  NSDictionary*copy=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
  NSDictionary*last=[self copyOriginalIDEProjectAuthorityLocal:error];NSData*post=[NSJSONSerialization dataWithJSONObject:_selection[@"projectSelection"] options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
  if(!last||![first isEqual:last]||![raw isEqual:post]){[self fail:@"IDE_PROJECT_WORKSPACE_SELECTION_POST_CURRENT_CHANGED" error:error];return nil;}
  return @{@"authority":first,@"selection":copy};
 }@catch(id){[self fail:@"IDE_PROJECT_WORKSPACE_SELECTION_UNKNOWN" error:error];return nil;}
 }
}
- (NSDictionary*)copyOriginalIDECurrentProject:(NSString*)projectID error:(NSError**)error {
 @synchronized(self){NSDictionary*first=[self copyOriginalIDEProjectAuthorityLocal:error];if(!first)return nil;if(!SourceProjectText(projectID)||![first[@"project"][@"projectId"]isEqual:projectID]){[self fail:@"IDE_PROJECT_REQUEST_MISMATCH" error:error];return nil;}
  NSDictionary*last=[self copyOriginalIDEProjectAuthorityLocal:error];if(!last||![first isEqual:last]){[self fail:@"IDE_PROJECT_REQUEST_POST_CURRENT_REFUSED" error:error];return nil;}return @{@"principal":first[@"principal"],@"project":first[@"project"],@"expiresMS":first[@"expiresMS"]};}
}
- (NSDictionary*)copyOriginalIDECurrentPublisher:(NSString*)publisherID forProject:(NSString*)projectID error:(NSError**)error {
 @synchronized(self){NSDictionary*first=[self copyOriginalIDEProjectAuthorityLocal:error];if(!first)return nil;if(![first[@"publisher"]isKindOfClass:NSDictionary.class]||!SourceProjectText(publisherID)||!SourceProjectText(projectID)||![first[@"project"][@"projectId"]isEqual:projectID]||![first[@"publisher"][@"publisherId"]isEqual:publisherID]||![first[@"project"][@"publish"]boolValue]){[self fail:@"IDE_PROJECT_PUBLISHER_REQUEST_DENIED" error:error];return nil;}
  NSDictionary*last=[self copyOriginalIDEProjectAuthorityLocal:error];if(!last||![first isEqual:last]){[self fail:@"IDE_PROJECT_PUBLISHER_POST_CURRENT_REFUSED" error:error];return nil;}return @{@"principal":first[@"principal"],@"project":first[@"project"],@"publisher":first[@"publisher"],@"publisherOriginal":first[@"publisherOriginal"],@"expiresMS":first[@"expiresMS"]};}
}
