// Included INSIDE original Source implementation; not a caller-DATA factory.
- (NSDictionary*)copyOriginalIDEContractInitiatorCodeInputsLocal:(NSError**)error {
 @synchronized(self){
  if(!pthread_main_np()||_invalid||_retired||!_policy||_policy->purpose!="ide-contract-relay-v1")return [self fail:@"IDE_CONTRACT_INITIATOR_SOURCE_REQUIRED" error:error],nil;
  if(![self assertOriginalIDEContractRelayRuntimeCurrent:error])return nil;
  NSDictionary*before=[self copyOriginalIDEContractRelayScopeLocal:error];if(!before)return nil;
  const auto*policy=_policy;NSData*manifest=[_relayRuntimeManifestOriginal copy];
  NSDictionary*body=SourceProofDictionary(manifest,4194304);NSArray*files=body[@"files"];
  if(![body[@"version"]isEqual:@"YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1"]||![files isKindOfClass:NSArray.class]||!files.count)return [self fail:@"IDE_CONTRACT_INITIATOR_MANIFEST_REQUIRED" error:error],nil;
  NSString*root=[NSString stringWithUTF8String:policy->contractRelayRuntimeDirectory.c_str()];
  NSMutableDictionary*entries=[NSMutableDictionary dictionary];
  for(NSDictionary*entry in files){if(![entry isKindOfClass:NSDictionary.class]||![entry[@"path"]isKindOfClass:NSString.class]||entries[entry[@"path"]])return [self fail:@"IDE_CONTRACT_INITIATOR_MANIFEST_DUPLICATE" error:error],nil;entries[entry[@"path"]]=entry;}
  // Read ONLY the actual retained Source FD, not an unchecked path or a new
  // caller namespace. Every duplicate held FD must still denote the same input.
  NSData*(^readHeld)(NSString*,uint64_t,NSString*)=^NSData*(NSString*relative,uint64_t count,NSString*sha){
   NSDictionary*entry=entries[relative];NSString*path=[root stringByAppendingPathComponent:relative];
   if(!entry||!SourceProofHex(sha)||![entry[@"sha256"]isEqual:sha]||![entry[@"bytes"]isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)entry[@"bytes"])==CFBooleanGetTypeID()||[entry[@"bytes"]unsignedLongLongValue]!=count||!count||count>131072)return nil;
   NSData*captured=nil;BOOL found=NO;
   for(const auto&held:_files){if(![held.path isEqual:path])continue;found=YES;struct stat start{},named{},end{};
    if(held.selected||fstat(held.fd,&start)||lstat(path.fileSystemRepresentation,&named)||!SourceSame(start,held.identity)||!SourceSame(start,named)||(uint64_t)start.st_size!=count||!S_ISREG(start.st_mode)||start.st_uid!=0||start.st_nlink!=1||(start.st_mode&0022))return nil;
    NSMutableData*raw=[NSMutableData dataWithLength:(NSUInteger)count];uint64_t at=0;while(at<count){ssize_t n=pread(held.fd,(uint8_t*)raw.mutableBytes+at,(size_t)(count-at),(off_t)at);if(n<0&&errno==EINTR)continue;if(n<=0)return nil;at+=(uint64_t)n;}
    if(fstat(held.fd,&end)||lstat(path.fileSystemRepresentation,&named)||!SourceSame(start,end)||!SourceSame(start,named)||![SourceSHA(raw)isEqual:sha]||(captured&&![captured isEqual:raw]))return nil;captured=[raw copy];
   }return found?captured:nil;
  };
  for(const auto&pin:ynx::ide::initiator_private::pins){NSString*relative=[NSString stringWithUTF8String:pin.path],*sha=[NSString stringWithUTF8String:pin.sha256];
   if(!readHeld(relative,pin.bytes,sha))return [self fail:@"IDE_CONTRACT_INITIATOR_PINNED_CODE_CHANGED" error:error],nil;
  }
  NSString*executor=[NSString stringWithUTF8String:ynx::ide::initiator_private::pins[0].sha256];
  if(![[NSString stringWithUTF8String:policy->contractRelayExecutorDigest.c_str()]isEqual:executor])return [self fail:@"IDE_CONTRACT_INITIATOR_EXECUTOR_NOT_ADMITTED" error:error],nil;
  for(NSString*name in @[@"@walletconnect/core",@"@walletconnect/sign-client",@"@walletconnect/utils"]){
   NSString*relative=[NSString stringWithFormat:@"node_modules/%@/package.json",name];NSDictionary*entry=entries[relative];
   // npm's actual package.json is pretty JSON, not the Root canonical record
   // grammar. Its exact bytes are already manifest/FD/hash pinned above.
   NSData*raw=readHeld(relative,[entry[@"bytes"]unsignedLongLongValue],entry[@"sha256"]);id parsed=raw&&raw.length<=131072?[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil]:nil;NSDictionary*package=[parsed isKindOfClass:NSDictionary.class]?parsed:nil;id exportMap=package[@"exports"];id primary=[exportMap isKindOfClass:NSDictionary.class]?exportMap[@"."]:nil;NSDictionary*exports=[primary isKindOfClass:NSDictionary.class]?primary:nil;
   if(![package[@"name"]isEqual:name]||![package[@"version"]isEqual:@"2.23.10"]||![exports isKindOfClass:NSDictionary.class]||![exports[@"default"]isEqual:@"./dist/index.cjs"]||exports[@"import"]||exports[@"require"])return [self fail:@"IDE_CONTRACT_INITIATOR_DEPENDENCY_NAMESPACE_CHANGED" error:error],nil;
  }
  if(![self assertOriginalIDEContractRelayRuntimeCurrent:error])return nil;
  NSDictionary*after=[self copyOriginalIDEContractRelayScopeLocal:error];
  if(_invalid||_retired||_policy!=policy||!after||![before isEqual:after]||![_relayRuntimeManifestOriginal isEqual:manifest])return [self fail:@"IDE_CONTRACT_INITIATOR_POST_CURRENT_CHANGED" error:error],nil;
  // Pure private observations. Only the exact original Source can supply them;
  // the typed Native holder below ANDs its own lifetime, not a caller bool.
  return @{@"version":@"YNX-IDE-CONTRACT-INITIATOR-CODE/v1",@"role":@"developer-contract-initiator",@"walletConnectVersion":@"2.23.10",@"verifyHTTP":@"forbidden",@"runtimeSHA256":[NSString stringWithUTF8String:policy->contractRelayRuntimeManifestDigest.c_str()],@"executorSHA256":executor,@"scope":after};
 }
}
