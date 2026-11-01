+ (instancetype)acquireOriginalWalletNativePayClientSource:(NSError**)error {
 YNXAuthIdentitySourceAuthority*s=[self new];s->_walletNativePay=YES;s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 s->_payObserved=ynx_auth_private::OriginalPaySourceMathCompletion::makeState();
 try{@try{
  NSError*e=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalWalletNativePayClientProfile:&e];
  if(e||!s->_custody){[s fail:e.localizedDescription?:@"PAY_NATIVE_ORIGINAL_PROFILE_NOT_SUPPLIED" error:error];return s;}
  s->_profileOriginal=[s->_custody copyOriginalProfile:&e];s->_headOriginal=[s->_custody copyOriginalHead:&e];
  id source=SourceOriginalBodyHint(s->_profileOriginal)[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto&p:ynx_auth_private::originalNativeSourceReleases())if(p.sourceId==[source UTF8String]){if(s->_policy){[s fail:@"PAY_NATIVE_DUPLICATE_RELEASE" error:error];return s;}s->_policy=&p;}
  if(e||!s->_policy||s->_policy->purpose!="wallet-native-pay-client-source-v1"||s->_policy->walletNativePayProductId!="wallet"||s->_policy->walletNativePayPlatform!="macos"||s->_policy->walletNativePayApplicationId.empty()||s->_policy->walletNativePayUID!=getuid()){[s fail:@"PAY_NATIVE_INDEPENDENT_RELEASE_NOT_SUPPLIED" error:error];return s;}
  NSString*root=[[s->_custody copyOriginalResourceDirectory:&e]stringByAppendingPathComponent:@"original-auth-identity"];
  if(root)s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"] maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:&e];
  if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"] maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:&e];
  if(e||!s->_enrollmentOriginal||![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()] maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&e]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()] maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&e]||![s assertOriginalWalletNativePayClientCurrent:&e]){[s fail:e.localizedDescription?:@"PAY_NATIVE_ORIGINAL_SOURCE_NOT_CURRENT" error:error];return s;}
  return s;
 }@catch(NSException*){[s fail:@"PAY_NATIVE_SOURCE_CAPTURE_EXCEPTION" error:error];return s;}}catch(...){[s fail:@"PAY_NATIVE_SOURCE_CAPTURE_CPP_EXCEPTION" error:error];return s;}
}
- (BOOL)assertOriginalWalletNativePayClientCurrent:(NSError**)error {
 @synchronized(self){
  if(!_walletNativePay||!_policy||_policy->purpose!="wallet-native-pay-client-source-v1"||!_payObserved)return [self fail:@"PAY_NATIVE_DEDICATED_SOURCE_REQUIRED" error:error];
  return [self assertAuthenticatedNativePurpose:error];
 }
}
- (const void*)originalWalletNativePaySourceMarker:(NSError**)error {
 @synchronized(self){if(![self assertOriginalWalletNativePayClientCurrent:error])return nullptr;return (const void*)&YNXOriginalWalletNativePayHiddenMarker;}
}
- (NSDictionary*)copyOriginalWalletNativePayClientContext:(NSError**)error {
 @synchronized(self){if(![self assertOriginalWalletNativePayClientCurrent:error])return nil;
  NSDictionary*body=SourceOriginalBodyHint(_profileOriginal),*scope=_selection[@"walletNativePayClientV1"];
  if(![scope isKindOfClass:NSDictionary.class]||![body[@"subjectOwner"]isKindOfClass:NSString.class])return [self fail:@"PAY_NATIVE_AUTHENTICATED_SCOPE_REQUIRED" error:error],nil;
  id issued=SourceOriginalBodyHint(_currentOriginal)[@"issuedAtMs"];if(!issued)return [self fail:@"PAY_NATIVE_ORIGINAL_CURRENT_WINDOW_REQUIRED" error:error],nil;
  NSDictionary*result=@{@"scope":[scope copy],@"sourceId":[NSString stringWithUTF8String:_policy->sourceId.c_str()],@"subjectOwner":body[@"subjectOwner"],@"issuedAtMs":issued,@"expiresAtMs":@(_cachedCurrentExpiresMS)};
  if(![self heldCurrent:error]||_cachedCurrentExpiresMS<=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0))return nil;return result;
 }
}
- (std::shared_ptr<ynx_auth_private::PayObservedPermission>)borrowOriginalWalletNativePayPermission:(NSError**)error {
 @synchronized(self){if(![self assertOriginalWalletNativePayClientCurrent:error])return {};
  uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  if(now<_timeFloor||now>=_cachedCurrentExpiresMS)return [self fail:@"PAY_NATIVE_PERMISSION_LATE" error:error],std::shared_ptr<ynx_auth_private::PayObservedPermission>{};
  // Only this original math-success path can mint. Parent stays held through
  // actual native children. No refresh operation exists on the returned loan.
  auto owner=std::shared_ptr<void>((__bridge_retained void*)self,[](void*p){CFRelease(p);});
  auto loan=ynx_auth_private::OriginalPaySourceMathCompletion::mint(_payObserved,std::move(owner),_payCurrentMonoDeadline);
  if(!loan||![self heldCurrent:error]||loan->current_native()!=0){[self fail:@"PAY_NATIVE_PERMISSION_POST_CURRENT" error:error];return loan;}
  return loan;
 }
}
- (BOOL)closeOriginalWalletNativePaySource:(NSError**)error {
 @synchronized(self){[self retire];
  if(_payObserved&&ynx_auth_private::OriginalPaySourceMathCompletion::loans(_payObserved)){
   if(!_payCloseCause)_payCloseCause=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PAY_NATIVE_CHILDREN_RETAINED"}];if(error)*error=_payCloseCause;return NO;
  }
  if(_closeSelected){if(error)*error=_payCloseCause?:_cleanupCause;return _cleanupComplete;}
  if(![self join:error])return NO;_closeSelected=YES;
  if(_publicInstallation&&!_publicInstallation->close()){_cleanupCause=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PAY_NATIVE_PUBLIC_CHILD_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;}
  for(auto it=_files.rbegin();it!=_files.rend();++it){if(it->selected){if(!it->complete){if(error)*error=_cleanupCause;return NO;}continue;}it->selected=true;it->complete=::close(it->fd)==0;if(!it->complete){_cleanupCause=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PAY_NATIVE_FILE_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;}}
  for(NSUInteger n=_pipeHandles.count;n>0;--n){NSUInteger i=n-1;if(_pipeStates[i].intValue==1)continue;if(_pipeStates[i].intValue!=0){if(error)*error=_cleanupCause;return NO;}_pipeStates[i]=@2;NSError*e=nil;if(![_pipeHandles[i]closeAndReturnError:&e]||e){_cleanupCause=e?:[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"PAY_NATIVE_PIPE_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;}_pipeStates[i]=@1;}
  NSError*e=nil;if(_custody&&![_custody close:&e]){_cleanupCause=e;if(error)*error=e;return NO;}
  _cleanupComplete=YES;if(error)*error=_payCloseCause;return YES;
 }
}
