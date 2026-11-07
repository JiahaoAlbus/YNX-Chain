#ifndef YNX_SOCIAL_JOINT_PUBLIC_CONTROLS
#error "PUBLIC five-borrow bridge exists only in this isolated test binary"
#endif
#include "CaptureLoan.hpp"
#include "social_joint_profile_issuer_private.h"
#include <cassert>
#include <cstring>
#include <iostream>
using namespace ynx::social::joint::original;
namespace {
struct Fixture{SourceInput input;std::string mode;int acquires=0,currents=0,retires=0,joins=0,closes=0;Fixture(){input.resource.fill(0x31);input.same_process_capture_reference=0xfedcba9876543210ULL;for(unsigned i=0;i<4;i++)input.originals[i]={'P','U','B',static_cast<unsigned char>('0'+i)};}};
std::shared_ptr<Fixture>heldCfg;
constexpr std::uint64_t loan=0x1234567890abcdefULL;
void success(ynx_social_joint_status_v1*s,bool physical=false){*s={1,sizeof(*s),0,0,physical?1U:0U,0};}
void zeroFailure(ynx_social_joint_status_v1*s,bool physical=false){*s={1,sizeof(*s),1,0,physical?1U:0U,0};}
void checkedLoan(std::uint64_t n){assert(n==loan);}
void run(const std::string&mode){heldCfg=std::make_shared<Fixture>();auto cfg=heldCfg;cfg->mode=mode;CaptureLoan owner;Result r;owner.acquire(cfg->input,r);assert(cfg->acquires==1&&owner.sameProcessLoan()==loan);
 if(mode=="partial-zero"){assert(r.error_present&&r.first==0&&!r.physical_done);auto current=owner.current();assert(current.error_present&&current.first==0&&cfg->currents==0);}
 else if(mode=="untouched-acquire"){assert(r.error_present&&r.unknown);assert(!owner.current().ok()&&cfg->currents==0);}
 else {assert(r.ok());r=owner.current();if(mode=="untouched-current"||mode=="bad-current-done")assert(!r.ok()&&r.unknown);else if(mode=="current-zero")assert(r.error_present&&r.first==0);else assert(r.ok());assert(cfg->currents==1);}
 auto closed=owner.close();assert(cfg->retires==1);
 if(mode=="retire-failed"){assert(closed.error_present&&closed.first==0&&closed.unknown&&!closed.physical_done&&cfg->joins==0&&cfg->closes==0);auto again=owner.close();assert(!again.physical_done&&cfg->retires==1&&cfg->joins==0&&cfg->closes==0);return;}
 assert(cfg->joins==1);
 if(mode=="join-failed"){assert(closed.error_present&&closed.first==0&&closed.unknown&&!closed.physical_done&&cfg->closes==0);auto again=owner.close();assert(!again.physical_done&&cfg->retires==1&&cfg->joins==1&&cfg->closes==0);return;}
 assert(cfg->closes==1);
 if(mode=="ambiguous-close"||mode=="zero-ref-missing-done"||mode=="untouched-close"||mode=="done-retains-ref"){assert(!closed.physical_done&&closed.unknown);if(mode=="ambiguous-close")assert(closed.error_present&&closed.first==0&&owner.hasDebt());else if(mode!="done-retains-ref")assert(owner.sameProcessLoan()==0);auto again=owner.close();assert(!again.physical_done&&again.unknown&&cfg->closes==1&&cfg->retires==1&&cfg->joins==1);return;}
 assert(closed.physical_done&&!owner.hasDebt());
 if(mode=="done-late-zero"||mode=="partial-zero"||mode=="current-zero")assert(closed.error_present&&closed.first==0);
 else if(mode=="untouched-acquire"||mode=="untouched-current"||mode=="bad-current-done")assert(closed.error_present&&closed.unknown);
 else assert(closed.ok());
 auto again=owner.close();assert(again.physical_done&&cfg->closes==1&&cfg->retires==1&&cfg->joins==1);owner.acquire(cfg->input,r);assert(!r.ok()&&cfg->acquires==1);
}
}
extern "C" {
void ynx_auth_social_joint_capture_borrow_acquire_v1(std::uint64_t ref,ynx_social_joint_source_input_v1*in,std::uint64_t*out,ynx_social_joint_status_v1*st){auto cfg=heldCfg;++cfg->acquires;assert(ref==cfg->input.same_process_capture_reference&&in->version==2&&in->size==112&&in->same_process_capture_reference==ref&&!std::memcmp(in->registered_source_resource,cfg->input.resource.data(),32));ynx_social_joint_bytes_v1 fields[]={in->registration,in->issuer_credential,in->anchor_credential,in->history_envelope};for(unsigned i=0;i<4;i++)assert(fields[i].size==cfg->input.originals[i].size()&&!std::memcmp(fields[i].data,cfg->input.originals[i].data(),fields[i].size));assert(*out==0);*out=loan;if(cfg->mode=="untouched-acquire")return;if(cfg->mode=="partial-zero")zeroFailure(st);else success(st);}
void ynx_auth_social_joint_capture_borrow_current_v1(std::uint64_t n,ynx_social_joint_status_v1*st){checkedLoan(n);auto cfg=heldCfg;++cfg->currents;if(cfg->mode=="untouched-current")return;if(cfg->mode=="current-zero")zeroFailure(st);else success(st,cfg->mode=="bad-current-done");}
void ynx_auth_social_joint_capture_borrow_retire_v1(std::uint64_t n,ynx_social_joint_status_v1*st){checkedLoan(n);auto cfg=heldCfg;++cfg->retires;if(cfg->mode=="retire-failed")zeroFailure(st);else success(st);}
void ynx_auth_social_joint_capture_borrow_join_v1(std::uint64_t n,ynx_social_joint_status_v1*st){checkedLoan(n);auto cfg=heldCfg;++cfg->joins;if(cfg->mode=="join-failed")zeroFailure(st);else success(st);}
void ynx_auth_social_joint_capture_borrow_close_v1(std::uint64_t*n,ynx_social_joint_status_v1*st){checkedLoan(*n);auto cfg=heldCfg;++cfg->closes;if(cfg->mode=="ambiguous-close"){zeroFailure(st);st->unknown=1;return;}if(cfg->mode=="done-retains-ref"){success(st,true);return;}*n=0;if(cfg->mode=="untouched-close")return;if(cfg->mode=="zero-ref-missing-done"){success(st,false);return;}if(cfg->mode=="done-late-zero")zeroFailure(st,true);else success(st,true);}
}
int main(int argc,char**argv){assert(argc==2);run(argv[1]);std::cout<<"PASS "<<argv[1]<<" actual Native CaptureLoan adapter with finite PUBLIC five-C-borrow bridge; no actual Go/math/Source/keys/Root\n";return 0;}
