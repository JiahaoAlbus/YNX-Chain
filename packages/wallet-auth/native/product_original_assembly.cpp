#include "product_original_assembly_private.hpp"
#include "product_original_backend_private.hpp"
#include "product_read_custody.hpp"
#include "archive_read_contract.hpp"
#include <array>
#include <thread>
#include <functional>
#include <stdexcept>
#include <cstring>
#include <mutex>
namespace ynx::wallet::product {
namespace {
struct JSFailure:std::exception{};
void ok(napi_status s){if(s!=napi_ok)throw JSFailure{};}
napi_value undef(napi_env e){napi_value v;ok(napi_get_undefined(e,&v));return v;}
napi_value text(napi_env e,const char*s){napi_value v;ok(napi_create_string_utf8(e,s,NAPI_AUTO_LENGTH,&v));return v;}
napi_value err(napi_env e,const char*s){napi_value v;ok(napi_create_error(e,nullptr,text(e,s),&v));ok(napi_set_named_property(e,v,"code",text(e,s)));return v;}
[[noreturn]]void deny(const char*s){throw std::runtime_error(s);}
napi_value get(napi_env e,napi_value o,const char*k){napi_value v;ok(napi_get_named_property(e,o,k,&v));return v;}
void prop(napi_env e,napi_value o,const char*k,napi_value v){napi_property_descriptor d={k,nullptr,nullptr,nullptr,nullptr,v,napi_default,nullptr};ok(napi_define_properties(e,o,1,&d));}
bool same(napi_env e,napi_value a,napi_value b){bool v=false;ok(napi_strict_equals(e,a,b,&v));return v;}
bool type(napi_env e,napi_value v,napi_valuetype t){napi_valuetype x;ok(napi_typeof(e,v,&x));return x==t;}
napi_value call(napi_env e,napi_value self,napi_value fn,size_t n=0,napi_value*a=nullptr){if(!type(e,fn,napi_function))deny("PRODUCT_ORIGINAL_CALLEE_NOT_FUNCTION");napi_value r;ok(napi_call_function(e,self,fn,n,a,&r));return r;}
std::string string(napi_env e,napi_value v,size_t max=512){if(!type(e,v,napi_string))deny("PRODUCT_ORIGINAL_STRING_REQUIRED");size_t n=0;ok(napi_get_value_string_utf8(e,v,nullptr,0,&n));if(!n||n>max)deny("PRODUCT_ORIGINAL_STRING_BOUND");std::string s(n+1,'\0');size_t z=0;ok(napi_get_value_string_utf8(e,v,s.data(),s.size(),&z));if(z!=n||memchr(s.data(),0,n))deny("PRODUCT_ORIGINAL_STRING_INVALID");s.resize(n);return s;}
struct Ref {napi_env e=nullptr;napi_ref ref=nullptr;
 void set(napi_env env,napi_value v){if(ref)deny("PRODUCT_ORIGINAL_REF_ALREADY_HELD");e=env;ok(napi_create_reference(e,v,1,&ref));}
 napi_value value()const{napi_value v;if(!ref)deny("PRODUCT_ORIGINAL_REF_NOT_HELD");ok(napi_get_reference_value(e,ref,&v));return v;}
 void clear(){if(ref){ok(napi_delete_reference(e,ref));ref=nullptr;}}
 ~Ref(){if(ref)napi_delete_reference(e,ref);}
};
// Boxing preserves EVERY falsy original cause; presence is never truthiness.
struct Cause {bool present=false;Ref box;
 void keep(napi_env e,napi_value v){if(present)return;napi_value o;ok(napi_create_object(e,&o));prop(e,o,"value",v);box.set(e,o);present=true;}
 void take(napi_env e,const char*code){bool pending=false;ok(napi_is_exception_pending(e,&pending));napi_value v;if(pending)ok(napi_get_and_clear_last_exception(e,&v));else v=err(e,code);keep(e,v);}
 napi_value value(napi_env e)const{return present?get(e,box.value(),"value"):undef(e);}
};
struct Function {std::function<napi_value(size_t,napi_value*,napi_value)> run;};
napi_value function(napi_env e,const char*name,std::function<napi_value(size_t,napi_value*,napi_value)>f){
 auto*p=new Function{std::move(f)};napi_value fn;
 auto cb=[](napi_env env,napi_callback_info info)->napi_value{size_t n=9;napi_value a[9],self;void*d=nullptr;
  napi_get_cb_info(env,info,&n,a,&self,&d);try{return static_cast<Function*>(d)->run(n,a,self);}
  catch(const std::exception&x){bool pending=false;napi_is_exception_pending(env,&pending);if(!pending)napi_throw(env,err(env,x.what()));return nullptr;}
  catch(...){bool pending=false;napi_is_exception_pending(env,&pending);if(!pending)napi_throw(env,err(env,"PRODUCT_ORIGINAL_NATIVE_FAILURE"));return nullptr;}};
 ok(napi_create_function(e,name,NAPI_AUTO_LENGTH,cb,p,&fn));
 ok(napi_add_finalizer(e,fn,p,[](napi_env,void*x,void*){delete static_cast<Function*>(x);},nullptr,nullptr));return fn;
}
struct Deferred {napi_deferred deferred=nullptr;Ref promise;bool settled=false;
 void create(napi_env e){napi_value p;ok(napi_create_promise(e,&deferred,&p));promise.set(e,p);}
 void settle(napi_env e,bool failure,napi_value v){if(settled)return;settled=true;ok(failure?napi_reject_deferred(e,deferred,v):napi_resolve_deferred(e,deferred,v));}
};
const std::array<const char*,16> names={"createInvoiceIntent","lookupInvoiceIntent","merchantTermsReview","readInvoiceIntent","readInvoice","readInvoiceEvents","reviewSettlement","reviewRefund","reconcileInvoiceIntent","reconcileOperation","readOriginalInvoiceIntent","readInvoiceOriginals","readOriginalArchiveReceipt","readOriginalArchiveReconciliation","readOriginalShopNativeInvoiceRequestDATA","readOriginalCloudBillLocator"};
const std::array<size_t,16> arities={2,2,2,2,3,3,3,5,2,4,2,2,2,2,2,2};
}
struct OriginalReadAssembly::Impl:std::enable_shared_from_this<Impl>{
 napi_env env;std::thread::id actor;std::unique_ptr<assembly_private::Backend>backend;ReadCustody reads;
 ProductScopeDATA scope;Ref owner,pay,then,abortCtor,abortAny;Cause first;
 bool retired=false,ready=false,joined=false,closeSelected=false,closed=false,parked=false;
 Deferred retirement,joining,closing;
 struct Read;std::vector<std::weak_ptr<Read>>operations;
 explicit Impl(napi_env e,std::unique_ptr<assembly_private::Backend>b):env(e),actor(std::this_thread::get_id()),backend(std::move(b)){}
 void thread(){if(actor!=std::this_thread::get_id())deny("PRODUCT_ORIGINAL_ACTOR_REQUIRED");}
 void current(){thread();reads.lifecycle_current();if(!ready)deny("PRODUCT_ORIGINAL_ASSEMBLY_NOT_READY");backend->current();}
 void observe(napi_value v,std::function<void(napi_value)>yes,std::function<void(napi_value)>no){
  if(!v){yes(undef(env));return;}bool promise=false;ok(napi_is_promise(env,v,&promise));if(!promise){yes(v);return;}
  auto s=shared_from_this();napi_value handlers[]={function(env,"originalFulfilled",[s,yes](size_t n,napi_value*a,napi_value){yes(n?a[0]:undef(s->env));return undef(s->env);}),
    function(env,"originalRejected",[s,no](size_t n,napi_value*a,napi_value){no(n?a[0]:undef(s->env));return undef(s->env);})};
  (void)call(env,v,then.value(),2,handlers); // original captured intrinsic, not result.then
 }
 void capture(napi_value self){owner.set(env,self);
  // Native-created Promise gives original realm prototype, no public provider.
  napi_value p; napi_deferred d;ok(napi_create_promise(env,&d,&p));napi_value proto;ok(napi_get_prototype(env,p,&proto));then.set(env,get(env,proto,"then"));
  ok(napi_resolve_deferred(env,d,undef(env)));
  napi_value global;ok(napi_get_global(env,&global));abortCtor.set(env,get(env,global,"AbortController"));napi_value signal=get(env,global,"AbortSignal");
  napi_value pair;ok(napi_create_object(env,&pair));prop(env,pair,"owner",signal);prop(env,pair,"call",get(env,signal,"any"));abortAny.set(env,pair);
  backend->initialize(self);scope=backend->scope();ready=true;current();
 }
 napi_value failure(Read&,const char*);
 napi_value start(size_t,size_t,napi_value*,napi_value);
 void retire();napi_value join();napi_value close();void completeClose();
 void install(napi_value self);
 void park(){if(closed||parked)return;parked=true;static auto*debt=new std::vector<std::shared_ptr<Impl>>;static auto*lock=new std::mutex;std::lock_guard<std::mutex>l(*lock);debt->push_back(shared_from_this());}
};
struct OriginalReadAssembly::Impl::Read:std::enable_shared_from_this<Read>{
 std::shared_ptr<Impl>parent;std::shared_ptr<ReadCustody::Read>custody;std::shared_ptr<assembly_private::Permit>permit;
 Ref caller,controller,result,guard;Cause cause;Deferred output;bool invoked=false,finished=false;
 Read(std::shared_ptr<Impl>p):parent(std::move(p)),custody(parent->reads.begin()){}
 void current(){custody->current();parent->current();if(!permit)deny("PRODUCT_ORIGINAL_PERMISSION_MISSING");permit->current();
  auto r=call(parent->env,undef(parent->env),caller.value());if(!type(parent->env,r,napi_undefined))deny("PRODUCT_ORIGINAL_CALLER_CURRENT_RESULT");custody->current();permit->current();}
 void finish(bool failed,napi_value value){if(finished)return;finished=true;
  // Release exact per-read Source permit BEFORE announcing child drain.
  permit.reset();custody->finish();guard.clear();caller.clear();controller.clear();output.settle(parent->env,failed,value);
 }
 void reject(const char*code){cause.take(parent->env,code);finish(true,parent->failure(*this,code));}
 void abort(){if(finished||!controller.ref)return;try{auto c=controller.value();(void)call(parent->env,c,get(parent->env,c,"abort"));}catch(...){cause.take(parent->env,"PRODUCT_ORIGINAL_ABORT_FAILURE");}}
};
napi_value OriginalReadAssembly::Impl::failure(Read&r,const char*code){
 auto v=err(env,code);prop(env,v,"cause",r.cause.value(env));napi_value yes;ok(napi_get_boolean(env,true,&yes));prop(env,v,"errorPresent",yes);
 napi_value possible;ok(napi_get_boolean(env,r.invoked,&possible));prop(env,v,"dispatchPossible",possible);
 prop(env,v,"state",text(env,r.invoked?"UNKNOWN":"NOT_DISPATCHED"));prop(env,v,"partial",owner.value());
 // The actual result, if any, stays privately owned, not exposed after revoke.
 return v;
}
napi_value OriginalReadAssembly::Impl::start(size_t op,size_t argc,napi_value*args,napi_value receiver){
 thread();current();if(op>=names.size()||argc!=arities[op])deny("PRODUCT_ORIGINAL_ARGUMENTS");
 auto expected=op>=10?owner.value():pay.value();if(!same(env,receiver,expected)&&!(op==11&&same(env,receiver,pay.value()))&&!(op>=12&&op<=13&&same(env,receiver,pay.value())))deny("PRODUCT_ORIGINAL_FOREIGN_RECEIVER");
 current();const std::string requested=op>=14?"readOriginalInvoiceIntent":names[op];
 if(!archive_data::declared_operation_DATA(scope.operations,requested))deny("PRODUCT_ORIGINAL_OPERATION_NOT_SELECTED");
 operations.erase(std::remove_if(operations.begin(),operations.end(),[](const auto&w){return w.expired();}),operations.end());
 if(reads.active()>=32)deny("PRODUCT_ORIGINAL_ACTIVE_LIMIT");
 auto r=std::make_shared<Read>(shared_from_this());r->output.create(env);operations.push_back(r);
 try{
  if(!type(env,args[argc-1],napi_function))deny("PRODUCT_ORIGINAL_CURRENT_FUNCTION_REQUIRED");r->caller.set(env,args[argc-1]);
  ProductReference reference;const ProductReference*selected=nullptr;napi_value safeRef=nullptr;
  if(op==10||op>=12){
   if(op==14){reference={"shop.order",string(env,args[0],128)};}
   else {napi_value keys;ok(napi_get_all_property_names(env,args[0],napi_key_own_only,napi_key_all_properties,napi_key_numbers_to_strings,&keys));uint32_t count=0;ok(napi_get_array_length(env,keys,&count));
    const uint32_t required=op==12?5u:op==13?4u:2u;if(count!=required)deny("PRODUCT_ORIGINAL_REFERENCE_KEYS");
    reference={string(env,get(env,args[0],"productId"),128),string(env,get(env,args[0],"sourceOrder"),128)};
   }
   if((reference.product_id!="shop.order"&&reference.product_id!="cloud.ide-usage")||!archive_data::identifier(reference.source_order)||
      std::find(scope.products.begin(),scope.products.end(),reference)==scope.products.end())deny("PRODUCT_ORIGINAL_REFERENCE_NOT_SELECTED");
   if(op==15&&reference.product_id!="cloud.ide-usage")deny("PRODUCT_ORIGINAL_CLOUD_REFERENCE");
   selected=&reference;
   // Frozen own reference copy. Actual original payloads are not reconstructed.
   ok(napi_create_object(env,&safeRef));prop(env,safeRef,"productId",text(env,reference.product_id.c_str()));prop(env,safeRef,"sourceOrder",text(env,reference.source_order.c_str()));
   if(op==12||op==13){archive_data::Ref a{reference.product_id,reference.source_order,string(env,get(env,args[0],"merchant"),42),string(env,get(env,args[0],"invoiceId"),128),{}};
    if(op==12)a.native_hash=string(env,get(env,args[0],"nativeHash"),66);
    if(!archive_data::valid_ref(names[op],a))deny("PRODUCT_ORIGINAL_ARCHIVE_REFERENCE");
    prop(env,safeRef,"merchant",text(env,a.merchant.c_str()));prop(env,safeRef,"invoiceId",text(env,a.invoice_id.c_str()));if(a.native_hash)prop(env,safeRef,"nativeHash",text(env,a.native_hash->c_str()));
   }ok(napi_object_freeze(env,safeRef));
  }
  r->permit=backend->borrow(requested,selected); // actual normal Root permit
  napi_value ctrl;ok(napi_new_instance(env,abortCtor.value(),0,nullptr,&ctrl));r->controller.set(env,ctrl);
  auto keep=r;napi_value guardFn=function(env,"originalProductReadCurrent",[keep](size_t n,napi_value*,napi_value){if(n)deny("PRODUCT_ORIGINAL_CURRENT_ZERO_ARGS");keep->current();return undef(keep->parent->env);});
  napi_value signals;ok(napi_create_array(env,&signals));ok(napi_set_element(env,signals,0,get(env,ctrl,"signal")));
  napi_value signal=get(env,args[argc-1],"signal");if(!type(env,signal,napi_undefined))ok(napi_set_element(env,signals,1,signal));
  auto any=abortAny.value();napi_value merged=call(env,get(env,any,"owner"),get(env,any,"call"),1,&signals);prop(env,guardFn,"signal",merged);ok(napi_object_freeze(env,guardFn));r->guard.set(env,guardFn);
  r->current();std::array<napi_value,9>passed{};for(size_t i=0;i<argc-1;i++)passed[i]=args[i];if(safeRef)passed[0]=safeRef;
  // The real resource getter owns response encoding/proof/receipt semantics.
  r->invoked=true;napi_value actual=backend->invoke(names[op],argc-1,passed.data(),guardFn,selected);
  observe(actual,[r](napi_value value){try{
   // Adopt exact actual return BEFORE any late Source/current/caller checks.
   napi_value box;ok(napi_create_object(r->parent->env,&box));prop(r->parent->env,box,"value",value);r->result.set(r->parent->env,box);
   r->current();r->finish(false,value);
  }catch(...){r->reject("PRODUCT_ORIGINAL_RETURN_BLOCKED");}},[r](napi_value why){r->cause.keep(r->parent->env,why);r->reject("PRODUCT_ORIGINAL_RESOURCE_FAILURE");});
 }catch(...){r->reject("PRODUCT_ORIGINAL_READ_FAILED");}
 return r->output.promise.value();
}
void OriginalReadAssembly::Impl::retire(){thread();if(retired)return;retired=true;reads.retire();retirement.create(env);
 for(auto&w:operations)if(auto r=w.lock())r->abort();
 auto s=shared_from_this();try{observe(backend->retire(),[s](napi_value){s->retirement.settle(s->env,false,undef(s->env));},[s](napi_value why){s->first.keep(s->env,why);s->retirement.settle(s->env,false,undef(s->env));});}
 catch(...){first.take(env,"PRODUCT_ORIGINAL_RETIRE_FAILED");retirement.settle(env,false,undef(env));}
}
namespace {struct JoinJob{std::function<void()>work;std::function<void(napi_status)>done;napi_async_work handle=nullptr;std::exception_ptr error;};}
napi_value OriginalReadAssembly::Impl::join(){thread();if(joining.promise.ref)return joining.promise.value();retire();joining.create(env);auto s=shared_from_this();
 observe(retirement.promise.value(),[s](napi_value){auto*w=new JoinJob;try{
  w->work=[s]{s->reads.join();};w->done=[s](napi_status status){
   if(status!=napi_ok){s->first.keep(s->env,err(s->env,"PRODUCT_ORIGINAL_JOIN_UNCONFIRMED"));s->joining.settle(s->env,true,s->first.value(s->env));return;}
   try{s->observe(s->backend->join(),[s](napi_value){s->joined=true;s->joining.settle(s->env,s->first.present,s->first.value(s->env));},[s](napi_value why){s->first.keep(s->env,why);s->joining.settle(s->env,true,s->first.value(s->env));});}
   catch(...){s->first.take(s->env,"PRODUCT_ORIGINAL_PARENT_JOIN_FAILED");s->joining.settle(s->env,true,s->first.value(s->env));}};
  ok(napi_create_async_work(s->env,nullptr,text(s->env,"OriginalProductReadDrain"),[](napi_env,void*p){auto*j=static_cast<JoinJob*>(p);try{j->work();}catch(...){j->error=std::current_exception();}},[](napi_env e,napi_status code,void*p){auto*j=static_cast<JoinJob*>(p);try{j->done(j->error?napi_generic_failure:code);}catch(...){/* owning done callback already records failure */}napi_delete_async_work(e,j->handle);delete j;},w,&w->handle));ok(napi_queue_async_work(s->env,w->handle));
  }catch(...){if(w->handle)napi_delete_async_work(s->env,w->handle);delete w;s->first.take(s->env,"PRODUCT_ORIGINAL_JOIN_SCHEDULING_FAILED");s->joining.settle(s->env,true,s->first.value(s->env));}
 },[s](napi_value why){s->first.keep(s->env,why);s->joining.settle(s->env,true,s->first.value(s->env));});return joining.promise.value();}
void OriginalReadAssembly::Impl::completeClose(){if(!joined){closing.settle(env,true,first.present?first.value(env):err(env,"PRODUCT_ORIGINAL_DRAIN_UNCONFIRMED"));return;}
 if(closeSelected)return;closeSelected=true;reads.select_close();auto s=shared_from_this();
 try{observe(backend->close(),[s](napi_value){try{auto r=s->backend->finish_root_close();if(r.error)s->first.keep(s->env,err(s->env,r.error));s->closed=r.completed;
   s->reads.settle_close({},s->first.present);s->closing.settle(s->env,s->first.present||!s->closed,s->first.present?s->first.value(s->env):s->closed?undef(s->env):err(s->env,"PRODUCT_ORIGINAL_ROOT_CLOSE_PENDING"));
   if(s->closed){s->owner.clear();s->pay.clear();}
  }catch(...){s->first.take(s->env,"PRODUCT_ORIGINAL_ROOT_CLOSE_FAILED");s->reads.settle_close({},true);s->closing.settle(s->env,true,s->first.value(s->env));}},[s](napi_value why){s->first.keep(s->env,why);s->reads.settle_close({},true);s->closing.settle(s->env,true,s->first.value(s->env));});}
 catch(...){first.take(env,"PRODUCT_ORIGINAL_PARENT_CLOSE_FAILED");reads.settle_close({},true);closing.settle(env,true,first.value(env));}
}
napi_value OriginalReadAssembly::Impl::close(){thread();if(closing.promise.ref)return closing.promise.value();closing.create(env);auto s=shared_from_this();
 observe(join(),[s](napi_value){s->completeClose();},[s](napi_value why){s->first.keep(s->env,why);s->completeClose();});return closing.promise.value();}
void OriginalReadAssembly::Impl::install(napi_value self){thread();if(!same(env,self,owner.value()))deny("PRODUCT_ORIGINAL_OWNER_MISMATCH");napi_value p;ok(napi_create_object(env,&p));pay.set(env,p);auto s=shared_from_this();
 for(size_t i=0;i<names.size();i++){napi_value fn=function(env,names[i],[s,i](size_t n,napi_value*a,napi_value receiver){return s->start(i,n,a,receiver);});
  if(i<10||i==11||i==12||i==13)prop(env,p,names[i],fn);
  if(i>=10)prop(env,self,names[i],fn);
 }ok(napi_object_freeze(env,p));prop(env,self,"pay",p);
}
OriginalReadAssembly::OriginalReadAssembly(std::shared_ptr<Impl>s):impl_(std::move(s)){}
OriginalReadAssembly::~OriginalReadAssembly(){if(impl_&&!impl_->closed){retire_native_only();impl_->park();}}
struct ProductAssemblyAccess{
 static void adopt(napi_env e,napi_value self,std::unique_ptr<assembly_private::Backend>b,std::unique_ptr<OriginalReadAssembly>&out){
  if(out)deny("PRODUCT_ORIGINAL_OUT_NOT_EMPTY");auto s=std::make_shared<OriginalReadAssembly::Impl>(e,std::move(b));out=std::unique_ptr<OriginalReadAssembly>(new OriginalReadAssembly(s));
  try{s->capture(self);}catch(...){s->first.take(e,"PRODUCT_ORIGINAL_CAPTURE_FAILED");s->retire();throw;}
 }
};
void OriginalReadAssembly::capture(napi_env e,napi_value self,const std::shared_ptr<OriginalProductRoot>&r,std::unique_ptr<OriginalReadAssembly>&out){ProductAssemblyAccess::adopt(e,self,assembly_private::make_normal_backend(e,r),out);}
void OriginalReadAssembly::current(){impl_->current();}
void OriginalReadAssembly::install(napi_value self){impl_->install(self);}
void OriginalReadAssembly::retire(){impl_->retire();}
void OriginalReadAssembly::retire_native_only()noexcept{if(impl_){impl_->retired=true;impl_->reads.retire();impl_->backend->retire_native_only();}}
napi_value OriginalReadAssembly::join(){return impl_->join();}
napi_value OriginalReadAssembly::close(){return impl_->close();}
void OriginalReadAssembly::assert_safe_to_close(){impl_->thread();if(!impl_->closed||impl_->reads.active())deny("PRODUCT_ORIGINAL_CLOSE_UNCONFIRMED");}
bool OriginalReadAssembly::has_first_error()const{return impl_->first.present;}
napi_value OriginalReadAssembly::first_error()const{return impl_->first.value(impl_->env);}
#ifdef YNX_PRODUCT_ASSEMBLY_PUBLIC_TEST_ONLY
void PUBLIC_adopt_product_assembly(napi_env e,napi_value self,std::unique_ptr<assembly_private::Backend>b,std::unique_ptr<OriginalReadAssembly>&out){ProductAssemblyAccess::adopt(e,self,std::move(b),out);}
#endif
}
