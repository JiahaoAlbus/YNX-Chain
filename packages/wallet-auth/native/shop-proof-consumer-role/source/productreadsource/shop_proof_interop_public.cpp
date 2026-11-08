//go:build shop_proof_interop_public && cgo && (darwin || linux)

#ifndef YNX_SHOP_PROOF_INTEROP_PUBLIC
#error PUBLIC fixture only
#endif
// Actual Auth protected ProofLoan body. Only Main8 ports below are PUBLIC,
// synthetic opaque transport DATA, NOT actual Main/SDK/session/Root producers.
#include "../ShopProofLoan.cpp"
#include "shop_proof_interop_public.h"
#include <atomic>
#include <cassert>
#include <cstring>
using S=ynx_auth_shop_status_v1;
using ynx::auth::shop::ProofLoan;
struct ynx_wallet_shop_session_v1{int PUBLIC;};
struct ynx_wallet_shop_invoice_introspection_proof_v1{int PUBLIC;};
namespace{
ynx_wallet_shop_session_v1 session{1};ynx_wallet_shop_invoice_introspection_proof_v1 proof{2};
std::shared_ptr<ProofLoan>loan;ynx_auth_shop_original_client_v1*source=nullptr;
std::string header;std::atomic<bool>revoked{false};uint32_t joins=0,closes=0,drops=0;
int64_t issued=0,expires=0;
bool success(S s){return !s.error_present&&!s.unknown&&!s.first_code;}
S rejected(){return{1,0,0,0};}S done(){return{0,0,0,1};}
}
extern "C" {
ynx_wallet_shop_invoice_introspection_proof_acquisition_v1 ynx_wallet_shop_invoice_introspection_proof_acquire_v1(void*,ynx_wallet_shop_session_v1*s,ynx_auth_shop_original_client_v1*p,ynx_auth_shop_span_v1){assert(s==&session&&p==source);return{&proof,{}};}
S ynx_wallet_shop_invoice_introspection_proof_current_actor_v1(void*,ynx_wallet_shop_invoice_introspection_proof_v1*p,ynx_wallet_shop_session_v1*s,ynx_auth_shop_original_client_v1*c){assert(p==&proof&&s==&session&&c==source);return revoked.load()?rejected():S{};}
S ynx_wallet_shop_invoice_introspection_proof_current_local_v1(ynx_wallet_shop_invoice_introspection_proof_v1*p,ynx_wallet_shop_session_v1*s,ynx_auth_shop_original_client_v1*c){assert(p==&proof&&s==&session&&c==source);return revoked.load()?rejected():S{};}
S ynx_wallet_shop_invoice_introspection_proof_copy_v1(void*,ynx_wallet_shop_invoice_introspection_proof_v1*,ynx_wallet_shop_session_v1*,ynx_auth_shop_original_client_v1*,uint8_t*b,size_t n,ynx_wallet_shop_invoice_introspection_proof_data_v1*out){assert(header.size()<=n);std::memcpy(b,header.data(),header.size());*out={1,sizeof(*out),{b,header.size()},issued,expires};return{};}
S ynx_wallet_shop_invoice_introspection_proof_retire_v1(ynx_wallet_shop_invoice_introspection_proof_v1*){return{};}
S ynx_wallet_shop_invoice_introspection_proof_join_v1(ynx_wallet_shop_invoice_introspection_proof_v1*){++joins;return done();}
S ynx_wallet_shop_invoice_introspection_proof_close_v1(ynx_wallet_shop_invoice_introspection_proof_v1*){++closes;return done();}
S ynx_wallet_shop_invoice_introspection_proof_release_closed_v1(ynx_wallet_shop_invoice_introspection_proof_v1*){++drops;return done();}
S public_shop_proof_read(ynx_auth_shop_original_client_v1*s,uint8_t*id,size_t n,const uint8_t*h,size_t hn,ynx_auth_shop_original_response_v1**out){
 assert(!loan||loan->done());source=s;header.assign(reinterpret_cast<const char*>(h),hn);revoked.store(false);joins=closes=drops=0;
 issued=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count()-1000;expires=issued+6000;
 S status{};loan=ProofLoan::capture(nullptr,&session,s,std::string(reinterpret_cast<char*>(id),n),status);
 if(!success(status))return status;
 auto*borrow=loan->beginBorrow(s,status);if(!borrow)return status;
 if(header=="PUBLIC_FIRST0")revoked.store(true);
 if(header=="PUBLIC_FOREIGN_BORROW")borrow=reinterpret_cast<ynx_auth_shop_proof_borrow_v1*>(uintptr_t(0x1234));
 status=ynx_auth_shop_original_client_read_with_proof_v1(s,id,n,borrow,out);loan->endBorrow();return status;
}
S public_shop_proof_close(){return loan?loan->close():done();}
void public_shop_proof_revoke(){revoked.store(true);}
void public_shop_proof_counts(uint32_t out[3]){out[0]=joins;out[1]=closes;out[2]=drops;}
}
