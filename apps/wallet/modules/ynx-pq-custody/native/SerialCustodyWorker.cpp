#include "SerialCustodyWorker.h"
#include <future>
#include <algorithm>
#include <stdexcept>
namespace ynx::mobilepq {
SerialCustodyWorker::SerialCustodyWorker():worker_([this]{
 for(;;){Job job;{std::unique_lock<std::mutex> lock(mutex_);cv_.wait(lock,[this]{return stopping_||!jobs_.empty();});
  if(stopping_&&jobs_.empty())return;job=std::move(jobs_.front());jobs_.pop_front();}job();}
}){}
SerialCustodyWorker::~SerialCustodyWorker(){
 // Platform owner must keep this worker alive if shutdown returned false.
 // Do not detach a thread with live custody or free its backing owner inventory.
 if(worker_.joinable()){if(!shutdown())std::terminate();}
}
void SerialCustodyWorker::enqueue(Job job){
 {std::lock_guard<std::mutex> lock(mutex_);if(stopping_)throw std::runtime_error("PQ_WORKER_CLOSED");jobs_.push_back(std::move(job));}cv_.notify_one();
}
std::shared_ptr<CustodySession> SerialCustodyWorker::prepare(const std::string& reference,uint32_t mode){
 if(std::this_thread::get_id()!=worker_.get_id())throw std::runtime_error("PQ_WORKER_THREAD_REQUIRED");
 if(!runtimeLive_->load())throw std::runtime_error("PQ_WORKER_CLOSED");
 // Capacity is checked before capture/decryption. Closed public outcomes stay
 // reachable via their held object but no longer occupy the private inventory.
 owners_.erase(std::remove_if(owners_.begin(),owners_.end(),[](auto& s){return s->released();}),owners_.end());
 if(owners_.size()>=64)throw std::runtime_error("PQ_WORKER_CAPACITY");
 auto owner=std::make_shared<CustodySession>(mode,runtimeLive_);owners_.push_back(owner);owner->prepare(reference);return owner;
}
bool SerialCustodyWorker::closeAll(){
 if(std::this_thread::get_id()!=worker_.get_id())return false;bool ok=true;
 for(auto& owner:owners_)ok=owner->close()&&ok;return ok;
}
bool SerialCustodyWorker::shutdown(){
 if(std::this_thread::get_id()==worker_.get_id())return false;
 std::lock_guard<std::mutex> shutdownLock(shutdownMutex_);
 if(!worker_.joinable())return true;
 runtimeLive_->store(false); // closes effects even while a primitive is running
 auto done=std::make_shared<std::promise<bool>>();auto result=done->get_future();
 enqueue([this,done]{done->set_value(closeAll());});if(!result.get())return false;
 {std::lock_guard<std::mutex> lock(mutex_);stopping_=true;}cv_.notify_one();worker_.join();return true;
}
}
