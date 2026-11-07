// Included in the SAME lexical SourceAuthority. No borrowed consumer grant,
// untrusted JSON provider or dynamically supplied verifier path is used.
- (NSData*)copyOriginalWPRRegistrationCapture:(NSError**)error {
 @synchronized(self){
 if(!_wprPublication||_walletNativeProduct||!ynx::wallet::product::publication::registered(_wprPublicationRow)||![_wprPublicationPeer assertCurrentMessage:error]||![self heldCurrent:error])return nil;
 const auto&r=*_wprPublicationRow;
 if(r.registration_capture_entry.empty()||r.registration_capture_entry.front()!='/'||!ynx::wallet::product::publication::digest(r.registration_capture_entry_sha256))return[self fail:@"WPR_CAPTURE_ENTRY_NOT_SUPPLIED" error:error],nil;
 NSString*entry=[NSString stringWithUTF8String:r.registration_capture_entry.c_str()];NSString*directory=[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]stringByDeletingLastPathComponent];
 if(![entry.lastPathComponent isEqual:@"original-wallet-product-registration-capture-runner.mjs"]||r.registration_capture_entry_sha256!="0b9a332b1459da450c3a54913e92beda364d4279c80fbba866c86cb1a327d630"||![entry.stringByDeletingLastPathComponent isEqual:directory])return[self fail:@"WPR_CAPTURE_SAME_PINNED_RUNTIME_REQUIRED" error:error],nil;
 BOOL rawModuleHeld=NO;NSString*rawModule=[directory stringByAppendingPathComponent:@"original-wallet-product-registration-capture.mjs"];
 for(const auto&file:_files)if(!file.selected&&[file.path isEqual:rawModule]){rawModuleHeld=YES;break;}
 if(!rawModuleHeld)return[self fail:@"WPR_CAPTURE_WHOLE_CLOSURE_REQUIRED" error:error],nil;
 if(!_wprCaptureEntryHeld){if(![self holdPublic:[NSString stringWithUTF8String:r.registration_capture_entry.c_str()]maximum:131072 image:YES digest:r.registration_capture_entry_sha256 error:error])return nil;_wprCaptureEntryHeld=YES;}
 _wprCaptureSelected=YES;
 @try{BOOL okay=[self assertAuthenticatedNativePurpose:error];NSData*partial=[_wprRegistrationCapture copy];if(!okay)return partial;
 if(!partial||!_wprExpectedCaptureInput||![_wprPublicationPeer assertCurrentMessage:error]||![self heldCurrent:error])return partial;
 return partial;
 }@finally{_wprCaptureSelected=NO;}
 }
}
- (NSData*)copyOriginalWPRExpectedCaptureInput:(NSError**)error {
 @synchronized(self){if(!_wprPublication||!_wprRegistrationCapture||!_wprExpectedCaptureInput||![self heldCurrent:error])return nil;return[_wprExpectedCaptureInput copy];}
}
- (NSDictionary*)copyOriginalWPRMaterializationCaptureBundle:(NSError**)error {
 @synchronized(self){NSData*raw=[self copyOriginalWPRRegistrationCapture:error];
 // Same actual invocation and fresh current: do not start another Source math
 // round between the capture and its paired currentOriginal/inputOriginal.
 NSMutableDictionary*actual=[NSMutableDictionary dictionary];if(raw)actual[@"registrationCaptureOriginal"]=raw;
 if(_wprExpectedCaptureInput)actual[@"expectedInputOriginal"]=[_wprExpectedCaptureInput copy];
 if(_currentOriginal)actual[@"currentOriginal"]=[_currentOriginal copy];
 if(![self heldCurrent:error]||![_wprPublicationPeer assertCurrentMessage:error])return[actual copy];return[actual copy];}
}
- (NSData*)copyIndependentWPRMaterializationOriginal:(NSError**)error {
 @synchronized(self){
 if(!_wprPublication||!ynx::wallet::product::publication::registered(_wprPublicationRow)||![_wprPublicationPeer assertCurrentMessage:error]||![self heldCurrent:error])return nil;
 const auto&r=*_wprPublicationRow;
 if(!ynx::wallet::product::publication::digest(r.independent_materialization_sha256)||!r.independent_materialization_bytes||r.independent_materialization_bytes>2097152)return[self fail:@"WPR_INDEPENDENT_PUBLIC_METADATA_NOT_SUPPLIED" error:error],nil;
 if(!_wprIndependentOriginal){NSString*path=[[NSString stringWithUTF8String:r.materialized_directory.c_str()]stringByAppendingPathComponent:@"independent-materialization.original"];
 NSData*actual=[self holdPublic:path maximum:2097152 image:NO digest:r.independent_materialization_sha256 error:error];if(actual)_wprIndependentOriginal=[actual copy];
 if(actual.length!=r.independent_materialization_bytes)return[self fail:@"WPR_INDEPENDENT_PUBLIC_METADATA_LENGTH" error:error],actual;}
 NSData*actual=[_wprIndependentOriginal copy];
 NSDictionary*metadata=SourceProofDictionary(actual,2097152),*build=metadata[@"build"],*expected=metadata[@"expectedContext"];
 NSSet*keys=[NSSet setWithArray:@[@"expectedContext",@"approvals",@"build",@"independentBuildOriginal"]];uint64_t uid=0;
 NSDictionary*node=@{@"origin":[NSString stringWithUTF8String:_policy->nativeNodeOrigin.c_str()],@"spki":[NSString stringWithUTF8String:_policy->nativeNodeSPKI.c_str()],@"nativeChainId":[NSString stringWithUTF8String:_policy->nativeChainId.c_str()]};
 NSDictionary*root=SourceProofDictionary(_rootOriginal,16384),*enrollment=SourceOriginalBodyHint(_enrollmentOriginal),*profile=SourceOriginalBodyHint(_profileOriginal);
 NSArray*owners=@[root[@"rootOwner"]?:NSNull.null,enrollment[@"profileOwner"]?:NSNull.null,enrollment[@"currentOwner"]?:NSNull.null,profile[@"subjectOwner"]?:NSNull.null];
 if(![metadata isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:metadata.allKeys]isEqual:keys]||![build isKindOfClass:NSDictionary.class]||![expected isKindOfClass:NSDictionary.class]||expected.count!=3||![expected[@"node"]isEqual:node]||![expected[@"networkId"]isEqual:root[@"networkId"]]||![expected[@"owners"]isEqual:owners]||![build[@"nativeNode"]isEqual:node]||![build[@"applicationId"]isEqual:[NSString stringWithUTF8String:r.product.application_id.c_str()]]||![build[@"productId"]isEqual:@"wallet"]||![build[@"platform"]isEqual:@"macos"]||!SourceProofU64(build[@"uid"],uid)||uid!=r.product.uid||![build[@"resourceDirectory"]isEqual:[NSString stringWithUTF8String:r.product.resource_directory.c_str()]]){[self fail:@"WPR_INDEPENDENT_METADATA_SAME_ROOT_APP_CONTEXT_REQUIRED" error:error];return actual;}
 if(![self heldCurrent:error]||![_wprPublicationPeer assertCurrentMessage:error])return actual;return actual;
 }
}
- (NSDictionary*)copyOriginalWPRMaterializationBuildOriginals:(NSError**)error {
 @synchronized(self){
 if(!_wprPublication||!_wprRegistrationCapture||![self heldCurrent:error]||![_wprPublicationPeer assertCurrentMessage:error])return nil;
 NSMutableDictionary*actual=[NSMutableDictionary dictionary];actual[@"root"]=[_rootOriginal copy];actual[@"enrollment"]=[_enrollmentOriginal copy];
 NSString*directory=[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]stringByDeletingLastPathComponent];
 NSArray*names=@[@"verifier",@"node",@"runtimeManifest",@"dispatch"];
 NSArray*paths=@[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()],[NSString stringWithUTF8String:_policy->nodeImagePath.c_str()],[directory stringByAppendingPathComponent:@"original-ide-auth-runtime-manifest.json"],[directory stringByAppendingPathComponent:@"original-ide-auth-proof-dispatch.mjs"]];
 const uint64_t caps[]={131072,134217728,1048576,16777216};uint64_t total=_rootOriginal.length+_enrollmentOriginal.length;
 for(NSUInteger n=0;n<names.count;n++){
  BOOL found=NO;for(const auto&file:_files){if(file.selected||![file.path isEqual:paths[n]])continue;found=YES;struct stat before{},after{};
   if(fstat(file.fd,&before)||!SourceSame(file.identity,before)||before.st_size<=0||uint64_t(before.st_size)>caps[n]||total+uint64_t(before.st_size)>153092096){[self fail:@"WPR_BUILD_ORIGINAL_FIXED_FILE_CHANGED" error:error];return[actual copy];}
   NSMutableData*bytes=[NSMutableData dataWithLength:(NSUInteger)before.st_size];size_t at=0;while(at<bytes.length){ssize_t count=pread(file.fd,(unsigned char*)bytes.mutableBytes+at,bytes.length-at,at);if(count<0&&errno==EINTR)continue;if(count<=0){[self fail:@"WPR_BUILD_ORIGINAL_READ_UNKNOWN" error:error];return[actual copy];}at+=size_t(count);}
   // Adopt actual partial before late physical fence. No fresh name/path open.
   actual[names[n]]=[bytes copy];total+=bytes.length;if(fstat(file.fd,&after)||!SourceSame(before,after)){[self fail:@"WPR_BUILD_ORIGINAL_POST_FILE_CHANGED" error:error];return[actual copy];}if(![self heldCurrent:error])return[actual copy];break;
  }if(!found){[self fail:@"WPR_BUILD_ORIGINAL_NOT_HELD" error:error];return[actual copy];}
 }
 uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);if(now<_timeFloor||now>=_cachedCurrentExpiresMS||![self heldCurrent:error]||![_wprPublicationPeer assertCurrentMessage:error]){[self fail:@"WPR_BUILD_ORIGINAL_POST_CURRENT" error:error];return[actual copy];}
 return[actual copy];
 }
}
