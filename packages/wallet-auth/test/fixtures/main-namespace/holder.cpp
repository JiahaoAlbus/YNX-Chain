// PUBLIC NAPI/Root double: lifecycle/identity arguments only, no qualification.
#include "../../../native/original-wallet-main-namespace-private.h"
#include <cassert>
#include <thread>
#include <cstdio>
static int nsData,fun[4],boxData,causeData;static bool pending=false;static void* saved=nullptr;static int refs=0,reads=0;
extern "C" napi_status napi_is_exception_pending(napi_env,bool*p){*p=pending;return napi_ok;}
extern "C" napi_status napi_get_and_clear_last_exception(napi_env,napi_value*p){*p=&causeData;pending=false;return napi_ok;}
extern "C" napi_status napi_create_object(napi_env,napi_value*p){*p=&boxData;return napi_ok;}
extern "C" napi_status napi_set_named_property(napi_env,napi_value,const char*,napi_value v){saved=v;return napi_ok;}
extern "C" napi_status napi_create_reference(napi_env,napi_value v,unsigned,napi_ref*p){*p=v;refs++;return napi_ok;}
extern "C" napi_status napi_get_reference_value(napi_env,napi_ref r,napi_value*p){*p=r;return napi_ok;}
extern "C" napi_status napi_delete_reference(napi_env,napi_ref){refs--;return napi_ok;}
extern "C" napi_status napi_typeof(napi_env,napi_value,napi_valuetype*p){*p=napi_function;return napi_ok;}
extern "C" napi_status napi_get_named_property(napi_env,napi_value v,const char*n,napi_value*p){if(v==&boxData){*p=saved;return napi_ok;}reads++;if(n[0]=='c'&&n[1]=='a')*p=&fun[0];else if(n[0]=='i')*p=&fun[1];else if(n[0]=='a')*p=&fun[2];else *p=&fun[3];return napi_ok;}
static ynx_wallet_main_namespace_owner_v1** slot=nullptr;
struct Root{bool reject=false,drain=true,throwJS=false,reenter=false,reenterCleanup=false,throwRetire=false,throwJoin=false,throwClose=false;int current=0,retired=0,joined=0,closed=0;};
static int32_t current(void*c,napi_env,napi_value ns,const napi_value f[4]){auto&r=*(Root*)c;r.current++;if(r.reenter){r.reenter=false;assert(slot&&*slot);ynx_wallet_main_namespace_retire_v1(*slot);ynx_wallet_main_namespace_join_v1(*slot,(napi_env)&causeData);ynx_wallet_main_namespace_close_v1(*slot,(napi_env)&causeData);assert(ynx_wallet_main_namespace_dispose_v1(*slot)==-1);}assert(ns==&nsData);if(f[0])for(int i=0;i<4;i++)assert(f[i]==&fun[i]);if(r.throwJS)pending=true;return r.reject?-1:0;}
static void reentry(Root&r){if(r.reenterCleanup){assert(slot&&*slot);auto e=(napi_env)&causeData;assert(ynx_wallet_main_namespace_join_v1(*slot,e)==-1);assert(ynx_wallet_main_namespace_close_v1(*slot,e)==-1);assert(ynx_wallet_main_namespace_dispose_v1(*slot)==-1);}}
static void retire(void*c){auto&r=*(Root*)c;r.retired++;reentry(r);if(r.throwRetire){pending=true;r.throwRetire=false;}}
static int32_t join(void*c){auto&r=*(Root*)c;r.joined++;reentry(r);if(r.throwJoin){pending=true;r.throwJoin=false;}return r.drain?0:-1;}
static int32_t close(void*c){auto&r=*(Root*)c;r.closed++;reentry(r);if(r.throwClose){pending=true;r.throwClose=false;}return 0;}
static void cleanup(ynx_wallet_main_namespace_owner_v1*p,napi_env e){assert(ynx_wallet_main_namespace_join_v1(p,e)==0);assert(ynx_wallet_main_namespace_close_v1(p,e)==0);assert(ynx_wallet_main_namespace_close_v1(p,e)==0);assert(ynx_wallet_main_namespace_dispose_v1(p)==0);assert(refs==0);}
int main(){napi_env e=&causeData;Root r;ynx_wallet_main_namespace_root_loan_v1 root{1,&r,current,retire,join,close};ynx_wallet_main_namespace_owner_v1*p=nullptr;
 assert(ynx_wallet_main_namespace_hold_v1(e,&nsData,nullptr,&p)==-1&&p==nullptr);
 assert(ynx_wallet_main_namespace_hold_v1(e,&nsData,&root,&p)==0&&p);auto same=p;assert(ynx_wallet_main_namespace_hold_v1(e,&nsData,&root,&p)==-1&&p==same);napi_value ns,f[4];assert(ynx_wallet_main_namespace_borrow_v1(p,e,&ns,f)==0&&ns==&nsData);assert(r.current==4);int wrong=0;std::thread t([&]{wrong=ynx_wallet_main_namespace_borrow_v1(p,e,&ns,f);});t.join();assert(wrong==-1);assert(ynx_wallet_main_namespace_close_v1(p,e)==-1);r.drain=false;assert(ynx_wallet_main_namespace_join_v1(p,e)==-1);assert(ynx_wallet_main_namespace_dispose_v1(p)==-1);r.drain=true;cleanup(p,e);assert(r.retired==1&&r.closed==1);
 p=nullptr;r=Root{};r.reject=true;reads=0;assert(ynx_wallet_main_namespace_hold_v1(e,&nsData,&root,&p)==-1&&p);assert(reads==0);assert(ynx_wallet_main_namespace_borrow_v1(p,e,&ns,f)==-1);cleanup(p,e);
 p=nullptr;r=Root{};r.throwJS=true;reads=0;assert(ynx_wallet_main_namespace_hold_v1(e,&nsData,&root,&p)==-1&&p);assert(reads==0&&!pending);napi_value failure;assert(ynx_wallet_main_namespace_failure_v1(p,e,&failure)==0&&failure==&causeData);cleanup(p,e);
 p=nullptr;r=Root{};assert(ynx_wallet_main_namespace_hold_v1(e,&nsData,&root,&p)==0);r.reject=true;assert(ynx_wallet_main_namespace_recheck_v1(p,e)==-1);r.reject=false;assert(ynx_wallet_main_namespace_borrow_v1(p,e,&ns,f)==-1);cleanup(p,e);p=nullptr;r=Root{};r.reenter=true;slot=&p;assert(ynx_wallet_main_namespace_hold_v1(e,&nsData,&root,&p)==-1&&p);cleanup(p,e);for(int mode=0;mode<3;mode++){p=nullptr;r=Root{};slot=&p;assert(ynx_wallet_main_namespace_hold_v1(e,&nsData,&root,&p)==0);r.reenterCleanup=true;if(mode==0)r.throwRetire=true;if(mode==1)r.throwJoin=true;if(mode<2){assert(ynx_wallet_main_namespace_join_v1(p,e)==-1);assert(!pending);napi_value cause;assert(ynx_wallet_main_namespace_failure_v1(p,e,&cause)==0&&cause==&causeData);cleanup(p,e);}else{assert(ynx_wallet_main_namespace_join_v1(p,e)==0);r.throwClose=true;assert(ynx_wallet_main_namespace_close_v1(p,e)==-1);assert(!pending);napi_value cause;assert(ynx_wallet_main_namespace_failure_v1(p,e,&cause)==0&&cause==&causeData);cleanup(p,e);}assert(r.closed==1);}
 p=nullptr;r=Root{};{auto mutableTable=root;assert(ynx_wallet_main_namespace_hold_v1(e,&nsData,&mutableTable,&p)==0);mutableTable.assert_current=[](void*,napi_env,napi_value,const napi_value[4])->int32_t{return -1;};assert(ynx_wallet_main_namespace_recheck_v1(p,e)==0);}assert(ynx_wallet_main_namespace_recheck_v1(p,e)==0);cleanup(p,e);
 puts("native-holder PUBLIC lifecycle/reentry/pending/table-copy 9 scenarios PASS; actual qualification false");}
