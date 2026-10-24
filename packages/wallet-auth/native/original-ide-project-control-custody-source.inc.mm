// In the SAME Source implementation. No private bytes, Keychain access or
// caller policy in this metadata selector. Root-current verification already
// checked this descriptor against its complete registered subject pair.
- (NSDictionary*)copyOriginalIDEProjectControlSigningContext:(NSError**)error {
 @synchronized(self){
  if(error)*error=nil;NSDictionary*capture=[self copyOriginalIDEProjectControlCapture:error];if(!capture)return nil;
  _controlLocalEntered=YES;
  @try{
   NSDictionary*c=_selection[@"projectControlCustody"],*peer=_selection[@"identityPeerBinding"],*profile=SourceOriginalBodyHint(_profileOriginal),*root=SourceProofDictionary(_rootOriginal,16384);
   if(!_ideControlConsumer||!_policy||_policy->purpose!="ide-project-control-authority-v1"||!SourceProjectKeys(c,@[@"version",@"purpose",@"keyRole",@"owner",@"keyVersion",@"pkA",@"pkB",@"keychainAccount",@"expiresAtMs"])||![c[@"version"]isEqual:@"YNX-IDE-PROJECT-CONTROL-CUSTODY/v1"]||![c[@"purpose"]isEqual:@"IDE-PROJECT-CONTROL"]||![c[@"keyRole"]isEqual:@"ide-project-control-consent"]||![c[@"owner"]isEqual:profile[@"subjectOwner"]]){[self fail:@"IDE_CONTROL_CUSTODY_NOT_ADMITTED" error:error];return nil;}
   NSData*a=SourceControlBase64(c[@"pkA"],2592),*b=SourceControlBase64(c[@"pkB"],64);uint64_t key=0,expires=0,captureExpiry=0;
   if(a.length!=2592||b.length!=64||!SourceProofU64(c[@"keyVersion"],key,true)||!SourceProofU64(c[@"expiresAtMs"],expires,true)||!SourceProofU64(capture[@"expiresAtMs"],captureExpiry,true)||!_observationHeight.length){[self fail:@"IDE_CONTROL_CUSTODY_BINDING_INVALID" error:error];return nil;}
   NSDictionary*address=@{@"version":c[@"version"],@"purpose":c[@"purpose"],@"keyRole":c[@"keyRole"],@"networkId":root[@"networkId"]?:@"",@"owner":c[@"owner"],@"keyVersion":c[@"keyVersion"],@"pkA":c[@"pkA"],@"pkB":c[@"pkB"]};
   NSData*addressRaw=[NSJSONSerialization dataWithJSONObject:address options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
   if(!addressRaw||![SourceSHA(addressRaw)isEqual:c[@"keychainAccount"]]){[self fail:@"IDE_CONTROL_CUSTODY_ADDRESS_INVALID" error:error];return nil;}
   NSData*p=capture[@"principalOriginal"];NSDictionary*principal=SourceProofDictionary(p,16384);NSString*actual=SourceControlActualWalletCode();
   if(![principal[@"CurrentRef"]isKindOfClass:NSString.class]||![principal[@"CurrentRef"]length]||![actual isEqual:peer[@"walletCodeIdentity"]]){[self fail:@"IDE_CONTROL_CUSTODY_CALLER_INVALID" error:error];return nil;}
   expires=std::min(expires,std::min(captureExpiry,_cachedCurrentExpiresMS));uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000);
   if(now<_timeFloor||now>=expires||![self heldCurrent:error]){[self fail:@"IDE_CONTROL_CUSTODY_EXPIRED" error:error];return nil;}_timeFloor=now;
   return @{@"networkId":root[@"networkId"],@"owner":c[@"owner"],@"keyVersion":c[@"keyVersion"],@"executionHeight":_observationHeight,@"callerIdentity":actual,@"sourceCurrentRef":principal[@"CurrentRef"],@"pkA":a,@"pkB":b,@"keychainAccount":c[@"keychainAccount"],@"expiresAtMs":[NSString stringWithFormat:@"%llu",(unsigned long long)expires]};
  }@catch(id){[self fail:@"IDE_CONTROL_CUSTODY_CONTEXT_UNKNOWN" error:error];return nil;}@finally{_controlLocalEntered=NO;}
 }
}
// Private same-image child custody. Token never crosses a Node/IDE interface.
- (id)reserveOriginalControlKeyBorrow:(NSError**)error {@synchronized(self){
 if(_controlKeyBorrowSelected||_controlKeyBorrowToken||_retired||_invalid||_closeSelected||_entered||_controlLocalEntered){[self fail:@"IDE_CONTROL_KEY_BORROW_ONCE" error:error];return nil;}
 _controlKeyBorrowSelected=YES;_controlKeyBorrowToken=[NSObject new];return _controlKeyBorrowToken;
}}
- (BOOL)releaseOriginalControlKeyBorrow:(id)token error:(NSError**)error {@synchronized(self){
 if(!token||token!=_controlKeyBorrowToken){if(error)*error=[NSError errorWithDomain:@"YNXOriginalSourceAuthority" code:1 userInfo:@{NSLocalizedDescriptionKey:@"IDE_CONTROL_KEY_BORROW_IDENTITY_MISMATCH"}];return NO;}
 _controlKeyBorrowToken=nil;return YES;
}}
