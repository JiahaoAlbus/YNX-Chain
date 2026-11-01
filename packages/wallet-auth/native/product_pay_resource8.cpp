#include "product_pay_resource8_private.hpp"
#include "product_pay_route_match_private.hpp"
#include "pay_native_namespace_bootstrap_private.hpp"
#include "pay_root_main_code_private.hpp"
#include "product_main_peer_private.hpp"
#include <atomic>
#include <thread>
#include <mutex>
#include <vector>
#include <functional>
#include <stdexcept>
#include <cstring>
#include <algorithm>
#include <chrono>
namespace ynx::wallet::product {
namespace {
void ok(napi_status s){if(s!=napi_ok)throw std::runtime_error("PRODUCT_RESOURCE8_NAPI");}
[[noreturn]]void deny(const char*s){throw std::runtime_error(s);}
napi_value undef(napi_env e){napi_value v;ok(napi_get_undefined(e,&v));return v;}
napi_value text(napi_env e,const std::string&s){napi_value v;ok(napi_create_string_utf8(e,s.data(),s.size(),&v));return v;}
bool type(napi_env e,napi_value v,napi_valuetype t){napi_valuetype x;ok(napi_typeof(e,v,&x));return x==t;}
napi_value get(napi_env e,napi_value o,const char*k){napi_value v;ok(napi_get_named_property(e,o,k,&v));return v;}
void prop(napi_env e,napi_value o,const char*k,napi_value v){napi_property_descriptor d={k,nullptr,nullptr,nullptr,nullptr,v,napi_enumerable,nullptr};ok(napi_define_properties(e,o,1,&d));}
napi_value error(napi_env e,const char*c){napi_value v;ok(napi_create_error(e,nullptr,text(e,c),&v));prop(e,v,"code",text(e,c));return v;}
std::string string(napi_env e,napi_value v,size_t max){if(!type(e,v,napi_string))deny("PRODUCT_RESOURCE8_STRING");size_t n;ok(napi_get_value_string_utf8(e,v,nullptr,0,&n));if(n>max)deny("PRODUCT_RESOURCE8_BOUND");std::string s(n+1,0);size_t got;ok(napi_get_value_string_utf8(e,v,s.data(),s.size(),&got));if(got!=n||memchr(s.data(),0,n))deny("PRODUCT_RESOURCE8_STRING");s.resize(n);return s;}
struct Ref{napi_env e=nullptr;napi_ref p=nullptr;bool weak=false;void set(napi_env env,napi_value v){if(p)deny("PRODUCT_RESOURCE8_DOUBLE_HOLD");e=env;ok(napi_create_reference(e,v,1,&p));}napi_value value(){napi_value v;if(!p)deny("PRODUCT_RESOURCE8_HOLD_MISSING");ok(napi_get_reference_value(e,p,&v));if(!v)deny("PRODUCT_RESOURCE8_HOLD_COLLECTED");return v;}void weaken(){if(p&&!weak){uint32_t n;ok(napi_reference_unref(e,p,&n));weak=true;}}void clear(){if(p){ok(napi_delete_reference(e,p));p=nullptr;weak=false;}}~Ref(){if(p)napi_delete_reference(e,p);}};
napi_value call(napi_env e,napi_value o,napi_value f,size_t n=0,napi_value*a=nullptr){if(!type(e,f,napi_function))deny("PRODUCT_RESOURCE8_CALLEE");napi_value v;ok(napi_call_function(e,o,f,n,a,&v));return v;}
struct Fn{std::function<napi_value(size_t,napi_value*,napi_value)>f;};
napi_value fn(napi_env e,const char*name,std::function<napi_value(size_t,napi_value*,napi_value)>f){auto*p=new Fn{std::move(f)};napi_value v;
 ok(napi_create_function(e,name,NAPI_AUTO_LENGTH,[](napi_env e,napi_callback_info i)->napi_value{size_t n=2;napi_value a[2],self;void*d;ok(napi_get_cb_info(e,i,&n,a,&self,&d));try{return static_cast<Fn*>(d)->f(n,a,self);}catch(const std::exception&x){bool pending=false;napi_is_exception_pending(e,&pending);if(!pending)napi_throw(e,error(e,x.what()));return nullptr;}catch(...){napi_throw(e,error(e,"PRODUCT_RESOURCE8_FAILURE"));return nullptr;}},p,&v));
 ok(napi_add_finalizer(e,v,p,[](napi_env,void*p,void*){delete static_cast<Fn*>(p);},nullptr,nullptr));return v;}
ynx_product_pay_bytes_v1 bytes(const std::string&s){return{reinterpret_cast<const unsigned char*>(s.data()),s.size()};}
std::string copy(ynx_product_pay_bytes_v1 b,size_t cap){if(b.bytes>cap||(!b.data&&b.bytes))deny("PRODUCT_RESOURCE8_RESPONSE_BOUND");return b.bytes?std::string(reinterpret_cast<const char*>(b.data),b.bytes):std::string{};}
}
struct ProductPayResource8::Impl:std::enable_shared_from_this<Impl>{
 napi_env env;std::thread::id actor;std::shared_ptr<OriginalProductRoot>root;std::shared_ptr<ProductPayResourceRoot>resource;
 ynx::wallet::pay::MainNamespaceBorrow main;ProductPayResourceProfileDATA profile;Ref object,firstBox,sourceOwner,producer,captureOriginal,readyP,then;
 napi_deferred readyD=nullptr;bool captureFinished=false,retireReaderRequested=false;
 std::atomic<bool>retired{false};bool first=false,closed=false,joined=false,cleanupFailure=false;std::string cleanupCode;size_t active=0;
 struct Job;std::shared_ptr<Job>armed;std::vector<std::shared_ptr<Job>>jobs;
 napi_deferred joinD=nullptr,closeD=nullptr;Ref joinP,closeP;
 explicit Impl(napi_env e):env(e),actor(std::this_thread::get_id()){}
 void thread(){if(actor!=std::this_thread::get_id())deny("PRODUCT_RESOURCE8_ACTOR");}
 void remember(const char*code="PRODUCT_RESOURCE8_FIRST_FAILURE"){if(first)return;bool pending=false;ok(napi_is_exception_pending(env,&pending));napi_value c;if(pending)ok(napi_get_and_clear_last_exception(env,&c));else c=error(env,code);napi_value b;ok(napi_create_object(env,&b));prop(env,b,"cause",c);firstBox.set(env,b);first=true;}
 napi_value cause(){return first?get(env,firstBox.value(),"cause"):undef(env);}
 void cleanup_failed(const char*code){if(!cleanupFailure){cleanupFailure=true;cleanupCode=code;}remember(code);}
 napi_value cleanup_error(){auto out=error(env,cleanupCode.c_str());prop(env,out,"cause",cause());return out;}
 void current(){thread();if(retired.load()||closed||!resource||!main.epoch||!main.epoch->current()||ynx::wallet::pay::original_pay_main_code_root_current(main.code_root)||resource->current()||recheck_original_product_root(root))deny("PRODUCT_RESOURCE8_NOT_CURRENT");}
 void park(){static auto*items=new std::vector<std::shared_ptr<Impl>>;static auto*lock=new std::mutex;std::lock_guard<std::mutex>l(*lock);items->push_back(shared_from_this());}
 void settle();void retire();napi_value request(napi_value);napi_value after_capture(std::function<napi_value()>);
};
struct ProductPayResource8::Impl::Job:std::enable_shared_from_this<Job>{
 std::shared_ptr<Impl>parent;uint32_t operation;ynx_product_pay_source_loan_v1*loan=nullptr;std::atomic<ynx_product_pay_transport_v1*>transport{nullptr};
 ynx_product_pay_response_v1 response{};ynx_product_pay_response_diagnostics_v1 diagnostic{};
 std::atomic<bool>cancelled{false},clean{false},draining{false},drainExpired{false};bool consumed=false,done=false,settled=false,resultValid=false,published=false,dispatchPossible=false;uint32_t remoteStatus=0;int32_t code=0,nativeCode=0;std::atomic<int32_t>cleanup{0};
 std::string method,path,mime,body,retained_body,retained_headers,retained_mime,diagnosticCode,diagnosticMessage;Ref current,signal,abortHandler;bool listening=false,listenerDebt=false;
 napi_deferred deferred=nullptr;napi_async_work work=nullptr;
 explicit Job(std::shared_ptr<Impl>p,uint32_t op):parent(std::move(p)),operation(op){}
 static int32_t fence(void*p){auto&j=*static_cast<Job*>(p);if(j.cancelled.load(std::memory_order_acquire)||j.parent->retired.load(std::memory_order_acquire)||!j.parent->main.epoch||!j.parent->main.epoch->current())return 1;return ynx_product_pay_source_current_no_io_v1(j.loan);}
 void cancel(){cancelled.store(true,std::memory_order_release);if(transport)(void)ynx_product_pay_transport_cancel_v1(transport);}
 void drain(){if(clean)return;if(response.response_owner)ynx_product_pay_transport_release_response_v1(&response);
  if(transport){(void)ynx_product_pay_transport_retire_v1(transport);uint32_t done=0;int32_t c=ynx_product_pay_transport_join_v1(transport,&done);if(c&&!cleanup)cleanup=c;if(!done)return;done=0;c=ynx_product_pay_transport_close_v1(transport,&done);if(c&&!cleanup)cleanup=c;if(!done)return;transport=nullptr;}
  // Keep this original permission until actor final post-cleanup verification.
  if(listenerDebt||(deferred&&!settled))return;
  if(loan){int32_t c=ynx_product_pay_source_release_v1(loan);if(c==2)return;if(c&&!cleanup)cleanup=c;if(c)return;loan=nullptr;}clean=true;
 }
 void caller(){auto e=parent->env;auto v=call(e,undef(e),current.value());if(!type(e,v,napi_undefined))deny("PRODUCT_RESOURCE8_CALLER_CURRENT_RESULT");}
 void schedule_drain();
 napi_value failure(const char*c){auto e=parent->env;auto v=error(e,c);napi_value b;ok(napi_get_boolean(e,true,&b));prop(e,v,"errorPresent",b);prop(e,v,"cause",parent->cause());ok(napi_get_boolean(e,dispatchPossible,&b));prop(e,v,"dispatchPossible",b);prop(e,v,"state",text(e,dispatchPossible?"UNKNOWN":"NOT_DISPATCHED"));
  napi_value n;ok(napi_create_int32(e,code,&n));prop(e,v,"transportCode",n);ok(napi_create_uint32(e,remoteStatus,&n));prop(e,v,"remoteStatus",n);ok(napi_create_double(e,double(retained_body.size()),&n));prop(e,v,"partialResponseBytes",n);
  ok(napi_create_int32(e,nativeCode,&n));prop(e,v,"nativeCurrentCode",n);prop(e,v,"transportErrorCode",text(e,diagnosticCode));prop(e,v,"transportMessage",text(e,diagnosticMessage));return v;}
 void publish(){if(settled)return;auto e=parent->env;napi_value out=nullptr;
  try{if(!resultValid||cleanup||transport||drainExpired)deny(cleanup?"PRODUCT_RESOURCE8_ORIGINAL_CLEANUP_ERROR":"PRODUCT_RESOURCE8_ORIGINAL_DRAIN_PENDING");parent->current();caller();if(fence(this)||ynx_product_pay_source_full_current_v1(loan))deny("PRODUCT_RESOURCE8_POST_CLEANUP_CURRENT");
   ok(napi_create_object(e,&out));prop(e,out,"method",text(e,method));prop(e,out,"requestPath",text(e,path));prop(e,out,"contentType",text(e,retained_mime));napi_value n;ok(napi_create_uint32(e,remoteStatus,&n));prop(e,out,"status",n);napi_value b;void*d;ok(napi_create_buffer_copy(e,retained_body.size(),retained_body.data(),&d,&b));prop(e,out,"body",b);
   parent->current();caller();if(fence(this))deny("PRODUCT_RESOURCE8_POST_CLEANUP_CURRENT");
  }catch(const std::exception&x){parent->remember(x.what());out=nullptr;}catch(...){parent->remember();out=nullptr;}
  settled=true;drain();if(!clean){parent->cleanup_failed("PRODUCT_RESOURCE8_PERMISSION_RELEASE_PENDING");out=nullptr;}
  // Last full Root/Main/caller fence after original child cleanup/release.
  if(out)try{parent->current();caller();}catch(...){parent->remember("PRODUCT_RESOURCE8_LAST_CURRENT");out=nullptr;}
  if(out){published=true;ok(napi_resolve_deferred(e,deferred,out));}else ok(napi_reject_deferred(e,deferred,failure("PRODUCT_RESOURCE8_RESULT_WITHHELD")));
  if(!listenerDebt){signal.clear();abortHandler.clear();}current.clear();done=true;parent->active--;
 }
 void finish(napi_status status){auto e=parent->env;
  // response_owner already adopted on worker, before every code/current check.
  dispatchPossible=response.dispatch_possible!=0;remoteStatus=response.status;
  try{retained_body=copy(response.body,parent->profile.max_response_bytes);retained_headers=copy(diagnostic.headers_original,parent->profile.max_header_bytes);retained_mime=copy(response.content_type,1024);
   if(diagnostic.version==1&&diagnostic.size==sizeof diagnostic){nativeCode=diagnostic.native_current_code;diagnosticCode=copy(diagnostic.error_code,128);diagnosticMessage=copy(diagnostic.error_message,512);}
   if(status!=napi_ok||code)deny("PRODUCT_RESOURCE8_TRANSPORT_FAILURE");parent->current();caller();if(fence(this))deny("PRODUCT_RESOURCE8_LATE_CURRENT");
   if(response.version!=1||response.size!=sizeof response||response.status<100||response.status>599||copy(response.method,16)!=method||copy(response.request_path,4096)!=path)deny("PRODUCT_RESOURCE8_RESPONSE_BINDING");
   resultValid=true;
  }catch(const std::exception&x){parent->remember(x.what());}
   catch(...){parent->remember();}
  if(listening){try{auto s=signal.value();auto h=abortHandler.value();napi_value a[]={text(e,"abort"),h};(void)call(e,s,get(e,s,"removeEventListener"),2,a);}catch(...){listenerDebt=true;resultValid=false;parent->retired=true;parent->cleanup_failed("PRODUCT_RESOURCE8_ABORT_LISTENER_DEBT");}listening=false;}
  drain();if(transport)schedule_drain();else publish();parent->settle();
 }
};
void ProductPayResource8::Impl::Job::schedule_drain(){
 if(draining.exchange(true))return;
 struct Drain{std::shared_ptr<Job>job;napi_async_work work=nullptr;};
 auto*d=new Drain{shared_from_this(),nullptr};auto e=parent->env;
 auto rc=napi_create_async_work(e,nullptr,text(e,"OriginalProductPayDrain"),[](napi_env,void*p){auto j=static_cast<Drain*>(p)->job;
  auto until=std::chrono::steady_clock::now()+std::chrono::milliseconds(std::min<uint64_t>(30000,j->parent->profile.timeout_ms));
  do{j->drain();if(!j->transport)break;std::this_thread::sleep_for(std::chrono::milliseconds(1));}while(std::chrono::steady_clock::now()<until);j->drainExpired=j->transport!=nullptr;
 },[](napi_env e,napi_status,void*p){auto*d=static_cast<Drain*>(p);auto j=d->job;j->draining=false;try{j->publish();j->parent->settle();}catch(...){j->parent->park();}napi_delete_async_work(e,d->work);delete d;},d,&d->work);
 if(rc!=napi_ok||napi_queue_async_work(e,d->work)!=napi_ok){if(d->work)napi_delete_async_work(e,d->work);delete d;draining=false;drainExpired=true;publish();}
}
void ProductPayResource8::Impl::retire(){retired.store(true,std::memory_order_release);for(auto&j:jobs)j->cancel();if(resource)resource->retire();}
void ProductPayResource8::Impl::settle(){thread();bool pending=false;for(auto&j:jobs)if(j->done&&!j->draining){j->drain();if(j->cleanup)cleanup_failed("PRODUCT_RESOURCE8_ORIGINAL_CLEANUP_ERROR");pending=pending||(j->drainExpired&&!j->clean);}jobs.erase(std::remove_if(jobs.begin(),jobs.end(),[](const auto&j){return j->published&&j->clean&&!j->draining;}),jobs.end());bool all=active==0;for(auto&j:jobs)all=all&&j->clean;
 if(!all){if(pending&&joinD){cleanup_failed("PRODUCT_RESOURCE8_ORIGINAL_DRAIN_PENDING");auto d=joinD;joinD=nullptr;ok(napi_reject_deferred(env,d,cleanup_error()));}return;}if(joinD){joined=true;auto d=joinD;joinD=nullptr;ok(cleanupFailure?napi_reject_deferred(env,d,cleanup_error()):napi_resolve_deferred(env,d,undef(env)));}
 if(closeD&&joined){if(resource){auto rc=resource->close();if(!resource->closed())return;if(rc)cleanup_failed("PRODUCT_RESOURCE8_CLOSE_FIRST_CAUSE");resource.reset();}root.reset();main={};closed=true;object.weaken();sourceOwner.weaken();producer.clear();captureOriginal.clear();readyP.clear();then.clear();auto d=closeD;closeD=nullptr;ok(cleanupFailure?napi_reject_deferred(env,d,cleanup_error()):napi_resolve_deferred(env,d,undef(env)));}
}
napi_value ProductPayResource8::Impl::request(napi_value descriptor){thread();current();auto j=armed;if(!j||j->consumed)deny("PRODUCT_RESOURCE8_NO_ORIGINAL_CALL_SLOT");if(active>=32||jobs.size()>=64)deny("PRODUCT_RESOURCE8_CAPACITY");j->consumed=true;try{
 auto e=env;j->method=string(e,get(e,descriptor,"method"),16);j->path=string(e,get(e,descriptor,"path"),4096);if(string(e,get(e,descriptor,"origin"),2048)!=profile.origin)deny("PRODUCT_RESOURCE8_ORIGIN_MISMATCH");
 auto ct=get(e,descriptor,"contentType");if(!type(e,ct,napi_undefined))j->mime=string(e,ct,1024);
 auto body=get(e,descriptor,"body");if(!type(e,body,napi_undefined)){bool buffer=false;ok(napi_is_buffer(e,body,&buffer));if(!buffer)deny("PRODUCT_RESOURCE8_BODY_BUFFER");void*p;size_t n;ok(napi_get_buffer_info(e,body,&p,&n));if(n>product_pay_request_max_v1)deny("PRODUCT_RESOURCE8_BODY_BOUND");j->body.assign(static_cast<char*>(p),n);}
 if(!product_pay_request_matches_v1(j->operation,j->method,j->path,j->mime,j->body.size()))deny("PRODUCT_RESOURCE8_ROUTE_DENIED");
 j->current.set(e,get(e,descriptor,"assertCurrent"));j->caller();auto sig=get(e,j->current.value(),"signal");
 if(!type(e,sig,napi_undefined)){j->signal.set(e,sig);bool aborted=false;ok(napi_get_value_bool(e,get(e,sig,"aborted"),&aborted));if(aborted)j->cancel();auto keep=j;auto h=fn(e,"cancelOriginalProductRead",[keep](size_t,napi_value*,napi_value){keep->cancel();return undef(keep->parent->env);});j->abortHandler.set(e,h);napi_value a[]={text(e,"abort"),h};(void)call(e,sig,get(e,sig,"addEventListener"),2,a);j->listening=true;}
 if(ynx_product_pay_source_full_current_v1(j->loan)||Job::fence(j.get()))deny("PRODUCT_RESOURCE8_PREWRITE_CURRENT");
 napi_value promise;ok(napi_create_promise(e,&j->deferred,&promise));active++;jobs.push_back(j);
 auto*box=new std::shared_ptr<Job>(j);try{ok(napi_create_async_work(e,nullptr,text(e,"OriginalProductPayRead"),[](napi_env,void*p){auto j=*static_cast<std::shared_ptr<Job>*>(p);
  try{ynx_product_pay_transport_v1*t=nullptr;j->code=ynx_product_pay_transport_open_v1(j->loan,&t);j->transport.store(t,std::memory_order_release);if(j->cancelled.load()&&t)(void)ynx_product_pay_transport_cancel_v1(t);if(!j->code&&t){ynx_product_pay_request_v1 r{};r.version=1;r.size=sizeof r;r.operation=j->operation;r.method=bytes(j->method);r.path=bytes(j->path);r.content_type=bytes(j->mime);r.body=bytes(j->body);r.fence_context=j.get();r.current_no_io=Job::fence;j->code=ynx_product_pay_transport_request_v1(t,&r,&j->response);if(j->response.response_owner)(void)ynx_product_pay_transport_response_diagnostics_v1(&j->response,&j->diagnostic);}else if(!j->code)j->code=1;}catch(...){j->code=1;}
 },[](napi_env e,napi_status s,void*p){auto*box=static_cast<std::shared_ptr<Job>*>(p);auto j=*box;try{j->finish(s);}catch(...){j->parent->park();}napi_delete_async_work(e,j->work);delete box;},box,&j->work));ok(napi_queue_async_work(e,j->work));}
 catch(...){if(j->work)napi_delete_async_work(e,j->work);delete box;j->code=1;j->finish(napi_generic_failure);}
 return promise;
 }catch(...){if(!j->deferred){j->done=true;j->drain();if(!j->clean)jobs.push_back(j);}throw;}
}
ProductPayResource8::ProductPayResource8(std::shared_ptr<Impl>s):impl_(std::move(s)){}
ProductPayResource8::~ProductPayResource8(){if(impl_&&!impl_->closed){retire_native_only();impl_->park();}}
void ProductPayResource8::capture(napi_env e,const std::shared_ptr<OriginalProductRoot>&root,std::unique_ptr<ProductPayResource8>&out){if(out)deny("PRODUCT_RESOURCE8_OUT_NOT_EMPTY");auto s=std::make_shared<Impl>(e);out=std::unique_ptr<ProductPayResource8>(new ProductPayResource8(s));s->root=root;
 auto r=ProductPayResourceRoot::capture(root);s->resource=std::move(r.owner);if(r.error||!s->resource)deny("PRODUCT_RESOURCE8_ROOT_RESOURCE_NOT_SUPPLIED");
 if(s->resource->copy_profile_DATA(s->profile)||ynx::wallet::pay::borrow_initialized_original_main_namespace(e,s->main))deny("PRODUCT_RESOURCE8_MAIN_NOT_SUPPLIED");s->current();
 napi_value o;ok(napi_create_object(e,&o));s->object.set(e,o);prop(e,o,"protectedResourceRef",text(e,s->profile.resource_ref));prop(e,o,"networkId",text(e,s->profile.network_id));prop(e,o,"origin",text(e,s->profile.origin));
 const char*names[]={"requestPrivate","current","retire","join","close"};for(uint32_t i=0;i<5;++i){prop(e,o,names[i],fn(e,names[i],[s,i](size_t n,napi_value*a,napi_value self){bool same=false;ok(napi_strict_equals(s->env,self,s->object.value(),&same));if(!same)deny("PRODUCT_RESOURCE8_FOREIGN_RECEIVER");
  if(i==0){if(n!=1)deny("PRODUCT_RESOURCE8_ARGUMENTS");return s->request(a[0]);}if(n)deny("PRODUCT_RESOURCE8_ZERO_ARGS");
  if(i==1){s->current();return undef(s->env);}if(i==2){s->retire();return undef(s->env);}
  Ref&held=i==3?s->joinP:s->closeP;napi_deferred&d=i==3?s->joinD:s->closeD;if(held.p)return held.value();
  if(!s->retired.load())deny("PRODUCT_RESOURCE8_RETIRE_REQUIRED");if(i==4&&!s->joined)deny("PRODUCT_RESOURCE8_JOIN_REQUIRED");napi_value p;ok(napi_create_promise(s->env,&d,&p));held.set(s->env,p);s->settle();return p;
 }));}ok(napi_object_freeze(e,o));s->current();}
napi_value ProductPayResource8::resource_DATA(){impl_->current();return impl_->object.value();}
void ProductPayResource8::install_main_inputs(napi_value owner){auto s=impl_;s->current();s->sourceOwner.set(s->env,owner);
 const char*names[]={"captureOriginalProductPayResourceForMain","readOriginalProductScopeDATAForMain"};for(uint32_t i=0;i<2;++i){
  prop(s->env,owner,names[i],fn(s->env,names[i],[s,i](size_t n,napi_value*,napi_value self){bool same=false;ok(napi_strict_equals(s->env,self,s->sourceOwner.value(),&same));if(n||!same)deny("PRODUCT_RESOURCE8_ORIGINAL_OWNER_REQUIRED");s->current();if(i==0)return s->object.value();
   ProductScopeDATA scope;if(read_original_product_scope(s->root,scope))deny("PRODUCT_RESOURCE8_SCOPE_NOT_CURRENT");napi_value o;ok(napi_create_object(s->env,&o));napi_value v;ok(napi_create_uint32(s->env,1,&v));prop(s->env,o,"version",v);prop(s->env,o,"networkId",text(s->env,scope.network_id));prop(s->env,o,"account",text(s->env,scope.account));prop(s->env,o,"protectedResourceRef",text(s->env,scope.protected_resource_ref));
   napi_value ops;ok(napi_create_array_with_length(s->env,scope.operations.size(),&ops));for(size_t n=0;n<scope.operations.size();++n)ok(napi_set_element(s->env,ops,n,text(s->env,scope.operations[n])));ok(napi_object_freeze(s->env,ops));prop(s->env,o,"operations",ops);
   napi_value products;ok(napi_create_array_with_length(s->env,scope.products.size(),&products));for(size_t n=0;n<scope.products.size();++n){napi_value p;ok(napi_create_object(s->env,&p));prop(s->env,p,"productId",text(s->env,scope.products[n].product_id));prop(s->env,p,"sourceOrder",text(s->env,scope.products[n].source_order));ok(napi_object_freeze(s->env,p));ok(napi_set_element(s->env,products,n,p));}ok(napi_object_freeze(s->env,products));prop(s->env,o,"products",products);ok(napi_object_freeze(s->env,o));s->current();return o;
  }));
 }
}
napi_value ProductPayResource8::bind_original_main_reader(MainProductPeer&main){auto s=impl_;s->current();if(s->readyP.p)deny("PRODUCT_RESOURCE8_MAIN_READER_ALREADY_CAPTURED");napi_value ready;ok(napi_create_promise(s->env,&s->readyD,&ready));s->readyP.set(s->env,ready);napi_value proto;ok(napi_get_prototype(s->env,ready,&proto));s->then.set(s->env,get(s->env,proto,"then"));
 auto rejected=[s](napi_value why){if(!s->first){napi_throw(s->env,why);s->remember();}s->captureFinished=true;auto d=s->readyD;s->readyD=nullptr;ok(napi_reject_deferred(s->env,d,why));};
 auto accepted=[s,&main,rejected](napi_value value){try{
  if(!type(s->env,value,napi_object))deny("PRODUCT_RESOURCE8_MAIN_READER_SHAPE");s->producer.set(s->env,value); // actual output first, BEFORE late current
  if(s->retireReaderRequested){(void)call(s->env,value,get(s->env,value,"retire"));deny("PRODUCT_RESOURCE8_CAPTURE_RETIRED");}
  main.current();auto r=call(s->env,value,get(s->env,value,"current"));if(!type(s->env,r,napi_undefined))deny("PRODUCT_RESOURCE8_MAIN_CURRENT_RESULT");s->current();s->captureFinished=true;auto d=s->readyD;s->readyD=nullptr;ok(napi_resolve_deferred(s->env,d,undef(s->env)));
 }catch(...){s->remember("PRODUCT_RESOURCE8_CAPTURE_LATE_FAILURE");rejected(s->cause());}};
 try{auto original=main.pay_preparation_reader();napi_value box;ok(napi_create_object(s->env,&box));prop(s->env,box,"original",original);s->captureOriginal.set(s->env,box); // Promise/partial held first
  bool promise=false;ok(napi_is_promise(s->env,original,&promise));if(promise){napi_value h[]={fn(s->env,"adoptOriginalPayCapture",[s,accepted](size_t n,napi_value*a,napi_value){accepted(n?a[0]:undef(s->env));return undef(s->env);}),fn(s->env,"retainOriginalPayCaptureFailure",[s,rejected](size_t n,napi_value*a,napi_value){rejected(n?a[0]:undef(s->env));return undef(s->env);})};(void)call(s->env,original,s->then.value(),2,h);}else accepted(original);
 }catch(...){s->remember("PRODUCT_RESOURCE8_MAIN_CAPTURE_FAILURE");rejected(s->cause());}
 // Mark the private capture handled, without changing the original rejection.
 napi_value none=undef(s->env),noop=fn(s->env,"holdOriginalCaptureFailure",[s](size_t,napi_value*,napi_value){return undef(s->env);});napi_value handled[]={none,noop};(void)call(s->env,ready,s->then.value(),2,handled);return ready;
}
napi_value ProductPayResource8::invoke_bound_original(uint32_t op,size_t n,napi_value*a,napi_value c){return invoke_original(op,impl_->producer.value(),n,a,c);}
napi_value ProductPayResource8::Impl::after_capture(std::function<napi_value()> action){thread();if(!readyP.p||captureFinished)return action();napi_deferred d;napi_value out;ok(napi_create_promise(env,&d,&out));auto s=shared_from_this();auto run=[s,d,action](size_t,napi_value*,napi_value){try{ok(napi_resolve_deferred(s->env,d,action()));}catch(...){s->remember("PRODUCT_RESOURCE8_CAPTURE_CLEANUP_FAILURE");ok(napi_reject_deferred(s->env,d,s->cause()));}return undef(s->env);};napi_value handlers[]={fn(env,"drainAfterOriginalCapture",run),fn(env,"drainAfterFailedOriginalCapture",run)};(void)call(env,readyP.value(),then.value(),2,handlers);return out;}
napi_value ProductPayResource8::retire_main_reader(){auto s=impl_;s->thread();s->retireReaderRequested=true;s->retire();return s->after_capture([s]{if(!s->producer.p)return undef(s->env);return call(s->env,s->producer.value(),get(s->env,s->producer.value(),"retire"));});}
napi_value ProductPayResource8::join_main_reader(){auto s=impl_;s->thread();return s->after_capture([s,this]{if(!s->producer.p)return join();return call(s->env,s->producer.value(),get(s->env,s->producer.value(),"join"));});}
napi_value ProductPayResource8::close_main_reader(){auto s=impl_;s->thread();return s->after_capture([s,this]{if(!s->producer.p)return close();return call(s->env,s->producer.value(),get(s->env,s->producer.value(),"close"));});}
void ProductPayResource8::current(){impl_->current();}
napi_value ProductPayResource8::invoke_original(uint32_t op,napi_value producer,size_t n,napi_value*a,napi_value original){auto&s=*impl_;s.current();if(s.armed||op>=14||op==10)deny("PRODUCT_RESOURCE8_ORIGINAL_CALL_SLOT_BUSY");auto j=std::make_shared<Impl::Job>(impl_,op);
 int32_t rc=borrow_original_product_pay_source(s.root,s.resource,op,&j->loan);if(rc||!j->loan){j->drain();deny("PRODUCT_RESOURCE8_ORIGINAL_PERMISSION_DENIED");}s.armed=j;
 try{std::vector<napi_value>args(a,a+n);args.push_back(original);auto pay=get(s.env,producer,"pay");auto v=call(s.env,pay,get(s.env,pay,product_pay_routes_v1[op].operation),args.size(),args.data());s.armed.reset();if(!j->consumed){j->done=true;j->drain();deny("PRODUCT_RESOURCE8_ORIGINAL_REQUEST_NOT_CONSUMED");}return v;}
 catch(...){s.armed.reset();if(!j->consumed){j->done=true;j->drain();}else if(!j->deferred){j->done=true;j->drain();}throw;}
}
void ProductPayResource8::retire_native_only()noexcept{if(!impl_)return;impl_->retired.store(true,std::memory_order_release);for(auto&j:impl_->jobs)j->cancel();}
void ProductPayResource8::retire(){impl_->thread();impl_->retire();}
napi_value ProductPayResource8::join(){auto s=impl_;s->thread();if(s->joinP.p)return s->joinP.value();s->retire();napi_value p;ok(napi_create_promise(s->env,&s->joinD,&p));s->joinP.set(s->env,p);s->settle();return p;}
napi_value ProductPayResource8::close(){auto s=impl_;s->thread();if(s->closeP.p)return s->closeP.value();if(!s->joined)deny("PRODUCT_RESOURCE8_JOIN_REQUIRED");napi_value p;ok(napi_create_promise(s->env,&s->closeD,&p));s->closeP.set(s->env,p);s->settle();return p;}
bool ProductPayResource8::physically_closed()const noexcept{return impl_&&impl_->closed;}
bool ProductPayResource8::drain_original(){impl_->thread();impl_->settle();for(auto&j:impl_->jobs)if(!j->clean)return false;return impl_->active==0;}
}
