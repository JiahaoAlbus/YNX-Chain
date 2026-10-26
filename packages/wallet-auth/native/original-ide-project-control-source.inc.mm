// Included inside the SAME original Source @implementation. No new Source
// wrapper, supplied provider, caller path, Root row or signing fallback.
static NSData*SourceControlBase64(id value,NSUInteger maximum){
 if(![value isKindOfClass:NSString.class]||![value length]||[value length]>((maximum*4+2)/3))return nil;
 NSString*s=[[value stringByReplacingOccurrencesOfString:@"-" withString:@"+"]stringByReplacingOccurrencesOfString:@"_" withString:@"/"];if(s.length%4==1)return nil;while(s.length%4)s=[s stringByAppendingString:@"="];
 NSData*raw=[[NSData alloc]initWithBase64EncodedString:s options:0];if(!raw.length||raw.length>maximum)return nil;
 NSString*again=[[[[raw base64EncodedStringWithOptions:0]stringByReplacingOccurrencesOfString:@"+" withString:@"-"]stringByReplacingOccurrencesOfString:@"/" withString:@"_"]stringByReplacingOccurrencesOfString:@"=" withString:@""];return [again isEqual:value]?raw:nil;
}
static NSString*SourceControlActualWalletCode(){
 SecCodeRef dynamic=nullptr;SecStaticCodeRef image=nullptr;CFDictionaryRef info=nullptr;
 OSStatus rc=SecCodeCopySelf(kSecCSDefaultFlags,&dynamic);if(rc==errSecSuccess)rc=SecCodeCheckValidity(dynamic,kSecCSStrictValidate,nullptr);
 if(rc==errSecSuccess)rc=SecCodeCopyStaticCode(dynamic,kSecCSDefaultFlags,&image);if(rc==errSecSuccess)rc=SecStaticCodeCheckValidity(image,kSecCSStrictValidate,nullptr);
 if(rc==errSecSuccess)rc=SecCodeCopySigningInformation(image,kSecCSSigningInformation,&info);
 id code=info?((__bridge NSDictionary*)info)[(__bridge NSString*)kSecCodeInfoUnique]:nil;NSString*result=rc==errSecSuccess&&[code isKindOfClass:NSData.class]?[code base64EncodedStringWithOptions:0]:nil;
 if(info)CFRelease(info);if(image)CFRelease(image);if(dynamic)CFRelease(dynamic);return result;
}
+ (instancetype)acquireOriginalIDEProjectControlAuthoritySource:(NSError**)error {
 if(error)*error=nil;YNXAuthIdentitySourceAuthority*s=[self new];s->_ideRegistry=YES;s->_ideControlConsumer=YES;s->_headDigest=@"";s->_pipeHandles=[NSMutableArray array];s->_pipeStates=[NSMutableArray array];
 NSError*actual=nil;s->_custody=[YNXAuthIdentityCurrentOwner acquireOriginalIDEProjectControlProfile:&actual];
 if(!s->_custody){if(error)*error=actual;return nil;}
 if(actual){s->_firstCause=actual;[s fail:@"IDE_CONTROL_ORIGINAL_CUSTODY_PARTIAL" error:error];return s;}
 s->_profileOriginal=[s->_custody copyOriginalProfile:&actual];s->_headOriginal=[s->_custody copyOriginalHead:&actual];
 if(s->_profileOriginal&&s->_headOriginal&&!actual){
  id source=SourceOriginalBodyHint(s->_profileOriginal)[@"sourceId"];
  if([source isKindOfClass:NSString.class])for(const auto&row:ynx_auth_private::originalNativeSourceReleases())if(row.sourceId==[source UTF8String]&&row.purpose=="ide-project-control-authority-v1"){s->_policy=&row;break;}
  if(s->_policy){NSString*root=[[s->_custody copyOriginalResourceDirectory:&actual]stringByAppendingPathComponent:@"original-auth-identity"];
   s->_rootOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"root.original"]maximum:ynx_auth_private::OriginalAuthPublicRootMax image:NO digest:s->_policy->rootDigest error:&actual];
   if(s->_rootOriginal)s->_enrollmentOriginal=[s holdPublic:[root stringByAppendingPathComponent:@"enrollment.original"]maximum:ynx_auth_private::OriginalAuthPublicOriginalMax image:NO digest:s->_policy->enrollmentDigest error:&actual];
   if(s->_enrollmentOriginal&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->verifierImagePath.c_str()]maximum:131072 image:YES digest:s->_policy->verifierImageDigest error:&actual]&&[s holdPublic:[NSString stringWithUTF8String:s->_policy->nodeImagePath.c_str()]maximum:134217728 image:YES digest:s->_policy->nodeImageDigest error:&actual]&&[s assertAuthenticatedNativePurpose:&actual])return s;
  }
 }
 if(actual&&!s->_firstCause)s->_firstCause=actual;[s fail:@"IDE_CONTROL_DEDICATED_SOURCE_NOT_ADMITTED" error:error];
 // Actual partial custody is returned to Main even on acquisition error.
 // Caller must retain/retire/join/close it; it is never a review or grant.
 return s;
}
- (NSDictionary*)copyOriginalIDEProjectControlCapture:(NSError**)error {
 @synchronized(self){
  if(error)*error=nil;
  if(_controlLocalEntered||_entered||_projectLocalEntered||_relayLocalEntered||_relayRuntimeEntered||!NSThread.isMainThread||getuid()==0||getuid()!=geteuid()){[self fail:@"IDE_CONTROL_ORIGINAL_ACTOR_REQUIRED" error:error];return nil;}
  if(![self assertCurrent:error])return nil;_controlLocalEntered=YES;
  @try{
   if(_invalid||_retired||!_ideControlConsumer||!_policy||_policy->purpose!="ide-project-control-authority-v1"){[self fail:@"IDE_CONTROL_DEDICATED_SOURCE_REQUIRED" error:error];return nil;}
   NSDictionary*c=_selection[@"projectControlCapture"],*peer=_selection[@"identityPeerBinding"],*association=_selection[@"association"],*root=SourceProofDictionary(_rootOriginal,16384),*body=SourceOriginalBodyHint(_currentOriginal);
   if(![root[@"version"]isEqual:@2]||!SourceProjectKeys(c,@[@"version",@"review",@"requestOriginal",@"principalOriginal",@"commandOriginal",@"expiresAtMs"])||![c[@"version"]isEqual:@"YNX-IDE-PROJECT-CONTROL-CAPTURE/v1"]||![body[@"head"]isEqual:_headDigest]){[self fail:@"IDE_CONTROL_CAPTURE_VERIFIED_V2_REQUIRED" error:error];return nil;}
   NSString*actualCode=SourceControlActualWalletCode();if(!actualCode||![actualCode isEqual:peer[@"walletCodeIdentity"]]){[self fail:@"IDE_CONTROL_ORIGINAL_WALLET_CODE_MISMATCH" error:error];return nil;}
   NSData*request=SourceControlBase64(c[@"requestOriginal"],65536),*principal=SourceControlBase64(c[@"principalOriginal"],16384),*command=SourceControlBase64(c[@"commandOriginal"],16384);NSDictionary*review=c[@"review"];
   uint64_t expires=0;if(!request||!principal||!command||![review isKindOfClass:NSDictionary.class]||![review[@"account"]isEqual:association[@"account"]]||![review[@"networkId"]isEqual:root[@"networkId"]]||!SourceProofU64(c[@"expiresAtMs"],expires,true)||expires>9007199254740991ULL){[self fail:@"IDE_CONTROL_ORIGINAL_CAPTURE_INVALID" error:error];return nil;}
   uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000);if(before<_timeFloor||before>=expires||expires-before>30000||before>=_cachedCurrentExpiresMS){[self fail:@"IDE_CONTROL_CAPTURE_EXPIRED" error:error];return nil;}_timeFloor=before;
   const auto*policy=_policy;const uint64_t seq=_sequence,floor=_floor,cache=_cachedCurrentExpiresMS;NSData*current=[_currentOriginal copy],*original=[NSJSONSerialization dataWithJSONObject:c options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];NSString*head=[_headDigest copy];
   if(!original||original.length>131072||![self heldCurrent:error])return nil;
   NSData*immutable=[NSPropertyListSerialization dataWithPropertyList:@{@"review":review,@"requestOriginal":request,@"principalOriginal":principal,@"commandOriginal":command,@"expiresAtMs":c[@"expiresAtMs"]}format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil];
   NSDictionary*result=immutable?[NSPropertyListSerialization propertyListWithData:immutable options:NSPropertyListImmutable format:nullptr error:nil]:nil;
   if(!result||result.count!=5||![self heldCurrent:error])return nil;
   NSData*post=[NSJSONSerialization dataWithJSONObject:_selection[@"projectControlCapture"]options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];NSString*postCode=SourceControlActualWalletCode();uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000);
   if(_invalid||_retired||_policy!=policy||_sequence!=seq||_floor!=floor||_cachedCurrentExpiresMS!=cache||![_currentOriginal isEqual:current]||![_headDigest isEqual:head]||![original isEqual:post]||![postCode isEqual:actualCode]||after<_timeFloor||after>=expires||after>=cache){[self fail:@"IDE_CONTROL_POST_CAPTURE_CHANGED" error:error];return nil;}_timeFloor=after;
   return result;
  }@catch(id){[self fail:@"IDE_CONTROL_CAPTURE_UNKNOWN" error:error];return nil;}@finally{_controlLocalEntered=NO;}
 }
}
