// Included INSIDE the original SourceAuthority implementation, same lexical
// verifier/current/held runtime. It does not call the installed-WPR consumer.
+ (instancetype)acquireOriginalWPRPublicationForPeer:(YNXWPRPublicationPeer*)peer error:(NSError**)error {
 YNXAuthIdentitySourceAuthority*s=[self new];s->_wprPublication=YES;s->_ideRegistry=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 @try{try{
 if(![YNXWPRPublicationPeer isOriginalPeer:peer]||![peer assertCurrentMessage:error]){[s fail:@"WPR_PUBLICATION_ORIGINAL_PEER_REQUIRED" error:error];return s;}
 const auto*row=[peer originalRegisteredRelease:error];if(!ynx::wallet::product::publication::registered(row)||!ynx::wallet::product::publication::valid_installation_release(*row)){[s fail:@"WPR_PUBLICATION_RELEASE_REQUIRED" error:error];return s;}
 s->_wprPublicationPeer=peer;s->_wprPublicationRow=row;s->_policy=&row->product.source;s->_productPolicy=&row->product;
 auto input=ynx::wallet::product::publication::StagedOriginals::acquire(row);s->_wprPublicationInputs=input.owner;
 if(input.error||!input.owner){[s fail:@"WPR_PUBLICATION_INPUTS_NOT_SUPPLIED" error:error];return s;}
 const auto&raw=input.owner->originals_DATA();auto data=[](const auto&v){return[NSData dataWithBytes:v.data() length:v.size()];};
 s->_rootOriginal=data(raw[0]);s->_enrollmentOriginal=data(raw[1]);s->_profileOriginal=data(raw[2]);s->_headOriginal=data(raw[3]);
 // Original Source-v2 math, registered role/current and the SAME protected
 // Node/runtime closure. No filesystem row or JSON body is Source authority.
 if(![SourceProofDictionary(s->_rootOriginal,16384)[@"version"]isEqual:@2]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()]maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:error]||![s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()]maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:error]||![s assertAuthenticatedNativePurpose:error])return s;
 if(![peer assertCurrentMessage:error]||input.owner->current()){[s fail:@"WPR_PUBLICATION_POST_INPUTS_CHANGED" error:error];return s;}return s;
 }catch(...){[s fail:@"WPR_PUBLICATION_SOURCE_CPP_UNKNOWN" error:error];return s;}}@catch(NSException*){[s fail:@"WPR_PUBLICATION_SOURCE_EXCEPTION_UNKNOWN" error:error];return s;}
}
- (NSDictionary*)copyOriginalWPRPublicationOriginals:(NSError**)error {
 @synchronized(self){
 if([self class]!=YNXAuthIdentitySourceAuthority.class||!_wprPublication||_walletNativeProduct||!_wprPublicationInputs||!ynx::wallet::product::publication::registered(_wprPublicationRow)||_policy!=&_wprPublicationRow->product.source||_productPolicy!=&_wprPublicationRow->product||![_wprPublicationPeer assertCurrentMessage:error])return[self fail:@"WPR_PUBLICATION_SOURCE_REQUIRED" error:error],nil;
 NSDictionary*snapshot=[self copyOriginalProvisioningPublicOriginals:error];if(!snapshot)return nil;
 if(![SourceSHA(snapshot[@"rootOriginal"])isEqual:[NSString stringWithUTF8String:_wprPublicationRow->public_original_sha256[0].c_str()]]||![SourceSHA(snapshot[@"enrollmentOriginal"])isEqual:[NSString stringWithUTF8String:_wprPublicationRow->public_original_sha256[1].c_str()]]||![SourceSHA(snapshot[@"profileOriginal"])isEqual:[NSString stringWithUTF8String:_wprPublicationRow->public_original_sha256[2].c_str()]]||![SourceSHA(_headOriginal)isEqual:[NSString stringWithUTF8String:_wprPublicationRow->public_original_sha256[3].c_str()]]||![_wprPublicationPeer assertCurrentMessage:error]||_wprPublicationInputs->current())return[self fail:@"WPR_PUBLICATION_SAME_ORIGINALS_REQUIRED" error:error],nil;
 NSMutableDictionary*result=[snapshot mutableCopy];result[@"acquisitionHeadOriginal"]=[_headOriginal copy];return[result copy];
 }
}
- (BOOL)closeOriginalWPRPublicationSource:(NSError**)error {
 @synchronized(self){if(!_wprPublication)return[self fail:@"WPR_PUBLICATION_SOURCE_REQUIRED" error:error];[self retire];
 if(_cleanupComplete){if(error)*error=_cleanupCause;return YES;}
 if(![self join:error])return NO;
 auto refuse=[&](NSError*cause){if(!_cleanupCause)_cleanupCause=cause?:[NSError errorWithDomain:@"WPRPublication" code:1 userInfo:@{NSLocalizedDescriptionKey:@"WPR_PUBLICATION_RUNTIME_CLOSE_UNKNOWN"}];if(error)*error=_cleanupCause;return NO;};
 if(!_wprPublicationRuntimeClosed){if(_closeSelected)return refuse(nil);_closeSelected=YES;
  // Child-first SAME original pipes/images. No post-close retry or input
  // parent release after an ambiguous child close. No IDE permission path.
  for(NSUInteger reverse=_pipeHandles.count;reverse>0;--reverse){NSUInteger n=reverse-1;if(_pipeStates[n].intValue==1)continue;if(_pipeStates[n].intValue!=0)return refuse(nil);_pipeStates[n]=@2;NSError*cause=nil;if(![_pipeHandles[n]closeAndReturnError:&cause]||cause)return refuse(cause);_pipeStates[n]=@1;}
  for(auto it=_files.rbegin();it!=_files.rend();++it){if(it->selected){if(!it->complete)return refuse(nil);continue;}it->selected=true;it->complete=::close(it->fd)==0;if(!it->complete)return refuse(nil);}
  _wprPublicationRuntimeClosed=YES;
 }
 if(_wprPublicationInputs&&!_wprPublicationInputs->physically_closed()){
 if(_wprPublicationInputs->close()){if(error)*error=[NSError errorWithDomain:@"WPRPublication" code:1 userInfo:@{NSLocalizedDescriptionKey:@"WPR_PUBLICATION_INPUT_CLOSE_UNKNOWN"}];return NO;}}
 _cleanupComplete=YES;return YES;}
}
- (BOOL)originalWPRPublicationPhysicallyClosed{@synchronized(self){return _wprPublication&&_cleanupComplete&&(!_wprPublicationInputs||_wprPublicationInputs->physically_closed());}}
