// PUBLIC fixed Root/approval/Core boundaries, actual new production Source TU.
// No Root-positive authorization, real OS path, key, signing or registration.
#define main retained_producer_control_main
#include "RetainedProducerControls.cpp"
#undef main
#include "PendingJournalConstraints.hpp"
namespace {
enum class JournalHook{None,Revoke,Close,Malformed,FirstZero,Expire};
JournalHook journalHook=JournalHook::None;
int journalCalls=0;ynx_original_android_pending_root_v1*expectedRoot=nullptr;
}
extern "C" void ynx_original_android_pending_root_copy_journal_constraints_v1(ynx_original_android_pending_root_v1*p,ynx_auth_android_pending_journal_constraints_v1*out,F*f){
 ++journalCalls;assert(p&&!p->retired);if(expectedRoot)assert(p==expectedRoot);expectedRoot=p;
 *f={};*out={};out->version=1;out->size=sizeof(*out);out->parent={19,201,10001,10001,0700,0};out->directory={19,202,10001,10001,0700,0};std::memcpy(out->leaf,"ynx-product-device-v4",sizeof("ynx-product-device-v4"));
 if(journalHook==JournalHook::Revoke)rootRevoked=true;
 if(journalHook==JournalHook::Close){D d{};ynx_auth_android_pending_source_close_v1(activeSource,&d);assert(!d.physical_done&&!d.unknown);}
 if(journalHook==JournalHook::Malformed)out->directory.inode=out->parent.inode;
 if(journalHook==JournalHook::FirstZero)*f={1,0,91,0};
 if(journalHook==JournalHook::Expire)end=now()-1;
}
int main(){
 using namespace ynx::auth::android_capture;
 Resource row{};row.kind=4;row.application_uid=10001;row.application_gid=10001;
 ynx_auth_android_pending_journal_constraints_v1 value{};
 assert(copy_pending_journal_constraints(row,value)==1&&value.version==0);
 PendingJournalSelection selection{{19,201,10001,10001,0700},{19,202,10001,10001,0700}};row.pending_journal=&selection;
 assert(!copy_pending_journal_constraints(row,value)&&value.parent.inode==201&&value.directory.inode==202&&!std::strcmp(value.leaf,"ynx-product-device-v4"));
 group("reviewed-selection-only-no-observed-fd");
 for(int n=0;n<6;++n){auto bad=selection;if(n==0)bad.parent.device=0;if(n==1)bad.directory.inode=0;if(n==2)bad.parent.uid=0;if(n==3)bad.directory.gid=0;if(n==4)bad.directory.mode=0755;if(n==5)bad.directory.inode=bad.parent.inode;row.pending_journal=&bad;assert(copy_pending_journal_constraints(row,value)==2&&!value.version);}row.pending_journal=&selection;row.kind=1;assert(copy_pending_journal_constraints(row,value)==1&&!value.version);group("missing-wrong-purpose-uid-gid-mode-alias-reject");
 reset();open();journalCalls=0;expectedRoot=nullptr;journalHook=JournalHook::None;F f{};
 ynx_auth_android_pending_source_copy_journal_constraints_v1(activeSource,&value,&f);assert(!f.present&&value.directory.inode==202&&journalCalls==1&&rootOpens==1);ynx_auth_android_pending_source_copy_journal_constraints_v1(activeSource,&value,&f);assert(!f.present&&journalCalls==2&&rootOpens==1&&coreCalls==0);sourceClose();group("same-source-root-not-reopened-no-core");
 reset();open();expectedRoot=nullptr;journalHook=JournalHook::Revoke;
 ynx_auth_android_pending_source_copy_journal_constraints_v1(activeSource,&value,&f);assert(f.present&&f.code==0&&!value.version);sourceClose();group("post-current-revoke-no-output");
 reset();open();expectedRoot=nullptr;journalHook=JournalHook::Close;
 ynx_auth_android_pending_source_copy_journal_constraints_v1(activeSource,&value,&f);assert(f.present&&!value.version);sourceClose();group("reentrant-close-keeps-active-loan-no-output");
 reset();open();expectedRoot=nullptr;journalHook=JournalHook::Malformed;
 ynx_auth_android_pending_source_copy_journal_constraints_v1(activeSource,&value,&f);assert(f.present&&!value.version);sourceClose();group("malformed-root-copy-no-output");
 reset();open();expectedRoot=nullptr;journalHook=JournalHook::Expire;
 ynx_auth_android_pending_source_copy_journal_constraints_v1(activeSource,&value,&f);assert(f.present&&!value.version);sourceClose();group("post-copy-expiry-no-output");
 reset();open();expectedRoot=nullptr;journalHook=JournalHook::FirstZero;
 ynx_auth_android_pending_source_copy_journal_constraints_v1(activeSource,&value,&f);assert(f.present&&f.code==0&&f.origin==91&&!value.version);journalHook=JournalHook::None;int prior=journalCalls;ynx_auth_android_pending_source_copy_journal_constraints_v1(activeSource,&value,&f);assert(f.present&&f.code==0&&f.origin==91&&journalCalls==prior&&!value.version);sourceClose();group("first-present-zero-sticky-no-second-root-call");
 journalCalls=0;value.version=77;ynx_auth_android_pending_source_copy_journal_constraints_v1(nullptr,&value,&f);assert(f.present&&!value.version&&!journalCalls);group("foreign-null-source-reject-before-root");
}
