#include "NativeAccountPicker.h"
#include <chrono>
#include <array>
#include <condition_variable>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <thread>
namespace ynx::mobilepq::picker {
namespace {
using Clock=std::chrono::steady_clock;
struct Ticket {
 const std::thread::id actor=std::this_thread::get_id();
 uint64_t binding=0;size_t count=0;Clock::time_point deadline;
 bool retired=false,responded=false,uiClosed=false;uint32_t index=0;int32_t result=pending;
 std::condition_variable changed;
};
std::mutex mutex;std::map<uint64_t,std::shared_ptr<Ticket>>tickets;
uint64_t currentBinding=0,lastBinding=0,nextTicket=1;bool runtimeRetired=true;
std::shared_ptr<Ticket>get(uint64_t id){auto it=tickets.find(id);return it==tickets.end()?nullptr:it->second;}
bool active(const Ticket&t){return !runtimeRetired&&currentBinding==t.binding&&!t.retired&&Clock::now()<t.deadline;}
bool lowerHex(const std::string&s,size_t n){return s.size()==n&&s.find_first_not_of("0123456789abcdef")==std::string::npos;}
bool operation(const std::string&s){return !s.empty()&&s.size()<=128&&s.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-")==std::string::npos;}
void cancel(Ticket&t,int32_t reason){t.retired=true;if(!t.responded){t.responded=true;t.result=reason;}t.changed.notify_all();}
}
bool bindRuntime(uint64_t binding)noexcept{try{std::lock_guard<std::mutex>lock(mutex);if(currentBinding)return currentBinding==binding&&!runtimeRetired;if(!binding||binding<=lastBinding)return false;lastBinding=currentBinding=binding;runtimeRetired=false;return true;}catch(...){return false;}}
void retireRuntime(uint64_t binding)noexcept{
 try{std::array<uint64_t,32>dismiss{};size_t count=0;
  {std::lock_guard<std::mutex>lock(mutex);if(!binding||binding!=currentBinding)return;runtimeRetired=true;for(auto&[id,t]:tickets)if(t->binding==binding){cancel(*t,cancelled);dismiss[count++]=id;}}
  for(size_t i=0;i<count;++i)platformDismiss(dismiss[i]);
 }catch(...){/* Tickets remain owned; release never manufactures a closed ACK. */}
}
bool releaseRuntime(uint64_t binding)noexcept{try{std::lock_guard<std::mutex>lock(mutex);if(!binding||binding!=currentBinding||!runtimeRetired)return false;for(const auto&[id,t]:tickets){(void)id;if(t->binding==binding)return false;}currentBinding=0;return true;}catch(...){return false;}}
static int32_t openImpl(uint64_t binding,const std::vector<AccountChoice>&choices,uint32_t timeout,uint64_t*out,bool accountOnly)noexcept{
 if(!out||*out||choices.empty()||choices.size()>20||timeout<1000||timeout>120000)return invalid;
 try{
  std::vector<std::string>labels;std::set<std::string>identities;
  for(const auto&c:choices){if(c.account.size()!=42||c.account.substr(0,2)!="0x"||!lowerHex(c.account.substr(2),40)||(accountOnly?(!operation(c.network)||!c.originalOperation.empty()):(!lowerHex(c.network,64)||!operation(c.originalOperation))))return invalid;
   if(!identities.insert(c.account+"/"+c.network+"/"+c.originalOperation).second)return invalid;
   labels.push_back(c.account+"\nNetwork: "+c.network+(accountOnly?"":"\nOriginal operation: "+c.originalOperation));
  }
  auto t=std::make_shared<Ticket>();t->binding=binding;t->count=choices.size();t->deadline=Clock::now()+std::chrono::milliseconds(timeout);uint64_t id;
  {std::lock_guard<std::mutex>lock(mutex);if(!binding||binding!=currentBinding||runtimeRetired)return unavailable;if(tickets.size()>=32||nextTicket==uint64_t(std::numeric_limits<int64_t>::max()))return capacity;id=nextTicket++;tickets.emplace(id,t);*out=id;}
  const auto rc=platformShow(id,labels);
  if(rc){std::lock_guard<std::mutex>lock(mutex);cancel(*t,rc);t->uiClosed=true;} // platform contract: no work posted
  return rc;
 }catch(...){return unavailable;}
}
int32_t open(uint64_t binding,const std::vector<AccountChoice>&choices,uint32_t timeout,uint64_t*out)noexcept{return openImpl(binding,choices,timeout,out,false);}
int32_t openForCurrentRuntime(const std::vector<AccountChoice>&choices,uint32_t timeout,uint64_t*out)noexcept{
 try{uint64_t binding;{std::lock_guard<std::mutex>lock(mutex);if(!currentBinding||runtimeRetired)return unavailable;binding=currentBinding;}
  // open rechecks this SAME binding after validation. A retire/replacement in
  // that interval cannot silently redirect the inventory to a later runtime.
  return open(binding,choices,timeout,out);
 }catch(...){return unavailable;}
}
int32_t openRegisteredAccountForCurrentRuntime(const std::vector<RegisteredAccountChoice>&choices,uint32_t timeout,uint64_t*out)noexcept{
 try{uint64_t binding;{std::lock_guard<std::mutex>lock(mutex);if(!currentBinding||runtimeRetired)return unavailable;binding=currentBinding;}
  if(choices.empty()||choices.size()>20)return invalid;
  std::vector<AccountChoice>rows;rows.reserve(choices.size());for(const auto&c:choices)rows.push_back({c.account,c.network,{}});
  return openImpl(binding,rows,timeout,out,true);
 }catch(...){return unavailable;}
}
int32_t wait(uint64_t id,uint32_t*out)noexcept{
 if(!out)return invalid;
 try{std::unique_lock<std::mutex>lock(mutex);auto t=get(id);if(!t)return invalid;if(t->actor!=std::this_thread::get_id())return wrongThread;
  while(!t->responded&&active(*t))t->changed.wait_until(lock,t->deadline);
  if(!active(*t)){const auto rc=Clock::now()>=t->deadline?expired:cancelled;cancel(*t,rc);lock.unlock();platformDismiss(id);return rc;}
  if(!t->responded)return pending;if(t->result)return t->result;if(t->index>=t->count)return invalid;*out=t->index;return 0;
 }catch(...){return unavailable;}
}
bool requestCancel(uint64_t id)noexcept{
 try{bool done;{std::lock_guard<std::mutex>lock(mutex);auto t=get(id);if(!t)return false;cancel(*t,cancelled);done=t->uiClosed;}
  if(!done)platformDismiss(id);return true;
 }catch(...){return false;}
}
int32_t close(uint64_t id)noexcept{
 try{bool done=false;{std::lock_guard<std::mutex>lock(mutex);auto t=get(id);if(!t)return invalid;if(t->actor!=std::this_thread::get_id())return wrongThread;cancel(*t,cancelled);done=t->uiClosed;}if(!done)platformDismiss(id);return done?0:pending;}catch(...){return unavailable;}
}
int32_t releaseClosed(uint64_t id)noexcept{try{std::lock_guard<std::mutex>lock(mutex);auto t=get(id);if(!t)return invalid;if(t->actor!=std::this_thread::get_id())return wrongThread;if(!t->retired||!t->uiClosed)return pending;tickets.erase(id);return 0;}catch(...){return unavailable;}}
bool presentationCurrent(uint64_t id)noexcept{try{std::lock_guard<std::mutex>lock(mutex);auto t=get(id);return t&&active(*t)&&!t->uiClosed&&!t->responded;}catch(...){return false;}}
bool selected(uint64_t id,uint32_t index,int32_t result)noexcept{try{std::lock_guard<std::mutex>lock(mutex);auto t=get(id);if(!t||!active(*t)||t->responded||t->uiClosed||(!result&&index>=t->count))return false;t->responded=true;t->index=index;t->result=result;t->changed.notify_all();return true;}catch(...){return false;}}
void presentationClosed(uint64_t id)noexcept{try{std::lock_guard<std::mutex>lock(mutex);auto t=get(id);if(!t)return;t->uiClosed=true;if(!t->responded){t->responded=true;t->result=cancelled;}t->changed.notify_all();}catch(...){}}
}
