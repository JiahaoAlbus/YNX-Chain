// Same Source custody and holdPublic machinery. Does not load WC, connect,
// initialize a Core, grant a Root or accept a caller runtime/qualifying bool.
- (BOOL)pinOriginalIDEContractRelayRuntime:(NSError **)error {
 @synchronized(self){
  if(_relayRuntimePinned)return [self assertOriginalIDEContractRelayRuntimeCurrent:error];
  if(_relayRuntimeEntered||_entered||_relayLocalEntered)return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_REENTRANT" error:error];
  NSDictionary *scope=[self copyOriginalIDEContractRelayScopeLocal:error];if(!scope)return NO;
  if(!_policy||!SourceProofHex([NSString stringWithUTF8String:_policy->contractRelayRuntimeManifestDigest.c_str()])||!SourceProofHex([NSString stringWithUTF8String:_policy->contractRelayExecutorDigest.c_str()]))return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_NOT_ADMITTED" error:error];
  NSString *root=[NSString stringWithUTF8String:_policy->contractRelayRuntimeDirectory.c_str()];
  char resolved[PATH_MAX];
  if(!root.length||![root hasPrefix:@"/"]||!realpath(root.fileSystemRepresentation,resolved)||![root isEqual:[NSString stringWithUTF8String:resolved]])return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_ROOT_INVALID" error:error];
  NSString *verifierRoot=[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]stringByDeletingLastPathComponent].stringByDeletingLastPathComponent;
  if(![root isEqual:verifierRoot])return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_DIFFERENT_SOURCE_ROOT" error:error];
  NSString *digest=[NSString stringWithUTF8String:_policy->contractRelayRuntimeManifestDigest.c_str()];
  if(![_selection[@"contractRelayRuntimeSHA256"]isEqual:digest])return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_PROFILE_MISMATCH" error:error];
  _relayRuntimeEntered=YES;
  @try{
   // Reuse the existing complete-runtime manifest schema. The provider builds
   // the exact UNION of independently read normal Auth+WC manifests. No entry
   // is inferred from source adjacency or a successful three-file check.
   NSString *manifest=[root stringByAppendingPathComponent:@"native/original-ide-contract-relay-runtime-manifest.json"];
   NSError *inputError=nil;NSData *raw=[self holdPublic:manifest maximum:4194304 image:YES digest:_policy->contractRelayRuntimeManifestDigest error:&inputError];
   if(!raw){if(!_firstCause&&inputError)_firstCause=inputError;return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_MANIFEST_UNAVAILABLE" error:error];}
   _relayRuntimeManifestOriginal=[raw copy]; // capture actual original before classification/callbacks
   NSDictionary *body=SourceProofDictionary(raw,4194304);NSArray *files=body[@"files"];
   if(body.count!=2||![body[@"version"]isEqual:@"YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1"]||![files isKindOfClass:NSArray.class]||!files.count||files.count>16384)return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_MANIFEST_INVALID" error:error];
   // Never raise process limits or silently drop closure files. A normal
   // installed executor needs capacity for every independent retained image.
   struct rlimit limit{};
   if(getrlimit(RLIMIT_NOFILE,&limit)||files.count+_files.size()+32>=limit.rlim_cur)return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_DESCRIPTOR_CAPACITY" error:error];
   NSMutableSet *required=[NSMutableSet setWithArray:@[@"package.json",@"src/original-ide-contract-relay-guard-node.js",@"src/original-ide-contract-relay-guard-core.js",@"src/walletconnect-dapp-connection.js",@"src/walletconnect-contract-initiator-boundary.js",@"src/walletconnect-contract-initiator-boundary-node.js",@"node_modules/@walletconnect/core/dist/index.cjs",@"node_modules/@walletconnect/core/package.json",@"node_modules/@walletconnect/sign-client/dist/index.cjs",@"node_modules/@walletconnect/sign-client/package.json",@"node_modules/@walletconnect/utils/dist/index.cjs",@"node_modules/@walletconnect/utils/package.json",@"node_modules/.package-lock.json"]];
   NSMutableSet *seen=[NSMutableSet set];NSString *previous=@"";uint64_t total=0;
   for(id entry in files){
    if(![entry isKindOfClass:NSDictionary.class]||[entry count]!=3)return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_ENTRY_INVALID" error:error];
    NSString *relative=entry[@"path"],*sha=entry[@"sha256"];NSNumber *bytes=entry[@"bytes"];
    if(![relative isKindOfClass:NSString.class]||!relative.length||relative.length>1024||![relative canBeConvertedToEncoding:NSASCIIStringEncoding]||[relative hasPrefix:@"/"]||[relative containsString:@"\\"]||[relative rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound||[relative.pathComponents containsObject:@".."]||[relative.pathComponents containsObject:@"."]||![relative.stringByStandardizingPath isEqual:relative]||[relative isEqual:@"native/original-ide-contract-relay-runtime-manifest.json"]||[seen containsObject:relative]||[previous compare:relative]!=NSOrderedAscending||!SourceProofHex(sha)||![bytes isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)bytes)==CFBooleanGetTypeID()||bytes.doubleValue!=(double)bytes.unsignedLongLongValue||bytes.unsignedLongLongValue>16777216||(!bytes.unsignedLongLongValue&&![sha isEqual:@"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]))return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_ENTRY_INVALID" error:error];
    total+=bytes.unsignedLongLongValue;if(total>268435456)return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_CAPACITY" error:error];
    if([relative isEqual:@"src/walletconnect-contract-initiator-boundary.js"]&&![sha isEqual:[NSString stringWithUTF8String:_policy->contractRelayExecutorDigest.c_str()]])return [self fail:@"IDE_CONTRACT_RELAY_EXECUTOR_BINDING_MISMATCH" error:error];
    NSString *path=[root stringByAppendingPathComponent:relative];
    NSError *actualError=nil;
    NSData *held=bytes.unsignedLongLongValue?[self holdPublic:path maximum:16777216 image:YES digest:std::string(sha.UTF8String) error:&actualError]:[self holdOriginalContractRelayEmptyRuntimeFile:path error:&actualError];
    if(!held||held.length!=bytes.unsignedLongLongValue){if(!_firstCause&&actualError)_firstCause=actualError;return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_BYTES_MISMATCH" error:error];}
    [seen addObject:relative];[required removeObject:relative];previous=relative;
   }
   if(required.count)return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_CLOSURE_INCOMPLETE" error:error];
   // Capture this original manifest before late callbacks; heldSource checks
   // retained original byte identities for ALL files, not only the executor.
   NSError *actual=nil;if(![self heldCurrent:&actual]){if(!_firstCause&&actual)_firstCause=actual;return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_POST_CURRENT_UNKNOWN" error:error];}
   _relayRuntimePinned=YES;
  }@catch(id){return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_PIN_UNKNOWN" error:error];}
  @finally{_relayRuntimeEntered=NO;}
  return [self assertOriginalIDEContractRelayRuntimeCurrent:error];
 }
}
- (NSData *)holdOriginalContractRelayEmptyRuntimeFile:(NSString *)path error:(NSError **)error {
 // Actual SDK closure contains three legitimate empty files. Do not relax the
 // nonempty rule for Root/credential/verifier inputs or silently omit them.
 char resolved[PATH_MAX];if(!path||!realpath(path.fileSystemRepresentation,resolved)||![path isEqual:[NSString stringWithUTF8String:resolved]]){[self fail:@"IDE_CONTRACT_RELAY_EMPTY_FILE_PATH_INVALID" error:error];return nil;}
 NSString *part=@"/";for(NSString *name in path.stringByDeletingLastPathComponent.pathComponents){if([name isEqual:@"/"])continue;part=[part stringByAppendingPathComponent:name];struct stat st{};if(lstat(part.fileSystemRepresentation,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=0||(st.st_mode&0022)){[self fail:@"IDE_CONTRACT_RELAY_EMPTY_FILE_PARENT_INVALID" error:error];return nil;}}
 int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);if(fd<0){[self fail:@"IDE_CONTRACT_RELAY_EMPTY_FILE_UNAVAILABLE" error:error];return nil;}
 struct stat before{},named{},after{};_files.push_back({fd,before,path,false,false});auto &held=_files.back();
 if(fstat(fd,&before)||lstat(path.fileSystemRepresentation,&named)||!SourceSame(before,named)||!S_ISREG(before.st_mode)||before.st_uid!=0||before.st_nlink!=1||(before.st_mode&0022)||before.st_size!=0){[self fail:@"IDE_CONTRACT_RELAY_EMPTY_FILE_IDENTITY_INVALID" error:error];return nil;}held.identity=before;
 unsigned char probe=0;
 if(pread(fd,&probe,1,0)!=0||fstat(fd,&after)||lstat(path.fileSystemRepresentation,&named)||!SourceSame(before,after)||!SourceSame(before,named)){[self fail:@"IDE_CONTRACT_RELAY_EMPTY_FILE_CHANGED" error:error];return nil;}
 return [NSData data];
}
- (BOOL)assertOriginalIDEContractRelayRuntimeCurrent:(NSError **)error {
 @synchronized(self){
  if(!_relayRuntimePinned||!_relayRuntimeManifestOriginal||!_policy||!SourceProofHex([NSString stringWithUTF8String:_policy->contractRelayRuntimeManifestDigest.c_str()])||![SourceSHA(_relayRuntimeManifestOriginal)isEqual:[NSString stringWithUTF8String:_policy->contractRelayRuntimeManifestDigest.c_str()]])return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_NOT_QUALIFIED" error:error];
  // Same local Source/short expiry/files. No HTTP/runner/JS boolean here.
  NSDictionary *before=[self copyOriginalIDEContractRelayScopeLocal:error];if(!before)return NO;
  if(![_selection[@"contractRelayRuntimeSHA256"]isEqual:[NSString stringWithUTF8String:_policy->contractRelayRuntimeManifestDigest.c_str()]])return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_PROFILE_MISMATCH" error:error];
  NSDictionary *after=[self copyOriginalIDEContractRelayScopeLocal:error];
  if(!after||![before isEqual:after])return [self fail:@"IDE_CONTRACT_RELAY_RUNTIME_POST_SCOPE_CHANGED" error:error];return YES;
 }
}
