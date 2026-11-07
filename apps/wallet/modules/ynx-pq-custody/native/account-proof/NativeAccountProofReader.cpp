#include "NativeAccountPurposeChild.h"
#include <limits>
#include <map>
#include <memory>
#include <mutex>

namespace ynx::sdk::mobile::accountproof {
namespace native=ynx::native::accountproof;
namespace {
constexpr int32_t invalid=11701,wrongActor=11702,retired=11703,unknown=11704,
                  malformed=11705,pending=11706,capacity=11707;
void remember(Failure&first,Failure f){if(f.present&&!first.present)first=f;}
Failure local(int32_t code){return{true,code};}
}
struct Reader final {
 const std::thread::id actor=std::this_thread::get_id();
 native::OriginalAccountPurposeChild*child=nullptr;
 ynx::auth::mobile::receipt::OriginalEngineSource*source=nullptr;
 Reader*token=nullptr;
 wire::SequenceDATA sequence;
 std::optional<CheckpointDATA>captured;
 Failure first;
 bool attached=false,retired=false,retireSelected=false,closeSelected=false,
      closed=false,noRemoteReader=false;
 static Acquisition acquire(HostPort*,ynx::auth::mobile::receipt::OriginalEngineSource*);
 bool onActor()const{return actor==std::this_thread::get_id();}
 Failure gate(){
  if(first.present)return first;
  if(retired||closeSelected||closed)return local(accountproof::retired);
  if(!child||!attached)return local(invalid);
  auto f=child->current(source);remember(first,f);return f;
 }
 Failure exchange(Operation op,bool cleanup,wire::FrameDATA&reply){
  if(!child||!attached)return local(invalid);
  if(sequence.pending)return first.present?first:local(unknown);
  if(!cleanup){auto f=gate();if(f.present)return f;}
  wire::FrameDATA request;request.operation=op;request.sequence=sequence.next;
  request.reader=sequence.reader;
  try{
   auto bytes=wire::encodeFrameDATA(request);sequence.request(request);
   Bytes raw;auto physical=child->exchange(bytes,raw,cleanup);
   if(!physical.complete||physical.unknown||physical.failure!=ynx::network::accountproof::Failure::None){
    if(op==Operation::Open&&!physical.unknown&&physical.requestBytesWritten==0)noRemoteReader=true;
    auto f=child->firstFailure();if(!f.present)f=local(unknown);
    remember(first,f);return f; // pending is never reset/replayed
   }
   reply=wire::decodeFrameDATA(raw);sequence.response(reply);
   // Decode alone cannot associate a view with this genuine Source.
   if(reply.status==wire::Status::Failed)remember(first,reply.failure);
   if(op==Operation::Open&&reply.status==wire::Status::Failed&&wire::zero(reply.reader))noRemoteReader=true;
   if(reply.status==wire::Status::Closed){closed=true;remember(first,reply.failure);}
   if(!cleanup){auto f=child->current(source);if(f.present){remember(first,f);return f;}}
   return reply.status==wire::Status::Failed?reply.failure:Failure{};
  }catch(...){auto f=local(malformed);remember(first,f);return f;}
 }
 ReadOutcome observe(Operation op,CommittedProofViewDATA&out){
  auto f=gate();if(f.present)return{ReadState::Failed,f};
  wire::FrameDATA reply;f=exchange(op,false,reply);
  if(f.present)return{ReadState::Failed,f};
  if(reply.status==wire::Status::NotReady)return{ReadState::NotReady,reply.failure};
  if(reply.status!=wire::Status::OK){remember(first,local(malformed));return{ReadState::Failed,first};}
  try{
   auto view=wire::decodeViewDATA(reply.payload);const auto&s=child->selection();
   if(view.proof.height<=0||view.proof.chainID!=s.chainId||
      uint64_t(view.proof.height)<s.minimumHeight||view.historicalAccount.owner!=s.canonicalOwner||
      (captured&&(captured->chainID!=view.proof.chainID||captured->height!=view.proof.height||captured->appHash!=view.proof.appHash))){
    remember(first,local(malformed));return{ReadState::Failed,first};
   }
   f=child->current(source);if(f.present){remember(first,f);return{ReadState::Failed,f};}
   captured=view.proof;out=std::move(view);return{ReadState::Ready,{}};
  }catch(...){remember(first,local(malformed));return{ReadState::Failed,first};}
 }
};
namespace {
std::mutex&inventoryMutex=*new std::mutex;
auto&inventory=*new std::map<uintptr_t,std::shared_ptr<Reader>>;
uintptr_t nextToken=1;
std::shared_ptr<Reader>known(Reader*token){std::lock_guard<std::mutex>lock(inventoryMutex);auto i=inventory.find(reinterpret_cast<uintptr_t>(token));return i==inventory.end()?nullptr:i->second;}
}
bool readerBelongsToPurposeChild(Reader*t,native::OriginalAccountPurposeChild*child,ynx::auth::mobile::receipt::OriginalEngineSource*source)noexcept{
 auto p=known(t);return p&&p->onActor()&&p->child==child&&p->source==source;
}
Acquisition Reader::acquire(HostPort*host,ynx::auth::mobile::receipt::OriginalEngineSource*source){
 Acquisition out;
 auto*child=native::originalChildForAccountProofHostPort(host);
 if(!child)return{nullptr,local(invalid)};
 auto owned=std::make_shared<Reader>();owned->child=child;owned->source=source;
 {std::lock_guard<std::mutex>lock(inventoryMutex);
  if(inventory.size()>=64||nextToken==std::numeric_limits<uintptr_t>::max())return{nullptr,local(capacity)};
  const auto id=nextToken++;owned->token=reinterpret_cast<Reader*>(id);
  inventory.emplace(id,std::move(owned));out.owner=reinterpret_cast<Reader*>(id);
 }
 auto p=known(out.owner);auto f=p->child->attachReader(out.owner,source);
 if(f.present){remember(p->first,f);out.failure=f;return out;}
 p->attached=true;wire::FrameDATA reply;f=p->exchange(Operation::Open,false,reply);
 if(!f.present&&reply.status!=wire::Status::OK)f=local(malformed);
 remember(p->first,f);out.failure=f;return out;
}
Acquisition open(HostPort*h,ynx::auth::mobile::receipt::OriginalEngineSource*s)noexcept{
 try{return Reader::acquire(h,s);}catch(...){return{nullptr,local(invalid)};}
}
ReadOutcome read(Reader*t,CommittedProofViewDATA&out)noexcept{
 auto p=known(t);if(!p||!p->onActor())return{ReadState::Failed,local(p?wrongActor:invalid)};
 try{return p->observe(Operation::Read,out);}catch(...){remember(p->first,local(invalid));return{ReadState::Failed,p->first};}
}
ReadOutcome current(Reader*t,CommittedProofViewDATA&out)noexcept{
 auto p=known(t);if(!p||!p->onActor())return{ReadState::Failed,local(p?wrongActor:invalid)};
 try{return p->observe(Operation::Current,out);}catch(...){remember(p->first,local(invalid));return{ReadState::Failed,p->first};}
}
void retire(Reader*t)noexcept{
 auto p=known(t);if(!p||!p->onActor()||p->closed||p->retireSelected)return;
 p->retired=true;p->retireSelected=true;
 if(!p->attached||p->noRemoteReader||!p->sequence.opened)return;
 wire::FrameDATA reply;auto f=p->exchange(Operation::Retire,true,reply);remember(p->first,f);
}
Failure join(Reader*t)noexcept{
 auto p=known(t);if(!p||!p->onActor())return local(p?wrongActor:invalid);
 if(p->closed)return p->first;
 if(!p->retired)return local(pending);
 if(p->sequence.pending)return p->first.present?p->first:local(unknown);
 if(!p->attached||p->noRemoteReader)return p->first;
 if(!p->sequence.opened)return p->first.present?p->first:local(pending);
 wire::FrameDATA reply;auto f=p->exchange(Operation::Join,true,reply);remember(p->first,f);return p->first;
}
Failure close(Reader*t)noexcept{
 auto p=known(t);if(!p||!p->onActor())return local(p?wrongActor:invalid);
 if(p->closeSelected)return p->first;
 p->retired=true;p->closeSelected=true;
 if(!p->attached||p->noRemoteReader||
    (!p->sequence.opened&&!p->sequence.pending&&p->sequence.next==1)){
  p->closed=true;return p->first; // original OPEN was never sent
 }
 if(p->sequence.pending||!p->sequence.opened){remember(p->first,local(unknown));return p->first;}
 wire::FrameDATA reply;auto f=p->exchange(Operation::Close,true,reply);remember(p->first,f);
 if(!p->closed)remember(p->first,local(pending));return p->first;
}
bool isClosed(Reader*t)noexcept{auto p=known(t);return p&&p->onActor()&&p->closed;}
Failure releaseClosed(Reader*t)noexcept{
 auto p=known(t);if(!p||!p->onActor()||!p->closed)return local(p?pending:invalid);
 if(p->attached){p->child->releaseReader(t);p->attached=false;}
 std::lock_guard<std::mutex>lock(inventoryMutex);inventory.erase(reinterpret_cast<uintptr_t>(t));return{};
}
}
