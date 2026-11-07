+ (instancetype)acquireOriginalNetworkCurrentPublisherSource:(NSError**)error{
 YNXAuthIdentitySourceAuthority*s=[self new];s->_networkPublisher=YES;s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 try{@try{NSError*e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalNetworkCurrentPublisherProfile:&e];if(e||!s->_custody){[s fail:e.localizedDescription?:@"NETWORK_PUBLISHER_NO_ROOT_SELECTION" error:error];return s;}
  s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];id source=SourceOriginalBodyHint(s->_profileOriginal)[@"sourceId"];
  for(const auto&r:ynx::network::publisher::releases())if([source isKindOfClass:NSString.class]&&r.source.sourceId==[source UTF8String]){if(s->_networkPublisherPolicy){[s fail:@"NETWORK_PUBLISHER_DUPLICATE_RELEASE" error:error];return s;}s->_networkPublisherPolicy=&r;s->_policy=&r.source;}
  if(e||!s->_networkPublisherPolicy||s->_networkPublisherPolicy->uid!=getuid()||s->_policy->purpose!=ynx::network::publisher::purpose){[s fail:@"NETWORK_PUBLISHER_INDEPENDENT_RELEASE_REQUIRED" error:error];return s;}
  NSString*directory=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];
  if(directory)s->_rootOriginal=[s holdPublic:[directory stringByAppendingPathComponent:@"root.original"] maximum:16384 image:NO digest:s->_policy->rootDigest error:&e];
  if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[directory stringByAppendingPathComponent:@"enrollment.original"] maximum:393216 image:NO digest:s->_policy->enrollmentDigest error:&e];
  if(e||!s->_enrollmentOriginal||![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||![s assertOriginalNetworkCurrentPublisherCurrent:&e]){[s fail:e.localizedDescription?:@"NETWORK_PUBLISHER_SOURCE_NOT_CURRENT" error:error];return s;}
  return s;
 }@catch(NSException*){[s fail:@"NETWORK_PUBLISHER_SOURCE_EXCEPTION" error:error];return s;}}catch(...){[s fail:@"NETWORK_PUBLISHER_SOURCE_CPP_EXCEPTION" error:error];return s;}
}
- (BOOL)assertOriginalNetworkCurrentPublisherCurrent:(NSError**)error{
 @synchronized(self){if([self class]!=YNXAuthIdentitySourceAuthority.class||!_networkPublisher||!_networkPublisherPolicy||_policy!=&_networkPublisherPolicy->source||_policy->purpose!=ynx::network::publisher::purpose)return[self fail:@"NETWORK_PUBLISHER_DEDICATED_OWNER_REQUIRED" error:error];
  if(![self assertAuthenticatedNativePurpose:error])return NO;
  NSDictionary*s=_selection[@"networkResourceCurrentPublisherV1"],*d=s[@"descriptor"];
  if(![s isKindOfClass:NSDictionary.class]||s.count!=7||![s[@"operation"]isEqual:@"resource.current.publish"]||![d isKindOfClass:NSDictionary.class]||d.count!=8||![d[@"originalLocator"][@"leaf"]isEqual:@"source.current.original"]||![d[@"publisherOwner"]isEqual:s[@"subjectOwner"]]||[s[@"sourceId"]isEqual:d[@"sourceId"]]||[s[@"instanceId"]isEqual:d[@"instanceId"]]||![_selection[@"expectedRequest"][@"operations"]isEqual:@[@"resource.current.publish"]])return[self fail:@"NETWORK_PUBLISHER_SCOPE_BINDING" error:error];
  return[self heldCurrent:error];
 }
}
- (NSDictionary*)copyOriginalNetworkCurrentPublisherContext:(NSError**)error{
 @synchronized(self){if(![self assertOriginalNetworkCurrentPublisherCurrent:error])return nil;
  const auto&r=*_networkPublisherPolicy;NSDictionary*s=_selection[@"networkResourceCurrentPublisherV1"];
  NSDictionary*contract=@{@"purpose":[NSString stringWithUTF8String:r.source.purpose.c_str()],@"enrollmentFrame":[NSString stringWithUTF8String:r.source.enrollmentFrame.c_str()],@"profileFrame":[NSString stringWithUTF8String:r.source.profileFrame.c_str()],@"currentFrame":[NSString stringWithUTF8String:r.source.currentFrame.c_str()]};
  NSDictionary*policy=@{@"rootDigest":[NSString stringWithUTF8String:r.source.rootDigest.c_str()],@"enrollmentDigest":[NSString stringWithUTF8String:r.source.enrollmentDigest.c_str()],@"endpoint":[NSString stringWithUTF8String:r.source.endpoint.c_str()],@"spki":[NSString stringWithUTF8String:r.source.spki.c_str()],@"signatureContract":contract,@"applicationId":[NSString stringWithUTF8String:r.applicationId.c_str()],@"productId":@"network",@"platform":[NSString stringWithUTF8String:r.platform.c_str()]};
  NSDictionary*inputs=@{@"rootRaw":[[NSString alloc]initWithData:_rootOriginal encoding:NSUTF8StringEncoding],@"enrollmentRaw":[[NSString alloc]initWithData:_enrollmentOriginal encoding:NSUTF8StringEncoding],@"profileRaw":[[NSString alloc]initWithData:_profileOriginal encoding:NSUTF8StringEncoding],@"currentRaw":[[NSString alloc]initWithData:_currentOriginal encoding:NSUTF8StringEncoding],@"policy":policy,@"expectedNonce":_currentNonce,@"previous":@{@"sequence":@(_sequence),@"floor":@(_floor),@"head":_headDigest,@"timeFloor":@(_timeFloor),@"executionHeight":_observationHeight?:@"0"},@"atMs":@(_timeFloor)};
  NSDictionary*out=@{@"descriptor":s[@"descriptor"],@"issuerSourceInputs":inputs,@"sourceScope":s,@"journalDirectory":_selection[@"originalHostTerminalDirectory"],@"originalOperation64":[NSString stringWithUTF8String:r.originalOperation64.c_str()],@"expiresAtMs":@(_cachedCurrentExpiresMS),@"node":@{@"origin":[NSString stringWithUTF8String:r.source.nativeNodeOrigin.c_str()],@"spki":[NSString stringWithUTF8String:r.source.nativeNodeSPKI.c_str()],@"nativeChainId":[NSString stringWithUTF8String:r.source.nativeChainId.c_str()]}};
  return[self heldCurrent:error]?out:nil;
 }
}
- (BOOL)assertOriginalNetworkCurrentPublisherCompletedCurrent:(NSError**)error{
 @synchronized(self){uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);if(!_networkPublisher||!_networkPublisherPolicy||now<_timeFloor||now>=_cachedCurrentExpiresMS)return[self fail:@"NETWORK_PUBLISHER_COMPLETED_CURRENT_EXPIRED" error:error];return[self heldCurrent:error];}
}
- (BOOL)retainOriginalNetworkCurrentPublisherChild:(NSError**)error{@synchronized(self){if(![self assertOriginalNetworkCurrentPublisherCurrent:error]||_networkPublisherLoans==UINT_MAX)return NO;++_networkPublisherLoans;return YES;}}
- (void)releaseOriginalNetworkCurrentPublisherChild{@synchronized(self){if(_networkPublisherLoans)--_networkPublisherLoans;else[self fail:@"NETWORK_PUBLISHER_CHILD_UNDERFLOW" error:nil];}}
- (BOOL)closeOriginalNetworkCurrentPublisherSource:(NSError**)error{@synchronized(self){[self retire];if(_networkPublisherLoans){if(error)*error=[NSError errorWithDomain:@"YNXNetworkPublisher" code:1 userInfo:@{NSLocalizedDescriptionKey:@"NETWORK_PUBLISHER_CHILDREN_RETAINED"}];return NO;}return[self closeOriginalIDECocoaParentChildFirst:error];}}
