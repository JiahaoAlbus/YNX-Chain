#include "original-http-v5-acquire.inc.mm"
- (BOOL)assertOriginalProductSessionHTTPProofV5SourceCurrent:(NSError**)error{
 @synchronized(self){
 if([self class]!=YNXAuthIdentitySourceAuthority.class||!_productHTTPV5||!_policy||_policy->purpose!="product-session-device-http-binary-source-v5"||![SourceProofDictionary(_rootOriginal,16384)[@"version"]isEqual:@2])return [self fail:@"PRODUCT_HTTP_V5_INDEPENDENT_SOURCE_REQUIRED" error:error];
 if(![self assertAuthenticatedNativePurpose:error])return NO;
 if(![_selection[@"expectedRequest"][@"operations"]isEqual:@[@"device.current",@"device.http-proof-v5"]])return [self fail:@"PRODUCT_HTTP_V5_DEDICATED_OPERATIONS_REQUIRED" error:error];
 uint64_t profileEnd=0;NSDictionary*p=SourceOriginalBodyHint(_profileOriginal);if(!ynx_auth_private::originalQueryProfileNumberU64(p[@"expiresAtMs"],profileEnd))return [self fail:@"PRODUCT_HTTP_V5_PROFILE_WINDOW_REQUIRED" error:error];
 uint64_t wall=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0),mono=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();NSDictionary*scope=HTTPV5ScopeDATA(_selection,profileEnd,_cachedCurrentExpiresMS,wall);if(!scope)return [self fail:@"PRODUCT_HTTP_V5_REGISTERED_SCOPE_REQUIRED" error:error];
 uint64_t end=[scope[@"expiresAtMs"]unsignedLongLongValue];if(!_httpV5Deadline){_httpV5Deadline=end;_httpV5WallAnchor=wall;_httpV5MonoAnchor=mono;}else _httpV5Deadline=std::min(_httpV5Deadline,end);
 if(mono<_httpV5MonoAnchor||UINT64_MAX-_httpV5WallAnchor<mono-_httpV5MonoAnchor||std::max(wall,_httpV5WallAnchor+mono-_httpV5MonoAnchor)>=_httpV5Deadline)return [self fail:@"PRODUCT_HTTP_V5_WINDOW_EXPIRED" error:error];
 try{const auto n=std::string([scope[@"networkId"]UTF8String]),digest=std::string([_selection[@"productSessionHTTPProofV5"][@"expected"][@"registrationDigest"]UTF8String]);if(!_httpV5Store)_httpV5Store=ynx_auth_private::openOriginalDeviceAssociationKeychainStore();if(!_httpV5ItemSelected){_httpV5SameItem=_httpV5Store->readPublic(n,digest);_httpV5ItemSelected=YES;}
 _httpV5Store->assertIdentity(_httpV5SameItem);NSMutableString*a=[NSMutableString new],*b=[NSMutableString new];for(auto c:_httpV5SameItem.publicPair.pa)[a appendFormat:@"%02x",c];for(auto c:_httpV5SameItem.publicPair.pb)[b appendFormat:@"%02x",c];
 if(_httpV5SameItem.network!=n||_httpV5SameItem.persistentRef.empty()||_httpV5SameItem.metadata.empty()||![a isEqual:scope[@"pkA"]]||![b isEqual:scope[@"pkB"]])return [self fail:@"PRODUCT_HTTP_V5_SAME_REGISTERED_ITEM_PAIR_REQUIRED" error:error];_httpV5Store->assertIdentity(_httpV5SameItem);
 }catch(...){return [self fail:@"PRODUCT_HTTP_V5_REGISTERED_ITEM_NOT_CURRENT" error:error];}
 return [self heldCurrent:error];
 }
}
- (NSDictionary*)copyOriginalProductSessionHTTPProofV5Scope:(NSError**)error{
 @synchronized(self){if(![self assertOriginalProductSessionHTTPProofV5SourceCurrent:error])return nil;uint64_t pe=0;if(!ynx_auth_private::originalQueryProfileNumberU64(SourceOriginalBodyHint(_profileOriginal)[@"expiresAtMs"],pe))return nil;NSDictionary*s=HTTPV5ScopeDATA(_selection,pe,_cachedCurrentExpiresMS,(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0));if(!s)return [self fail:@"PRODUCT_HTTP_V5_SCOPE_UNAVAILABLE" error:error],nil;NSMutableDictionary*d=[s mutableCopy];d[@"expiresAtMs"]=@(std::min(_httpV5Deadline,[s[@"expiresAtMs"]unsignedLongLongValue]));NSData*raw=HTTPV5Canonical(d);NSDictionary*copy=raw?[NSJSONSerialization JSONObjectWithData:raw options:0 error:nil]:nil;return copy&&[self assertOriginalProductSessionHTTPProofV5SourceCurrent:error]?copy:nil;}
}
- (NSDictionary*)copyOriginalProductSessionHTTPProofV5RegisteredContext:(NSError**)error{
 @synchronized(self){NSDictionary*publicScope=[self copyOriginalProductSessionHTTPProofV5Scope:error];if(!publicScope)return nil;NSDictionary*s=_selection[@"productSessionHTTPProofV5"];NSString*ref=[[NSString alloc]initWithBytes:_httpV5SameItem.persistentRef.data() length:_httpV5SameItem.persistentRef.size() encoding:NSUTF8StringEncoding],*os=[[NSString alloc]initWithBytes:_httpV5SameItem.osIdentity.data() length:_httpV5SameItem.osIdentity.size() encoding:NSUTF8StringEncoding];NSDictionary*out=@{@"scope":publicScope,@"context":s[@"context"],@"registrationOriginal":s[@"registrationOriginal"],@"sessionOriginal":s[@"sessionOriginal"],@"persistentRef":ref,@"osIdentity":os,@"sameItemAccount":[NSString stringWithUTF8String:_httpV5SameItem.account.c_str()],@"sameItemOperation":[NSString stringWithUTF8String:_httpV5SameItem.operation.c_str()],@"sameItemMetadata":[NSString stringWithUTF8String:_httpV5SameItem.metadata.c_str()]};return [self assertOriginalProductSessionHTTPProofV5SourceCurrent:error]?out:nil;}
}
- (NSString*)copyOriginalProductSessionHTTPProofV5ModulePath:(NSError**)error{
 @synchronized(self){if(![self assertOriginalProductSessionHTTPProofV5SourceCurrent:error]||![self pinOriginalIDEProofRuntime:error])return nil;
 const auto&path=_policy->productHTTPV5TransportModulePath;const auto&digest=_policy->productHTTPV5TransportModuleDigest;const auto bytes=_policy->productHTTPV5TransportModuleBytes;
 NSString*root=[[[NSString stringWithUTF8String:_policy->verifierImagePath.c_str()]stringByDeletingLastPathComponent]stringByDeletingLastPathComponent];NSString*fixed=[root stringByAppendingPathComponent:@"src/original-http-binary-v5-client-private.js"];
 if(bytes!=16811||digest!="0ed0751df3b51f44eb3643b5802a6892c9fd375168a8006ad17a1a71ed0ef23f"||path!=std::string(fixed.UTF8String))return [self fail:@"PRODUCT_HTTP_V5_FIXED_TRANSPORT_RELEASE_REQUIRED" error:error],nil;
 // Must ALREADY be held by the complete signed runtime manifest. A lone
 // transport-file hash never creates a trusted transitive closure here.
 for(const auto&held:_files)if([held.path isEqual:fixed]){struct stat st{};if(fstat(held.fd,&st)||!SourceSame(st,held.identity)||(uint64_t)st.st_size!=bytes)return [self fail:@"PRODUCT_HTTP_V5_TRANSPORT_CHANGED" error:error],nil;return [self assertOriginalProductSessionHTTPProofV5SourceCurrent:error]?[fixed copy]:nil;}
 return [self fail:@"PRODUCT_HTTP_V5_TRANSITIVE_CLOSURE_NOT_SUPPLIED" error:error],nil;
 }
}
- (BOOL)retainOriginalHTTPV5RegisteredChild:(NSError**)error{@synchronized(self){if(![self assertOriginalProductSessionHTTPProofV5SourceCurrent:error]||_httpV5Loans==UINT_MAX)return NO;++_httpV5Loans;return YES;}}
- (void)releaseOriginalHTTPV5RegisteredChild{@synchronized(self){if(_httpV5Loans)--_httpV5Loans;}}
- (std::shared_ptr<ynx_auth_private::OriginalHTTPV5RegisteredReadLease>)borrowOriginalProductSessionHTTPProofV5RegisteredReadLease:(NSError**)error{return ynx_auth_private::borrowOriginalHTTPV5RegisteredReadLease(self,error);}
