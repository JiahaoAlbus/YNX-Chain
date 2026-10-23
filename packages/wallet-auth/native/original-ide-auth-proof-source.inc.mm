// Included inside the ORIGINAL Source implementation. Uses its existing
// _task, pipes, 7s runner, held originals, purpose, current and first cause.
// No Source factory, renderer provider, new process entry or signer is added.
- (BOOL)pinOriginalIDEProofRuntime:(NSError **)error {
 if(_proofClosurePinned)return [self heldCurrent:error];
 if(!_policy||_policy->proofContract!="YNX-AUTH-IDENTITY-PROOF-DATA/v1"||
  !SourceProofHex([NSString stringWithUTF8String:_policy->proofDispatchDigest.c_str()])||
  !SourceProofHex([NSString stringWithUTF8String:_policy->proofRuntimeManifestDigest.c_str()]))return [self fail:@"AUTH_IDENTITY_PROOF_RUNTIME_NOT_ADMITTED" error:error];
 NSString *directory=[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]stringByDeletingLastPathComponent];
 NSString *root=directory.stringByDeletingLastPathComponent;
 NSString *manifest=[directory stringByAppendingPathComponent:@"original-ide-auth-runtime-manifest.json"];
 NSData *raw=[self holdPublic:manifest maximum:1048576 image:YES digest:_policy->proofRuntimeManifestDigest error:error];
 NSDictionary *body=SourceProofDictionary(raw,1048576);NSArray *files=body[@"files"];
 if(body.count!=2||![body[@"version"]isEqual:@"YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1"]||![files isKindOfClass:NSArray.class]||!files.count||files.count>4096)return [self fail:@"AUTH_IDENTITY_PROOF_RUNTIME_MANIFEST_INVALID" error:error];
 // The independently reviewed release manifest must bind the COMPLETE sole
 // SDK runtime closure (including package resolution and native dependency
 // bytes), not merely these minimum entrypoints. No manifest is minted here.
 NSMutableSet *required=[NSMutableSet setWithArray:@[@"package.json",@"native/original-auth-identity-source-verifier.mjs",@"native/original-ide-auth-proof-dispatch.mjs",@"native/original-auth-identity-v2-contract.mjs",@"src/auth-identity-verification.js",@"src/pq-wallet-policy.js",@"src/pq-wallet-authorization.js"]];
 NSMutableSet *seen=[NSMutableSet set];uint64_t total=0;NSString *previous=@"";
 for(id entry in files){
  if(![entry isKindOfClass:NSDictionary.class]||[entry count]!=3)return [self fail:@"AUTH_IDENTITY_PROOF_RUNTIME_ENTRY_INVALID" error:error];
  NSString *relative=entry[@"path"],*digest=entry[@"sha256"];NSNumber *bytes=entry[@"bytes"];
  if(![relative isKindOfClass:NSString.class]||!relative.length||relative.length>512||[relative hasPrefix:@"/"]||[relative containsString:@"\\"]||[relative rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound||
   [relative.pathComponents containsObject:@".."]||[relative.pathComponents containsObject:@"."]||![relative.stringByStandardizingPath isEqual:relative]||
   ![relative canBeConvertedToEncoding:NSASCIIStringEncoding]||[relative isEqual:@"native/original-ide-auth-runtime-manifest.json"]||
   [seen containsObject:relative]||[previous compare:relative]!=NSOrderedAscending||!SourceProofHex(digest)||
   ![bytes isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)bytes)==CFBooleanGetTypeID()||bytes.doubleValue!=(double)bytes.unsignedLongLongValue||!bytes.unsignedLongLongValue||bytes.unsignedLongLongValue>16777216)return [self fail:@"AUTH_IDENTITY_PROOF_RUNTIME_ENTRY_INVALID" error:error];
  total+=bytes.unsignedLongLongValue;if(total>268435456)return [self fail:@"AUTH_IDENTITY_PROOF_RUNTIME_CAPACITY" error:error];
  if([relative isEqual:@"native/original-ide-auth-proof-dispatch.mjs"]&&![digest isEqual:[NSString stringWithUTF8String:_policy->proofDispatchDigest.c_str()]])return [self fail:@"AUTH_IDENTITY_PROOF_DISPATCH_DIGEST_MISMATCH" error:error];
  NSData *held=[self holdPublic:[root stringByAppendingPathComponent:relative] maximum:16777216 image:YES digest:std::string(digest.UTF8String) error:error];
  if(!held||held.length!=bytes.unsignedLongLongValue)return [self fail:@"AUTH_IDENTITY_PROOF_RUNTIME_BYTES_MISMATCH" error:error];
  [seen addObject:relative];[required removeObject:relative];previous=relative;
 }
 if(required.count||![self heldCurrent:error])return [self fail:@"AUTH_IDENTITY_PROOF_RUNTIME_CLOSURE_INCOMPLETE" error:error];
 _proofClosurePinned=YES;return YES;
}
- (BOOL)assertOriginalIDEIdentityProofConsumerReady:(NSData *)raw error:(NSError **)error {
 @synchronized(self){
  if(_entered||_ideProofSelected||_invalid||_retired||[self class]!=YNXAuthIdentitySourceAuthority.class)return [self fail:@"AUTH_IDENTITY_PROOF_OWNER_NOT_READY" error:error];
  if(![self assertAuthenticatedNativePurpose:error])return NO;
  NSDictionary *request=SourceProofDictionary(raw,16384);uint64_t issued=0,expires=0,revision=0,height=0,nativeChain=0;
  NSString *origin=_policy?[NSString stringWithUTF8String:_policy->nativeNodeOrigin.c_str()]:nil;
  NSURLComponents *url=origin?[NSURLComponents componentsWithString:origin]:nil;
  if(!_policy||!origin.length||![url.scheme isEqual:@"https"]||!url.host.length||url.user||url.password||url.query||url.fragment||url.path.length||
   !SourceProofHex([NSString stringWithUTF8String:_policy->nativeNodeSPKI.c_str()])||!SourceProofU64([NSString stringWithUTF8String:_policy->nativeChainId.c_str()],nativeChain,true))return [self fail:@"AUTH_IDENTITY_NATIVE_NODE_BINDING_REQUIRED" error:error];
  if(request.count!=17||![request[@"version"]isEqual:@"YNX-AUTH-IDENTITY/v2"]||![request[@"algorithmVersion"]isEqual:@"YNX-BATCH/v0.1"]||
   !SourceProofPurpose(request[@"purpose"])||![request[@"purpose"]isEqual:[NSString stringWithUTF8String:_policy->purpose.c_str()]]||
   !SourceProofHex(request[@"networkId"])||!SourceProofU64(request[@"keyVersion"],revision,true)||!SourceProofU64(request[@"executionHeight"],height)||
   !SourceProofU64(request[@"issuedAtMs"],issued)||!SourceProofU64(request[@"expiresAtMs"],expires)||expires<=issued||expires-issued>30000)return [self fail:@"AUTH_IDENTITY_PROOF_EXPECTED_REQUEST_INVALID" error:error];
  uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  if(now<issued||now>=expires)return [self fail:@"AUTH_IDENTITY_PROOF_EXPECTED_REQUEST_EXPIRED" error:error];
  if(![self pinOriginalIDEProofRuntime:error])return NO;
  const uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  if(after<now||after<issued||after>=expires)return [self fail:@"AUTH_IDENTITY_PROOF_READINESS_POST_CURRENT_EXPIRED" error:error];
  if([request[@"purpose"]isEqual:@"AUTH-IDENTITY-RECEIVE"]){
   if(_receiveRequestOriginal&&![_receiveRequestOriginal isEqual:raw])return [self fail:@"AUTH_IDENTITY_HELPER_REQUEST_CHANGED" error:error];
   if(!_receiveRequestOriginal)_receiveRequestOriginal=[raw copy];
  }
  return YES;
 }
}
- (BOOL)assertOriginalIDEIdentityReceiveExecutionAvailable:(NSError **)error {
 @synchronized(self){
  if(![self assertAuthenticatedNativePurpose:error])return NO;
  if(geteuid()!=0){
   if(!_policy||_policy->purpose!="AUTH-IDENTITY-RECEIVE"||!_receiveRequestOriginal)return [self fail:@"AUTH_IDENTITY_RECEIVE_ORIGINAL_REQUEST_REQUIRED" error:error];
   NSError*clientError=nil;if(!_helperClient)_helperClient=[YNXIDEHelperClient acquireOriginalNodeClient:&clientError]; // retain same partial FIRST
   if(clientError||!_helperClient){_invalid=YES;if(!_firstCause)_firstCause=clientError?:[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_HELPER_CLIENT_REQUIRED"}];if(error)*error=_firstCause;return NO;}
   NSDictionary*data=[_helperClient prepareOriginalReceiveRequest:_receiveRequestOriginal error:&clientError];
   if(clientError||!data){_invalid=YES;if(!_firstCause)_firstCause=clientError?:[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"AUTH_IDENTITY_HELPER_PREPARE_UNKNOWN"}];if(error)*error=_firstCause;return NO;}
   return [self assertOriginalIDEIdentityRequestCurrent:_receiveRequestOriginal invocation:[NSData data] error:error];
  }
  // Actual helper Source only. Ordinary Node readiness still needs its normal
  // authenticated client path; this never elevates the Node or installs a daemon.
  if(!_policy||_policy->purpose!="AUTH-IDENTITY-RECEIVE"||geteuid()!=0||!_helperPeer)return [self fail:@"AUTH_IDENTITY_PRIVILEGED_RECEIVER_NOT_CONNECTED" error:error];
  NSString*base=[_helperPeer copyOriginalUserRegistryBase:error];
  if(!base||!ynx_auth_private::SourcePublicInstallation::protectedRootAncestors(std::string(base.UTF8String)))return [self fail:@"AUTH_IDENTITY_PRIVILEGED_RECEIVER_NOT_CONNECTED" error:error];
  return [_helperPeer assertCurrentMessage:error];
 }
}
- (BOOL)verifyOriginalIDEIdentityProof:(NSData *)wire expectedRequest:(NSData *)raw invocation:(NSData *)invocation error:(NSError **)error {
 @synchronized(self){
  // Preserve exact original returned wire BEFORE readiness/current callbacks.
  // Two booleans/public projections can never reconstruct this proof.
  if([wire isKindOfClass:NSData.class]&&wire.length&&wire.length<=262144){
   if(_receiveProofOriginal&&![_receiveProofOriginal isEqual:wire])return [self fail:@"AUTH_IDENTITY_HELPER_PROOF_CHANGED" error:error];
   if(!_receiveProofOriginal)_receiveProofOriginal=[wire copy];
  }
  if(![self assertOriginalIDEIdentityProofConsumerReady:raw error:error])return NO;
  _ideProofSelected=YES; // Select before any proof consumer/callback; never retry.
  if(![wire isKindOfClass:NSData.class]||!wire.length||wire.length>262144||
   ![self respondsToSelector:@selector(assertOriginalIDEIdentityRequestCurrent:invocation:error:)]||
   ![self assertOriginalIDEIdentityRequestCurrent:raw invocation:invocation error:error])return [self fail:@"AUTH_IDENTITY_PROOF_ORIGINAL_CONTEXT_NOT_CURRENT" error:error];
  const uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  const auto monotonic=std::chrono::steady_clock::now();
  NSDictionary *expected=SourceProofDictionary(raw,16384);uint64_t issued=0,expires=0;
  if(!SourceProofU64(expected[@"issuedAtMs"],issued)||!SourceProofU64(expected[@"expiresAtMs"],expires)||before<issued||before>=expires)return [self fail:@"AUTH_IDENTITY_PROOF_EXPECTED_REQUEST_EXPIRED" error:error];
  NSString *request=[[NSString alloc]initWithData:raw encoding:NSUTF8StringEncoding];
  NSString *encoded=[[[wire base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
  encoded=[encoded stringByReplacingOccurrencesOfString:@"=" withString:@""];
  NSDictionary *input=@{@"operation":@"auth-identity-proof-native-node/v1",@"node":@{@"origin":[NSString stringWithUTF8String:_policy->nativeNodeOrigin.c_str()],@"spki":[NSString stringWithUTF8String:_policy->nativeNodeSPKI.c_str()],@"nativeChainId":[NSString stringWithUTF8String:_policy->nativeChainId.c_str()]},@"requestRaw":request,@"expectedRequestRaw":request,@"purpose":expected[@"purpose"],@"atMs":[NSString stringWithFormat:@"%llu",(unsigned long long)before],@"wireBase64url":encoded};
  _entered=YES;NSData *result=nil;
  @try{result=[self runOriginalVerifierData:SourceProofCanonical(input) error:error];}
  @catch(NSException *){[self fail:@"AUTH_IDENTITY_PROOF_VERIFIER_UNKNOWN" error:error];}
  @finally{_entered=NO;}
  if(!result)return NO;
  id data=[NSJSONSerialization JSONObjectWithData:result options:0 error:nil];
  if(![data isKindOfClass:NSDictionary.class]||[data count]!=15||![data[@"version"]isEqual:@"YNX-AUTH-IDENTITY-PROOF-DATA/v1"]||
   ![data[@"requestOriginalDigest"]isEqual:SourceSHA(raw)]||![data[@"proofDigest"]isEqual:SourceSHA(wire)]||
   ![data[@"networkId"]isEqual:expected[@"networkId"]]||![data[@"owner"]isEqual:expected[@"owner"]]||![data[@"keyVersion"]isEqual:expected[@"keyVersion"]]||
   ![data[@"executionHeight"]isEqual:expected[@"executionHeight"]]||![data[@"purpose"]isEqual:expected[@"purpose"]]||
   ![data[@"memberCount"]isEqual:@1]||![data[@"memberIndex"]isEqual:@0]||!SourceProofBoolean(data[@"signatureVerified"],true)||!SourceProofBoolean(data[@"dataOnly"],true)||
   !SourceProofBoolean(data[@"authorized"],false)||!SourceProofBoolean(data[@"nativeAdmission"],false)||!SourceProofBoolean(data[@"effectRetryAuthorized"],false))return [self fail:@"AUTH_IDENTITY_PROOF_DATA_RESULT_INVALID" error:error];
  // SDK verifies mathematics. The SAME genuine Source separately rechecks
  // permission/current/request context, then local fixed time AFTER callbacks.
  // It cannot upgrade the 15 DATA fields into a grant or effect replay token.
  if(![self assertOriginalIDEIdentityRequestCurrent:raw invocation:invocation error:error]||![self heldCurrent:error])return NO;
  const uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  const auto elapsed=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-monotonic).count();
  if(after<before||after<_timeFloor||after>=expires||elapsed<0||elapsed>7000)return [self fail:@"AUTH_IDENTITY_PROOF_POST_COMPLETION_CURRENT_EXPIRED" error:error];
  _ideProofVerified=YES;_timeFloor=after;return YES;
 }
}
