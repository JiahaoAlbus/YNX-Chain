+ (instancetype)acquireOriginalAITaskActionV6ClientSource:(NSError**)error {
 YNXAuthIdentitySourceAuthority*s=[self new];s->_aiTaskClient=YES;s->_ideRegistry=YES;
 s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 try{@try{NSError*e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalAITaskActionV6ClientProfile:&e];
  if(e||!s->_custody){[s fail:e.localizedDescription?:@"AI_V6_CLIENT_PROFILE_NOT_SUPPLIED" error:error];return s;}
  s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];
  id source=SourceOriginalBodyHint(s->_profileOriginal)[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto&p:ynx::ai::client::original_releases())if(p.source.sourceId==[source UTF8String]){
   if(s->_policy){[s fail:@"AI_V6_CLIENT_DUPLICATE_RELEASE" error:error];return s;}s->_aiTaskPolicy=&p;s->_policy=&p.source;
  }
  if(e||!s->_aiTaskPolicy||!YNXOriginalAITaskClientPolicyDATA(*s->_aiTaskPolicy)){
   [s fail:@"AI_V6_CLIENT_INDEPENDENT_RELEASE_NOT_SUPPLIED" error:error];return s;
  }
  NSString*directory=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];
  if(directory)s->_rootOriginal=[s holdPublic:[directory stringByAppendingPathComponent:@"root.original"] maximum:16384 image:NO digest:s->_policy->rootDigest error:&e];
  if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[directory stringByAppendingPathComponent:@"enrollment.original"] maximum:393216 image:NO digest:s->_policy->enrollmentDigest error:&e];
  if(e||!s->_enrollmentOriginal||![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]||
   ![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||
   ![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||
   ![s assertOriginalAITaskActionV6ClientCurrent:&e]){[s fail:e.localizedDescription?:@"AI_V6_CLIENT_SOURCE_NOT_CURRENT" error:error];return s;}
  return s;
 }@catch(NSException*){[s fail:@"AI_V6_CLIENT_CAPTURE_EXCEPTION" error:error];return s;}}
 catch(...){[s fail:@"AI_V6_CLIENT_CAPTURE_CPP_EXCEPTION" error:error];return s;}
}
- (BOOL)assertOriginalAITaskActionV6ClientCurrent:(NSError**)error {
 @synchronized(self){
  if([self class]!=YNXAuthIdentitySourceAuthority.class||!_aiTaskClient||!_aiTaskPolicy||_policy!=&_aiTaskPolicy->source||_policy->purpose!="ai-native-task-action-source-v6")return[self fail:@"AI_V6_CLIENT_DEDICATED_SOURCE_REQUIRED" error:error];
  if(![self assertAuthenticatedNativePurpose:error])return NO;
  NSDictionary*s=_selection[@"aiNativeTaskActionV6"],*agent=[s isKindOfClass:NSDictionary.class]?s[@"agentRegistration"]:nil;
  NSDictionary*own=s[@"imagePins"][@"implementingImage"];if(![own isKindOfClass:NSDictionary.class]||![own[@"path"]isKindOfClass:NSString.class]||![own[@"sha256"]isKindOfClass:NSString.class]||![own[@"bytes"]isKindOfClass:NSNumber.class])return[self fail:@"AI_V6_CLIENT_IMPLEMENTING_IMAGE_REQUIRED" error:error];
  if(!_aiTaskOwnImageOriginal){std::string digest=[own[@"sha256"]UTF8String];_aiTaskOwnImageOriginal=[self holdPublic:own[@"path"] maximum:268435456 image:YES digest:digest error:error];if(!_aiTaskOwnImageOriginal||_aiTaskOwnImageOriginal.length!=[own[@"bytes"]unsignedLongLongValue])return NO;}
  NSDictionary*module=s[@"imagePins"][@"privateModule"];
  if(![module isKindOfClass:NSDictionary.class]||![module[@"path"]isEqual:[NSString stringWithUTF8String:_aiTaskPolicy->private_kernel_path.c_str()]]||![module[@"sha256"]isEqual:[NSString stringWithUTF8String:_aiTaskPolicy->private_kernel_sha256.c_str()]]||[module[@"bytes"]unsignedLongLongValue]!=_aiTaskPolicy->private_kernel_bytes||_aiTaskPolicy->private_kernel_bytes==0||_aiTaskPolicy->private_kernel_bytes>262144)return[self fail:@"AI_V6_CLIENT_FIXED_KERNEL_NOT_SUPPLIED" error:error];
  if(!_aiTaskKernelOriginal){_aiTaskKernelOriginal=[self holdPublic:module[@"path"] maximum:262144 image:YES digest:_aiTaskPolicy->private_kernel_sha256 error:error];if(!_aiTaskKernelOriginal||_aiTaskKernelOriginal.length!=_aiTaskPolicy->private_kernel_bytes)return NO;}
  if(_aiTaskPolicy->node_loader_path.empty()||_aiTaskPolicy->node_loader_bytes==0||_aiTaskPolicy->node_loader_bytes>262144)return[self fail:@"AI_V6_CLIENT_NODE_LOADER_NOT_SUPPLIED" error:error];
  NSString*loader=[NSString stringWithUTF8String:_aiTaskPolicy->node_loader_path.c_str()];if(![loader hasSuffix:@"/packages/wallet-auth/src/original-ai-task-action-v6-node-loader-private.js"])return[self fail:@"AI_V6_CLIENT_FIXED_NODE_LOADER_REQUIRED" error:error];
  if(!_aiTaskNodeLoaderOriginal){_aiTaskNodeLoaderOriginal=[self holdPublic:loader maximum:262144 image:YES digest:_aiTaskPolicy->node_loader_sha256 error:error];if(!_aiTaskNodeLoaderOriginal||_aiTaskNodeLoaderOriginal.length!=_aiTaskPolicy->node_loader_bytes)return NO;}
  if(!_aiTaskClosurePinned){
   NSString*runtimeDirectory=[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]stringByDeletingLastPathComponent],*sdkRoot=runtimeDirectory.stringByDeletingLastPathComponent;
   NSData*mf=[self holdPublic:[runtimeDirectory stringByAppendingPathComponent:@"original-ide-auth-runtime-manifest.json"] maximum:1048576 image:YES digest:_policy->proofRuntimeManifestDigest error:error];
   NSDictionary*manifest=SourceProofDictionary(mf,1048576);NSArray*files=manifest[@"files"];if(![files isKindOfClass:NSArray.class])return[self fail:@"AI_V6_FULL_RUNTIME_CLOSURE_REQUIRED" error:error];
   NSMutableDictionary*byPath=[NSMutableDictionary dictionary];for(NSDictionary*f in files)if([f[@"path"]isKindOfClass:NSString.class])byPath[[sdkRoot stringByAppendingPathComponent:f[@"path"]]]=f;
   NSString*kernelDirectory=[module[@"path"]stringByDeletingLastPathComponent];
   for(NSString*relative in @[@"task-action-client-normal-v6-private.mjs",@"task-action-client-v6-private.mjs",@"task-action-client-cleanup-v6-private.mjs",@"task-action-client-once-v6-private.mjs",@"task-action-agent-registration-v6-private.mjs",@"task-agent-registration-current-v6-private.mjs",@"task-action-root-current-v6-private.mjs",@"task-action-protected-image-private.mjs",@"task-action-sqlite-bootstrap-private.mjs",@"task-action-once-v6-private.mjs",@"task-action-decisions-v6-private.mjs",@"inherited/canonical.js",@"inherited/product-pair-session-v4-store.js",@"inherited/product-pair-session-v4-schema.sql",@"inherited/original-bound-grant-policy.js",@"inherited/original-identity-challenge-ledger.js",@"inherited/original-task-grant-ledger.js"])
    if(!byPath[[kernelDirectory stringByAppendingPathComponent:relative]])return[self fail:@"AI_V6_PRIVATE_IMPORT_NOT_IN_REGISTERED_CLOSURE" error:error];
   NSDictionary*kernelPin=byPath[module[@"path"]],*loaderPin=byPath[loader],*imageMF=s[@"imagePins"][@"manifest"],*imageMFPin=byPath[imageMF[@"path"]];
   if(![kernelPin[@"sha256"]isEqual:module[@"sha256"]]||![kernelPin[@"bytes"]isEqual:module[@"bytes"]]||![loaderPin[@"sha256"]isEqual:[NSString stringWithUTF8String:_aiTaskPolicy->node_loader_sha256.c_str()]]||[loaderPin[@"bytes"]unsignedLongLongValue]!=_aiTaskPolicy->node_loader_bytes||![imageMFPin[@"sha256"]isEqual:imageMF[@"sha256"]]||![imageMFPin[@"bytes"]isEqual:imageMF[@"bytes"]])return[self fail:@"AI_V6_FIXED_MODULE_MANIFEST_BINDING" error:error];
   _aiTaskClosurePinned=YES;
  }
  if(![s[@"role"]isEqual:@"client"]||![agent isKindOfClass:NSDictionary.class]||!YNXAITaskExact(agent,@[@"version",@"purpose",@"networkId",@"canonicalOwner",@"registrationId",@"registrationDigest",@"keyEpoch",@"pkA",@"pkB",@"sourceId",@"instanceId",@"resourceKey",@"protectedResourceRef",@"registeredAtMs",@"expiresAtMs"]))return[self fail:@"AI_V6_CLIENT_AGENT_EXPECTED_REQUIRED" error:error];
  if(![agent[@"protectedResourceRef"]isEqual:[NSString stringWithUTF8String:_aiTaskPolicy->agent_resource_ref.c_str()]]||![agent[@"registrationDigest"]isEqual:[NSString stringWithUTF8String:_aiTaskPolicy->agent_original_sha256.c_str()]])return[self fail:@"AI_V6_CLIENT_AGENT_RELEASE_BINDING" error:error];
  if(!_aiTaskAgentOriginal){NSString*p=[[_custody copyOriginalResourceDirectory:error]stringByAppendingPathComponent:@"original-auth-identity/agent-registration.original"];if(!p)return NO;_aiTaskAgentOriginal=[self holdPublic:p maximum:16384 image:NO digest:_aiTaskPolicy->agent_original_sha256 error:error];}
  NSDictionary*r=SourceProofDictionary(_aiTaskAgentOriginal,16384);
  if(!r||!YNXAITaskExact(r,@[@"version",@"purpose",@"networkId",@"canonicalOwner",@"registrationId",@"keyEpoch",@"pkA",@"pkB",@"sourceId",@"instanceId",@"resourceKey",@"protectedResourceRef",@"registeredAtMs",@"expiresAtMs",@"state",@"rootDigest"])||![r[@"state"]isEqual:@"active"]||![r[@"rootDigest"]isEqual:SourceSHA(_rootOriginal)]||![SourceSHA(_aiTaskAgentOriginal)isEqual:agent[@"registrationDigest"]])return[self fail:@"AI_V6_CLIENT_AGENT_ORIGINAL_REQUIRED" error:error];
  NSData*canonical=[NSJSONSerialization dataWithJSONObject:r options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];if(![canonical isEqual:_aiTaskAgentOriginal])return[self fail:@"AI_V6_CLIENT_AGENT_CANONICAL_ORIGINAL_REQUIRED" error:error];
  for(NSString*k in agent)if(![k isEqual:@"registrationDigest"]&&![r[k]isEqual:agent[k]])return[self fail:@"AI_V6_CLIENT_AGENT_ORIGINAL_BINDING" error:error];
  for(NSString*k in @[@"sourceId",@"instanceId",@"resourceKey"])if(![agent[k]isEqual:s[@"currentSelector"][k]])return[self fail:@"AI_V6_CLIENT_AGENT_SELECTOR_BINDING" error:error];
  if(![agent[@"purpose"]isEqual:@"PRODUCT-SESSION-AI-TASK-ACTION"]||![self heldCurrent:error])return NO;
  return YES;
 }
}
- (NSDictionary*)copyOriginalAITaskActionV6ClientContext:(NSError**)error {
 @synchronized(self){if(![self assertOriginalAITaskActionV6ClientCurrent:error])return nil;
  NSDictionary*s=_selection[@"aiNativeTaskActionV6"],*profile=SourceOriginalBodyHint(_profileOriginal);
  if(![s isKindOfClass:NSDictionary.class]||!_currentOriginal||!_aiTaskAgentOriginal)return nil;
  NSDictionary*out=@{@"scope":s,@"rootOriginal":[_rootOriginal copy],@"enrollmentOriginal":[_enrollmentOriginal copy],@"profileOriginal":[_profileOriginal copy],@"currentOriginal":[_currentOriginal copy],@"agentRegistrationOriginal":[_aiTaskAgentOriginal copy],@"nodeLoaderModule":@{@"path":[NSString stringWithUTF8String:_aiTaskPolicy->node_loader_path.c_str()],@"sha256":[NSString stringWithUTF8String:_aiTaskPolicy->node_loader_sha256.c_str()],@"bytes":@(_aiTaskPolicy->node_loader_bytes)},@"subjectOwner":profile[@"subjectOwner"],@"expiresAtMs":@(_cachedCurrentExpiresMS)};
  if(![self heldCurrent:error])return nil;return out;
 }
}
- (NSDictionary*)retainOriginalAITaskActionV6ClientParent:(NSError**)error {
 @synchronized(self){NSDictionary*r=[self copyOriginalAITaskActionV6ClientContext:error];if(!r)return nil;if(_aiTaskLoans==UINT_MAX)return[self fail:@"AI_V6_CLIENT_CHILD_OVERFLOW" error:error],nil;++_aiTaskLoans;return r;}
}
- (void)releaseOriginalAITaskActionV6ClientParent {
 @synchronized(self){if(_aiTaskLoans)--_aiTaskLoans;else[self fail:@"AI_V6_CLIENT_CHILD_UNDERFLOW" error:nil];}
}
- (BOOL)closeOriginalAITaskActionV6ClientSource:(NSError**)error {
 @synchronized(self){[self retire];
  auto refuse=[&](NSString*code){if(!_aiTaskCloseCause)_aiTaskCloseCause=[NSError errorWithDomain:@"YNXOriginalAITaskClientSource" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=_aiTaskCloseCause;return NO;};
  if(_aiTaskLoans)return refuse(@"AI_V6_CLIENT_CHILDREN_RETAINED");
  if(_closeSelected){if(error)*error=_aiTaskCloseCause?:_cleanupCause;return _cleanupComplete;}
  if(![self join:error])return NO;_closeSelected=YES;
  if(_helperClient&&![_helperClient close:error])return refuse(@"AI_V6_CLIENT_HELPER_CLOSE_UNKNOWN");
  if(_publicInstallation&&!_publicInstallation->close())return refuse(@"AI_V6_CLIENT_PUBLIC_CLOSE_UNKNOWN");
  for(auto it=_files.rbegin();it!=_files.rend();++it){if(it->selected){if(!it->complete)return refuse(@"AI_V6_CLIENT_FILE_CLOSE_UNKNOWN");continue;}it->selected=true;it->complete=::close(it->fd)==0;if(!it->complete)return refuse(@"AI_V6_CLIENT_FILE_CLOSE_UNKNOWN");}
  for(NSUInteger n=_pipeHandles.count;n>0;--n){NSUInteger i=n-1;if(_pipeStates[i].intValue==1)continue;if(_pipeStates[i].intValue!=0)return refuse(@"AI_V6_CLIENT_PIPE_CLOSE_UNKNOWN");_pipeStates[i]=@2;NSError*e=nil;if(![_pipeHandles[i]closeAndReturnError:&e]||e)return refuse(@"AI_V6_CLIENT_PIPE_CLOSE_UNKNOWN");_pipeStates[i]=@1;}
  if(_custody&&![_custody closeOriginalIDERegistryChildFirst:error])return refuse(@"AI_V6_CLIENT_CUSTODY_CLOSE_UNKNOWN");_cleanupComplete=YES;if(error)*error=_aiTaskCloseCause;return YES;
 }
}
