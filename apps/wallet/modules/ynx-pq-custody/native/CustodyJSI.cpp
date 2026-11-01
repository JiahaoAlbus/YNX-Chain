#include "CustodyJSI.h"
#include "SerialCustodyWorker.h"
#include <atomic>
#include <mutex>
namespace ynx::mobilepq {
namespace jsi=facebook::jsi;
namespace {
struct RuntimeOwner {
 std::shared_ptr<SerialCustodyWorker> worker=std::make_shared<SerialCustodyWorker>();
 std::shared_ptr<facebook::react::CallInvoker> invoker;
 jsi::Runtime* runtime=nullptr;
 std::atomic<bool> alive{true};
 uint64_t nextCompletion=1; // JS-thread completion ID, never a custody ID
};
std::mutex bootMutex;std::shared_ptr<RuntimeOwner> boot;
jsi::Value cause(jsi::Runtime& rt,Cause c){
 if(!c.present)return jsi::Value::null();jsi::Object o(rt);o.setProperty(rt,"kind","native-code");o.setProperty(rt,"code",double(c.code));return o;
}
jsi::Value hex(jsi::Runtime& rt,const uint8_t* data,size_t n,bool present){
 if(!present)return jsi::Value::null();const char* digits="0123456789abcdef";std::string text="0x";
 for(size_t i=0;i<n;i++){text+=digits[data[i]>>4];text+=digits[data[i]&15];}return jsi::String::createFromUtf8(rt,text);
}
jsi::Object publicOutcome(jsi::Runtime& rt,const Outcome& out,bool succeeded){
 jsi::Object o(rt);o.setProperty(rt,"version",1);o.setProperty(rt,"state",jsi::String::createFromUtf8(rt,out.state));
 o.setProperty(rt,"operationSucceeded",succeeded);o.setProperty(rt,"signEntered",out.signEntered);o.setProperty(rt,"submitEntered",out.submitEntered);
 o.setProperty(rt,"restoreEntered",out.restoreEntered);o.setProperty(rt,"storageConfirmed",out.storageConfirmed);o.setProperty(rt,"closed",out.closed);
 o.setProperty(rt,"cancelled",out.cancelled);
 o.setProperty(rt,"queryEntered",out.queryEntered);o.setProperty(rt,"primitiveStatus",double(out.primitiveStatus));o.setProperty(rt,"primitiveCleanup",double(out.primitiveCleanup));
 o.setProperty(rt,"firstCause",cause(rt,out.firstCause));o.setProperty(rt,"cleanupCause",cause(rt,out.cleanupCause));
 o.setProperty(rt,"account",hex(rt,out.projection.account,20,out.projectionAvailable));
 o.setProperty(rt,"networkId",hex(rt,out.projection.network_id,32,out.projectionAvailable));
 o.setProperty(rt,"requestDigest",hex(rt,out.projection.request_digest,32,out.projectionAvailable));
 o.setProperty(rt,"transactionHash",hex(rt,out.projection.transaction_hash,32,out.projectionAvailable&&out.projection.transaction_hash_present));
 o.setProperty(rt,"memberRetained",out.memberRetained);o.setProperty(rt,"reviewAvailable",out.reviewSelected);
 o.setProperty(rt,"submissionObserved",out.submissionSelected);o.setProperty(rt,"queryObserved",out.querySelected);
 o.setProperty(rt,"canRetry",false);o.setProperty(rt,"consensusFinality",false);o.setProperty(rt,"clearsOriginal",false);return o;
}
using Completion=std::function<jsi::Value(jsi::Runtime&)>;
using Work=std::function<Completion()>;
jsi::Value promise(jsi::Runtime& rt,const std::shared_ptr<RuntimeOwner>& owner,Work work){
 auto executor=jsi::Function::createFromHostFunction(rt,jsi::PropNameID::forAscii(rt,"pqCompletion"),2,
 [owner,work=std::move(work)](jsi::Runtime& rt,const jsi::Value&,const jsi::Value* args,size_t count)->jsi::Value{
  if(count!=2||!owner->alive.load())throw jsi::JSError(rt,"PQ_RUNTIME_CLOSED");
  if(owner->nextCompletion==UINT64_MAX)throw jsi::JSError(rt,"PQ_COMPLETION_CAPACITY");
  auto ticket=std::to_string(owner->nextCompletion++);
  // Promise functions remain owned by the JS runtime's Map. No jsi::Value or
  // Function crosses onto the custody worker or survives runtime teardown in
  // a C++ shared_ptr. Invalidating the runtime can therefore drop its Map.
  jsi::Object callbacks(rt);callbacks.setProperty(rt,"resolve",args[0]);callbacks.setProperty(rt,"reject",args[1]);
  auto pending=rt.global().getPropertyAsObject(rt,"__ynxPQPendingV1");
  pending.getPropertyAsFunction(rt,"set").callWithThis(rt,pending,jsi::String::createFromUtf8(rt,ticket),std::move(callbacks));
  owner->worker->enqueue([owner,work,ticket]{
   Completion completion;bool failed=false;
   try{if(owner->alive.load())completion=work();else failed=true;}catch(...){failed=true;}
   // Native result/session was adopted on the worker BEFORE this UI delivery.
   owner->invoker->invokeAsync([owner,completion,ticket,failed]{
    if(!owner->alive.load())return;
    auto& rt=*owner->runtime;
    try{
     auto pending=rt.global().getPropertyAsObject(rt,"__ynxPQPendingV1");auto key=jsi::String::createFromUtf8(rt,ticket);
     auto value=pending.getPropertyAsFunction(rt,"get").callWithThis(rt,pending,key);
     pending.getPropertyAsFunction(rt,"delete").callWithThis(rt,pending,key);
     if(!value.isObject())return;auto callbacks=value.getObject(rt);
     if(failed){callbacks.getPropertyAsFunction(rt,"reject").call(rt,jsi::String::createFromAscii(rt,"PQ_NATIVE_OPERATION_RETAINED"));return;}
     callbacks.getPropertyAsFunction(rt,"resolve").call(rt,completion(rt));
    }catch(...){/* UI delivery failure cannot erase native original custody. */}
   });
  });return jsi::Value::undefined();
 });
 return rt.global().getPropertyAsFunction(rt,"Promise").callAsConstructor(rt,std::move(executor));
}
class Held final:public jsi::HostObject {
 std::shared_ptr<RuntimeOwner> runtime_;std::shared_ptr<CustodySession> session_;
 public:
 Held(std::shared_ptr<RuntimeOwner> rt,std::shared_ptr<CustodySession> s):runtime_(std::move(rt)),session_(std::move(s)){}
 jsi::Value get(jsi::Runtime& rt,const jsi::PropNameID& prop)override{
  auto name=prop.utf8(rt);
  if(name!="signOnce"&&name!="submitSignedOnce"&&name!="queryOriginal"&&name!="restoreRegisteredEmptyOnce"&&
     name!="copyOriginalPublicOutcome"&&name!="captureOriginalReview"&&name!="saveOriginal"&&name!="cancel"&&name!="retire"&&name!="join"&&name!="close")return jsi::Value::undefined();
  return jsi::Function::createFromHostFunction(rt,prop,0,[runtime=runtime_,session=session_,name](jsi::Runtime& rt,const jsi::Value&,const jsi::Value*,size_t n)->jsi::Value{
   if(n)throw jsi::JSError(rt,"PQ_ARGUMENTS_INVALID");
   if(name=="cancel")session->requestCancel();
   if(name=="retire"||name=="close")session->requestRetire();
   return promise(rt,runtime,[session,name]{
    bool ok=true;
    if(name=="signOnce")ok=session->signOnce();else if(name=="submitSignedOnce")ok=session->submitSignedOnce();
    else if(name=="queryOriginal")ok=session->queryOriginal();else if(name=="restoreRegisteredEmptyOnce")ok=session->restoreRegisteredEmptyOnce();
    else if(name=="saveOriginal")ok=session->saveOriginal();else if(name=="cancel")ok=session->cancel();else if(name=="retire")ok=session->retire();else if(name=="close")ok=session->close();
    auto out=session->copyProjection();
    return [out=std::move(out),ok](jsi::Runtime& rt)->jsi::Value{return publicOutcome(rt,out,ok);};
   });
  });
 }
};
}
bool install(jsi::Runtime& rt,std::shared_ptr<facebook::react::CallInvoker> invoker){
 std::lock_guard<std::mutex> lock(bootMutex);if(boot||!invoker)return false;
 auto owner=std::make_shared<RuntimeOwner>();owner->runtime=&rt;owner->invoker=std::move(invoker);boot=owner;
 rt.global().setProperty(rt,"__ynxPQPendingV1",rt.global().getPropertyAsFunction(rt,"Map").callAsConstructor(rt));
 jsi::Object api(rt);
 api.setProperty(rt,"prepare",jsi::Function::createFromHostFunction(rt,jsi::PropNameID::forAscii(rt,"prepare"),2,
 [owner](jsi::Runtime& rt,const jsi::Value&,const jsi::Value* args,size_t count)->jsi::Value{
  if(count!=2||!args[0].isString()||!args[1].isString())throw jsi::JSError(rt,"PQ_ARGUMENTS_INVALID");
  auto reference=args[0].asString(rt).utf8(rt),mode=args[1].asString(rt).utf8(rt);
  if(reference.empty()||reference.size()>128||(mode!="transaction"&&mode!="registered-restore"&&mode!="original-query"))throw jsi::JSError(rt,"PQ_ARGUMENTS_INVALID");
  return promise(rt,owner,[owner,reference,mode]{
   auto session=owner->worker->prepare(reference,mode=="transaction"?1:mode=="registered-restore"?2:3);
   return [owner,session](jsi::Runtime& rt)->jsi::Value{return jsi::Object::createFromHostObject(rt,std::make_shared<Held>(owner,session));};
  });
 }));
 rt.global().setProperty(rt,"__ynxPQCustodyV1",std::move(api));return true;
}
bool invalidate(){
 std::shared_ptr<RuntimeOwner> owner;{std::lock_guard<std::mutex> lock(bootMutex);owner=boot;if(!owner)return true;owner->alive=false;}
 // If cleanup fails keep boot + worker alive with all original debt. A second
 // native invalidation can drain it; a replacement JS runtime cannot steal it.
 if(!owner->worker->shutdown())return false;
 std::lock_guard<std::mutex> lock(bootMutex);if(boot==owner)boot.reset();return true;
}
}
