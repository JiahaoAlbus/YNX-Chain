// Inside the SAME real SourceAuthority @implementation. Scope is DATA only;
// all methods first require the original dedicated Root2/purpose/current gate.
- (id)reserveOriginalDeviceV4NativeReadLoan:(NSError**)error {
 @synchronized(self){
  if(error)*error=nil;if(_closeSelected||![self assertOriginalProductSessionDeviceV4SourceCurrent:error])return nil;
  if(!_deviceV4NativeReadLoans)_deviceV4NativeReadLoans=[NSHashTable hashTableWithOptions:NSPointerFunctionsStrongMemory|NSPointerFunctionsObjectPointerPersonality];
  if(_deviceV4NativeReadLoans.count>=256){if(error)*error=[NSError errorWithDomain:@"YNXDeviceV4NativeBorrow" code:73006 userInfo:nil];return nil;}
  id token=[NSObject new];[_deviceV4NativeReadLoans addObject:token];
  // Token remains adopted even when this late fence supplies NSError(code0).
  [self assertOriginalProductSessionDeviceV4SourceCurrent:error];return token;
 }
}
- (BOOL)releaseOriginalDeviceV4NativeReadLoan:(id)token released:(BOOL*)released error:(NSError**)error {
 @synchronized(self){if(error)*error=nil;if(released)*released=NO;
  if(!token||![_deviceV4NativeReadLoans containsObject:token]){if(error)*error=[NSError errorWithDomain:@"YNXDeviceV4NativeBorrow" code:73012 userInfo:nil];return NO;}
  [_deviceV4NativeReadLoans removeObject:token];if(released)*released=YES;return YES;
 }
}
- (NSDictionary*)copyOriginalDeviceV4NativeReadSnapshot:(id)token notBefore:(uint64_t*)begin expires:(uint64_t*)end error:(NSError**)error {
 @synchronized(self){if(error)*error=nil;
  if(!token||![_deviceV4NativeReadLoans containsObject:token]||![self assertOriginalProductSessionDeviceV4SourceCurrent:error])return nil;
  NSDictionary*scope=[self copyOriginalProductSessionDeviceV4Scope:error];if(!scope||(error&&*error))return nil;
  const uint64_t before=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  uint64_t until=_cachedCurrentExpiresMS;
  for(NSData*raw in @[_enrollmentOriginal?:NSData.data,_profileOriginal?:NSData.data,_currentOriginal?:NSData.data]){
   NSDictionary*body=SourceOriginalBodyHint(raw);id x=body[@"expiresAtMs"];double value=[x isKindOfClass:NSNumber.class]?[x doubleValue]:-1;
   if(![x isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)x)==CFBooleanGetTypeID()||!std::isfinite(value)||value!=std::floor(value)||value<1||value>9007199254740991.0){if(error)*error=[NSError errorWithDomain:@"YNXDeviceV4NativeBorrow" code:73008 userInfo:nil];return nil;}
   until=std::min(until,(uint64_t)value);
  }
  if(![self assertOriginalProductSessionDeviceV4SourceCurrent:error]||(error&&*error)||![_selection[@"productSessionDeviceV4"]isEqual:scope])return nil;
  const uint64_t after=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  // Last check is local: no further callbacks/Root I/O after this time fence.
  if(after<before||after<_timeFloor||after>=until||after>=_cachedCurrentExpiresMS||_retired||_invalid||_closeSelected){if(error)*error=[NSError errorWithDomain:@"YNXDeviceV4NativeBorrow" code:73008 userInfo:nil];return nil;}
  until=std::min(until,_cachedCurrentExpiresMS);until=std::min(until,after+5000);
  if(begin)*begin=after;if(end)*end=until;return scope;
 }
}
- (BOOL)originalDeviceV4NativePhysicalClosed {@synchronized(self){return _closeSelected&&_cleanupComplete&&!_deviceV4NativeReadLoans.count;}}
- (NSDictionary*)copyOriginalDeviceV4AccountNamespaceForNativeRead:(id)token error:(NSError**)error {
 @synchronized(self){
  if(error)*error=nil;
  if(!token||![_deviceV4NativeReadLoans containsObject:token]){if(error)*error=[NSError errorWithDomain:@"YNXDeviceV4NativeBorrow" code:73002 userInfo:nil];return nil;}
  if(![self assertOriginalProductSessionDeviceV4SourceCurrent:error]||(error&&*error))return nil;
  // Only the existing full verifier completion populates this private ivar.
  // An old SDK without typed DATA leaves only the matcher NOT_SUPPLIED.
  NSDictionary*value=[_deviceV4NativeAccountNamespace copy];if(!value)return nil;
  if(![self assertOriginalProductSessionDeviceV4SourceCurrent:error]||(error&&*error)||![_deviceV4NativeAccountNamespace isEqual:value])return nil;
  uint64_t now=(uint64_t)(NSDate.date.timeIntervalSince1970*1000.0);
  if(now<_timeFloor||now>=_cachedCurrentExpiresMS||_retired||_invalid||_closeSelected){if(error)*error=[NSError errorWithDomain:@"YNXDeviceV4NativeBorrow" code:73008 userInfo:nil];return nil;}
  return value;
 }
}
