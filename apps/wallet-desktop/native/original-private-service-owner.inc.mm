// Internal NAPI supplier: a DISTINCT service owner, never a forged joint or
// an IDE consumer with skipped adoption. The sole Source callee decides role.
static bool originalServiceAcquireSelected=false;
static napi_value ServiceAcquire(napi_env env,napi_callback_info info){
 napi_value unused[1];if(!Args(env,info,0,unused))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 if(originalServiceAcquireSelected)return Error(env,"ORIGINAL_SERVICE_ACQUIRE_ALREADY_SELECTED");originalServiceAcquireSelected=true;
 auto *h=new OriginalAuthHandle{};h->kind=Kind::privateService;h->env=env;h->serviceChannel=[YNXOriginalPrivateServiceChannel new];
 napi_value ref=Wrap(env,h);if(!ref)return nullptr; // Partial custody BEFORE Source I/O.
 @try{
  NSError *e=nil;h->source=[YNXAuthIdentitySourceAuthority acquireOriginalSource:&e];
  if(!h->source||e){h->acquisitionCause=e?:[NSError errorWithDomain:@"YNXOriginalPrivateService" code:1 userInfo:@{NSLocalizedDescriptionKey:@"ORIGINAL_SERVICE_SOURCE_NOT_SUPPLIED"}];debt.insert(h);return ref;}
  h->selection=[h->source copyOriginalSelection:&e];
  // This member must be in the same original authenticated Native selection.
  // A normal consumer's Source/profile, fd4 receipt or SSO is NOT this role.
  if(e||![h->selection[@"originalServiceRole"] isEqual:@"original-private-daemon"]||![h->selection[@"expectedRequest"][@"service"] isEqual:@"wallet-product-session-v2"]||![h->selection[@"expectedRequest"][@"gatewayOrigin"] isEqual:@"https://wallet-auth.ynxweb4.com"]){h->acquisitionCause=e?:[NSError errorWithDomain:@"YNXOriginalPrivateService" code:1 userInfo:@{NSLocalizedDescriptionKey:@"ORIGINAL_SERVICE_ROLE_NOT_ADMITTED"}];debt.insert(h);return ref;}
  for(NSString *k in @[@"sourceSelection",@"receiptSelection",@"expectedRequest",@"association"]){if(![h->selection[k] isKindOfClass:NSDictionary.class]){h->acquisitionCause=[NSError errorWithDomain:@"YNXOriginalPrivateService" code:1 userInfo:@{NSLocalizedDescriptionKey:@"ORIGINAL_SERVICE_BINDING_NOT_SUPPLIED"}];debt.insert(h);return ref;}}
  h->serviceReady=[h->serviceChannel acquireOriginalSource:h->source error:&e];
  if(!h->serviceReady){h->acquisitionCause=e?:[NSError errorWithDomain:@"YNXOriginalPrivateService" code:1 userInfo:@{NSLocalizedDescriptionKey:@"ORIGINAL_SERVICE_CHANNEL_NOT_READY"}];debt.insert(h);}
 }@catch(id cause){h->acquisitionCause=[NSError errorWithDomain:@"YNXOriginalPrivateService" code:1 userInfo:@{NSLocalizedDescriptionKey:@"ORIGINAL_SERVICE_ACQUIRE_EXCEPTION"}];debt.insert(h);(void)cause;}
 return ref; // Always pair with ready; a returned object alone is NOT success.
}
static napi_value ServiceReady(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=Original(env,a[0],Kind::privateService);if(!h)return Error(env,"ORIGINAL_SERVICE_OWNER_REQUIRED");return Current(h)?Undefined(env):nullptr;}
static napi_value ServiceLifecycle(napi_env env,napi_callback_info info){
 napi_value a[1];void *p=nullptr;if(!Args(env,info,1,a,&p))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=Original(env,a[0],Kind::privateService);if(!h)return Error(env,"ORIGINAL_SERVICE_OWNER_REQUIRED");
 auto op=(uintptr_t)p;if(op==0){h->retired=true;h->life.retire();return Undefined(env);}if(op==1)return JoinReady(h)?Undefined(env):Error(env,"ORIGINAL_SERVICE_NOT_JOINED");
 if(op==2)return CloseServiceOwner(env,h);
 return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
}
static napi_value ServiceRead(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=Original(env,a[0],Kind::privateService);if(!h)return Error(env,"ORIGINAL_SERVICE_OWNER_REQUIRED");if(!Current(h))return nullptr;
 if(!h->serviceReceivedRaw.empty())return Error(env,"ORIGINAL_SERVICE_UNRESOLVED_REQUEST");NSError *e=nil;NSData *raw=[h->serviceChannel readOriginalRequest:&e];
  if(!raw){if(!e){napi_value pending;napi_get_null(env,&pending);return pending;}if(!h->acquisitionCause)h->acquisitionCause=e;return Error(env,e.localizedDescription.UTF8String);}
 h->serviceReceivedRaw.assign((const char*)raw.bytes,raw.length); // Keep before late Source/JS result fence.
 napi_value result;if(napi_create_string_utf8(env,h->serviceReceivedRaw.data(),h->serviceReceivedRaw.size(),&result)!=napi_ok)return Error(env,"ORIGINAL_SERVICE_REQUEST_RESULT_UNKNOWN");return Current(h)?result:nullptr;
}
static napi_value ServiceWrite(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=Original(env,a[0],Kind::privateService);if(!h)return Error(env,"ORIGINAL_SERVICE_OWNER_REQUIRED");if(!Current(h))return nullptr;
 std::string response;if(!HostJournalString(env,a[1],65536,response)||h->serviceReceivedRaw.empty())return Error(env,"ORIGINAL_SERVICE_RESPONSE_REQUIRED");
 NSData *request=[NSData dataWithBytes:h->serviceReceivedRaw.data() length:h->serviceReceivedRaw.size()];NSDictionary *input=YNXTerminalObject(request,262144);
 if(!input)return Error(env,"ORIGINAL_SERVICE_RECEIVED_INPUT_INVALID");
 std::string key=std::string([input[@"operation"] UTF8String])+":"+[input[@"phase"] UTF8String]+":"+[input[@"requestId"] UTF8String];auto acknowledged=h->serviceAcknowledged.find(key);
 NSData *raw=[NSData dataWithBytes:response.data() length:response.size()];
 if(acknowledged==h->serviceAcknowledged.end()||!h->terminalAcknowledged.count(key)||acknowledged->second!=[TerminalSHA(raw) UTF8String]||!YNXTerminalObject(raw,65536))return Error(env,"ORIGINAL_SERVICE_NATIVE_TERMINAL_ACK_REQUIRED");
 NSError *e=nil;if(![h->serviceChannel writeOriginalResponse:raw error:&e]){if(!e){napi_value pending;napi_get_null(env,&pending);return pending;}if(!h->acquisitionCause)h->acquisitionCause=e;return Error(env,e.localizedDescription.UTF8String);}
 h->serviceReceivedRaw.clear();return Current(h)?Undefined(env):nullptr;
}
