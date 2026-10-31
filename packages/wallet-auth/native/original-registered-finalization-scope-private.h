#pragma once
// Native defensive correlation of the sole SDK signed-selection7. Authority
// is the SAME authenticated Source-v2 Root/enrollment/profile/current above
// this helper, never these dictionaries or locally read journal DATA.
static inline bool RegisteredFinalizationKeys(NSDictionary*d,NSArray*keys){return[d isKindOfClass:NSDictionary.class]&&d.count==keys.count&&[[NSSet setWithArray:d.allKeys]isEqual:[NSSet setWithArray:keys]];}
static inline bool RegisteredFinalizationHex(id s,size_t bytes){if(![s isKindOfClass:NSString.class]||[s length]!=bytes*2)return false;for(NSUInteger i=0;i<[s length];i++){unichar c=[s characterAtIndex:i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;}return true;}
static inline NSData*RegisteredFinalizationCanonical(NSDictionary*d){return[NSJSONSerialization dataWithJSONObject:d options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];}
static inline NSDictionary*RegisteredFinalizationParsed(NSString*s,NSUInteger maximum){if(![s isKindOfClass:NSString.class])return nil;NSData*b=[s dataUsingEncoding:NSUTF8StringEncoding];if(!b.length||b.length>maximum)return nil;id d=[NSJSONSerialization JSONObjectWithData:b options:0 error:nil];if(![d isKindOfClass:NSDictionary.class]||![RegisteredFinalizationCanonical(d)isEqual:b])return nil;return d;}
static inline NSDictionary*RegisteredFinalizationScopeDATA(NSDictionary*selection){
 NSDictionary*s=selection[@"productSessionDeviceV4RegisteredFinalization"],*e=s[@"expected"];
 if(!RegisteredFinalizationKeys(s,@[@"version",@"expected",@"originalCreationTerms19",@"originalCreationOperation",@"originalRegistrationOperation",@"registrationOriginal",@"associationOriginal"])||![s[@"version"]isEqual:@"4"]||!RegisteredFinalizationKeys(e,@[@"networkId",@"canonicalOwner",@"account",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"deviceId",@"generation",@"registrationId",@"revision",@"registrationDigest"]))return nil;
 NSArray*identity=@[@"networkId",@"canonicalOwner",@"account",@"productId",@"clientId",@"platform",@"applicationId",@"bundleId",@"packageId",@"origin",@"callback",@"deviceId"];
 NSDictionary*t=RegisteredFinalizationParsed(s[@"originalCreationTerms19"],16384),*r=RegisteredFinalizationParsed(s[@"registrationOriginal"],16384);if(!t||!r||t.count!=19||![t[@"version"]isEqual:@"1"]||![t[@"domain"]isEqual:@"YNX-PRODUCT-DEVICE-CREATE/v1"]||![t[@"generation"]isEqual:e[@"generation"]]||![t[@"operationId"]isEqual:s[@"originalCreationOperation"]]||!RegisteredFinalizationHex(e[@"networkId"],32)||!RegisteredFinalizationHex(r[@"pkA"],2592)||!RegisteredFinalizationHex(r[@"pkB"],64)||r[@"revokedAt"]!=NSNull.null)return nil;
 uint64_t generation=0;if(!SourceProofU64(e[@"generation"],generation,true))return nil;
 id registrationOperation=s[@"originalRegistrationOperation"];if(registrationOperation!=NSNull.null&&(![registrationOperation isKindOfClass:NSString.class]||![registrationOperation length]||[registrationOperation length]>128))return nil;
 if(![s[@"associationOriginal"]isKindOfClass:NSString.class]||![s[@"associationOriginal"]length]||[s[@"associationOriginal"]length]>65536)return nil;
 NSMutableDictionary*b=[NSMutableDictionary new];for(NSString*k in identity){id v=e[k];if(v==NSNull.null){if(![@[@"bundleId",@"packageId"]containsObject:k])return nil;}else if(![v isKindOfClass:NSString.class])return nil;if(![v isEqual:t[k]])return nil;b[k]=v;}
 // Registered record's same-version generation is explicit, not revision or
 // Session generation. The independently signed finalization selection also
 // covers exact creation19/gen/op and this complete original pair.
 for(NSString*k in e)if(![k isEqual:@"account"]&&![k isEqual:@"registrationDigest"]&&![e[k]isEqual:r[k]])return nil;
 NSData*registered=[s[@"registrationOriginal"]dataUsingEncoding:NSUTF8StringEncoding];if(![SourceSHA(registered)isEqual:e[@"registrationDigest"]])return nil;
 NSDictionary*association=selection[@"association"];for(NSString*k in @[@"account",@"clientId",@"productId",@"platform",@"applicationId",@"deviceId"])if(![association[k]isEqual:e[k]])return nil;
 NSMutableDictionary*stable=[@{@"version":@"1",@"domain":@"YNX-PRODUCT-DEVICE-IDENTITY/v1"}mutableCopy];for(NSString*k in @[@"networkId",@"canonicalOwner",@"account",@"productId",@"clientId",@"deviceId"])stable[k]=e[k];NSData*stableBytes=RegisteredFinalizationCanonical(stable);if(!stableBytes.length||stableBytes.length>1024)return nil;
 NSString*stableString=[[NSString alloc]initWithData:stableBytes encoding:NSUTF8StringEncoding];if(!stableString)return nil;
 return @{@"scope":s,@"identityBinding":[b copy],@"stableDeviceIdentity":stableString,@"network":e[@"networkId"],@"generation":e[@"generation"],@"creationOperation":s[@"originalCreationOperation"],@"registrationOperation":registrationOperation};
}
static inline NSDictionary*RegisteredFinalizationJournalObserve(NSDictionary*selection){NSDictionary*d=RegisteredFinalizationScopeDATA(selection);if(!d)return nil;
 // Reuse only existing no-write filesystem observation mechanics. This does
 // NOT acquire query Source, borrow query rights or make an observed tuple a
 // Root signature. Finalization Root/action remains independently verified.
 NSMutableDictionary*data=[selection mutableCopy];data[@"productSessionDeviceV4Query"]=@{@"version":@"4",@"identityBinding":d[@"identityBinding"],@"stableDeviceIdentity":d[@"stableDeviceIdentity"]};return ynx_auth_private::originalQueryDeviceV4JournalObserve(data);
}
