// Independent query-purpose Source; does not borrow creation/HTTP/pending.
+ (instancetype)acquireOriginalProductSessionDeviceV4QuerySource:(NSError**)error {
 YNXAuthIdentitySourceAuthority*s=[self new];s->_productDeviceV4Query=YES;s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 BOOL released=NO;for(const auto&p:ynx_auth_private::originalNativeSourceReleases())if(p.purpose=="product-session-device-query-source-v4"&&!p.productDeviceV4ApplicationId.empty()&&!p.productDeviceV4ProductId.empty())released=YES;
 if(!released){[s fail:@"PRODUCT_QUERY_V4_INDEPENDENT_RELEASE_NOT_SUPPLIED" error:error];return s;}
 try{@try{NSError*e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalProductSessionDeviceV4QueryProfile:&e];if(e||!s->_custody){[s fail:e.localizedDescription?:@"PRODUCT_QUERY_V4_PROFILE_REQUIRED" error:error];return s;}
  s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];id source=SourceOriginalBodyHint(s->_profileOriginal)[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto&p:ynx_auth_private::originalNativeSourceReleases())if(p.sourceId==[source UTF8String]){if(s->_policy){[s fail:@"PRODUCT_QUERY_V4_DUPLICATE_RELEASE" error:error];return s;}s->_policy=&p;}
  if(e||!s->_policy||s->_policy->purpose!="product-session-device-query-source-v4"||s->_policy->productDeviceV4ApplicationId.empty()||s->_policy->productDeviceV4ProductId.empty()){[s fail:@"PRODUCT_QUERY_V4_DEDICATED_RELEASE_REQUIRED" error:error];return s;}
  NSString*root=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];
  if(root)s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:&e];
  if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:&e];
  if(e||!s->_enrollmentOriginal||![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||![s assertOriginalProductSessionDeviceV4QuerySourceCurrent:&e]){[s fail:e.localizedDescription?:@"PRODUCT_QUERY_V4_SOURCE_NOT_CURRENT" error:error];return s;}return s;
 }@catch(id){[s fail:@"PRODUCT_QUERY_V4_SOURCE_EXCEPTION" error:error];return s;}}catch(...){[s fail:@"PRODUCT_QUERY_V4_SOURCE_CPP" error:error];return s;}
}
- (BOOL)assertOriginalProductSessionDeviceV4QuerySourceCurrent:(NSError**)error {
 if([self class]!=YNXAuthIdentitySourceAuthority.class||!_productDeviceV4Query||!_policy||_policy->purpose!="product-session-device-query-source-v4"||![SourceProofDictionary(_rootOriginal,16384)[@"version"]isEqual:@2])return [self fail:@"PRODUCT_QUERY_V4_DEDICATED_SOURCE_REQUIRED" error:error];
 if(![self assertAuthenticatedNativePurpose:error])return NO;
 if(![_selection[@"expectedRequest"][@"operations"]isEqual:@[@"device.original-query"]])return [self fail:@"PRODUCT_QUERY_V4_READ_ONLY_OPERATIONS_REQUIRED" error:error];
 NSDictionary*observed=ynx_auth_private::originalQueryDeviceV4JournalObserve(_selection);if(!observed||(_productDeviceV4QueryJournalObservedIdentity&&![_productDeviceV4QueryJournalObservedIdentity isEqual:observed]))return [self fail:@"PRODUCT_QUERY_V4_JOURNAL_OBSERVED_IDENTITY_CHANGED" error:error];if(!_productDeviceV4QueryJournalObservedIdentity)_productDeviceV4QueryJournalObservedIdentity=observed;
 return [self heldCurrent:error];
}
- (NSDictionary*)copyOriginalProductSessionDeviceV4QueryContext:(NSError**)error {
 @synchronized(self){if(![self assertOriginalProductSessionDeviceV4QuerySourceCurrent:error])return nil;
  NSDictionary*s=_selection[@"productSessionDeviceV4Query"],*p=SourceOriginalBodyHint(_profileOriginal);uint64_t issued=0,expires=0;
  if(![s isKindOfClass:NSDictionary.class]||s.count!=3||![s[@"version"]isEqual:@"4"]||![s[@"stableDeviceIdentity"]isKindOfClass:NSString.class]||![s[@"identityBinding"]isKindOfClass:NSDictionary.class]||[s[@"identityBinding"]count]!=12||!ynx_auth_private::originalQueryProfileNumberU64(p[@"issuedAtMs"],issued)||!ynx_auth_private::originalQueryProfileNumberU64(p[@"expiresAtMs"],expires)||expires<=issued||expires-issued>86400000)return [self fail:@"PRODUCT_QUERY_V4_SCOPE_REQUIRED" error:error],nil;
  NSData*raw=[NSJSONSerialization dataWithJSONObject:s options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];NSString*parent=_selection[@"originalHostTerminalDirectory"];NSData*stable=[s[@"stableDeviceIdentity"]dataUsingEncoding:NSUTF8StringEncoding];if(!raw.length||raw.length>32768||!parent.length||!stable.length||stable.length>1024)return [self fail:@"PRODUCT_QUERY_V4_SCOPE_BOUND" error:error],nil;
  NSDictionary*copy=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];if(!copy||![_selection[@"productSessionDeviceV4Query"]isEqual:copy]||![self assertOriginalProductSessionDeviceV4QuerySourceCurrent:error])return [self fail:@"PRODUCT_QUERY_V4_SCOPE_CHANGED" error:error],nil;
  return @{@"scope":copy,@"issuedAtMs":@(issued),@"expiresAtMs":@(expires),@"parent":parent,@"leaf":[@"device-v4-provisioning-" stringByAppendingString:SourceSHA(stable)],@"observedJournalIdentity":_productDeviceV4QueryJournalObservedIdentity};
 }
}
- (NSString*)copyOriginalProductSessionDeviceV4QueryModulePath:(NSError**)error {
 @synchronized(self){if(![self assertOriginalProductSessionDeviceV4QuerySourceCurrent:error])return nil;
  const auto&path=_policy->productDeviceV4QueryModulePath;const auto&digest=_policy->productDeviceV4QueryModuleDigest;const auto bytes=_policy->productDeviceV4QueryModuleBytes;
  if(path.empty()||path.front()!='/'||path.size()>4096||digest.size()!=64||!bytes||bytes>131072)return [self fail:@"PRODUCT_QUERY_V4_MAIN_MODULE_RELEASE_REQUIRED" error:error],nil;NSString*p=[NSString stringWithUTF8String:path.c_str()];
  for(auto&held:_files)if([held.path isEqual:p]){struct stat st{};if(fstat(held.fd,&st)||!SourceSame(st,held.identity)||(uint64_t)st.st_size!=bytes)return [self fail:@"PRODUCT_QUERY_V4_MAIN_MODULE_CHANGED" error:error],nil;return [self heldCurrent:error]?[p copy]:nil;}
  NSData*raw=[self holdPublic:p maximum:131072 image:NO digest:digest error:error];if(!raw||raw.length!=bytes||![self assertOriginalProductSessionDeviceV4QuerySourceCurrent:error])return [self fail:@"PRODUCT_QUERY_V4_MAIN_MODULE_BINDING" error:error],nil;return [p copy];
 }
}
