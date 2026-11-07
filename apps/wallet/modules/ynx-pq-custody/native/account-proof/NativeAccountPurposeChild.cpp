#include "NativeAccountPurposeChild.h"
#include <algorithm>
#include <chrono>
#include <map>
#include <memory>
#include <limits>
#include <mutex>

namespace ynx::native::accountproof {
namespace net=ynx::network::accountproof;
namespace port=ynx::sdk::mobile::accountproof;
namespace backend=ynx::network::normalnative;
namespace {
constexpr int32_t invalid=11721,wrongActor=11722,retired=11723,pending=11724,
 physicalFailure=11725,sourceMismatch=11726;
void remember(Failure&first,Failure f){if(f.present&&!first.present)first=f;}
Failure local(int32_t c){return{true,c};}
Failure converted(const net::SourceOutcome&f){
 if(f.sourceFailure.present)return{true,f.sourceFailure.code};
 if(!f.failed())return{};
 return local(physicalFailure);
}
bool same(const ynx::auth::mobile::receipt::EngineSelection&a,const ynx::auth::mobile::receipt::EngineSelection&b){
 return a.version==b.version&&a.platform==b.platform&&a.engineReference==b.engineReference&&
 a.chainId==b.chainId&&a.canonicalOwner==b.canonicalOwner&&a.sourceId==b.sourceId&&
 a.instanceId==b.instanceId&&a.minimumHeight==b.minimumHeight&&a.deadlineMs==b.deadlineMs;
}
std::mutex&inventoryMutex=*new std::mutex;
auto&inventory=*new std::map<uintptr_t,std::shared_ptr<OriginalAccountPurposeChild>>;
uintptr_t nextToken=1;
std::shared_ptr<OriginalAccountPurposeChild>known(OriginalAccountPurposeChild*t){
 std::lock_guard<std::mutex>l(inventoryMutex);auto i=inventory.find(reinterpret_cast<uintptr_t>(t));return i==inventory.end()?nullptr:i->second;
}
}
struct OriginalAccountPurposeChild::Impl {
 const std::thread::id actor=std::this_thread::get_id();
 Source*source=nullptr;
 net::SourceBoundAccountAcquisition*owner=nullptr;
 std::unique_ptr<backend::OriginalBackendLoan>backend;
 net::OriginalSourceParent*parent=nullptr;
 ynx::auth::mobile::receipt::EngineSelection selection;
 net::Deadline originalDeadline{};
 port::HostPort*host=nullptr;
 port::Reader*reader=nullptr;
 Failure first,cleanup;
 bool bound=false,parentHeld=false,readerIssued=false,retired=false,closing=false,
      tokenSelected=false,childDrained=false,ownerReleaseSelected=false,closed=false;
 bool onActor()const{return actor==std::this_thread::get_id();}
};
Failure OriginalAccountPurposeChild::initialize(Source*s,backend::AccountAcquisition acquired)noexcept{
 auto&i=*impl;i.source=s;i.backend=std::move(acquired.backend);i.owner=acquired.account.owner; // partials BEFORE status
 if(i.owner){auto f=converted(i.owner->bindOriginalChild(*this,s));if(!f.present)i.bound=true;remember(i.first,f);}
 remember(i.first,converted(acquired.account.failure));
 if(acquired.failure.failed())remember(i.first,local(physicalFailure));
 if(!i.owner){remember(i.first,local(invalid));return i.first;}
 if(i.first.present)return i.first;
 net::OriginalAccountContext context;auto f=converted(i.owner->readOriginalContext(context));
 remember(i.first,f);if(f.present)return f;i.selection=std::move(context.selection);
 // An immutable monotonic attenuation of the SAME original Source window.
 // It is never recomputed on Read/Current or used to renew permission.
 const auto wall=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
 if(wall<0||i.selection.deadlineMs<=uint64_t(wall)){remember(i.first,local(retired));return i.first;}
 const auto remaining=i.selection.deadlineMs-uint64_t(wall);
 const auto now=std::chrono::steady_clock::now();
 const auto maximum=std::chrono::duration_cast<std::chrono::milliseconds>(net::Deadline::max()-now).count();
 if(maximum<=0||remaining>uint64_t(maximum)){remember(i.first,local(invalid));return i.first;}
 i.originalDeadline=now+std::chrono::milliseconds(remaining);
 f=converted(i.owner->originalParentForChild(*this,s,i.parent));
 i.parentHeld=i.parent!=nullptr;remember(i.first,f);
 if(!f.present&&(!i.parent||i.parent->originalDeadlineMs()!=i.selection.deadlineMs))remember(i.first,local(sourceMismatch));
 return i.first.present?i.first:current(s);
}
Failure OriginalAccountPurposeChild::current(Source*s)noexcept{
 if(!impl||!impl->onActor())return local(impl?wrongActor:invalid);
 auto&i=*impl;if(s!=i.source)return local(sourceMismatch);
 if(i.first.present)return i.first;
 if(i.retired||i.closing||i.closed)return local(retired);
 if(!i.owner||!i.backend||!i.bound||!i.parentHeld||!i.parent){remember(i.first,local(invalid));return i.first;}
 if(i.backend->current().failed()){remember(i.first,local(physicalFailure));return i.first;}
 net::OriginalAccountContext context;auto f=converted(i.owner->readOriginalContext(context));
 if(!f.present&&!same(i.selection,context.selection))f=local(sourceMismatch);
 if(!f.present)f=converted(i.parent->current());
 if(!f.present&&std::chrono::steady_clock::now()>=i.originalDeadline)f=local(retired);
 remember(i.first,f);return f;
}
Failure OriginalAccountPurposeChild::firstFailure()const noexcept{return impl?impl->first:local(invalid);}
const ynx::auth::mobile::receipt::EngineSelection&OriginalAccountPurposeChild::selection()const noexcept{return impl->selection;}
Failure OriginalAccountPurposeChild::attachReader(port::Reader*r,Source*s)noexcept{
 auto f=current(s);if(f.present)return f;auto&i=*impl;
 if(!r||i.readerIssued||i.reader||!port::readerBelongsToPurposeChild(r,this,s))return local(invalid);
 i.readerIssued=true;i.reader=r;return{};
}
void OriginalAccountPurposeChild::releaseReader(port::Reader*r)noexcept{
 if(!impl||!impl->onActor()||!r||impl->reader!=r||!port::isClosed(r)||
    !port::readerBelongsToPurposeChild(r,this,impl->source))return;
 impl->reader=nullptr; // called only by actual Reader::releaseClosed
}
net::ExchangeResult OriginalAccountPurposeChild::exchange(const port::Bytes&request,port::Bytes&reply,bool cleanup)noexcept{
 net::ExchangeResult failed;failed.failure=net::Failure::Custody;
 if(!impl||!impl->onActor()||!impl->reader)return failed;
 auto&i=*impl;net::GenuineAccountChannel*channel=nullptr;
 try{
  const auto frame=port::wire::decodeFrameDATA(request);
  if(frame.status!=port::wire::Status::Request||
     (cleanup&&frame.operation!=port::Operation::Retire&&frame.operation!=port::Operation::Join&&frame.operation!=port::Operation::Close)){
   remember(i.first,local(invalid));return failed;
  }
 }catch(...){remember(i.first,local(invalid));return failed;}
 if(!cleanup){auto f=current(i.source);if(f.present)return failed;}
 auto outcome=cleanup?i.owner->originalCleanupChannelForChild(*this,i.source,channel):i.owner->originalChannelForChild(*this,i.source,channel);
 auto f=converted(outcome);remember(i.first,f);if(f.present||!channel)return failed;
 auto result=channel->originalFrameExchange(request,reply,i.originalDeadline);
 if(result.unknown||!result.complete||result.failure!=net::Failure::None)remember(i.first,local(physicalFailure));
 if(!cleanup&&result.complete){f=current(i.source);remember(i.first,f);}
 return result;
}
OriginalAccountPurposeChild*originalChildForAccountProofHostPort(port::HostPort*h)noexcept{
 auto p=known(reinterpret_cast<OriginalAccountPurposeChild*>(h));
 return p&&p->impl&&p->impl->onActor()&&p->impl->host==h&&!p->impl->closed?p.get():nullptr;
}
Failure readOriginalAccountPurposeChild(OriginalAccountPurposeChild*t,Source*s,port::HostPort*&out)noexcept{
 out=nullptr;auto p=known(t);if(!p)return local(invalid);
 auto f=p->current(s);if(f.present)return f;
 auto*host=p->impl->host;f=p->current(s);if(!f.present)out=host;return f;
}
Failure currentOriginalAccountPurposeChild(OriginalAccountPurposeChild*t,Source*s)noexcept{
 auto p=known(t);return p?p->current(s):local(invalid);
}
void retireOriginalAccountPurposeChild(OriginalAccountPurposeChild*t)noexcept{
 auto p=known(t);if(!p||!p->impl||!p->impl->onActor())return;
 auto&i=*p->impl;i.retired=true;if(i.owner)i.owner->retire();
}
Failure OriginalAccountPurposeChild::finishClose()noexcept{
 auto&i=*impl;
 if(i.closed)return i.cleanup;
 if(!i.closing)return local(pending);
 if(i.reader)return local(pending); // actual Reader/packet debt, no bool ACK
 if(!i.owner){
  if(i.backend){if(i.backend->close().failed())return local(pending);i.backend.reset();}
  i.closed=true;return i.cleanup;
 }
 if(!i.bound)return local(pending); // unknown association cannot be discarded
 if(i.parentHeld){
  const auto f=converted(i.owner->completeOriginalParentBridge(*this,*i.parent));
  if(f.present){remember(i.cleanup,f);return f;}i.parentHeld=false;i.parent=nullptr;
 }
 if(!i.childDrained){
  if(i.tokenSelected)return i.cleanup.present?i.cleanup:local(pending);
  i.tokenSelected=true;
  net::OriginalChildDrainToken token(*i.owner,*this);
  auto f=converted(i.owner->completeOriginalChildDrain(std::move(token)));
  remember(i.cleanup,f);if(f.present)return f;i.childDrained=true;
 }
 if(i.ownerReleaseSelected)return i.cleanup.present?i.cleanup:local(pending);
 auto drain=i.owner->close(i.originalDeadline);remember(i.cleanup,converted(drain.failure));
 if(!drain.complete||!i.owner->isClosed())return local(pending);
 if(!i.backend)return local(pending);
 i.ownerReleaseSelected=true;auto f=converted(i.backend->releaseClosedOriginalAccount(i.owner));
 remember(i.cleanup,f);if(f.present)return f;i.owner=nullptr;i.source=nullptr;
 if(i.backend->close().failed())return local(pending);
 i.backend.reset();i.closed=true;return i.cleanup;
}
Failure joinOriginalAccountPurposeChild(OriginalAccountPurposeChild*t)noexcept{
 auto p=known(t);if(!p||!p->impl||!p->impl->onActor())return local(p?wrongActor:invalid);
 auto&i=*p->impl;
 if(i.closing)return p->finishClose();
 if(!i.retired)return local(pending);
 if(i.owner)remember(i.cleanup,converted(i.owner->join(i.originalDeadline).failure));
 return i.cleanup;
}
Failure closeOriginalAccountPurposeChild(OriginalAccountPurposeChild*t)noexcept{
 auto p=known(t);if(!p||!p->impl||!p->impl->onActor())return local(p?wrongActor:invalid);
 auto&i=*p->impl;retireOriginalAccountPurposeChild(t);i.closing=true;
 remember(i.cleanup,i.first);return p->finishClose();
}
bool originalAccountPurposeChildClosed(OriginalAccountPurposeChild*t)noexcept{
 auto p=known(t);return p&&p->impl&&p->impl->onActor()&&p->impl->closed;
}
Failure releaseClosedOriginalAccountPurposeChild(OriginalAccountPurposeChild*t)noexcept{
 auto p=known(t);if(!p||!p->impl||!p->impl->onActor()||!p->impl->closed)return local(p?pending:invalid);
 std::lock_guard<std::mutex>l(inventoryMutex);inventory.erase(reinterpret_cast<uintptr_t>(t));return{};
}
Acquisition acquireOriginalAccountPurposeChild(Source*s)noexcept{
 Acquisition out;
 try{
  auto owned=std::make_shared<OriginalAccountPurposeChild>();
  auto state=std::make_shared<OriginalAccountPurposeChild::Impl>();
  {std::lock_guard<std::mutex>l(inventoryMutex);
   if(inventory.size()>=64||nextToken==std::numeric_limits<uintptr_t>::max())return{nullptr,local(pending)};
   const auto id=nextToken++;
   state->host=reinterpret_cast<port::HostPort*>(id);owned->impl=state;
   inventory.emplace(id,std::move(owned));out.owner=reinterpret_cast<OriginalAccountPurposeChild*>(id);
  }
  auto p=known(out.owner);
  // The actual original startup holds the one capture. No caller-selected
  // process, descriptor, engine string, callback or profile enters this call.
  auto acquired=backend::acquireOriginalNormalSourceAccount(s);
  out.failure=p->initialize(s,std::move(acquired));return out;
 }catch(...){out.failure=local(invalid);if(auto p=known(out.owner))remember(p->impl->first,out.failure);return out;}
}
}
