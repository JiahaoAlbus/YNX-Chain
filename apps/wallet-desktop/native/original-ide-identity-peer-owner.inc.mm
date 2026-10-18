// SAME original Native module, after R91 request owners. No JS FD/Source/PID
// constructor, old four-op capability, renderer provider or parallel daemon.
#include "../../../packages/wallet-auth/native/original-ide-identity-peer-endpoint.h"
#include <sys/un.h>
#include <bsm/libbsm.h>
#include <poll.h>
#include <memory>
#include <set>
using ynx_auth_ide_identity_private::Endpoint;
using ynx_auth_ide_identity_private::Frame;
using ynx_auth_ide_identity_private::Message;
struct IDEIdentityPeerOwner{
 napi_env env=nullptr;pthread_t thread{};napi_ref parentReference=nullptr;IDEIdentityRequestOwner*parent=nullptr;
 std::unique_ptr<Endpoint>endpoint;struct stat original{},pendingIdentity{};audit_token_t peer{};int pendingDescriptor=-1;
 ynx_auth_ide_private::KernelProcess wallet,ide,node;NSString*__strong resources=nil;
 NSDictionary*__strong selection=nil,*__strong registration=nil;ynx_auth_ide_private::ResourceCloseDebt resourceDebt;
 Frame selectedReturn{Message::failure,0,{}};unsigned busy=0;
 bool ready=false,retired=false,sent=false,read=false,closeSelected=false,closed=false,child=false,claimed=false;
 std::string first,closeFirst;
};
static const napi_type_tag identityPeerTag={0x594e584944455045ULL,0x45524f574e455231ULL};
static std::unordered_set<IDEIdentityPeerOwner*>identityPeers,identityPeerDebts;
static std::set<std::pair<dev_t,ino_t>>identityPeerClaims;
static bool PeerFail(IDEIdentityPeerOwner*p,const char*code){if(p->first.empty())p->first=code;p->ready=false;return false;}
static bool PeerSameFile(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_mode==b.st_mode&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_nlink==b.st_nlink;}
// Borrow-only qualification: never adopts, closes or shuts down inherited fd5.
// It is also the shared pre/post-current fence after a qualified duplicate exists.
static bool PeerBorrowCurrent(IDEIdentityPeerOwner*p){
 if(p->retired||p->closeSelected||!p->parent||!p->first.empty())return false;
 if(!IDEIdentityCurrent(p->parent))return PeerFail(p,"AUTH_IDENTITY_PEER_REQUEST_NOT_CURRENT");
 NSError*error=nil;NSDictionary*selection=[p->parent->source copyOriginalSelection:&error];
 if(error||![selection isEqual:p->selection]||!ynx_auth_ide_private::identityResourceBytes(p->resources,p->registration,p->resourceDebt))return PeerFail(p,"AUTH_IDENTITY_PEER_SOURCE_BINDING_CHANGED");
 struct stat named{};audit_token_t peer{};socklen_t size=sizeof(peer);pollfd state{5,POLLIN,0};
 if(fstat(5,&named)||!PeerSameFile(named,p->original)||getsockopt(5,SOL_LOCAL,LOCAL_PEERTOKEN,&peer,&size)||size!=sizeof(peer)||memcmp(&peer,&p->peer,sizeof(peer))||poll(&state,1,0)<0||(state.revents&(POLLHUP|POLLERR|POLLNVAL)))return PeerFail(p,"AUTH_IDENTITY_PEER_ENDPOINT_CHANGED");
 if(!ynx_auth_ide_private::sameKernel(p->node,ynx_auth_ide_private::observeKernel(getpid()))||!ynx_auth_ide_private::sameKernel(p->ide,ynx_auth_ide_private::observeKernel(getppid()))||!ynx_auth_ide_private::sameKernel(p->wallet,ynx_auth_ide_private::observeKernel((pid_t)p->wallet.original.pid)))return PeerFail(p,"AUTH_IDENTITY_PEER_KERNEL_CHANGED");
 if(!IDEIdentityCurrent(p->parent))return PeerFail(p,"AUTH_IDENTITY_PEER_REQUEST_POST_CURRENT_REFUSED");return p->first.empty()&&!p->retired&&!p->closeSelected;
}
static bool PeerCurrent(IDEIdentityPeerOwner*p){
 if(!p->ready||!p->endpoint||!PeerBorrowCurrent(p))return false;
 p->endpoint->current();if(!IDEIdentityCurrent(p->parent))return PeerFail(p,"AUTH_IDENTITY_PEER_REQUEST_POST_CURRENT_REFUSED");return p->first.empty()&&!p->retired&&!p->closeSelected;
}
static IDEIdentityPeerOwner*PeerOriginal(napi_env env,napi_value object){
 bool tagged=false;void*raw=nullptr;if(napi_check_object_type_tag(env,object,&identityPeerTag,&tagged)!=napi_ok||!tagged||napi_unwrap(env,object,&raw)!=napi_ok)return nullptr;
 auto*p=static_cast<IDEIdentityPeerOwner*>(raw);return identityPeers.count(p)&&p->env==env&&pthread_equal(p->thread,pthread_self())&&pthread_main_np()?p:nullptr;
}
static void PeerRetire(IDEIdentityPeerOwner*p){p->retired=true;p->ready=false;if(p->endpoint)p->endpoint->retire();}
static bool PeerClose(IDEIdentityPeerOwner*p){
 if(p->busy)return false;PeerRetire(p);if(p->closeSelected)return p->closed;p->closeSelected=true;
 try{if(p->endpoint){if(!p->endpoint->joined())return false;p->endpoint->close();}}
 catch(const std::exception&e){p->closeFirst=e.what();identityPeerDebts.insert(p);return false;}
 if(p->pendingDescriptor>=0){struct stat now{};if(fstat(p->pendingDescriptor,&now)||!PeerSameFile(now,p->pendingIdentity)||::close(p->pendingDescriptor)){p->closeFirst="AUTH_IDENTITY_PEER_DUPLICATE_CLOSE_UNKNOWN";identityPeerDebts.insert(p);return false;}p->pendingDescriptor=-1;}
 if(!p->resourceDebt.clean()){p->closeFirst="AUTH_IDENTITY_PEER_RESOURCE_CLOSE_UNKNOWN";identityPeerDebts.insert(p);return false;}
 if(p->claimed){identityPeerClaims.erase({p->original.st_dev,p->original.st_ino});p->claimed=false;}
 if(p->child){if(!p->parent||!p->parent->peerChildren)std::terminate();p->parent->peerChildren--;p->child=false;}
 p->parent=nullptr;if(p->parentReference){if(napi_delete_reference(p->env,p->parentReference)!=napi_ok){p->closeFirst="AUTH_IDENTITY_PEER_PARENT_RELEASE_UNKNOWN";identityPeerDebts.insert(p);return false;}p->parentReference=nullptr;}
 p->closed=true;return true;
}
static void PeerFinalize(napi_env,void*raw,void*){
 auto*p=static_cast<IDEIdentityPeerOwner*>(raw);if(!identityPeers.count(p))return;
 if(!PeerClose(p)){identityPeerDebts.insert(p);return;}identityPeers.erase(p);delete p;
}
struct PeerWork{IDEIdentityPeerOwner*p;bool sending;std::vector<unsigned char>payload;Frame result{Message::failure,0,{}};std::string failure;napi_async_work work=nullptr;napi_deferred deferred=nullptr;napi_ref self=nullptr;};
static void PeerExecute(napi_env,void*raw){auto*w=static_cast<PeerWork*>(raw);try{if(w->sending)w->p->endpoint->send(Message::request,w->payload);else w->result=w->p->endpoint->receive();}catch(const std::exception&e){w->failure=e.what();}catch(...){w->failure="AUTH_IDENTITY_PEER_IO_UNKNOWN";}}
static napi_value PeerErrorValue(napi_env env,const char*code){napi_value text,error;napi_create_string_utf8(env,code,NAPI_AUTO_LENGTH,&text);napi_create_error(env,nullptr,text,&error);napi_set_named_property(env,error,"code",text);return error;}
static napi_value PeerResponseValue(napi_env env,IDEIdentityPeerOwner*p,bool approved){
 auto&frame=p->selectedReturn;NSDictionary*expected=IDERequestDictionary(p->parent->expected,16384);if(!expected)return nullptr;
 napi_value value,field,proof;if(napi_create_object(env,&value)!=napi_ok||napi_create_string_utf8(env,approved?"approve":"reject",NAPI_AUTO_LENGTH,&field)!=napi_ok||napi_set_named_property(env,value,"decision",field)!=napi_ok)return nullptr;
 for(NSString*key in @[@"requestId",@"purpose"]){NSData*b=[expected[key]dataUsingEncoding:NSUTF8StringEncoding];if(!b.length||napi_create_string_utf8(env,(const char*)b.bytes,b.length,&field)!=napi_ok||napi_set_named_property(env,value,key.UTF8String,field)!=napi_ok)return nullptr;}
 if(approved){void*bytes=nullptr;napi_value array;if(napi_create_arraybuffer(env,frame.payload.size(),&bytes,&array)!=napi_ok||!bytes)return nullptr;memcpy(bytes,frame.payload.data(),frame.payload.size());if(napi_create_typedarray(env,napi_uint8_array,frame.payload.size(),array,0,&proof)!=napi_ok)return nullptr;}
 else if(napi_get_null(env,&proof)!=napi_ok)return nullptr;
 if(napi_set_named_property(env,value,"proof",proof)!=napi_ok||napi_object_freeze(env,value)!=napi_ok)return nullptr;return value;
}
static void PeerComplete(napi_env env,napi_status status,void*raw){
 std::unique_ptr<PeerWork>w(static_cast<PeerWork*>(raw));auto*p=w->p;
 // Capture the returned bytes BEFORE ANY Source/current callback or cancel.
 if(!w->sending)p->selectedReturn=std::move(w->result);
 napi_value value=Undefined(env);bool success=false;
 try{@try{
  if(status!=napi_ok)PeerFail(p,"AUTH_IDENTITY_PEER_WORK_CANCELLED");
  if(!w->failure.empty())PeerFail(p,w->failure.c_str());
  if(PeerCurrent(p)){
   if(w->sending)success=true;
   else{
    auto&frame=p->selectedReturn;bool approved=frame.kind==Message::proof;
    if((!approved&&frame.kind!=Message::reject)||(approved&&frame.payload.size()>262144))PeerFail(p,"AUTH_IDENTITY_PEER_RETURN_KIND_INVALID");
    else{
     unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256(p->parent->expected.bytes,(CC_LONG)p->parent->expected.length,digest);
     if(!approved&&(frame.payload.size()!=sizeof(digest)||memcmp(frame.payload.data(),digest,sizeof(digest))))PeerFail(p,"AUTH_IDENTITY_PEER_REJECT_CORRELATION_INVALID");
     else{
      value=PeerResponseValue(env,p,approved);if(!value)PeerFail(p,"AUTH_IDENTITY_PEER_RETURN_ALLOC_UNKNOWN");else success=PeerCurrent(p);
     }
    }
   }
  }
 }@catch(id){PeerFail(p,"AUTH_IDENTITY_PEER_NATIVE_EXCEPTION");}}catch(const std::exception&e){PeerFail(p,e.what());}
 if(!success){PeerRetire(p);napi_reject_deferred(env,w->deferred,PeerErrorValue(env,p->first.empty()?"AUTH_IDENTITY_PEER_UNKNOWN":p->first.c_str()));}
 else napi_resolve_deferred(env,w->deferred,value);
 if(!p->busy)std::terminate();p->busy--;napi_delete_async_work(env,w->work);napi_delete_reference(env,w->self);
}
static napi_value PeerQueue(napi_env env,napi_value self,IDEIdentityPeerOwner*p,bool sending,std::vector<unsigned char>payload){
 auto*w=new(std::nothrow)PeerWork{p,sending,std::move(payload)};if(!w)return Error(env,"AUTH_IDENTITY_PEER_CAPACITY");
 napi_value promise,name;napi_create_string_utf8(env,"OriginalIdentityPeerIO",NAPI_AUTO_LENGTH,&name);
 if(napi_create_promise(env,&w->deferred,&promise)!=napi_ok||napi_create_reference(env,self,1,&w->self)!=napi_ok||napi_create_async_work(env,nullptr,name,PeerExecute,PeerComplete,w,&w->work)!=napi_ok){
  if(w->self)napi_delete_reference(env,w->self);delete w;PeerFail(p,"AUTH_IDENTITY_PEER_QUEUE_UNKNOWN");return Error(env,p->first.c_str());
 }
 p->busy++;
 if(napi_queue_async_work(env,w->work)!=napi_ok){p->busy--;napi_reject_deferred(env,w->deferred,PeerErrorValue(env,"AUTH_IDENTITY_PEER_QUEUE_UNKNOWN"));napi_delete_async_work(env,w->work);napi_delete_reference(env,w->self);delete w;PeerFail(p,"AUTH_IDENTITY_PEER_QUEUE_UNKNOWN");PeerRetire(p);}
 return promise;
}
enum class PeerMethod:uintptr_t{current=1,send,receive,retire,join,close,status};
static napi_value PeerOperation(napi_env env,napi_callback_info info){
 napi_value self,args[3];void*raw=nullptr;size_t n=3;if(napi_get_cb_info(env,info,&n,args,&self,&raw)!=napi_ok)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto method=static_cast<PeerMethod>((uintptr_t)raw);if(!IDEIdentityArgc(env,info,method==PeerMethod::send?3:0,args,&self,&raw))return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto*p=PeerOriginal(env,self);if(!p)return Error(env,"AUTH_IDENTITY_PEER_ORIGINAL_REQUIRED");
 try{@try{
  if(method==PeerMethod::retire){PeerRetire(p);return Undefined(env);}
  if(method==PeerMethod::join){if(!p->retired||p->busy||(p->endpoint&&!p->endpoint->joined()))return Error(env,"AUTH_IDENTITY_PEER_JOIN_PENDING");return Undefined(env);}
  if(method==PeerMethod::close){if(p->busy)return Error(env,"AUTH_IDENTITY_PEER_JOIN_PENDING");return PeerClose(p)?Undefined(env):Error(env,p->closeFirst.empty()?"AUTH_IDENTITY_PEER_CLOSE_UNKNOWN":p->closeFirst.c_str());}
  if(method==PeerMethod::status)return IDEIdentityPublic(env,@{@"ready":@(p->ready&&!p->retired),@"retired":@(p->retired),@"busy":@(p->busy),@"closed":@(p->closed),@"selectedReturnBytes":@(p->selectedReturn.payload.size()),@"firstCause":p->first.empty()?(id)NSNull.null:[NSString stringWithUTF8String:p->first.c_str()],@"dataOnly":@YES,@"nativeAdmission":@NO});
  if(!PeerCurrent(p))return Error(env,p->first.empty()?"AUTH_IDENTITY_PEER_NOT_CURRENT":p->first.c_str());
  if(method==PeerMethod::current)return Undefined(env);
  if(method==PeerMethod::send){
   if(p->sent)return Error(env,"AUTH_IDENTITY_PEER_SEND_ONCE");
   NSData*kind=IDEIdentityString(env,args[0],16),*request=IDEIdentityString(env,args[1],16384);NSString*k=[[NSString alloc]initWithData:kind encoding:NSUTF8StringEncoding];
   NSString*expectedKind=p->parent->kind==IDEIdentityKind::receive?@"receive":p->parent->kind==IDEIdentityKind::recover?@"recover":@"keyCall";
   napi_valuetype t;napi_typeof(env,args[2],&t);NSData*invocation=t==napi_undefined?[NSData data]:IDEIdentityString(env,args[2],16384);
   if(![k isEqual:expectedKind]||![request isEqual:p->parent->expected]||!invocation||![invocation isEqual:p->parent->invocation])return Error(env,"AUTH_IDENTITY_PEER_EXPECTED_MISMATCH");
   p->sent=true;NSData*packet=IDERequestCanonical(@{@"requestRaw":[[NSString alloc]initWithData:request encoding:NSUTF8StringEncoding],@"invocationRaw":invocation.length?(id)[[NSString alloc]initWithData:invocation encoding:NSUTF8StringEncoding]:NSNull.null});
   if(!packet||packet.length>65536)return Error(env,"AUTH_IDENTITY_PEER_PACKET_BOUND");
   return PeerQueue(env,self,p,true,{(const unsigned char*)packet.bytes,(const unsigned char*)packet.bytes+packet.length});
  }
  if(method==PeerMethod::receive){if(!p->sent||p->read||p->busy)return Error(env,"AUTH_IDENTITY_PEER_RETURN_ONCE");p->read=true;return PeerQueue(env,self,p,false,{});}
  return Error(env,"AUTH_IDENTITY_PEER_METHOD_INVALID");
 }@catch(id){PeerFail(p,"AUTH_IDENTITY_PEER_NATIVE_EXCEPTION");}}catch(const std::exception&e){PeerFail(p,e.what());}return Error(env,p->first.c_str());
}
static napi_value PeerConstruct(napi_env env,napi_callback_info info){
 napi_value args[2];if(!Args(env,info,2,args)||!pthread_main_np())return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto*request=IDEIdentityOriginal(env,args[1]);if(!request)return Error(env,"AUTH_IDENTITY_ORIGINAL_OWNER_REQUIRED");
 NSData*entryRaw=IDEIdentityString(env,args[0],8192);if(!entryRaw)return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
 if(identityPeers.size()>=32||request->peerChildren)return Error(env,"AUTH_IDENTITY_PEER_CAPACITY");
 auto*p=new(std::nothrow)IDEIdentityPeerOwner;if(!p)return Error(env,"AUTH_IDENTITY_PEER_CAPACITY");p->env=env;p->thread=pthread_self();p->parent=request;
 napi_value result;if(napi_create_object(env,&result)!=napi_ok||napi_type_tag_object(env,result,&identityPeerTag)!=napi_ok||napi_create_reference(env,args[1],1,&p->parentReference)!=napi_ok){delete p;return nullptr;}
 identityPeers.insert(p);if(napi_wrap(env,result,p,PeerFinalize,nullptr,nullptr)!=napi_ok){identityPeers.erase(p);napi_delete_reference(env,p->parentReference);delete p;return nullptr;}
 request->peerChildren++;p->child=true;
 const char*names[]={"current","sendRequest","receiveReturn","retire","join","close","status"};for(uintptr_t i=0;i<7;i++){napi_property_descriptor d={names[i],nullptr,PeerOperation,nullptr,nullptr,nullptr,napi_default,(void*)(i+1)};if(napi_define_properties(env,result,1,&d)!=napi_ok)return nullptr;}napi_object_freeze(env,result);
 try{@try{
  // Observe only until Source, registration and the actual peer qualify.
  // Ordinary IDE fd5 must never acquire an Endpoint whose retire shuts it down.
  if(fstat(5,&p->original)||!S_ISSOCK(p->original.st_mode))return PeerFail(p,"AUTH_IDENTITY_PEER_INHERITED_ENDPOINT_REQUIRED"),result;
  if(!IDEIdentityCurrent(request))return PeerFail(p,"AUTH_IDENTITY_PEER_REQUEST_NOT_CURRENT"),result;
  NSString*entry=[[NSString alloc]initWithData:entryRaw encoding:NSUTF8StringEncoding];p->resources=ynx_auth_ide_private::actualNodeParentResources();if(!ynx_auth_ide_private::actualNodeEntry(p->resources,entry))return PeerFail(p,"IDE_NODE_RUNNING_ENTRY_INVALID"),result;
  NSError*error=nil;p->selection=[request->source copyOriginalSelection:&error];p->registration=p->selection[@"identityPeerBinding"];
  NSSet*keys=[NSSet setWithArray:@[@"walletCodeIdentity",@"ideCodeIdentity",@"nodeCodeIdentity",@"nodeSHA256",@"entrySHA256",@"provenanceSHA256"]];
  if(error||![p->registration isKindOfClass:NSDictionary.class]||![[NSSet setWithArray:p->registration.allKeys]isEqual:keys])return PeerFail(p,"AUTH_IDENTITY_PEER_REGISTRATION_REQUIRED"),result;
  p->node=ynx_auth_ide_private::observeKernel(getpid());p->ide=ynx_auth_ide_private::observeKernel(getppid());p->wallet=ynx_auth_ide_private::observeKernel((pid_t)p->ide.original.parent);
  socklen_t size=sizeof(p->peer);if(getsockopt(5,SOL_LOCAL,LOCAL_PEERTOKEN,&p->peer,&size)||size!=sizeof(p->peer)||audit_token_to_pid(p->peer)!=(pid_t)p->wallet.original.pid||audit_token_to_euid(p->peer)!=p->wallet.original.uid||p->node.original.parent!=p->ide.original.pid||p->ide.original.parent!=p->wallet.original.pid||p->node.original.uid!=p->ide.original.uid||p->ide.original.uid!=p->wallet.original.uid)return PeerFail(p,"AUTH_IDENTITY_PEER_KERNEL_LINEAGE_REQUIRED"),result;
  if(![[p->wallet.codeIdentity base64EncodedStringWithOptions:0]isEqual:p->registration[@"walletCodeIdentity"]]||![[p->ide.codeIdentity base64EncodedStringWithOptions:0]isEqual:p->registration[@"ideCodeIdentity"]]||![[p->node.codeIdentity base64EncodedStringWithOptions:0]isEqual:p->registration[@"nodeCodeIdentity"]])return PeerFail(p,"AUTH_IDENTITY_PEER_CODE_IDENTITY_MISMATCH"),result;
  if(!PeerBorrowCurrent(p))return result;
  if(!identityPeerClaims.insert({p->original.st_dev,p->original.st_ino}).second)return PeerFail(p,"AUTH_IDENTITY_PEER_ALREADY_CLAIMED"),result;p->claimed=true;
  // First new descriptor is retained immediately, before any later validation.
  p->pendingDescriptor=fcntl(5,F_DUPFD_CLOEXEC,10);if(p->pendingDescriptor<0||fstat(p->pendingDescriptor,&p->pendingIdentity))return PeerFail(p,"AUTH_IDENTITY_PEER_DUPLICATE_UNKNOWN"),result;
  if(!PeerSameFile(p->pendingIdentity,p->original)||!PeerBorrowCurrent(p))return PeerFail(p,"AUTH_IDENTITY_PEER_DUPLICATE_IDENTITY_CHANGED"),result;
  p->endpoint=std::make_unique<Endpoint>(p->pendingDescriptor,std::chrono::steady_clock::time_point(std::chrono::milliseconds(request->deadline)));p->pendingDescriptor=-1;
  p->ready=true;PeerCurrent(p);return result;
 }@catch(id){PeerFail(p,"AUTH_IDENTITY_PEER_CONSTRUCTOR_EXCEPTION");return result;}}catch(const std::exception&e){PeerFail(p,e.what());return result;}
}
// Fixed immutable compiled Method[] collector. No caller module object or
// getter may install/replace a factory, Source owner or expected registration.
struct IdentityPeerFactoryTable{napi_env env;napi_callback callback=nullptr;void*data=nullptr;};
static void IdentityPeerFactoryCleanup(void*raw){auto*t=static_cast<IdentityPeerFactoryTable*>(raw);if(pthread_main_np())for(auto*p:identityPeers)if(p->env==t->env)PeerRetire(p);delete t;}
static napi_value IdentityPeerFactoryBinding(napi_env env,napi_callback_info info){
 napi_value argument;void*raw=nullptr;size_t count=1;if(napi_get_cb_info(env,info,&count,&argument,nullptr,&raw)!=napi_ok||count!=1)return Error(env,"AUTH_IDENTITY_ARGUMENTS_INVALID");
 auto*t=static_cast<IdentityPeerFactoryTable*>(raw);if(!t||t->env!=env||!t->callback||!pthread_main_np())return Error(env,"AUTH_IDENTITY_PEER_BINDING_REQUIRED");
 NSData*entry=IDEIdentityString(env,argument,8192);if(!entry)return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
 try{@try{
  NSString*url=[[NSString alloc]initWithData:entry encoding:NSUTF8StringEncoding];NSString*resources=ynx_auth_ide_private::actualNodeParentResources();
  if(!ynx_auth_ide_private::actualNodeEntry(resources,url))return Error(env,"IDE_NODE_RUNNING_ENTRY_INVALID");
  napi_value binding;if(napi_create_object(env,&binding)!=napi_ok)return nullptr;
  napi_property_descriptor d={"acquireOriginalIDEIdentityPeerChannel",nullptr,t->callback,nullptr,nullptr,nullptr,napi_default,t->data};
  if(napi_define_properties(env,binding,1,&d)!=napi_ok||napi_object_freeze(env,binding)!=napi_ok)return nullptr;return binding;
 }@catch(id){return Error(env,"AUTH_IDENTITY_PEER_BINDING_EXCEPTION");}}catch(const std::exception&){return Error(env,"IDE_NODE_ACTUAL_PARENT_ENTRY_UNAVAILABLE");}
}
template<class Method,std::size_t N>static napi_value RegisterOriginalIDEIdentityPeerBinding(napi_env env,napi_value exports,const Method(&methods)[N]){
 auto*t=new(std::nothrow)IdentityPeerFactoryTable{env};if(!t)return Error(env,"AUTH_IDENTITY_PEER_CAPACITY");
 for(const auto&method:methods)if(!strcmp(method.name,"acquireOriginalIDEIdentityPeerChannel")){
  if(t->callback||!method.callback){delete t;return Error(env,"AUTH_IDENTITY_PEER_FACTORY_DUPLICATE");}t->callback=method.callback;t->data=method.data;
 }
 if(!t->callback){delete t;return Error(env,"AUTH_IDENTITY_PEER_FACTORY_NOT_IMPLEMENTED");}
 if(napi_add_env_cleanup_hook(env,IdentityPeerFactoryCleanup,t)!=napi_ok){delete t;return Error(env,"AUTH_IDENTITY_PEER_BINDING_CLEANUP_UNKNOWN");}
 napi_property_descriptor d={"getOriginalIDEIdentityPeerBinding",nullptr,IdentityPeerFactoryBinding,nullptr,nullptr,nullptr,napi_default,t};
 if(napi_define_properties(env,exports,1,&d)!=napi_ok)return nullptr;return exports;
}
