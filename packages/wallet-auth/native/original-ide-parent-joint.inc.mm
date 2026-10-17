// Textually included by the original Auth node owner, after its private registry
// and lifecycle functions. Never compile as a separately callable constructor.
#include "original-ide-parent-source-binding.h"
#include <mutex>
#include <atomic>
#import "original-ide-parent-node.h"
#include "original-ide-parent-kernel.h"
#include "original-ide-parent-transport.h"
#include <thread>
#include <pthread.h>

struct OriginalIDEIntent {
 napi_env env=nullptr;napi_ref jointRef=nullptr;OriginalAuthHandle *joint=nullptr;
 ynx_auth_ide_private::SourceBinding source;
 int endpoint=-1,childEndpoint=-1;
 struct stat endpointIdentity{},childEndpointIdentity{};
 ynx_auth_private::TemporaryDescriptor endpointOwner,childEndpointOwner,intentRecordOwner,transferOwner;
 NSError *__strong first=nil,*cleanup=nil;
 std::atomic_bool ready{false},retired{false},brokerBusy{false},prefixComplete{false};
 bool closeSelected=false,closed=false,released=false,senderTaken=false;
 bool frameSelected=false,ackSelected=false,acknowledged=false;
 bool shutdownSelected=false,shutdownComplete=false;
 NSNumber *__strong installedSequence=nil;OriginalAuthHandle *jointIdentity=nullptr;
 std::mutex failureMutex;
 napi_async_work work=nullptr;napi_deferred workDeferred=nullptr,closeDeferred=nullptr,joinDeferred=nullptr;
 napi_ref workOwnerRef=nullptr,workPromiseRef=nullptr,closePromiseRef=nullptr,joinPromiseRef=nullptr;
 ynx_auth_ide_private::KernelProcess wallet,ide,node;
 std::array<unsigned char,32> walletAudit{},ideAudit{},nodeAudit{};
 ynx_auth_ide_private::ResourceCloseDebt resourceDebt;
};
static std::unordered_set<OriginalIDEIntent *> ideIntents,ideIntentDebt;
static std::unordered_map<OriginalAuthHandle *,OriginalIDEIntent *> ideIntentsForJoint;
// A Source-approved request intent may be reserved once by this original joint.
// Failed/UNKNOWN attempts retain their key; neither close nor GC makes it reusable.
static std::unordered_map<OriginalAuthHandle *,std::unordered_set<std::string>> ideIntentSelections;
static napi_value IDEAcquireAdministration(napi_env env,napi_callback_info info){
 napi_value unused[1];if(!Args(env,info,0,unused))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");if(!pthread_main_np())return Error(env,"IDE_NORMAL_ORIGINAL_OWNER_THREAD_REQUIRED");
 // The original admin opaque is installed before any Source/resource I/O.
 // A returned partial therefore always has the existing close/join lifecycle.
 auto*admin=new OriginalAuthHandle{};admin->kind=Kind::administration;admin->env=env;
 napi_value result=Wrap(env,admin);if(!result)return nullptr;NSError *e=nil;
 admin->source=[YNXAuthIdentitySourceAuthority acquireOriginalIDEParentSource:&e];
 if(!admin->source){admin->acquisitionCause=e?:[NSError errorWithDomain:@"YNXOriginalIDEAdministration" code:1 userInfo:@{NSLocalizedDescriptionKey:@"IDE_ORIGINAL_EXTERNAL_SOURCE_NOT_SUPPLIED"}];admin->retired=true;return result;}
 ynx_auth_ide_private::SourceBinding binding;if(!binding.capture(admin->source,&e)){admin->acquisitionCause=e;admin->retired=true;}
 return result;
}
static bool IDEIntentFail(OriginalIDEIntent *h,NSString *code){
 std::lock_guard<std::mutex> lock(h->failureMutex);
 h->ready=false;h->retired=true;if(!h->first)h->first=[NSError errorWithDomain:@"YNXOriginalIDEIntent" code:1 userInfo:@{NSLocalizedDescriptionKey:code}];if(!h->brokerBusy)ideIntentDebt.insert(h);return false;
}
static bool IDESocketIdentity(int fd,const struct stat&expected){struct stat current{};return fd>=0&&fstat(fd,&current)==0&&current.st_dev==expected.st_dev&&current.st_ino==expected.st_ino&&current.st_uid==expected.st_uid&&current.st_gid==expected.st_gid&&current.st_mode==expected.st_mode&&current.st_nlink==expected.st_nlink;}
static bool IDEIntentShutdown(OriginalIDEIntent*h){
 if(h->shutdownSelected)return h->shutdownComplete;h->shutdownSelected=true;
 h->shutdownComplete=h->endpoint<0||(IDESocketIdentity(h->endpoint,h->endpointIdentity)&&(shutdown(h->endpoint,SHUT_RDWR)==0||errno==ENOTCONN));
 if(!h->shutdownComplete&&!h->cleanup)h->cleanup=[NSError errorWithDomain:@"YNXOriginalIDEIntent" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_INTENT_SHUTDOWN_UNKNOWN"}];return h->shutdownComplete;
}
static void IDERetireForOriginal(OriginalAuthHandle*original){
 // Called only from the original NAPI owner's main-thread lifecycle.
 for(auto &entry:ideIntentsForJoint){auto*h=entry.second;if(h->joint&&(h->joint==original||h->joint->parent==original)){IDEIntentFail(h,@"IDE_ORIGINAL_PARENT_OR_JOINT_RETIRED");IDEIntentShutdown(h);}}
}
static bool IDEIntentCurrent(OriginalIDEIntent *h){
 if(!h||h->retired||h->closeSelected||!h->ready||!h->joint||h->joint->retired||h->joint->closed||h->joint->cleanupFailed||
    !h->joint->parent||h->joint->parent->retired||h->joint->parent->closed||h->joint->parent->cleanupFailed)return h?IDEIntentFail(h,@"IDE_ORIGINAL_JOINT_RETIRED"):false;
 NSError *e=nil;if(!h->source.current(&e)){{std::lock_guard<std::mutex> lock(h->failureMutex);if(!h->first)h->first=e;}return IDEIntentFail(h,@"IDE_ORIGINAL_JOINT_CURRENT_FAILED");}
 struct stat current{};pollfd state{h->endpoint,POLLIN,0};
 if(h->endpoint<0||fstat(h->endpoint,&current)||current.st_dev!=h->endpointIdentity.st_dev||current.st_ino!=h->endpointIdentity.st_ino||poll(&state,1,0)<0||(state.revents&(POLLHUP|POLLERR|POLLNVAL)))return IDEIntentFail(h,@"IDE_ORIGINAL_ENDPOINT_CURRENT_FAILED");
 if(h->prefixComplete){try{using namespace ynx_auth_ide_private;if(!verifyKernelAudit(h->walletAudit,h->wallet.original)||!verifyKernelAudit(h->ideAudit,h->ide.original)||!verifyKernelAudit(h->nodeAudit,h->node.original)||!sameKernel(h->wallet,observeKernel(getpid()))||!sameKernel(h->ide,observeKernel((pid_t)h->ide.original.pid))||!sameKernel(h->node,observeKernel((pid_t)h->node.original.pid)))return IDEIntentFail(h,@"IDE_ORIGINAL_ADOPTED_LINEAGE_CHANGED");}catch(const std::exception&){return IDEIntentFail(h,@"IDE_ORIGINAL_ADOPTED_PROCESS_UNAVAILABLE");}}
 if(h->retired||!h->joint||h->joint->retired||h->joint->closed||h->joint->cleanupFailed||!h->joint->parent||h->joint->parent->retired||h->joint->parent->closed||h->joint->parent->cleanupFailed)return IDEIntentFail(h,@"IDE_ORIGINAL_JOINT_POST_CURRENT_RETIRED");return true;
}
static bool IDEIntentClose(OriginalIDEIntent *h){
 h->retired=true;h->ready=false;if(h->closeSelected)return h->closed;h->closeSelected=true;
 bool done=IDEIntentShutdown(h);
 // shutdown fences this one capability's endpoint copies; no unrelated service.
 if(!h->endpointOwner.closeOnce([&](int fd){return IDESocketIdentity(fd,h->endpointIdentity)?::close(fd):-1;}))done=false;else h->endpoint=-1;
 if(!h->childEndpointOwner.closeOnce([&](int fd){return IDESocketIdentity(fd,h->childEndpointIdentity)?::close(fd):-1;}))done=false;else h->childEndpoint=-1;
 if(!h->intentRecordOwner.closeOnce([](int fd){return ::close(fd);}))done=false;
 if(!h->transferOwner.closeOnce([&](int fd){return IDESocketIdentity(fd,h->endpointIdentity)?::close(fd):-1;}))done=false;
 if(!done||!h->resourceDebt.clean()){if(!h->cleanup)h->cleanup=[NSError errorWithDomain:@"YNXOriginalIDEIntent" code:2 userInfo:@{NSLocalizedDescriptionKey:@"IDE_ORIGINAL_INTENT_CLOSE_UNKNOWN"}];ideIntentDebt.insert(h);return false;}
 h->closed=true;
 if(!h->released&&h->joint){h->released=true;if(h->joint->children)h->joint->children--;h->joint=nullptr;if(h->jointRef){napi_delete_reference(h->env,h->jointRef);h->jointRef=nullptr;}}
 ideIntentDebt.erase(h);return true;
}
static void IDEIntentFinalize(napi_env,void *raw,void *){
 auto *h=static_cast<OriginalIDEIntent *>(raw);if(!ideIntents.count(h))return;
 if(h->brokerBusy){h->retired=true;IDEIntentShutdown(h);ideIntentDebt.insert(h);return;}
 if(!IDEIntentClose(h))return;
 for(napi_ref ref:{h->workPromiseRef,h->closePromiseRef,h->joinPromiseRef})if(ref)napi_delete_reference(h->env,ref);
 if(ideIntentsForJoint[h->jointIdentity]==h)ideIntentsForJoint.erase(h->jointIdentity);ideIntents.erase(h);delete h;
}
static OriginalIDEIntent *IDEIntentOriginal(napi_env env,napi_value value){
 void *raw=nullptr;if(napi_unwrap(env,value,&raw)!=napi_ok)return nullptr;
 auto*h=static_cast<OriginalIDEIntent *>(raw);return ideIntents.count(h)&&h->env==env?h:nullptr;
}
static napi_value IDEReserve(napi_env env,napi_callback_info info){
 if(!pthread_main_np())return Error(env,"IDE_NORMAL_ORIGINAL_OWNER_THREAD_REQUIRED");
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto *joint=Original(env,a[0],Kind::joint);
 if(!joint||joint->life.phase!=ynx_auth_private::JointPhase::committed||!joint->view)return Error(env,"IDE_COMMITTED_ORIGINAL_JOINT_REQUIRED");
 if(!Current(joint))return nullptr;
 // Reserve recognized custody before any resource operation. Even a partial
 // acquisition returns this same opaque object and is closeable, never a guard.
 auto*h=new OriginalIDEIntent;h->env=env;h->joint=h->jointIdentity=joint;
 napi_value result;if(napi_create_object(env,&result)!=napi_ok){delete h;return Error(env,"IDE_INTENT_OBJECT_UNAVAILABLE");}
 if(napi_wrap(env,result,h,IDEIntentFinalize,nullptr,nullptr)!=napi_ok){delete h;return Error(env,"IDE_INTENT_WRAP_UNAVAILABLE");}
 ideIntents.insert(h);ideIntentDebt.insert(h);
 if(napi_create_reference(env,a[0],1,&h->jointRef)!=napi_ok){h->joint=nullptr;h->released=true;IDEIntentFail(h,@"IDE_INTENT_JOINT_REFERENCE_UNAVAILABLE");return result;}
 joint->children++;
 NSError *e=nil;
 if(!h->source.capture(joint->source,&e)){h->first=e;IDEIntentFail(h,@"IDE_ORIGINAL_REGISTERED_SOURCE_REQUIRED");return result;}
 NSString *nonce=h->source.request()[@"requestNonce"];
 std::string key=nonce.UTF8String;
 auto &selected=ideIntentSelections[joint];
 if(selected.count(key)||!selected.empty()){IDEIntentFail(h,@"IDE_ORIGINAL_INTENT_ALREADY_SELECTED");return result;}
 // Capture and validate the actual executing Wallet code, not a JS supplied
 // provider/code identity, PID, path or receipt. Accepted identity is the
 // independently authenticated original profile's registration projection.
 SecCodeRef dynamic=nullptr;SecStaticCodeRef image=nullptr;CFDictionaryRef metadata=nullptr;
 OSStatus rc=SecCodeCopySelf(kSecCSDefaultFlags,&dynamic);
 if(rc==errSecSuccess)rc=SecCodeCheckValidity(dynamic,kSecCSStrictValidate,nullptr);
 if(rc==errSecSuccess)rc=SecCodeCopyStaticCode(dynamic,kSecCSDefaultFlags,&image);
 if(rc==errSecSuccess)rc=SecStaticCodeCheckValidity(image,kSecCSStrictValidate,nullptr);
 if(rc==errSecSuccess)rc=SecCodeCopySigningInformation(image,kSecCSSigningInformation,&metadata);
 id identity=metadata?((__bridge NSDictionary *)metadata)[(__bridge NSString *)kSecCodeInfoUnique]:nil;
 bool admitted=rc==errSecSuccess&&[identity isKindOfClass:NSData.class]&&[[identity base64EncodedStringWithOptions:0] isEqual:h->source.registration()[@"walletCodeIdentity"]];
 if(metadata)CFRelease(metadata);if(image)CFRelease(image);if(dynamic)CFRelease(dynamic);
 if(!admitted){IDEIntentFail(h,@"IDE_ORIGINAL_WALLET_CODE_MISMATCH");return result;}
 selected.insert(key); // prior to I/O/late fences; UNKNOWN is never retried
 if(joint->journalDir<0){IDEIntentFail(h,@"IDE_ORIGINAL_JOURNAL_REQUIRED");return result;}
 std::string leaf="ide-intent-"+key;
 int record=openat(joint->journalDir,leaf.c_str(),O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
 if(record<0){IDEIntentFail(h,@"IDE_ORIGINAL_DURABLE_INTENT_ALREADY_ENTERED_OR_UNKNOWN");return result;}
 h->intentRecordOwner.hold(record);
 // Negative replay fence only. These bytes are NOT a grant or transferable
 // credential; never delete/retry this marker, even after partial failure.
 NSData *marker=[NSJSONSerialization dataWithJSONObject:@{@"jointRecord":[NSString stringWithUTF8String:joint->recordName.c_str()],@"expectedRequest":h->source.request()} options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
 bool recorded=marker&&marker.length<=65536;
 if(recorded)recorded=write(record,marker.bytes,marker.length)==(ssize_t)marker.length;
 if(recorded)recorded=fsync(record)==0;
 bool recordClosed=h->intentRecordOwner.closeOnce([](int fd){return ::close(fd);});
 if(!recorded||!recordClosed||fsync(joint->journalDir)){IDEIntentFail(h,@"IDE_ORIGINAL_DURABLE_INTENT_UNKNOWN");return result;}
 int pair[2]={-1,-1};
 if(socketpair(AF_UNIX,SOCK_STREAM,0,pair)){IDEIntentFail(h,@"IDE_ORIGINAL_ENDPOINT_CREATE_UNKNOWN");return result;}
 h->endpoint=pair[0];h->childEndpoint=pair[1];h->endpointOwner.hold(pair[0]);h->childEndpointOwner.hold(pair[1]);
 if(fstat(pair[0],&h->endpointIdentity)||fstat(pair[1],&h->childEndpointIdentity)||fcntl(pair[0],F_SETFD,FD_CLOEXEC)||fcntl(pair[1],F_SETFD,FD_CLOEXEC)||!h->source.current(&e)){
  if(!h->first)h->first=e;IDEIntentFail(h,@"IDE_ORIGINAL_ENDPOINT_POST_FENCE_FAILED");return result;
 }
 h->ready=true;ideIntentsForJoint[joint]=h;ideIntentDebt.erase(h);return result;
}
static napi_value IDEIntentRead(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=IDEIntentOriginal(env,a[0]);
 if(!h)return Error(env,"IDE_ORIGINAL_INTENT_REQUIRED");
 if(h->workPromiseRef)return Error(env,"IDE_PENDING_ENDPOINT_ALREADY_LAUNCHED");
 if(!IDEIntentCurrent(h))return Error(env,(h->first.localizedDescription?:@"IDE_ORIGINAL_INTENT_UNAVAILABLE").UTF8String);
 // This is pending transport metadata ONLY, not parent/Node qualification.
 return JSON(env,@{@"pending":@YES,@"descriptor":@(h->childEndpoint),@"currentReference":h->source.request()[@"currentReference"],@"requestNonce":h->source.request()[@"requestNonce"]});
}
static napi_value IDEErrorValue(napi_env env,NSString *code){napi_value text,value;napi_create_string_utf8(env,code.UTF8String,NAPI_AUTO_LENGTH,&text);napi_create_error(env,text,text,&value);return value;}
static NSString *IDEIntentCause(OriginalIDEIntent*h){std::lock_guard<std::mutex> lock(h->failureMutex);return h->first.localizedDescription?:@"IDE_ORIGINAL_PRELUDE_FAILED";}
static void IDECompleteClosePromise(OriginalIDEIntent*h){
 bool ok=IDEIntentClose(h);if(!h->closeDeferred)return;
 if(ok)napi_resolve_deferred(h->env,h->closeDeferred,Undefined(h->env));else napi_reject_deferred(h->env,h->closeDeferred,IDEErrorValue(h->env,h->cleanup.localizedDescription?:@"IDE_INTENT_CLEANUP_UNKNOWN"));h->closeDeferred=nullptr;
}
static void IDEBrokerExecute(napi_env,void*raw){
 auto*h=static_cast<OriginalIDEIntent*>(raw);@autoreleasepool{@try{try{
  using namespace ynx_auth_ide_private;
  if(!IDEIntentCurrent(h))throw std::runtime_error("IDE_BROKER_ORIGINAL_JOINT_NOT_CURRENT");
  h->wallet=observeKernel(getpid());
  if(![[h->wallet.codeIdentity base64EncodedStringWithOptions:0] isEqual:h->source.registration()[@"walletCodeIdentity"]])throw std::runtime_error("IDE_BROKER_WALLET_CODE_MISMATCH");
  uint64_t now=wallMS(),expires=[h->source.request()[@"expiresAtMs"] unsignedLongLongValue];if(expires<=now)throw std::runtime_error("IDE_BROKER_ORIGINAL_INTENT_EXPIRED");
  PreludeTransport transport(h->endpoint,(unsigned)std::min<uint64_t>(expires-now,15000));
  Prelude prepare=transport.read();
  if(prepare.kind!=PreludeKind::prepareIDE||!originalPreludeBinding(prepare,h->source)||!(prepare.wallet==h->wallet.original)||!verifyKernelAudit(prepare.audit,prepare.ide))throw std::runtime_error("IDE_BROKER_ORIGINAL_IDE_PREPARE_MISMATCH");
  h->ide=observeKernel((pid_t)prepare.ide.pid);
  h->ideAudit=prepare.audit;auto walletToken=originalSelfAudit();std::memcpy(h->walletAudit.data(),&walletToken,32);
  if(!(h->ide.original==prepare.ide)||h->ide.original.parent!=h->wallet.original.pid||h->ide.original.uid!=h->wallet.original.uid||![[h->ide.codeIdentity base64EncodedStringWithOptions:0] isEqual:h->source.registration()[@"ideCodeIdentity"]])throw std::runtime_error("IDE_BROKER_REGISTERED_IDE_LINEAGE_MISMATCH");
  NSString *app=h->ide.image.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent;NSBundle*bundle=[NSBundle bundleWithPath:app];NSString *resources=bundle.resourceURL.path;
  if(!bundle.resourceURL.isFileURL||![bundle.bundleIdentifier isEqual:h->source.request()[@"applicationId"]]||![bundle.executableURL.path isEqual:h->ide.image]||!registeredResources(resources,h->source,h->resourceDebt))throw std::runtime_error("IDE_BROKER_REGISTERED_RESOURCES_MISMATCH");
  Lifetime life;if(!life.begin([h->source.request()[@"requestNonce"] UTF8String],h->wallet.original,h->ide.original,wallMS(),expires,monotonicMS())||!IDEIntentCurrent(h))throw std::runtime_error("IDE_BROKER_PENDING_POST_FENCE_FAILED");
  Prelude pending=originalPrelude(PreludeKind::pendingIDE,h->source);pending.challenge=prepare.challenge;pending.wallet=h->wallet.original;pending.ide=h->ide.original;
  pending.ideAudit=h->ideAudit;
  // Wallet no longer retains the child's local endpoint after a real IDE
  // inherited it. This is the Native-owned fd, never the IDE/Node's fd4.
  if(!h->childEndpointOwner.closeOnce([&](int fd){return IDESocketIdentity(fd,h->childEndpointIdentity)?::close(fd):-1;}))throw std::runtime_error("IDE_BROKER_CHILD_ENDPOINT_CLOSE_UNKNOWN");h->childEndpoint=-1;
  transport.write(pending);
  bool adopted=false,acquired=false;Prelude nodeRequest{};KernelProcess adoptedChild;AdoptionPreludeOrder order(pending);
  // The child can reach acquisition before its IDE parent reports spawn.
  // Accept either order once; NEVER ask IDE to read a post-spawn response.
  for(unsigned count=0;count<2;count++){
   Prelude frame=transport.read();if(!IDEIntentCurrent(h)||!originalPreludeBinding(frame,h->source)||!(frame.wallet==h->wallet.original)||!(frame.ide==h->ide.original)||!sameKernel(h->ide,observeKernel((pid_t)h->ide.original.pid)))throw std::runtime_error("IDE_BROKER_ADOPTION_CURRENT_MISMATCH");
   order.accept(frame);
   if(frame.kind==PreludeKind::adoptNode&&!adopted){
    if(!verifyKernelAudit(frame.audit,h->ide.original))throw std::runtime_error("IDE_BROKER_ADOPT_ACTOR_MISMATCH");
    adoptedChild=observeKernel((pid_t)frame.node.pid);
    if(!(adoptedChild.original==frame.node)||adoptedChild.original.parent!=h->ide.original.pid||adoptedChild.original.uid!=h->ide.original.uid||![adoptedChild.image isEqual:[resources stringByAppendingPathComponent:@"runtime/node"]]||![[adoptedChild.codeIdentity base64EncodedStringWithOptions:0] isEqual:h->source.registration()[@"nodeCodeIdentity"]]||!life.beginAdopt(life.intent(),adoptedChild.original))throw std::runtime_error("IDE_BROKER_ORIGINAL_CHILD_ADOPT_MISMATCH");adopted=true;
   }else if(frame.kind==PreludeKind::acquireNode&&!acquired){
    if(!verifyKernelAudit(frame.audit,frame.node))throw std::runtime_error("IDE_BROKER_NODE_ACTOR_MISMATCH");nodeRequest=frame;acquired=true;
   }else throw std::runtime_error("IDE_BROKER_DUPLICATE_OR_WRONG_PHASE");
  }
  nodeRequest=order.finish();h->node=observeKernel((pid_t)nodeRequest.node.pid);h->nodeAudit=nodeRequest.audit;
  if(!adopted||!acquired||!sameKernel(h->node,adoptedChild)||!(h->node.original==nodeRequest.node)||!IDEIntentCurrent(h)||!sameKernel(h->wallet,observeKernel(getpid()))||!sameKernel(h->ide,observeKernel((pid_t)h->ide.original.pid))||!registeredResources(resources,h->source,h->resourceDebt)||!life.completeAdopt(life.intent(),h->node.original,h->wallet.original,h->ide.original,wallMS(),monotonicMS()))throw std::runtime_error("IDE_BROKER_NODE_ACQUIRE_POST_FENCE_FAILED");
  Prelude reply=originalPrelude(PreludeKind::readyNode,h->source);reply.challenge=nodeRequest.challenge;reply.wallet=h->wallet.original;reply.ide=h->ide.original;reply.node=h->node.original;reply.ideAudit=h->ideAudit;reply.nodeAudit=h->nodeAudit;transport.write(reply);transport.handoff();
  // No installed JSON or ACK bytes read here. Normal JS sender/receiver owns
  // the stream only after the main-thread completion publishes this handoff.
  h->prefixComplete.store(true,std::memory_order_release);
 }catch(const std::exception&e){IDEIntentFail(h,[NSString stringWithUTF8String:e.what()]);}}@catch(id exception){IDEIntentFail(h,@"IDE_BROKER_ORIGINAL_EXCEPTION");}}
}
static void IDEBrokerComplete(napi_env env,napi_status status,void*raw){
 auto*h=static_cast<OriginalIDEIntent*>(raw);h->brokerBusy=false;
 if(h->retired||!h->prefixComplete)ideIntentDebt.insert(h);
 if(status!=napi_ok)IDEIntentFail(h,@"IDE_BROKER_WORK_UNKNOWN");
 if(h->workDeferred){if(status==napi_ok&&h->prefixComplete&&!h->retired)napi_resolve_deferred(env,h->workDeferred,Undefined(env));else napi_reject_deferred(env,h->workDeferred,IDEErrorValue(env,IDEIntentCause(h)));h->workDeferred=nullptr;}
 if(h->joinDeferred){napi_resolve_deferred(env,h->joinDeferred,Undefined(env));h->joinDeferred=nullptr;}
 if(h->closeDeferred)IDECompleteClosePromise(h);
 if(h->work){napi_delete_async_work(env,h->work);h->work=nullptr;}
 if(h->workOwnerRef){napi_delete_reference(env,h->workOwnerRef);h->workOwnerRef=nullptr;}
}
static napi_value IDEBeginPrelude(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=IDEIntentOriginal(env,a[0]);if(!h)return Error(env,"IDE_ORIGINAL_INTENT_REQUIRED");
 if(h->workPromiseRef||h->brokerBusy||h->prefixComplete)return Error(env,"IDE_PRELUDE_ALREADY_SELECTED");if(!IDEIntentCurrent(h))return Error(env,IDEIntentCause(h).UTF8String);
 napi_value promise,name;if(napi_create_promise(env,&h->workDeferred,&promise)!=napi_ok)return Error(env,"IDE_PRELUDE_PROMISE_UNAVAILABLE");
 if(napi_create_reference(env,promise,1,&h->workPromiseRef)!=napi_ok||napi_create_reference(env,a[0],1,&h->workOwnerRef)!=napi_ok){IDEIntentFail(h,@"IDE_PRELUDE_OWNER_REFERENCE_UNKNOWN");napi_reject_deferred(env,h->workDeferred,IDEErrorValue(env,IDEIntentCause(h)));h->workDeferred=nullptr;return promise;}
 napi_create_string_utf8(env,"originalIDEPrelude",NAPI_AUTO_LENGTH,&name);h->brokerBusy=true;
 if(napi_create_async_work(env,nullptr,name,IDEBrokerExecute,IDEBrokerComplete,h,&h->work)!=napi_ok||napi_queue_async_work(env,h->work)!=napi_ok){h->brokerBusy=false;IDEIntentFail(h,@"IDE_PRELUDE_WORK_QUEUE_UNKNOWN");napi_reject_deferred(env,h->workDeferred,IDEErrorValue(env,IDEIntentCause(h)));h->workDeferred=nullptr;if(h->work){napi_delete_async_work(env,h->work);h->work=nullptr;}if(h->workOwnerRef){napi_delete_reference(env,h->workOwnerRef);h->workOwnerRef=nullptr;}}
 return promise;
}
static napi_value IDEIntentCloseAsync(OriginalIDEIntent*h){
 napi_env env=h->env;napi_value promise;if(h->closePromiseRef){napi_get_reference_value(env,h->closePromiseRef,&promise);return promise;}
 if(napi_create_promise(env,&h->closeDeferred,&promise)!=napi_ok)return Error(env,"IDE_CLOSE_PROMISE_UNAVAILABLE");napi_create_reference(env,promise,1,&h->closePromiseRef);h->retired=true;h->ready=false;
 if(h->brokerBusy){IDEIntentShutdown(h);}else IDECompleteClosePromise(h);return promise;
}
static napi_value IDEIntentJoinAsync(OriginalIDEIntent*h){
 napi_env env=h->env;napi_value promise;if(!h->retired)return Error(env,"IDE_INTENT_NOT_RETIRED");if(h->joinPromiseRef){napi_get_reference_value(env,h->joinPromiseRef,&promise);return promise;}
 if(napi_create_promise(env,&h->joinDeferred,&promise)!=napi_ok)return Error(env,"IDE_JOIN_PROMISE_UNAVAILABLE");napi_create_reference(env,promise,1,&h->joinPromiseRef);
 if(!h->brokerBusy){napi_resolve_deferred(env,h->joinDeferred,Undefined(env));h->joinDeferred=nullptr;}return promise;
}
static napi_value IDETakeSender(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=IDEIntentOriginal(env,a[0]);if(!h)return Error(env,"IDE_ORIGINAL_INTENT_REQUIRED");
 if(h->brokerBusy||!h->prefixComplete||h->senderTaken||!IDEIntentCurrent(h))return Error(env,"IDE_ORIGINAL_SENDER_NOT_AVAILABLE");h->senderTaken=true;
 int transferred=fcntl(h->endpoint,F_DUPFD_CLOEXEC,10);if(transferred<0){IDEIntentFail(h,@"IDE_SENDER_TRANSFER_UNKNOWN");return Error(env,"IDE_SENDER_TRANSFER_UNKNOWN");}
 h->transferOwner.hold(transferred);
 napi_value result;if(!IDEIntentCurrent(h)||napi_create_int32(env,transferred,&result)!=napi_ok){IDEIntentFail(h,@"IDE_SENDER_RESULT_UNKNOWN");return Error(env,"IDE_SENDER_RESULT_UNKNOWN");}
 // Ownership of this exact duplicate alone transfers to normal JS Socket.
 // Native retains its own monitor endpoint, never closes the JS duplicate.
 h->transferOwner.fd=-1;h->transferOwner.selected=true;h->transferOwner.completed=true;return result;
}
static napi_value IDEInstalledFrame(napi_env env,napi_callback_info info){
 napi_value a[1];if(!Args(env,info,1,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=IDEIntentOriginal(env,a[0]);if(!h)return Error(env,"IDE_ORIGINAL_INTENT_REQUIRED");
 if(h->brokerBusy||!h->prefixComplete||h->frameSelected||!IDEIntentCurrent(h))return Error(env,"IDE_ORIGINAL_INSTALLED_FRAME_UNAVAILABLE");h->frameSelected=true;
 NSDictionary *s=h->source.selection();NSString *directory=s[@"receiptDirectory"];
 if(![s[@"sourceSelection"] isKindOfClass:NSDictionary.class]||![s[@"receiptSelection"] isKindOfClass:NSDictionary.class]||![directory isKindOfClass:NSString.class]||![directory hasPrefix:@"/"]||![directory isEqual:directory.stringByStandardizingPath]||![s[@"receiptSelection"][@"receiptPath"] isEqual:[directory stringByAppendingPathComponent:[h->source.request()[@"requestNonce"] stringByAppendingString:@".admission.json"]]]){IDEIntentFail(h,@"IDE_ORIGINAL_INSTALLED_SELECTION_NOT_SUPPLIED");return Error(env,"IDE_ORIGINAL_INSTALLED_SELECTION_NOT_SUPPLIED");}
 NSError *e=nil;h->installedSequence=h->source.currentSequence(&e);
 if(!h->installedSequence||h->installedSequence.unsignedLongLongValue==0||!IDEIntentCurrent(h)){IDEIntentFail(h,@"IDE_ORIGINAL_SOURCE_SEQUENCE_UNAVAILABLE");return Error(env,"IDE_ORIGINAL_SOURCE_SEQUENCE_UNAVAILABLE");}
 NSDictionary *selection=@{@"sourceSelection":s[@"sourceSelection"],@"receiptSelection":s[@"receiptSelection"],@"expectedRequest":h->source.request(),@"receiptDirectory":directory};
 NSMutableData *raw=[[NSJSONSerialization dataWithJSONObject:@{@"type":@"installed",@"selection":selection,@"sequence":h->installedSequence,@"expiresAtMs":h->source.request()[@"expiresAtMs"]} options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil] mutableCopy];
 if(!raw||raw.length>=65536){IDEIntentFail(h,@"IDE_INSTALLED_FRAME_CAPACITY");return Error(env,"IDE_INSTALLED_FRAME_CAPACITY");}const char lf='\n';[raw appendBytes:&lf length:1];napi_value result;
 if(napi_create_buffer_copy(env,raw.length,raw.bytes,nullptr,&result)!=napi_ok){IDEIntentFail(h,@"IDE_INSTALLED_FRAME_RESULT_UNKNOWN");return Error(env,"IDE_INSTALLED_FRAME_RESULT_UNKNOWN");}return result;
}
static napi_value IDEAcknowledge(napi_env env,napi_callback_info info){
 napi_value a[2];if(!Args(env,info,2,a))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=IDEIntentOriginal(env,a[0]);if(!h)return Error(env,"IDE_ORIGINAL_INTENT_REQUIRED");
 if(h->brokerBusy||!h->prefixComplete||!h->senderTaken||!h->frameSelected||h->ackSelected||!IDEIntentCurrent(h))return Error(env,"IDE_ORIGINAL_ACK_NOT_AVAILABLE");h->ackSelected=true;
 bool buffer=false;void *data=nullptr;size_t length=0;if(napi_is_buffer(env,a[1],&buffer)!=napi_ok||!buffer||napi_get_buffer_info(env,a[1],&data,&length)!=napi_ok||length==0||length>16384){IDEIntentFail(h,@"IDE_ORIGINAL_ACK_INVALID");return Error(env,"IDE_ORIGINAL_ACK_INVALID");}
 NSDictionary *expected=@{@"type":@"ack",@"requestNonce":h->source.request()[@"requestNonce"],@"receiptDigest":h->source.selection()[@"receiptSelection"][@"receiptDigest"],@"sequence":h->installedSequence,@"consumerManifestDigest":h->source.request()[@"consumerManifestDigest"]};
 NSData *canonical=[NSJSONSerialization dataWithJSONObject:expected options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:nil];
 if(!canonical||canonical.length!=length||memcmp(canonical.bytes,data,length)||!IDEIntentCurrent(h)){IDEIntentFail(h,@"IDE_ORIGINAL_ACK_BINDING_MISMATCH");return Error(env,"IDE_ORIGINAL_ACK_BINDING_MISMATCH");}
 h->acknowledged=true;return Undefined(env); // receipt/liveness, NOT a new grant/effect
}
static bool IDEOriginalJointBusinessCurrent(OriginalAuthHandle *joint){
 NSDictionary *request=joint->selection[@"expectedRequest"];
 if(![request[@"productId"] isEqual:@"developer"]||![request[@"platform"] isEqual:@"macos"])return true;
 auto found=ideIntentsForJoint.find(joint);return found!=ideIntentsForJoint.end()&&found->second->prefixComplete&&!found->second->brokerBusy&&found->second->acknowledged&&IDEIntentCurrent(found->second);
}
enum IDEIntentOperation {ideIntentCurrent,ideIntentRetire,ideIntentJoin,ideIntentClose};
static napi_value IDEIntentLifecycle(napi_env env,napi_callback_info info){
 napi_value a[1];void *data=nullptr;if(!Args(env,info,1,a,&data))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=IDEIntentOriginal(env,a[0]);
 if(!h)return Error(env,"IDE_ORIGINAL_INTENT_REQUIRED");auto op=(IDEIntentOperation)(uintptr_t)data;
 if(op==ideIntentRetire){h->retired=true;h->ready=false;IDEIntentShutdown(h);return Undefined(env);}
 if(op==ideIntentJoin)return IDEIntentJoinAsync(h);
 if(op==ideIntentClose)return IDEIntentCloseAsync(h);
 return IDEIntentCurrent(h)?Undefined(env):Error(env,(h->first.localizedDescription?:@"IDE_INTENT_CURRENT_FAILED").UTF8String);
}
struct OriginalIDENodeHandle {napi_env env;YNXOriginalIDENodeDelivery *__strong owner;bool closeSelected=false,closeComplete=false;napi_ref closeErrorRef=nullptr;};
static std::unordered_set<OriginalIDENodeHandle*> ideNodeOwners,ideNodeDebt;
static bool ideNodeAcquisitionSelected=false;
static void IDENodeFinalize(napi_env,void *raw,void*){
 auto*h=static_cast<OriginalIDENodeHandle*>(raw);if(!ideNodeOwners.count(h))return;
 NSError *e=nil;if(![h->owner closeOriginal:&e]){ideNodeDebt.insert(h);return;}if(h->closeErrorRef)napi_delete_reference(h->env,h->closeErrorRef);ideNodeOwners.erase(h);ideNodeDebt.erase(h);delete h;
}
static napi_value IDENodeCurrent(napi_env env,napi_callback_info info){
 napi_value argv[2];size_t count=2;void *raw=nullptr;if(napi_get_cb_info(env,info,&count,argv,nullptr,&raw)!=napi_ok||count>1)return Error(env,"IDE_NODE_CURRENT_ARGUMENTS_INVALID");
 auto*h=static_cast<OriginalIDENodeHandle*>(raw);if(!ideNodeOwners.count(h)||h->env!=env)return Error(env,"IDE_ORIGINAL_NODE_OWNER_REQUIRED");
 NSDictionary *expected=nil;if(count==1){napi_valuetype type;if(napi_typeof(env,argv[0],&type)!=napi_ok)return Error(env,"IDE_NODE_CURRENT_ARGUMENTS_INVALID");if(type!=napi_undefined){expected=Dictionary(env,argv[0]);if(!expected)return Error(env,"IDE_NODE_CURRENT_EXPECTED_REQUEST_INVALID");}}
 NSError *e=nil;if(![h->owner assertCurrentExpected:expected error:&e])return Error(env,(e.localizedDescription?:@"IDE_NODE_ORIGINAL_CURRENT_FAILED").UTF8String);return Undefined(env);
}
static napi_value IDENodeClose(napi_env env,napi_callback_info info){
 napi_value unused[1];void *raw=nullptr;if(!Args(env,info,0,unused,&raw))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto*h=static_cast<OriginalIDENodeHandle*>(raw);if(!ideNodeOwners.count(h)||h->env!=env)return Error(env,"IDE_ORIGINAL_NODE_OWNER_REQUIRED");
 if(h->closeSelected){if(h->closeComplete)return Undefined(env);napi_value original;if(h->closeErrorRef&&napi_get_reference_value(env,h->closeErrorRef,&original)==napi_ok){napi_throw(env,original);return nullptr;}return Error(env,"IDE_NODE_CLOSE_UNKNOWN");}
 h->closeSelected=true;NSError *e=nil;h->closeComplete=[h->owner closeOriginal:&e];
 if(!h->closeComplete){ideNodeDebt.insert(h);napi_value original=IDEErrorValue(env,e.localizedDescription?:@"IDE_NODE_CLOSE_UNKNOWN");napi_create_reference(env,original,1,&h->closeErrorRef);napi_throw(env,original);return nullptr;}ideNodeDebt.erase(h);return Undefined(env);
}
static napi_value IDENodeDescriptor(napi_env env,napi_callback_info info){
 napi_value unused[1];void *raw=nullptr;if(!Args(env,info,0,unused,&raw))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");auto*h=static_cast<OriginalIDENodeHandle*>(raw);
 if(!ideNodeOwners.count(h)||h->env!=env)return Error(env,"IDE_ORIGINAL_NODE_OWNER_REQUIRED");napi_value result;if(napi_create_int32(env,h->owner.descriptor,&result)!=napi_ok)return Error(env,"IDE_NODE_DESCRIPTOR_UNAVAILABLE");return result;
}
static napi_value IDENodeAcquire(napi_env env,napi_callback_info info){
 if(!pthread_main_np())return Error(env,"IDE_NORMAL_NODE_OWNER_THREAD_REQUIRED");
 napi_value argv[1];if(!Args(env,info,1,argv))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");size_t size=0;
 if(napi_get_value_string_utf8(env,argv[0],nullptr,0,&size)!=napi_ok||size==0||size>8192)return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
 std::string text(size+1,'\0');if(napi_get_value_string_utf8(env,argv[0],text.data(),text.size(),&size)!=napi_ok)return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
 NSString *entry=[[NSString alloc]initWithBytes:text.data() length:size encoding:NSUTF8StringEncoding];if(!entry)return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
 if(ideNodeAcquisitionSelected)return Error(env,"IDE_NODE_ACQUISITION_ALREADY_SELECTED");ideNodeAcquisitionSelected=true;
 auto*h=new OriginalIDENodeHandle{env,[YNXOriginalIDENodeDelivery new]};napi_value result;
 if(napi_create_object(env,&result)!=napi_ok){delete h;return Error(env,"IDE_NODE_OBJECT_UNAVAILABLE");}
 if(napi_wrap(env,result,h,IDENodeFinalize,nullptr,nullptr)!=napi_ok){delete h;return Error(env,"IDE_NODE_WRAP_UNAVAILABLE");}
 ideNodeOwners.insert(h);
 napi_property_descriptor props[]={
  {"descriptor",nullptr,nullptr,IDENodeDescriptor,nullptr,nullptr,napi_default,h},
  {"assertCurrent",nullptr,IDENodeCurrent,nullptr,nullptr,nullptr,napi_default,h},
  {"close",nullptr,IDENodeClose,nullptr,nullptr,nullptr,napi_default,h}};
 if(napi_define_properties(env,result,3,props)!=napi_ok){ideNodeDebt.insert(h);return Error(env,"IDE_NODE_RESULT_DEFINITION_UNKNOWN");}
 NSError *e=nil;BOOL acquired=[h->owner acquireActualEntry:entry error:&e];
 if(!acquired)ideNodeDebt.insert(h); // same partial owner already has close/current
 return result;
}
