+ (instancetype)acquireOriginalBrowserSelectedPagesSource:(NSError**)error {
 YNXAuthIdentitySourceAuthority*s=[self new];s->_browserPages=YES;s->_ideRegistry=YES;
 s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 try{@try{
  NSError*e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalBrowserSelectedPagesProfile:&e];
  if(e||!s->_custody){[s fail:e.localizedDescription?:@"BROWSER_PAGE_ORIGINAL_PROFILE_NOT_SUPPLIED" error:error];return s;}
  s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];
  id source=SourceOriginalBodyHint(s->_profileOriginal)[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto&p:ynx::browser::page::original_browser_page_releases())
   if(p.source.sourceId==[source UTF8String]){
    if(s->_policy){[s fail:@"BROWSER_PAGE_DUPLICATE_RELEASE" error:error];return s;}
    s->_browserPagePolicy=&p;s->_policy=&p.source;
   }
  if(e||!s->_policy||!s->_browserPagePolicy||s->_policy->purpose!="browser-selected-pages-source-v1"||
     s->_browserPagePolicy->uid!=getuid()||s->_browserPagePolicy->application_id!="com.ynxweb4.browser.macos"||
     s->_browserPagePolicy->product_id!="browser"||s->_browserPagePolicy->platform!="macos"){
   [s fail:@"BROWSER_PAGE_INDEPENDENT_RELEASE_NOT_SUPPLIED" error:error];return s;
  }
  NSString*root=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];
  if(root)s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"]
   maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:&e];
  if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"]
   maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:&e];
  if(e||!s->_enrollmentOriginal||![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]||
     ![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||
     ![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||
     ![s assertOriginalBrowserSelectedPagesCurrent:&e]){
   [s fail:e.localizedDescription?:@"BROWSER_PAGE_ORIGINAL_SOURCE_NOT_CURRENT" error:error];return s;
  }
  return s;
 }@catch(NSException*){[s fail:@"BROWSER_PAGE_SOURCE_CAPTURE_EXCEPTION" error:error];return s;}}
 catch(...){[s fail:@"BROWSER_PAGE_SOURCE_CAPTURE_CPP_EXCEPTION" error:error];return s;}
}
- (BOOL)assertOriginalBrowserSelectedPagesCurrent:(NSError**)error {
 @synchronized(self){
  if([self class]!=YNXAuthIdentitySourceAuthority.class||!_browserPages||!_browserPagePolicy||
     _policy!=&_browserPagePolicy->source||_policy->purpose!="browser-selected-pages-source-v1")
   return [self fail:@"BROWSER_PAGE_DEDICATED_SOURCE_REQUIRED" error:error];
  // Actual original Source-v2 full closure/N1/dual signatures/current/nonce,
  // registration/revocation/role distinction run in the SAME existing owner.
  return [self assertAuthenticatedNativePurpose:error];
 }
}
- (NSDictionary*)copyOriginalBrowserSelectedPagesContext:(NSError**)error {
 @synchronized(self){
  if(![self assertOriginalBrowserSelectedPagesCurrent:error])return nil;
  NSDictionary*profile=SourceOriginalBodyHint(_profileOriginal),*scope=_selection[@"browserSelectedPagesV1"];
  id issued=SourceOriginalBodyHint(_currentOriginal)[@"issuedAtMs"];
  if(![scope isKindOfClass:NSDictionary.class]||![profile[@"subjectOwner"]isKindOfClass:NSString.class]||
     ![profile[@"instanceId"]isKindOfClass:NSString.class]||!issued||
     ![scope[@"currentSelector"][@"sourceId"]isEqual:[NSString stringWithUTF8String:_policy->sourceId.c_str()]]||
     ![scope[@"currentSelector"][@"instanceId"]isEqual:profile[@"instanceId"]])
   return [self fail:@"BROWSER_PAGE_AUTHENTICATED_SCOPE_REQUIRED" error:error],nil;
  NSData*raw=[NSJSONSerialization dataWithJSONObject:scope options:NSJSONWritingSortedKeys error:nil];
  NSDictionary*copy=raw.length&&raw.length<=49152?[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil]:nil;
  if(!copy||![copy isEqual:scope]||![self heldCurrent:error]||
     _cachedCurrentExpiresMS<=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0))return nil;
  return @{@"scope":copy,@"sourceId":[NSString stringWithUTF8String:_policy->sourceId.c_str()],
   @"instanceId":profile[@"instanceId"],@"subjectOwner":profile[@"subjectOwner"],
   @"profileDigest":SourceSHA(_profileOriginal),@"issuedAtMs":issued,@"expiresAtMs":@(_cachedCurrentExpiresMS)};
 }
}
- (NSDictionary*)retainOriginalBrowserSelectedPagesParent:(NSError**)error {
 @synchronized(self){NSDictionary*c=[self copyOriginalBrowserSelectedPagesContext:error];
  if(!c)return nil;if(_browserPagesLoans==UINT_MAX)return [self fail:@"BROWSER_PAGE_CHILD_COUNT_OVERFLOW" error:error],nil;
  ++_browserPagesLoans;return c;
 }
}
- (void)releaseOriginalBrowserSelectedPagesParent {
 @synchronized(self){if(_browserPagesLoans)--_browserPagesLoans;else [self fail:@"BROWSER_PAGE_CHILD_COUNT_UNDERFLOW" error:nil];}
}
- (BOOL)closeOriginalBrowserSelectedPagesSource:(NSError**)error {
 @synchronized(self){[self retire];
  auto refuse=[&](NSString*code){if(!_browserPagesCloseCause)_browserPagesCloseCause=[NSError errorWithDomain:@"YNXOriginalBrowserSource" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(error)*error=_browserPagesCloseCause;return NO;};
  if(_browserPagesLoans)return refuse(@"BROWSER_PAGE_ORIGINAL_CHILDREN_RETAINED");
  if(_closeSelected){if(error)*error=_browserPagesCloseCause?:_cleanupCause;return _cleanupComplete;}
  if(![self join:error])return NO;_closeSelected=YES;
  if(_helperClient&&![_helperClient close:error])return refuse(@"BROWSER_PAGE_HELPER_CLOSE_UNKNOWN");
  if(_publicInstallation&&!_publicInstallation->close())return refuse(@"BROWSER_PAGE_PUBLIC_CHILD_CLOSE_UNKNOWN");
  for(auto it=_files.rbegin();it!=_files.rend();++it){
   if(it->selected){if(!it->complete)return refuse(@"BROWSER_PAGE_FILE_CLOSE_UNKNOWN");continue;}
   it->selected=true;it->complete=::close(it->fd)==0;if(!it->complete)return refuse(@"BROWSER_PAGE_FILE_CLOSE_UNKNOWN");
  }
  for(NSUInteger n=_pipeHandles.count;n>0;--n){NSUInteger i=n-1;
   if(_pipeStates[i].intValue==1)continue;if(_pipeStates[i].intValue!=0)return refuse(@"BROWSER_PAGE_PIPE_CLOSE_UNKNOWN");
   _pipeStates[i]=@2;NSError*e=nil;if(![_pipeHandles[i]closeAndReturnError:&e]||e)return refuse(@"BROWSER_PAGE_PIPE_CLOSE_UNKNOWN");_pipeStates[i]=@1;
  }
  if(_custody&&![_custody closeOriginalIDERegistryChildFirst:error])return refuse(@"BROWSER_PAGE_CUSTODY_CLOSE_UNKNOWN");
  _cleanupComplete=YES;if(error)*error=_browserPagesCloseCause;return YES;
 }
}
