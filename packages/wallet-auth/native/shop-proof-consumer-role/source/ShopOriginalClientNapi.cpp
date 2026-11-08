#include "ShopOriginalClientNapi.hpp"
#include "ShopClientOwner.hpp"
#include <algorithm>
#include <array>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
namespace {
using namespace ynx::auth::shop;
constexpr napi_type_tag Tag{0xb8da890f412db700ULL,0x6f013aa0fe782137ULL};
enum class Kind {Client,Response};
struct Box {
 napi_env env;Kind kind;bool finalized=false;
 const std::thread::id actor=std::this_thread::get_id();
 std::shared_ptr<Client>client;std::shared_ptr<Response>response;
 napi_ref first=nullptr,closePromise=nullptr,releasePromise=nullptr;
};
std::mutex inventoryMutex;
std::vector<std::unique_ptr<Box>>inventory; // stable bounded tombstones prevent ABA
struct Job {
 napi_env env;Box*parent=nullptr;
 std::shared_ptr<Client>client;std::shared_ptr<Response>response;
 std::string order;Status status{};
 napi_async_work work=nullptr;napi_deferred deferred=nullptr;
 napi_ref parentRef=nullptr,responseRef=nullptr,guard=nullptr,signal=nullptr,listener=nullptr;
 bool listenerInstalled=false,workerStarted=false,beginOwned=false;
};
struct CancelHold {napi_env env;std::shared_ptr<Client>client;};
napi_value undef(napi_env e){napi_value v=nullptr;napi_get_undefined(e,&v);return v;}
bool set(napi_env e,napi_value o,const char*k,napi_value v){return v&&napi_set_named_property(e,o,k,v)==napi_ok;}
napi_value boolean(napi_env e,bool b){napi_value v=nullptr;napi_get_boolean(e,b,&v);return v;}
napi_value number(napi_env e,int n){napi_value v=nullptr;napi_create_int32(e,n,&v);return v;}
bool pending(napi_env e){bool b=false;napi_is_exception_pending(e,&b);return b;}
napi_value exception(napi_env e){napi_value v=nullptr;napi_get_and_clear_last_exception(e,&v);return v;}
napi_value error(napi_env e,Status s){napi_value m=nullptr,v=nullptr;napi_create_string_utf8(e,"SHOP_ORIGINAL_NATIVE_FAILURE",NAPI_AUTO_LENGTH,&m);napi_create_error(e,nullptr,m,&v);set(e,v,"nativeCode",number(e,s.first_code));set(e,v,"errorPresent",boolean(e,s.error_present));set(e,v,"unknown",boolean(e,s.unknown));set(e,v,"physicalDone",boolean(e,s.physical_done));return v;}
napi_value firstValue(Box*b){napi_value holder=nullptr,value=nullptr;napi_get_reference_value(b->env,b->first,&holder);napi_get_named_property(b->env,holder,"cause",&value);return value;}
napi_value rememberValue(Box*b,napi_value value){if(b->first)return firstValue(b);napi_value holder=nullptr;napi_create_object(b->env,&holder);set(b->env,holder,"cause",value);napi_object_freeze(b->env,holder);napi_create_reference(b->env,holder,1,&b->first);return value;}
napi_value remembered(Box*b,Status s){return b->first?firstValue(b):rememberValue(b,error(b->env,s));}
Box*known(napi_env e,napi_value v,Kind k){bool tagged=false;if(!v||napi_check_object_type_tag(e,v,&Tag,&tagged)!=napi_ok||!tagged)return nullptr;void*p=nullptr;if(napi_unwrap(e,v,&p)!=napi_ok)return nullptr;std::lock_guard<std::mutex>lock(inventoryMutex);for(auto&b:inventory)if(b.get()==p&&b->env==e&&b->kind==k&&!b->finalized)return b.get();return nullptr;}
void finalize(napi_env e,void*p,void*){Box*b=nullptr;{std::lock_guard<std::mutex>lock(inventoryMutex);for(auto&v:inventory)if(v.get()==p&&v->env==e){b=v.get();break;}}if(!b)return;b->finalized=true;if(b->client)b->client->retire(e);for(auto r:{b->first,b->closePromise,b->releasePromise})if(r)napi_delete_reference(e,r);b->first=b->closePromise=b->releasePromise=nullptr;/* Never resend close/release on GC. Inventory retains unknown physical debt. */}
bool string(napi_env e,napi_value v,std::string&out){napi_valuetype t;napi_typeof(e,v,&t);if(t!=napi_string)return false;std::size_t n=0;if(napi_get_value_string_utf8(e,v,nullptr,0,&n)!=napi_ok||n<3||n>128)return false;std::array<char,129>b{};std::size_t actual=0;if(napi_get_value_string_utf8(e,v,b.data(),b.size(),&actual)!=napi_ok||actual!=n)return false;out.assign(b.data(),n);return true;}
napi_value bytes(napi_env e,const std::vector<unsigned char>&b){void*p=nullptr;napi_value ab=nullptr,v=nullptr;if(napi_create_arraybuffer(e,b.size(),&p,&ab)!=napi_ok)return nullptr;if(!b.empty())std::copy(b.begin(),b.end(),static_cast<unsigned char*>(p));if(napi_create_typedarray(e,napi_uint8_array,b.size(),ab,0,&v)!=napi_ok)return nullptr;return v;}
napi_value envelope(napi_env e,napi_value owner,napi_value cause){napi_value o=nullptr,n=nullptr;napi_create_object(e,&o);napi_get_null(e,&n);set(e,o,"owner",owner?owner:n);set(e,o,"errorPresent",boolean(e,cause!=nullptr));if(cause)set(e,o,"error",cause);return o;}
bool callGuard(Job*j){napi_value f=nullptr,g=nullptr,result=nullptr;napi_valuetype t;if(!j->guard||napi_get_reference_value(j->env,j->guard,&f)!=napi_ok||napi_typeof(j->env,f,&t)!=napi_ok||t!=napi_function)return false;napi_get_undefined(j->env,&g);if(napi_call_function(j->env,g,f,0,nullptr,&result)!=napi_ok)return false;if(napi_typeof(j->env,result,&t)!=napi_ok||t!=napi_undefined)return false;napi_value sig=nullptr,aborted=nullptr;bool b=true;if(napi_get_reference_value(j->env,j->signal,&sig)!=napi_ok||napi_get_named_property(j->env,sig,"aborted",&aborted)!=napi_ok||napi_get_value_bool(j->env,aborted,&b)!=napi_ok||b)return false;return true;}
napi_value cancel(napi_env e,napi_callback_info info){std::size_t n=0;void*p=nullptr;napi_get_cb_info(e,info,&n,nullptr,nullptr,&p);auto*h=static_cast<CancelHold*>(p);if(h&&h->env==e&&h->client)h->client->retire(e);return undef(e);}
void finalizeCancel(napi_env,void*p,void*){delete static_cast<CancelHold*>(p);}
bool listen(Job*j){napi_value f=nullptr,s=nullptr,add=nullptr,fn=nullptr,name=nullptr,options=nullptr;if(napi_get_reference_value(j->env,j->guard,&f)!=napi_ok||napi_get_named_property(j->env,f,"signal",&s)!=napi_ok||napi_create_reference(j->env,s,1,&j->signal)!=napi_ok)return false;if(napi_get_named_property(j->env,s,"addEventListener",&add)!=napi_ok)return false;auto hold=std::make_unique<CancelHold>();hold->env=j->env;hold->client=j->client;if(napi_create_function(j->env,"retireOriginalShopRead",NAPI_AUTO_LENGTH,cancel,hold.get(),&fn)!=napi_ok||napi_add_finalizer(j->env,fn,hold.get(),finalizeCancel,nullptr,nullptr)!=napi_ok)return false;hold.release();if(napi_create_reference(j->env,fn,1,&j->listener)!=napi_ok)return false;napi_create_string_utf8(j->env,"abort",NAPI_AUTO_LENGTH,&name);napi_create_object(j->env,&options);set(j->env,options,"once",boolean(j->env,true));napi_value args[]{name,fn,options},r=nullptr;j->listenerInstalled=true;if(napi_call_function(j->env,s,add,3,args,&r)!=napi_ok)return false;return true;}
// Callback data owns its native loan independently of Job and is released by
// the actual function finalizer. A throwing custom signal cannot leave UAF.
bool detach(Job*j){if(!j->listenerInstalled)return true;napi_value s=nullptr,fn=nullptr,remove=nullptr,name=nullptr,r=nullptr;napi_get_reference_value(j->env,j->signal,&s);napi_get_reference_value(j->env,j->listener,&fn);if(napi_get_named_property(j->env,s,"removeEventListener",&remove)!=napi_ok)return false;napi_create_string_utf8(j->env,"abort",NAPI_AUTO_LENGTH,&name);napi_value args[]{name,fn};if(napi_call_function(j->env,s,remove,2,args,&r)!=napi_ok)return false;j->listenerInstalled=false;return true;}
void dropJob(Job*j){for(auto ref:{j->parentRef,j->responseRef,j->guard,j->signal,j->listener})if(ref)napi_delete_reference(j->env,ref);if(j->work)napi_delete_async_work(j->env,j->work);delete j;}
napi_value method(napi_env,napi_callback_info);
napi_value make(napi_env e,std::shared_ptr<Client>c,std::shared_ptr<Response>r,bool responseKind=false){
 auto box=std::make_unique<Box>();box->env=e;box->kind=(r||responseKind)?Kind::Response:Kind::Client;box->client=std::move(c);box->response=std::move(r);Box*raw=box.get();
 {std::lock_guard<std::mutex>lock(inventoryMutex);if(inventory.size()>=65536)return nullptr;inventory.push_back(std::move(box));}
 napi_value v=nullptr;if(napi_create_object(e,&v)!=napi_ok||napi_wrap(e,v,raw,finalize,nullptr,nullptr)!=napi_ok||napi_type_tag_object(e,v,&Tag)!=napi_ok)return nullptr;
 const std::vector<std::pair<const char*,std::intptr_t>>clientMethods{{"current",1},{"readOriginalScopeDATA",2},{"readOriginalShopInvoiceTransport",3},{"retire",4},{"join",5},{"close",6},{"readOriginalCustodyDATA",9}};
 const std::vector<std::pair<const char*,std::intptr_t>>responseMethods{{"readOriginalTransportDATA",7},{"release",8},{"readOriginalCustodyDATA",10}};
 for(auto [name,id]:(raw->kind==Kind::Client?clientMethods:responseMethods)){napi_value f=nullptr;if(napi_create_function(e,name,NAPI_AUTO_LENGTH,method,reinterpret_cast<void*>(id),&f)!=napi_ok||!set(e,v,name,f))return nullptr;}
 napi_object_freeze(e,v);return v;
}
void execute(napi_env,void*p){auto*j=static_cast<Job*>(p);j->workerStarted=true;j->response=j->client->read(j->order,j->status);j->beginOwned=false;}
void complete(napi_env e,napi_status native,void*p){auto*j=static_cast<Job*>(p);napi_value cause=nullptr,child=nullptr;
 if(j->beginOwned){j->client->abandon(j->order);j->beginOwned=false;}
 if(j->response){napi_get_reference_value(e,j->responseRef,&child);auto*b=known(e,child,Kind::Response);if(b){b->client=j->client;b->response=j->response;}else child=nullptr;} // preallocated custody, before status/current/guard
 if(!ok(j->status))cause=remembered(j->parent,j->status);
 if(native!=napi_ok&&!cause)cause=remembered(j->parent,denied());
 if(!cause&&!callGuard(j)){cause=rememberValue(j->parent,pending(e)?exception(e):error(e,denied()));j->client->retire(e);}
 if(!cause){auto s=j->client->current(e);if(!ok(s))cause=remembered(j->parent,s);}
 if(j->response&&!child&&!cause)cause=remembered(j->parent,denied());
 if(!detach(j)){auto late=pending(e)?exception(e):error(e,denied());if(!cause)cause=rememberValue(j->parent,late);j->client->retire(e);}
 if(child&&cause){auto*b=known(e,child,Kind::Response);if(b)rememberValue(b,cause);}
 napi_resolve_deferred(e,j->deferred,envelope(e,child,cause));dropJob(j);
}
napi_value method(napi_env e,napi_callback_info info){std::size_t n=3;napi_value args[3]{},self=nullptr;void*d=nullptr;napi_get_cb_info(e,info,&n,args,&self,&d);const auto id=reinterpret_cast<std::intptr_t>(d);auto*b=known(e,self,(id==7||id==8||id==10)?Kind::Response:Kind::Client);if(!b||b->actor!=std::this_thread::get_id()){napi_throw(e,error(e,denied()));return nullptr;}
 if(id==3){if(n!=2){napi_throw(e,error(e,denied()));return nullptr;}auto j=std::make_unique<Job>();j->env=e;j->parent=b;j->client=b->client;if(!string(e,args[0],j->order)||napi_create_reference(e,args[1],1,&j->guard)!=napi_ok){if(j->guard)napi_delete_reference(e,j->guard);napi_throw(e,error(e,denied()));return nullptr;}
  if(!listen(j.get())||!callGuard(j.get())){auto cause=rememberValue(b,pending(e)?exception(e):error(e,denied()));j->client->retire(e);if(!detach(j.get())&&pending(e))exception(e);dropJob(j.release());napi_throw(e,cause);return nullptr;}
  auto s=b->client->begin(e,j->order);if(!ok(s)){auto cause=remembered(b,s);if(!detach(j.get())&&pending(e))exception(e);dropJob(j.release());napi_throw(e,cause);return nullptr;}j->beginOwned=true;
  // Reserve the actual branded response child before crossing any C/Go read
  // boundary. A late packet never depends on post-effect JS allocation.
  napi_value reserved=make(e,{},{},true);if(!reserved||napi_create_reference(e,reserved,1,&j->responseRef)!=napi_ok){j->client->abandon(j->order);j->beginOwned=false;auto cause=rememberValue(b,pending(e)?exception(e):error(e,denied()));if(!detach(j.get())&&pending(e))exception(e);dropJob(j.release());napi_throw(e,cause);return nullptr;}
  napi_value promise=nullptr,name=nullptr;napi_create_promise(e,&j->deferred,&promise);napi_create_string_utf8(e,"original-shop-read",NAPI_AUTO_LENGTH,&name);napi_create_reference(e,self,1,&j->parentRef);
  if(napi_create_async_work(e,nullptr,name,execute,complete,j.get(),&j->work)!=napi_ok||napi_queue_async_work(e,j->work)!=napi_ok){j->client->abandon(j->order);j->beginOwned=false;auto cause=rememberValue(b,pending(e)?exception(e):error(e,denied()));if(!detach(j.get())&&pending(e))exception(e);napi_resolve_deferred(e,j->deferred,envelope(e,nullptr,cause));dropJob(j.release());return promise;}
  j.release();return promise;
 }
 if(n!=0){napi_throw(e,error(e,denied()));return nullptr;}
 if(id==9||id==10){const auto c=id==9?(b->client?b->client->custody():Custody{}):(b->response?b->response->custody():Custody{});napi_value v=nullptr;napi_create_object(e,&v);set(e,v,"selected",boolean(e,c.selected));set(e,v,"unknown",boolean(e,c.unknown));set(e,v,"physicalDone",boolean(e,c.physicalDone));napi_object_freeze(e,v);return v;}
 if((id==6&&b->closePromise)||(id==8&&b->releasePromise)){napi_value v=nullptr;napi_get_reference_value(e,id==6?b->closePromise:b->releasePromise,&v);return v;}
 if(id==2){std::vector<unsigned char>raw;auto s=b->client->scope(e,raw);if(!ok(s)){napi_throw(e,remembered(b,s));return nullptr;}return bytes(e,raw);}
 if(id==7){Transport raw;auto s=b->response->copy(e,raw);if(!ok(s)){napi_throw(e,remembered(b,s));return nullptr;}napi_value v=nullptr;napi_create_object(e,&v);set(e,v,"status",number(e,raw.status));set(e,v,"methodOriginal",bytes(e,raw.method));set(e,v,"pathOriginal",bytes(e,raw.path));set(e,v,"contentTypeOriginal",bytes(e,raw.contentType));set(e,v,"bodyOriginal",bytes(e,raw.body));napi_object_freeze(e,v);return v;}
 Status s{};switch(id){case 1:s=b->client->current(e);break;case 4:s=b->client->retire(e);break;case 5:s=b->client->join(e);break;case 6:s=b->client->close(e);break;case 8:s=b->response->release(e);break;default:s=denied();}
 if(id==5||id==6||id==8){napi_deferred deferred=nullptr;napi_value promise=nullptr;napi_create_promise(e,&deferred,&promise);if(id==8&&b->response->cleanupSelected())napi_create_reference(e,promise,1,&b->releasePromise);if(id==6&&b->client->cleanupSelected())napi_create_reference(e,promise,1,&b->closePromise);if(ok(s)&&s.physical_done&&!b->first)napi_resolve_deferred(e,deferred,undef(e));else {const bool unselected=(id==5&&!s.physical_done&&!s.unknown)||(id==6&&!b->client->cleanupSelected())||(id==8&&!b->response->cleanupSelected());napi_reject_deferred(e,deferred,unselected&&!b->first?error(e,s):remembered(b,s));}return promise;}
 if(!ok(s)){napi_throw(e,remembered(b,s));return nullptr;}return undef(e);
}
napi_value acquire(napi_env e,napi_callback_info info){std::size_t n=1;napi_value arg=nullptr;napi_get_cb_info(e,info,&n,&arg,nullptr,nullptr);if(n){napi_throw(e,error(e,denied()));return nullptr;}auto v=make(e,{},{});auto*b=v?known(e,v,Kind::Client):nullptr;if(!b){napi_throw(e,error(e,denied()));return nullptr;}Status s{};b->client=Client::acquire(e,s);if(!b->client){b->finalized=true;return envelope(e,nullptr,error(e,s));}return envelope(e,v,!ok(s)?remembered(b,s):nullptr);}
napi_value isOriginal(napi_env e,napi_callback_info info){std::size_t n=2;napi_value args[2]{};napi_get_cb_info(e,info,&n,args,nullptr,nullptr);return boolean(e,n==1&&known(e,args[0],Kind::Client));}
}
napi_value RegisterOriginalShopPrivateClientV1(napi_env e,napi_value exports){napi_value a=nullptr,i=nullptr;napi_create_function(e,"acquireOriginalShopPrivateClient",NAPI_AUTO_LENGTH,acquire,nullptr,&a);napi_create_function(e,"isOriginalShopPrivateClient",NAPI_AUTO_LENGTH,isOriginal,nullptr,&i);set(e,exports,"acquireOriginalShopPrivateClient",a);set(e,exports,"isOriginalShopPrivateClient",i);return exports;}
