#include "product_pay_binding_private.hpp"
#include "product_pay_routes_private.hpp"
#include <functional>
#include <stdexcept>
#include <thread>
#include <vector>
#include <mutex>
namespace ynx::wallet::product {
namespace binding_private {
void ok(napi_status s){if(s!=napi_ok)throw std::runtime_error("PRODUCT_PAY_BINDING_NAPI");}
napi_value u(napi_env e){napi_value v;ok(napi_get_undefined(e,&v));return v;}
napi_value get(napi_env e,napi_value o,const char*k){napi_value v;ok(napi_get_named_property(e,o,k,&v));return v;}
struct Hold{napi_env e; napi_ref ref=nullptr;explicit Hold(napi_env env):e(env){}~Hold(){if(ref)napi_delete_reference(e,ref);}void put(napi_value v){ok(napi_create_reference(e,v,1,&ref));}napi_value value(){napi_value v;ok(napi_get_reference_value(e,ref,&v));return v;}};
struct Callback{std::function<napi_value(size_t,napi_value*)>f;};
napi_value function(napi_env e,std::function<napi_value(size_t,napi_value*)>f){auto*c=new Callback{std::move(f)};napi_value v;ok(napi_create_function(e,"originalChildDrain",NAPI_AUTO_LENGTH,[](napi_env e,napi_callback_info info)->napi_value{size_t n=1;napi_value a[1];void*p;ok(napi_get_cb_info(e,info,&n,a,nullptr,&p));try{return static_cast<Callback*>(p)->f(n,a);}catch(const std::exception&x){bool pending=false;napi_is_exception_pending(e,&pending);if(!pending)napi_throw_error(e,nullptr,x.what());return nullptr;}},c,&v));ok(napi_add_finalizer(e,v,c,[](napi_env,void*p,void*){delete static_cast<Callback*>(p);},nullptr,nullptr));return v;}
napi_value call(napi_env e,napi_value self,napi_value fn,size_t n=0,napi_value*a=nullptr){napi_value v;ok(napi_call_function(e,self,fn,n,a,&v));return v;}
}
struct ProductPayBinding::Impl:std::enable_shared_from_this<Impl>{
 napi_env env;std::thread::id actor;MainProductPeer*main=nullptr;std::unique_ptr<ProductPayResource8>child;
 binding_private::Hold cause,then,ready;bool failed=false;bool closed=false;
 explicit Impl(napi_env e):env(e),actor(std::this_thread::get_id()),cause(e),then(e),ready(e){napi_deferred d;napi_value p,proto;binding_private::ok(napi_create_promise(e,&d,&p));binding_private::ok(napi_get_prototype(e,p,&proto));then.put(binding_private::get(e,proto,"then"));binding_private::ok(napi_resolve_deferred(e,d,binding_private::u(e)));}
 void remember(const char*msg){if(failed)return;bool pending=false;binding_private::ok(napi_is_exception_pending(env,&pending));napi_value original;if(pending)binding_private::ok(napi_get_and_clear_last_exception(env,&original));else{napi_value m;binding_private::ok(napi_create_string_utf8(env,msg,NAPI_AUTO_LENGTH,&m));binding_private::ok(napi_create_error(env,nullptr,m,&original));}napi_value box;binding_private::ok(napi_create_object(env,&box));binding_private::ok(napi_set_named_property(env,box,"cause",original));cause.put(box);failed=true;}
 void check(){if(actor!=std::this_thread::get_id())throw std::runtime_error("PRODUCT_PAY_BINDING_ACTOR");}
 void park(){static auto*debt=new std::vector<std::shared_ptr<Impl>>;static auto*mutex=new std::mutex;std::lock_guard<std::mutex>lock(*mutex);debt->push_back(shared_from_this());}
 napi_value sequence(napi_value childResult,std::function<napi_value()>parent){
  using namespace binding_private;bool promise=false;ok(napi_is_promise(env,childResult,&promise));if(!promise)return parent();napi_deferred deferred;napi_value result;ok(napi_create_promise(env,&deferred,&result));auto s=shared_from_this();
  auto reject=[s,deferred](size_t n,napi_value*a){ok(napi_reject_deferred(s->env,deferred,n?a[0]:u(s->env)));return u(s->env);};
  napi_value handlers[]={function(env,[s,deferred,parent](size_t,napi_value*){try{auto value=parent();ok(napi_resolve_deferred(s->env,deferred,value));}catch(...){s->remember("PRODUCT_PAY_PARENT_DRAIN_FAILED");ok(napi_reject_deferred(s->env,deferred,get(s->env,s->cause.value(),"cause")));}return u(s->env);}),function(env,reject)};
  (void)call(env,childResult,then.value(),2,handlers);return result;
 }
};
ProductPayBinding::ProductPayBinding(napi_env e):impl_(std::make_shared<Impl>(e)){}
ProductPayBinding::~ProductPayBinding(){if(impl_&&!impl_->closed){retire_native_only();impl_->park();}}
void ProductPayBinding::initialize(const std::shared_ptr<OriginalProductRoot>&root,napi_value owner,MainProductPeer&main){auto&s=*impl_;s.check();s.main=&main;try{ProductPayResource8::capture(s.env,root,s.child);s.child->install_main_inputs(owner);s.ready.put(s.child->bind_original_main_reader(main));}catch(...){s.remember("PRODUCT_PAY_RESOURCE_OR_MAIN_GETTER_NOT_SUPPLIED");}}
napi_value ProductPayBinding::invoke(const std::string&op,size_t n,napi_value*a,napi_value current){auto s=impl_;s->check();if(s->failed){napi_throw(s->env,binding_private::get(s->env,s->cause.value(),"cause"));throw std::runtime_error("PRODUCT_PAY_CAPTURE_FAILED");}if(!s->child)throw std::runtime_error("PRODUCT_PAY_RESOURCE_NOT_SUPPLIED");uint32_t selected=14;for(uint32_t i=0;i<14;++i)if(op==product_pay_routes_v1[i].operation)selected=i;if(selected==14)throw std::runtime_error("PRODUCT_PAY_OPERATION_NOT_SELECTED");
 auto held=std::make_shared<binding_private::Hold>(s->env);napi_value args;binding_private::ok(napi_create_array_with_length(s->env,n+1,&args));for(size_t i=0;i<n;++i)binding_private::ok(napi_set_element(s->env,args,i,a[i]));binding_private::ok(napi_set_element(s->env,args,n,current));held->put(args);
 auto invoke=[s,held,selected,n]{std::vector<napi_value>a(n+1);auto args=held->value();for(size_t i=0;i<n+1;++i)binding_private::ok(napi_get_element(s->env,args,i,&a[i]));return s->child->invoke_bound_original(selected,n,a.data(),a[n]);};
 return s->ready.ref?s->sequence(s->ready.value(),invoke):invoke();}
void ProductPayBinding::retire_native_only()noexcept{if(impl_&&impl_->child)impl_->child->retire_native_only();}
napi_value ProductPayBinding::retire_then_main(){auto s=impl_;s->check();auto parent=[s]{return s->main?s->main->retire_on_actor():binding_private::u(s->env);};if(!s->child)return parent();try{return s->sequence(s->child->retire_main_reader(),parent);}catch(...){s->remember("PRODUCT_PAY_CHILD_RETIRE_FAILED");(void)parent();napi_throw(s->env,binding_private::get(s->env,s->cause.value(),"cause"));throw;}}
napi_value ProductPayBinding::join_then_main(){auto s=impl_;s->check();auto parent=[s]{return s->main?s->main->join_on_actor():binding_private::u(s->env);};if(!s->child)return parent();return s->sequence(s->child->join_main_reader(),parent);}
napi_value ProductPayBinding::close_then_main(){auto s=impl_;s->check();auto parent=[s]{if(s->child&&!s->child->physically_closed())throw std::runtime_error("PRODUCT_PAY_CHILD_CLOSE_PENDING");auto done=[s]{s->closed=true;return binding_private::u(s->env);};return s->main?s->sequence(s->main->close_on_actor(),done):done();};if(!s->child)return parent();return s->sequence(s->child->close_main_reader(),parent);}
bool ProductPayBinding::resource_physically_closed()const noexcept{return impl_&&(!impl_->child||impl_->child->physically_closed());}
}
