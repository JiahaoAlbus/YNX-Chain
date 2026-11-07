// Actual Native Reader TU, PUBLIC protected-child seam only. Not Auth/Root,
// real Core proof verification, actual P09 socket or installed qualification.
#include "../native/account-proof/NativeAccountPurposeChild.h"
#include <cassert>
#include <atomic>
#include <iostream>
#include <string>
#include <thread>
namespace port=ynx::sdk::mobile::accountproof;
namespace wire=port::wire;
namespace native=ynx::native::accountproof;
namespace net=ynx::network::accountproof;
namespace {
native::OriginalAccountPurposeChild child;
auto*source=reinterpret_cast<native::Source*>(uintptr_t(11));
auto*host=reinterpret_cast<port::HostPort*>(uintptr_t(12));
ynx::auth::mobile::receipt::EngineSelection selected;
port::Reader*attached=nullptr;
port::Failure sourceFailure;
std::string mode;
unsigned requests=0,reads=0,closes=0,releases=0;
uint64_t sequence=0;
std::array<uint8_t,32>readerID{};
port::CommittedProofViewDATA view(){
 port::CommittedProofViewDATA v;
 v.proof.chainID=v.currentCheckpoint.chainID=selected.chainId;
 v.proof.height=41;v.currentCheckpoint.height=43;
 v.proof.appHash.fill(1);v.currentCheckpoint.appHash.fill(2);
 for(auto*a:{&v.historicalAccount,&v.currentAccount}){
  a->owner=selected.canonicalOwner;a->networkID.fill(3);a->nativeChainID=6423;
  a->policyOriginal={123,125};a->committedAuthorizationStatus="NONE";a->authorizationStatus="NONE";
 }
 v.historicalAccount.committedHeight=41;v.historicalAccount.executionHeight=42;
 v.currentAccount.committedHeight=43;v.currentAccount.executionHeight=44;
 v.blockOriginal={123,49,125};v.successorOriginal={123,50,125};return v;
}
}
namespace ynx::native::accountproof {
Failure OriginalAccountPurposeChild::current(Source*s)noexcept{return s==source?sourceFailure:Failure{true,991};}
Failure OriginalAccountPurposeChild::firstFailure()const noexcept{return sourceFailure;}
const ynx::auth::mobile::receipt::EngineSelection&OriginalAccountPurposeChild::selection()const noexcept{return selected;}
Failure OriginalAccountPurposeChild::attachReader(port::Reader*r,Source*s)noexcept{
 if(s!=source||attached)return{true,992};attached=r;return{};
}
void OriginalAccountPurposeChild::releaseReader(port::Reader*r)noexcept{assert(attached==r);attached=nullptr;++releases;}
OriginalAccountPurposeChild*originalChildForAccountProofHostPort(port::HostPort*h)noexcept{return h==host?&child:nullptr;}
net::ExchangeResult OriginalAccountPurposeChild::exchange(const port::Bytes&request,port::Bytes&reply,bool cleanup)noexcept{
 try{
  const auto f=wire::decodeFrameDATA(request);++requests;
  assert(f.payload.empty()&&f.sequence==++sequence);
  if(f.operation==port::Operation::Open)assert(requests==1&&wire::zero(f.reader)&&!cleanup);
  else assert(f.reader==readerID);
  if(f.operation==port::Operation::Close)++closes;
  if((mode=="unknown-open"&&f.operation==port::Operation::Open)||
     (mode=="unknown-close"&&f.operation==port::Operation::Close))
   return{false,true,request.size(),0,net::Failure::Unknown,false,false};
  wire::FrameDATA result;result.operation=f.operation;result.status=wire::Status::OK;
  result.sequence=f.sequence;result.reader=readerID;
  if(f.operation==port::Operation::Read||f.operation==port::Operation::Current){
   ++reads;
   if(mode=="not-ready"&&reads==1){result.status=wire::Status::NotReady;result.failure={true,0};}
   else{
    auto v=view();if(mode=="changed-h"&&reads==2){v.proof.height=42;v.historicalAccount.committedHeight=42;v.historicalAccount.executionHeight=43;}
    result.payload=wire::encodeViewDATA(v);
   }
   if(mode=="late-zero")sourceFailure={true,0};
  }
  if(f.operation==port::Operation::Close){assert(cleanup);result.status=wire::Status::Closed;if(mode=="closed-zero")result.failure={true,0};}
  if(mode=="wrong-sequence"&&f.operation==port::Operation::Read)++result.sequence;
  reply=wire::encodeFrameDATA(result);return{true,false,request.size(),reply.size(),net::Failure::None,false,false};
 }catch(...){return{false,true,request.size(),0,net::Failure::Unknown,false,false};}
}
}
int main(int argc,char**argv){
 assert(argc==2);mode=argv[1];readerID.fill(9);
 selected.chainId="PUBLIC-chain";selected.canonicalOwner="0x0000000000000000000000000000000000000001";selected.minimumHeight=40;selected.deadlineMs=1893456000000;
 if(mode=="concurrent-release"){
  std::atomic<port::Reader*>target{nullptr};std::atomic<bool>stop{false},started{false};
  std::thread observer([&]{started=true;while(!stop.load()){
   if(auto*r=target.load()){port::CommittedProofViewDATA local;
    (void)port::isClosed(r);assert(port::read(r,local).failure.present);
   }
  }});
  while(!started.load())std::this_thread::yield();
  for(unsigned k=0;k<3000;++k){
   requests=0;sequence=0;closes=0;
   auto a=port::open(host,source);assert(a.owner&&!a.failure.present);target=a.owner;
   std::this_thread::yield();assert(!port::close(a.owner).present&&port::isClosed(a.owner));
   assert(!port::releaseClosed(a.owner).present);target=nullptr;
  }
  stop=true;observer.join();assert(!attached);
  std::cout<<"PUBLIC_CHILD_SEAM_ACTUAL_NATIVE_READER_PASS concurrent-release NOT_ROOT_NOT_CORE_PROOF\n";return 0;
 }
 if(mode=="invalid-host"){
  auto a=port::open(reinterpret_cast<port::HostPort*>(uintptr_t(99)),source);assert(!a.owner&&a.failure.present&&requests==0);
 }else if(mode=="wrong-source"){
  auto a=port::open(host,reinterpret_cast<native::Source*>(uintptr_t(99)));assert(a.owner&&a.failure.present&&requests==0);
  assert(port::close(a.owner).present&&port::isClosed(a.owner));assert(!port::releaseClosed(a.owner).present&&releases==0);
 }else{
  auto a=port::open(host,source);assert(a.owner);
  if(mode=="unknown-open")assert(a.failure.present);else assert(!a.failure.present);
  if(mode=="intrinsic-reader"){
   assert(port::readerBelongsToPurposeChild(a.owner,&child,source));
   assert(!port::readerBelongsToPurposeChild(a.owner,reinterpret_cast<native::OriginalAccountPurposeChild*>(uintptr_t(999)),source));
   assert(!port::readerBelongsToPurposeChild(a.owner,&child,reinterpret_cast<native::Source*>(uintptr_t(999))));
   assert(!port::readerBelongsToPurposeChild(reinterpret_cast<port::Reader*>(uintptr_t(999)),&child,source));
  }
  port::CommittedProofViewDATA out;out.proof.chainID="unchanged";
  if(mode=="not-ready"){
   auto r=port::read(a.owner,out);assert(r.state==port::ReadState::NotReady&&r.failure.present&&r.failure.code==0&&out.proof.chainID=="unchanged"&&requests==2);
   r=port::read(a.owner,out);assert(r.state==port::ReadState::Ready&&!r.failure.present&&out.proof.height==41&&requests==3);
  }else if(mode=="late-zero"){
   auto r=port::read(a.owner,out);assert(r.state==port::ReadState::Failed&&r.failure.present&&r.failure.code==0&&out.proof.chainID=="unchanged");
  }else if(mode=="changed-h"){
   assert(port::read(a.owner,out).state==port::ReadState::Ready);auto before=out.proof.height;
   auto r=port::current(a.owner,out);assert(r.state==port::ReadState::Failed&&r.failure.present&&out.proof.height==before);
  }else if(mode=="wrong-sequence"){
   assert(port::read(a.owner,out).state==port::ReadState::Failed);assert(out.proof.chainID=="unchanged");
  }else if(mode=="wrong-thread"){
   auto count=requests;std::thread t([&]{assert(port::read(a.owner,out).failure.present);assert(port::close(a.owner).present);});t.join();assert(requests==count&&!port::isClosed(a.owner));
  }else if(mode!="unknown-open")assert(port::read(a.owner,out).state==port::ReadState::Ready);
  port::retire(a.owner);
  auto f=port::close(a.owner);auto count=requests;auto firstCloses=closes;
  (void)port::close(a.owner);
  if(mode=="unknown-open"||mode=="unknown-close"||mode=="wrong-sequence"){
   assert(f.present&&!port::isClosed(a.owner));(void)port::join(a.owner);port::retire(a.owner);
   assert(requests==count&&closes==firstCloses&&port::releaseClosed(a.owner).present&&releases==0);
  }else{
   assert(port::isClosed(a.owner)&&requests==count&&closes==1);
   if(mode=="closed-zero"||mode=="late-zero")assert(f.present&&f.code==0);
   assert(!port::releaseClosed(a.owner).present&&releases==1&&!port::isClosed(a.owner));
   assert(port::read(a.owner,out).failure.present&&requests==count);
  }
 }
 std::cout<<"PUBLIC_CHILD_SEAM_ACTUAL_NATIVE_READER_PASS "<<mode<<" NOT_ROOT_NOT_CORE_PROOF\n";
}
