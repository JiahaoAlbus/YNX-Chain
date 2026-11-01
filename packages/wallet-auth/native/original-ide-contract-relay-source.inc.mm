// Included in SAME original Source class. No caller-supplied scope/callback.
// A signed dedicated profile is necessary but not enough: actual Native guard
// also verifies its incoming peer/kernel and qualified network closure.
- (NSDictionary *)copyOriginalIDEContractRelayScopeLocal:(NSError **)error {
 @synchronized(self){
  if(_relayLocalEntered||_entered){[self fail:@"IDE_CONTRACT_RELAY_SOURCE_REENTRANT" error:error];return nil;}
  _relayLocalEntered=YES;
  @try{
   if(_invalid||_retired){[self fail:@"IDE_CONTRACT_RELAY_SOURCE_NOT_CURRENT" error:error];return nil;}
   if(!_policy||_policy->purpose!="ide-contract-relay-v1"||!_selection||!_currentOriginal.length||!_cachedCurrentExpiresMS||!_sequence||_floor>_sequence){[self fail:@"IDE_CONTRACT_RELAY_DEDICATED_SOURCE_REQUIRED" error:error];return nil;}
   // The existing admitted v2 Source verifier, not dictionary shape, installed
   // selection and cached expiry. Reject classic and every old identity grant.
   NSDictionary *root=SourceProofDictionary(_rootOriginal,16384);
   if(![root[@"version"]isEqual:@2]){[self fail:@"IDE_CONTRACT_RELAY_SOURCE_V2_REQUIRED" error:error];return nil;}
   NSDictionary *selection=[_selection copy],*scope=selection[@"contractRelay"],*association=selection[@"association"];
   NSSet *keys=[NSSet setWithArray:@[@"kind",@"projectId",@"projectGeneration",@"callerIdentity",@"origin",@"expiresMS",@"chainId",@"methods",@"relayURL"]];
   if(![scope isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:scope.allKeys]isEqual:keys]||![association isKindOfClass:NSDictionary.class]||![scope[@"kind"]isEqual:@"ide-contract-relay-v1"]||![scope[@"origin"]isEqual:@"https://developer.ynxweb4.com"]||![scope[@"chainId"]isEqual:@"eip155:6423"]||![scope[@"relayURL"]isEqual:@"wss://relay.walletconnect.org"]||![scope[@"methods"]isEqual:@[@"ynx_preparePQContractAction",@"ynx_preparePQContractBroadcast",@"ynx_getPQContractOriginal"]]){[self fail:@"IDE_CONTRACT_RELAY_SCOPE_INVALID" error:error];return nil;}
   for(NSString *k in @[@"projectId",@"callerIdentity"]){id v=scope[k];if(![v isKindOfClass:NSString.class]||![v length]||[v lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>512||[v rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound){[self fail:@"IDE_CONTRACT_RELAY_SCOPE_INVALID" error:error];return nil;}}
   uint64_t generation=0,expires=0;
   for(NSString *k in @[@"projectGeneration",@"expiresMS"]){id v=scope[k];if(![v isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)v)==CFBooleanGetTypeID()||[v doubleValue]<1||[v doubleValue]>9007199254740991.0||[v doubleValue]!=(double)[v unsignedLongLongValue]){[self fail:@"IDE_CONTRACT_RELAY_SAFE_INTEGER" error:error];return nil;}}
   generation=[scope[@"projectGeneration"]unsignedLongLongValue];expires=[scope[@"expiresMS"]unsignedLongLongValue];
   NSDictionary *project=selection[@"projectCurrent"],*peer=selection[@"identityPeerBinding"];
   if(![project isKindOfClass:NSDictionary.class]||![peer isKindOfClass:NSDictionary.class]||![project[@"projectId"]isEqual:scope[@"projectId"]]||![project[@"projectGeneration"]isEqual:scope[@"projectGeneration"]]||![project[@"callerIdentity"]isEqual:scope[@"callerIdentity"]]||![peer[@"nodeCodeIdentity"]isEqual:scope[@"callerIdentity"]]||![project[@"account"]isEqual:association[@"account"]]||![project[@"sessionId"]isKindOfClass:NSString.class]||![project[@"sessionId"]length]||expires>[project[@"expiresMS"]unsignedLongLongValue]){[self fail:@"IDE_CONTRACT_RELAY_PROJECT_CURRENT_REQUIRED" error:error];return nil;}
   // Caller identity meaning is signed by the dedicated project producer; do
   // not synthesize it from an account/login projection. Peer independently
   // compares the signed caller binding with its exact actual incoming peer.
   if(!generation){[self fail:@"IDE_CONTRACT_RELAY_EXPIRY_NOT_BOUND" error:error];return nil;}
   // A long-lived signed project profile never extends the freshly verified
   // current statement. The returned lease is their fixed intersection.
   const uint64_t cacheExpires=_cachedCurrentExpiresMS,sequence=_sequence,floor=_floor;
   const auto *policy=_policy;NSString *head=[_headDigest copy];NSData *current=[_currentOriginal copy];
   expires=std::min(expires,cacheExpires);
   NSData *snapshot=[NSJSONSerialization dataWithJSONObject:selection options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
   NSData *scopeBytes=[NSJSONSerialization dataWithJSONObject:scope options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
   if(!snapshot||!scopeBytes||snapshot.length>65536){[self fail:@"IDE_CONTRACT_RELAY_SCOPE_CAPACITY" error:error];return nil;}
   const uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
   if(before<_timeFloor||before>=expires||before>=_cachedCurrentExpiresMS){[self fail:@"IDE_CONTRACT_RELAY_EXPIRED" error:error];return nil;}
   _timeFloor=before;
   NSError *actual=nil;
   if(![self heldCurrent:&actual]){if(!_firstCause&&actual)_firstCause=actual;[self fail:@"IDE_CONTRACT_RELAY_LOCAL_CURRENT_UNKNOWN" error:error];return nil;}
   NSMutableDictionary *copied=[[NSJSONSerialization JSONObjectWithData:scopeBytes options:0 error:nil]mutableCopy];
   copied[@"expiresMS"]=@(expires);
   // Final callback may revoke/mutate/retire/advance clock. Repeat ALL local
   // operands after it. No current fetch/process/network is allowed here.
   actual=nil;if(![self heldCurrent:&actual]){if(!_firstCause&&actual)_firstCause=actual;[self fail:@"IDE_CONTRACT_RELAY_LOCAL_POST_CURRENT_UNKNOWN" error:error];return nil;}
   NSData *post=[NSJSONSerialization dataWithJSONObject:_selection options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
   uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
   if(_invalid||_retired||_policy!=policy||_sequence!=sequence||_floor!=floor||_cachedCurrentExpiresMS!=cacheExpires||![_headDigest isEqual:head]||![_currentOriginal isEqual:current]||!copied||![post isEqual:snapshot]||after<_timeFloor||after>=expires){[self fail:@"IDE_CONTRACT_RELAY_POST_CURRENT_REFUSED" error:error];return nil;}
   _timeFloor=after;return [copied copy];
  }@catch(id){[self fail:@"IDE_CONTRACT_RELAY_SOURCE_LOCAL_UNKNOWN" error:error];return nil;}
  @finally{_relayLocalEntered=NO;}
 }
}
- (NSDictionary *)copyOriginalIDEContractRelayPeerBindingLocal:(NSError **)error {
 @synchronized(self){
  NSDictionary *before=[self copyOriginalIDEContractRelayScopeLocal:error];if(!before)return nil;
  NSDictionary *peer=_selection[@"identityPeerBinding"];
  NSSet *keys=[NSSet setWithArray:@[@"walletCodeIdentity",@"ideCodeIdentity",@"nodeCodeIdentity",@"nodeSHA256",@"entrySHA256",@"provenanceSHA256"]];
  if(![peer isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:peer.allKeys]isEqual:keys]){[self fail:@"IDE_CONTRACT_RELAY_PEER_BINDING_REQUIRED" error:error];return nil;}
  NSData *raw=[NSJSONSerialization dataWithJSONObject:peer options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
  if(!raw||raw.length>8192){[self fail:@"IDE_CONTRACT_RELAY_PEER_BINDING_BOUND" error:error];return nil;}
  NSDictionary *copy=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
  NSDictionary *after=[self copyOriginalIDEContractRelayScopeLocal:error];
  NSData *post=[NSJSONSerialization dataWithJSONObject:_selection[@"identityPeerBinding"] options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
  if(!after||![before isEqual:after]||![raw isEqual:post]){[self fail:@"IDE_CONTRACT_RELAY_PEER_POST_CURRENT_REFUSED" error:error];return nil;}
  return copy;
 }
}
- (NSDictionary *)copyOriginalIDEContractRelayLaunchLocal:(NSError **)error {
 @synchronized(self){
  NSDictionary *before=[self copyOriginalIDEContractRelayScopeLocal:error];if(!before)return nil;
  NSDictionary *launch=_selection[@"projectLaunch"];
  NSSet *fields=[NSSet setWithArray:@[@"projectId",@"projectGeneration",@"localProjectId",@"workspace",@"profile",@"node"]];
  if(![launch isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:launch.allKeys]isEqual:fields]||![launch[@"projectId"]isEqual:before[@"projectId"]]||![launch[@"projectGeneration"]isEqual:before[@"projectGeneration"]]){[self fail:@"IDE_CONTRACT_RELAY_SIGNED_LAUNCH_REQUIRED" error:error];return nil;}
  NSData *raw=[NSJSONSerialization dataWithJSONObject:launch options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
  if(!raw||raw.length>16384){[self fail:@"IDE_CONTRACT_RELAY_LAUNCH_BOUND" error:error];return nil;}
  NSDictionary *copy=[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil];
  NSDictionary *after=[self copyOriginalIDEContractRelayScopeLocal:error];NSData *post=[NSJSONSerialization dataWithJSONObject:_selection[@"projectLaunch"] options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
  if(!after||![before isEqual:after]||![raw isEqual:post]){[self fail:@"IDE_CONTRACT_RELAY_LAUNCH_POST_CURRENT_CHANGED" error:error];return nil;}return copy;
 }
}
