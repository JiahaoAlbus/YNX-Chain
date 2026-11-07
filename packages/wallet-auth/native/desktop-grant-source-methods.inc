// Included ONLY inside original YNXAuthIdentitySourceAuthority implementation.
+ (instancetype)acquireOriginalDesktopTaskGrantAuthoritySource:(NSError**)error {
 YNXAuthIdentitySourceAuthority*s=[self new];s->_desktopTaskGrant=YES;s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 try{@try{
  NSError*e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalDesktopTaskGrantAuthorityProfile:&e];
  if(e||!s->_custody){[s fail:e.localizedDescription?:@"DESKTOP_GRANT_ORIGINAL_PROFILE_NOT_SUPPLIED" error:error];return s;}
  s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];
  id source=SourceOriginalBodyHint(s->_profileOriginal)[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto&p:ynx::auth::desktopgrant::original_desktop_grant_releases())if(p.source.sourceId==[source UTF8String]){if(s->_policy){[s fail:@"DESKTOP_GRANT_DUPLICATE_RELEASE" error:error];return s;}s->_desktopGrantPolicy=&p;s->_policy=&p.source;}
  if(e||!s->_policy||s->_policy->purpose!=ynx::auth::desktopgrant::purpose||s->_desktopGrantPolicy->uid!=getuid()||s->_desktopGrantPolicy->product_id!="wallet"||s->_desktopGrantPolicy->platform!="macos"||s->_desktopGrantPolicy->application_id.empty()){[s fail:@"DESKTOP_GRANT_INDEPENDENT_RELEASE_NOT_SUPPLIED" error:error];return s;}
  NSString*root=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];
  if(root)s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:&e];
  if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:&e];
  if(e||!s->_enrollmentOriginal||![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||![s assertOriginalDesktopTaskGrantAuthorityCurrent:&e]){[s fail:e.localizedDescription?:@"DESKTOP_GRANT_ORIGINAL_SOURCE_NOT_CURRENT" error:error];return s;}
  return s;
 }@catch(NSException*){[s fail:@"DESKTOP_GRANT_SOURCE_CAPTURE_EXCEPTION" error:error];return s;}}catch(...){[s fail:@"DESKTOP_GRANT_SOURCE_CAPTURE_CPP_EXCEPTION" error:error];return s;}
}
- (BOOL)assertOriginalDesktopTaskGrantAuthorityCurrent:(NSError**)error {
 @synchronized(self){if(!_desktopTaskGrant||!_desktopGrantPolicy||!_policy||_policy->purpose!=ynx::auth::desktopgrant::purpose)return [self fail:@"DESKTOP_GRANT_DEDICATED_SOURCE_REQUIRED" error:error];return [self assertAuthenticatedNativePurpose:error];}
}
- (NSDictionary*)copyOriginalDesktopTaskGrantAuthorityContext:(NSError**)error {
 @synchronized(self){if(![self assertOriginalDesktopTaskGrantAuthorityCurrent:error])return nil;
  NSDictionary*scope=_selection[@"desktopTaskGrantAuthorityV1"],*profile=SourceOriginalBodyHint(_profileOriginal);
  if(![scope isKindOfClass:NSDictionary.class]||![profile[@"sourceId"]isKindOfClass:NSString.class]||![profile[@"instanceId"]isKindOfClass:NSString.class])return [self fail:@"DESKTOP_GRANT_VERIFIED_SCOPE_REQUIRED" error:error],nil;
  NSDictionary*copy=@{@"scope":[scope copy],@"sourceId":profile[@"sourceId"],@"instanceId":profile[@"instanceId"],@"expiresAtMs":@(_cachedCurrentExpiresMS),@"profileDigest":SourceSHA(_profileOriginal)};
  if(![self heldCurrent:error]||_cachedCurrentExpiresMS<=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0))return nil;return copy;
 }
}
- (NSDictionary*)readDesktopGrantOriginal:(const ynx::auth::desktopgrant::PublicOriginalRef&)ref error:(NSError**)error {
 if(![self assertOriginalDesktopTaskGrantAuthorityCurrent:error]||ref.path.empty()||!ref.bytes||ref.bytes>32768)return nil;
 NSData*raw=[self holdPublic:[NSString stringWithUTF8String:ref.path.c_str()] maximum:32768 image:NO digest:ref.sha256 error:error];
 if(!raw||raw.length!=ref.bytes)return [self fail:@"DESKTOP_GRANT_PUBLIC_ORIGINAL_BOUND" error:error],nil;
 NSDictionary*value=SourceProofDictionary(raw,32768);if(!value||![self heldCurrent:error])return nil;return value;
}
- (NSDictionary*)copyOriginalDesktopTaskGrantCallerRegistration:(NSError**)error {@synchronized(self){if(!_desktopGrantPolicy)return nil;return [self readDesktopGrantOriginal:_desktopGrantPolicy->caller_scope error:error];}}
- (NSDictionary*)copyOriginalDesktopTaskGrantLINKRegistration:(NSError**)error {@synchronized(self){if(!_desktopGrantPolicy)return nil;return [self readDesktopGrantOriginal:_desktopGrantPolicy->link_registration error:error];}}
- (NSString*)copyOriginalDesktopTaskGrantBootstrapModule:(NSError**)error {
 @synchronized(self){if(![self assertOriginalDesktopTaskGrantAuthorityCurrent:error]||![self pinOriginalIDEProofRuntime:error])return nil;
  NSString*package=[[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]stringByDeletingLastPathComponent]stringByDeletingLastPathComponent];
  NSString*module=[package stringByAppendingPathComponent:@"src/desktop-grant-native-backend-private.mjs"];
  BOOL held=NO;for(const auto&f:_files)if(!f.selected&&[f.path isEqual:module])held=YES;
  if(!held||![self heldCurrent:error])return [self fail:@"DESKTOP_GRANT_FIXED_BOOTSTRAP_CLOSURE_REQUIRED" error:error],nil;return module;
 }
}
- (NSString*)copyOriginalDesktopTaskGrantLINKModule:(NSError**)error {
 @synchronized(self){if(![self assertOriginalDesktopTaskGrantAuthorityCurrent:error])return nil;
  if(!_desktopGrantPolicy||_desktopGrantPolicy->link_module_path.empty()||_desktopGrantPolicy->link_code_closure.empty()||_desktopGrantPolicy->link_code_closure.size()>256)return [self fail:@"DESKTOP_GRANT_LINK_CLOSURE_NOT_SUPPLIED" error:error],nil;
  BOOL moduleHeld=NO,addonHeld=NO;uint64_t total=0;
  for(const auto&f:_desktopGrantPolicy->link_code_closure){if(!f.bytes||f.bytes>16777216||total+f.bytes>67108864)return [self fail:@"DESKTOP_GRANT_LINK_CLOSURE_BOUND" error:error],nil;total+=f.bytes;
   NSData*raw=[self holdPublic:[NSString stringWithUTF8String:f.path.c_str()] maximum:16777216 image:NO digest:f.sha256 error:error];if(!raw||raw.length!=f.bytes)return nil;
   if(f.path==_desktopGrantPolicy->link_module_path)moduleHeld=YES;if(f.path.size()>12&&f.path.substr(f.path.size()-12)=="/caller.node")addonHeld=YES;
  }
  if(!moduleHeld||!addonHeld||![self heldCurrent:error])return [self fail:@"DESKTOP_GRANT_LINK_COMPLETE_CODE_REQUIRED" error:error],nil;
  return [NSString stringWithUTF8String:_desktopGrantPolicy->link_module_path.c_str()];
 }
}
- (BOOL)holdOriginalDesktopTaskGrantNativeAddress:(const void*)address error:(NSError**)error {
 @synchronized(self){if(![self assertOriginalDesktopTaskGrantAuthorityCurrent:error]||!address||!_desktopGrantPolicy)return NO;
  Dl_info own={},source={};static const unsigned char desktopGrantImageMarker=0;
  char canonical[PATH_MAX];if(!dladdr(address,&own)||!dladdr(&desktopGrantImageMarker,&source)||!own.dli_fbase||own.dli_fbase!=source.dli_fbase||!own.dli_fname||!realpath(own.dli_fname,canonical)||_desktopGrantPolicy->native_image_path!=canonical)return [self fail:@"DESKTOP_GRANT_ACTUAL_ADDON_IMAGE_REQUIRED" error:error];
  NSDictionary*image=_selection[@"desktopTaskGrantAuthorityV1"][@"nativeBackend"];
  if(![image isKindOfClass:NSDictionary.class]||![image[@"bytes"]isKindOfClass:NSNumber.class]||![image[@"sha256"]isKindOfClass:NSString.class])return [self fail:@"DESKTOP_GRANT_POSTBUILD_IMAGE_ORIGINAL_REQUIRED" error:error];
  NSData*raw=[self holdPublic:[NSString stringWithUTF8String:canonical] maximum:16777216 image:YES digest:std::string([image[@"sha256"]UTF8String]?:"") error:error];
  return raw&&raw.length==[image[@"bytes"]unsignedLongLongValue]&&[self heldCurrent:error];
 }
}
- (BOOL)closeOriginalDesktopTaskGrantAuthority:(NSError**)error {
 @synchronized(self){[self retire];if(_closeSelected){if(error)*error=_cleanupCause;return _cleanupComplete;}if(![self join:error])return NO;_closeSelected=YES;
  if(_publicInstallation&&!_publicInstallation->close())return [self fail:@"DESKTOP_GRANT_PUBLIC_CHILD_CLOSE_UNKNOWN" error:error];
  for(auto it=_files.rbegin();it!=_files.rend();++it){if(it->selected){if(!it->complete){if(error)*error=_cleanupCause;return NO;}continue;}it->selected=true;it->complete=::close(it->fd)==0;if(!it->complete){_cleanupCause=[NSError errorWithDomain:@"YNXDesktopGrant" code:1 userInfo:@{NSLocalizedDescriptionKey:@"DESKTOP_GRANT_FILE_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;}}
  for(NSUInteger n=_pipeHandles.count;n>0;--n){NSUInteger i=n-1;if(_pipeStates[i].intValue==1)continue;if(_pipeStates[i].intValue!=0){if(error)*error=_cleanupCause;return NO;}_pipeStates[i]=@2;NSError*e=nil;if(![_pipeHandles[i]closeAndReturnError:&e]||e){_cleanupCause=e?:[NSError errorWithDomain:@"YNXDesktopGrant" code:1 userInfo:@{NSLocalizedDescriptionKey:@"DESKTOP_GRANT_PIPE_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;}_pipeStates[i]=@1;}
  NSError*e=nil;if(_custody&&![_custody close:&e]){_cleanupCause=e;if(error)*error=e;return NO;}_cleanupComplete=YES;return YES;
 }
}
