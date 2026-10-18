// Same adopted Node delivery -> distinct private CLIENT owner. There is no
// second prelude, joint/Vault, service role, listener, callback or fd selector.
static bool IDEClientOriginalCurrent(OriginalAuthHandle *h){
 auto *parent=static_cast<OriginalIDENodeHandle*>(h->ideParentOpaque);
 if(!parent||!ideNodeOwners.count(parent)||parent->env!=h->env||parent->closeSelected||parent->privateClients.count()!=1||!h->ideNodeParent)return false;
 NSError *e=nil;return [parent->owner assertCurrentExpected:h->selection[@"expectedRequest"] error:&e];
}
static void IDEClientReleaseParent(OriginalAuthHandle *h){
 auto *parent=static_cast<OriginalIDENodeHandle*>(h->ideParentOpaque);
 if(!parent||!ideNodeOwners.count(parent)||!parent->privateClients.returnOnce()){h->cleanupFailed=true;h->closed=false;debt.insert(h);return;}
 h->ideParentOpaque=nullptr;
 if(h->ideNodeParent){if(napi_delete_reference(h->env,h->ideNodeParent)!=napi_ok){h->cleanupFailed=true;h->closed=false;debt.insert(h);return;}h->ideNodeParent=nullptr;}
 h->source=nil; // BORROWED: only the original Node delivery owns Source close.
}
static napi_value IDEClientCapture(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");void *raw=nullptr;
 if(napi_unwrap(env,a[0],&raw)!=napi_ok)return Error(env,"IDE_ORIGINAL_NODE_OWNER_REQUIRED");auto*parent=static_cast<OriginalIDENodeHandle*>(raw);
 if(!ideNodeOwners.count(parent)||parent->env!=env||parent->closeSelected)return Error(env,"IDE_ORIGINAL_NODE_OWNER_REQUIRED");
 if(!parent->privateClients.select(parent->closeSelected))return Error(env,"IDE_ORIGINAL_PRIVATE_CLIENT_ALREADY_SELECTED");
 auto *h=new OriginalAuthHandle{};h->env=env;h->kind=Kind::ideClient;h->ideParentOpaque=parent;
 napi_value ref=Wrap(env,h);if(!ref)return nullptr; // Partial custody before Source calls.
 if(napi_create_reference(env,a[0],1,&h->ideNodeParent)!=napi_ok){h->acquisitionCause=[NSError errorWithDomain:@"YNXOriginalIDEPrivateClient" code:1 userInfo:@{NSLocalizedDescriptionKey:@"IDE_PRIVATE_PARENT_HOLD_UNKNOWN"}];debt.insert(h);return ref;}
 @try{
  NSError *e=nil;h->source=[parent->owner borrowOriginalPrivateClientSource:&e];
  if(h->source&&!e)h->selection=[parent->owner copyOriginalPrivateClientSelection:&e];
  NSString *state=h->selection[@"originalHostStatePath"],*journal=h->selection[@"originalHostTerminalDirectory"];
  if(e||!h->source||!h->selection||![state isKindOfClass:NSString.class]||![state hasPrefix:@"/"]||![state isEqual:state.stringByStandardizingPath]||![journal isEqual:[state stringByAppendingString:@".private-terminal"]])h->acquisitionCause=e?:[NSError errorWithDomain:@"YNXOriginalIDEPrivateClient" code:1 userInfo:@{NSLocalizedDescriptionKey:@"IDE_PRIVATE_SOURCE_HOST_ORIGINALS_NOT_SUPPLIED"}];
  if(!h->acquisitionCause&&!IDEClientOriginalCurrent(h))h->acquisitionCause=[NSError errorWithDomain:@"YNXOriginalIDEPrivateClient" code:1 userInfo:@{NSLocalizedDescriptionKey:@"IDE_PRIVATE_ORIGINAL_NODE_CURRENT_FAILED"}];
 }@catch(id cause){h->acquisitionCause=[NSError errorWithDomain:@"YNXOriginalIDEPrivateClient" code:1 userInfo:@{NSLocalizedDescriptionKey:@"IDE_PRIVATE_SOURCE_CAPTURE_EXCEPTION"}];(void)cause;}
 if(h->acquisitionCause)debt.insert(h);return ref; // Not a ready/success tag.
}
static napi_value IDEClientReady(napi_env env,napi_callback_info info){napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=Original(env,a[0],Kind::ideClient);if(!h)return Error(env,"IDE_ORIGINAL_PRIVATE_CLIENT_REQUIRED");return Current(h)?Undefined(env):nullptr;}
// DATA retention only. Caller-provided bytes NEVER prove a terminal or clear
// UNKNOWN. The existing independent terminal callee must subsequently read
// the ORIGINAL Source-selected dirfd journal/state/entered + exact hashes.
static napi_value IDEClientResult(napi_env env,napi_callback_info info){
 napi_value a[5];size_t count=5;if(napi_get_cb_info(env,info,&count,a,nullptr,nullptr)!=napi_ok||count!=5)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=Original(env,a[0],Kind::ideClient);if(!h)return Error(env,"IDE_ORIGINAL_PRIVATE_CLIENT_REQUIRED");if(!Current(h))return nullptr;
 std::string op,phase,id,response;
 if(!HostJournalString(env,a[1],128,op)||!HostJournalString(env,a[2],128,phase)||!HostJournalString(env,a[3],128,id)||!HostJournalString(env,a[4],65536,response))return Error(env,"IDE_PRIVATE_RESULT_ARGUMENTS_INVALID");
 std::string key=op+":"+phase+":"+id;auto original=h->requestOriginals.find(key);
 if(original==h->requestOriginals.end()||!h->admittedPrivateRequests.count(key)||h->terminalAcknowledged.count(key))return Error(env,"IDE_PRIVATE_ORIGINAL_REQUEST_REQUIRED");
 NSData *bytes=[NSData dataWithBytes:response.data() length:response.size()];NSDictionary *r=YNXTerminalObject(bytes,65536);
 if(!YNXPrivateExact(r,@[@"status",@"headers",@"body"])||![r[@"headers"] isKindOfClass:NSDictionary.class]||![r[@"headers"][@"x-request-id"] isEqual:[NSString stringWithUTF8String:id.c_str()]]||![r[@"body"] isKindOfClass:NSString.class])return Error(env,"IDE_PRIVATE_RESPONSE_DATA_INVALID");
 auto held=h->responses.find(key);if(held!=h->responses.end())return Error(env,"IDE_PRIVATE_RESULT_ALREADY_RETAINED");
 h->responses.emplace(key,response); // Before late Source/current failure. No rewrite/retry.
 return Current(h)?Undefined(env):nullptr;
}
