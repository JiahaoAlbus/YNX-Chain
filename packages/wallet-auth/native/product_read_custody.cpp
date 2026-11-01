#include "product_read_custody.hpp"
#include <limits>

namespace ynx::wallet::product {
namespace {[[noreturn]]void deny(const char*c){throw std::runtime_error(c);}}
struct ReadCustody::State {
 mutable std::mutex mutex;
 std::condition_variable changed;
 std::atomic<bool> retired{false};
 bool joined=false,close_selected=false,close_settled=false,closed=false;
 bool close_error_present=false;
 std::exception_ptr close_error;
 uint64_t next=1;
 std::unordered_map<uint64_t,std::weak_ptr<Read>> reads;
};
ReadCustody::Read::Read(std::shared_ptr<State>s,uint64_t id):parent_(std::move(s)),id_(id){}
ReadCustody::Read::~Read(){finish();}
bool ReadCustody::Read::cancelled()const noexcept{
 return cancelled_.load(std::memory_order_acquire)||parent_->retired.load(std::memory_order_acquire);
}
void ReadCustody::Read::current()const{
 if(cancelled()||parent_->retired.load(std::memory_order_acquire))deny("PRODUCT_SOURCE_READ_RETIRED");
 std::lock_guard<std::mutex> lock(parent_->mutex);
 if(parent_->close_selected||parent_->closed)deny("PRODUCT_SOURCE_READ_CLOSED");
}
void ReadCustody::Read::retain_result(std::vector<uint8_t>b){
 if(b.size()>2*1024*1024)deny("PRODUCT_SOURCE_ORIGINAL_BOUNDS");
 std::lock_guard<std::mutex> lock(mutex_);
 if(finished_)deny("PRODUCT_SOURCE_READ_FINISHED");
 if(result_)deny("PRODUCT_SOURCE_ORIGINAL_ALREADY_RETAINED");
 result_=std::make_shared<const std::vector<uint8_t>>(std::move(b));
}
std::shared_ptr<const std::vector<uint8_t>>ReadCustody::Read::retained_result(){
 std::lock_guard<std::mutex> lock(mutex_);return result_;
}
void ReadCustody::Read::fail(std::exception_ptr p)noexcept{
 std::lock_guard<std::mutex> lock(mutex_);if(!first_present_){first_present_=true;first_=p;}
 cancelled_.store(true,std::memory_order_release);
}
void ReadCustody::Read::finish()noexcept{
 {std::lock_guard<std::mutex> lock(mutex_);if(finished_)return;finished_=true;}
 cancelled_.store(true,std::memory_order_release);
 std::lock_guard<std::mutex> lock(parent_->mutex);
 parent_->reads.erase(id_);parent_->changed.notify_all();
}
ReadCustody::ReadCustody():state_(std::make_shared<State>()){}
ReadCustody::~ReadCustody(){retire();} // GC is not join or downstream close.
std::shared_ptr<ReadCustody::Read>ReadCustody::begin(){
 std::lock_guard<std::mutex> lock(state_->mutex);
 if(state_->retired.load(std::memory_order_acquire)||state_->close_selected)deny("PRODUCT_SOURCE_RETIRED");
 if(state_->next==std::numeric_limits<uint64_t>::max())deny("PRODUCT_SOURCE_READ_COUNTER_EXHAUSTED");
 auto result=std::shared_ptr<Read>(new Read(state_,state_->next++));
 state_->reads.emplace(result->id_,result);return result;
}
void ReadCustody::lifecycle_current()const{
 std::lock_guard<std::mutex> lock(state_->mutex);
 if(state_->retired.load(std::memory_order_acquire)||state_->close_selected)deny("PRODUCT_SOURCE_RETIRED");
}
void ReadCustody::retire()noexcept{
 state_->retired.store(true,std::memory_order_release);
 // Every read shares this immutable parent epoch. No weak.lock/last-ref
 // destruction while holding the mutex, and retirement cannot allocate.
 state_->changed.notify_all();
}
void ReadCustody::join(){
 std::unique_lock<std::mutex> lock(state_->mutex);
 if(!state_->retired.load(std::memory_order_acquire))deny("PRODUCT_SOURCE_RETIRE_REQUIRED");
 state_->changed.wait(lock,[&]{return state_->reads.empty();});state_->joined=true;
}
void ReadCustody::select_close(){
 std::lock_guard<std::mutex> lock(state_->mutex);
 if(state_->close_selected){
  if(state_->close_error_present&&state_->close_error)std::rethrow_exception(state_->close_error);
  deny(state_->closed?"PRODUCT_SOURCE_ALREADY_CLOSED":"PRODUCT_SOURCE_CLOSE_UNKNOWN");
 }
 if(!state_->retired.load(std::memory_order_acquire)||!state_->joined||!state_->reads.empty())deny("PRODUCT_SOURCE_READS_RETAINED");
 state_->close_selected=true;
}
void ReadCustody::settle_close(std::exception_ptr error,bool present)noexcept{
 std::lock_guard<std::mutex> lock(state_->mutex);
 if(!state_->close_selected||state_->close_settled)return;
 state_->close_settled=true;state_->close_error_present=present;state_->close_error=error;
 state_->closed=!present;
}
bool ReadCustody::closed()const noexcept{std::lock_guard<std::mutex> lock(state_->mutex);return state_->closed;}
bool ReadCustody::close_selected()const noexcept{std::lock_guard<std::mutex> lock(state_->mutex);return state_->close_selected;}
size_t ReadCustody::active()const noexcept{std::lock_guard<std::mutex> lock(state_->mutex);return state_->reads.size();}
void ReadCustody::assert_safe_to_close()const{
 std::lock_guard<std::mutex> lock(state_->mutex);
 if(!state_->closed||!state_->reads.empty())deny("PRODUCT_SOURCE_CLOSE_UNCONFIRMED");
}
}
