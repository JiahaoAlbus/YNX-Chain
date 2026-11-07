#define main PreviousCommittedSocialPUBLICMain
#define ynx_social_main_committed_pair_current_v1 NamespaceBaseCurrent
#define ynx_social_main_committed_pair_view_open_v1 NamespaceBaseViewOpen
#include "social-joint-committed-social.PUBLIC.cpp"
#undef ynx_social_main_committed_pair_view_open_v1
#undef ynx_social_main_committed_pair_current_v1
#undef main

extern "C" void ynx_social_main_committed_pair_current_v1(std::uint64_t id,ynx_social_joint_status_v1*s){
 if(heldCfg->mode=="namespace-post0"){identity();assert(id==ownerID);++heldCfg->currents;zero(s);return;}
 NamespaceBaseCurrent(id,s);
}
extern "C" void ynx_social_main_committed_pair_view_open_v1(std::uint64_t id,unsigned char*storage,
 std::size_t capacity,ynx_social_main_pair_view_v1*out,ynx_social_joint_status_v1*s){
 NamespaceBaseViewOpen(id,storage,capacity,out,s);
 if(heldCfg->mode=="namespace-empty")out->account_issuer.size=0;
 if(heldCfg->mode=="namespace-reentrant")denied((*heldCfg->holderSlot)->close());
}
namespace {
struct Foreign final:SocialHolder {
 Result current()noexcept override{assert(false);return {};}
 void view(std::shared_ptr<SocialView>&,Result&)noexcept override{assert(false);}
 Result close()noexcept override{assert(false);return {};}
};
void checkNamespace(const AccountNamespace&n){assert(n.issuer=="PRIVATE-ACCOUNT-ISSUER"&&n.subject=="PRIVATE-ACCOUNT-SUBJECT");}
void namespaceRun(std::string mode){
 heldCfg=std::make_shared<Fixture>();auto cfg=heldCfg;
 cfg->mode=mode;S source(cfg);std::shared_ptr<SocialHolder>holder;cfg->holderSlot=&holder;
 AccountNamespace names{"SENTINEL","SENTINEL"};Result r;
 if(mode=="namespace-foreign"){Foreign foreign;copyOriginalCommittedPairAccountNamespace(foreign,names,r);
  assert(!r.ok()&&!r.physical_done&&names.issuer.empty()&&names.subject.empty()&&cfg->opens==0);return;}
 acquireCommittedSocialPair(source,cfg->f06,holder,r);assert(r.ok()&&holder);
 if(mode=="namespace-actor"){std::thread t([&]{copyOriginalCommittedPairAccountNamespace(*holder,names,r);});t.join();
  assert(r.first==-41304&&!r.physical_done&&names.issuer.empty()&&cfg->viewOpens==0);
  assert(holder->close().physical_done);return;}
 copyOriginalCommittedPairAccountNamespace(*holder,names,r);
 assert(!r.physical_done&&cfg->viewOpens==1);
 if(mode=="namespace-empty"||mode=="private-span-foreign"||mode=="view0-untouched"){
  assert(!r.ok()&&names.issuer.empty()&&names.subject.empty());
 }else checkNamespace(names);
 if(mode=="release-unknown"||mode=="view0-untouched"){
  assert(!r.ok()&&r.unknown);assert(!holder->close().physical_done&&cfg->closes==0);
  const auto releases=cfg->releases;copyOriginalCommittedPairAccountNamespace(*holder,names,r);
  assert(!r.ok()&&!r.physical_done&&names.issuer.empty()&&cfg->viewOpens==1&&cfg->releases==releases);return;
 }
 assert(cfg->releases==1);
 const bool original0=mode=="view-late0"||mode=="release-late0"||mode=="namespace-post0";
 if(original0)assert(raw0(r));
 else if(mode!="namespace-empty"&&mode!="private-span-foreign")assert(r.ok());
 if(mode=="namespace-detached"){
  names.issuer="CHANGED";copyOriginalCommittedPairAccountNamespace(*holder,names,r);assert(r.ok());checkNamespace(names);
  assert(cfg->viewOpens==2&&cfg->releases==2);
 }
 auto closed=holder->close();assert(closed.physical_done&&cfg->closes==1);
 if(original0)assert(raw0(closed));
}
}
int main(int argc,char**argv){assert(argc==2);namespaceRun(argv[1]);std::cout<<"PASS private namespace "<<argv[1]<<"; PUBLIC service seam, no Device grant or signing\n";}
