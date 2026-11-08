#pragma once
// Process-local, thread-bound lifetime inventory. Tokens are never serialized
// and never themselves prove Source/Root/user authority. No public installer.
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <vector>
#include <cstdint>
namespace ynx::auth::android_device_provisioning {
template<class T,std::size_t Limit=128>class Inventory{
 struct Token{std::uint64_t serial;};struct Entry{std::thread::id actor;std::unique_ptr<T>owner;};
 std::mutex mutex_;std::vector<std::unique_ptr<Token>>tokens_;std::unordered_map<void*,Entry>entries_;
public:
 // Owner must already be created/adopted by the private fixed factory. This
 // storage primitive does not accept bytes, Root keys or approval flags.
 void* adopt(std::unique_ptr<T>&owner){if(!owner)return nullptr;std::lock_guard<std::mutex>lock(mutex_);if(tokens_.size()>=Limit)return nullptr;auto token=std::make_unique<Token>();token->serial=tokens_.size()+1;auto p=token.get();tokens_.push_back(std::move(token));entries_.emplace(p,Entry{std::this_thread::get_id(),std::move(owner)});return p;}
 T* find(void*p){std::lock_guard<std::mutex>lock(mutex_);auto i=entries_.find(p);return i!=entries_.end()&&i->second.actor==std::this_thread::get_id()?i->second.owner.get():nullptr;}
 bool protects(std::uintptr_t start,std::size_t n){if(!start||!n||start>UINTPTR_MAX-n)return true;auto end=start+n;std::lock_guard<std::mutex>lock(mutex_);for(auto&t:tokens_){auto a=reinterpret_cast<std::uintptr_t>(t.get());if(start<a+sizeof(Token)&&a<end)return true;}for(auto&v:entries_){auto a=reinterpret_cast<std::uintptr_t>(v.second.owner.get());if(start<a+sizeof(T)&&a<end)return true;}return false;}
 // Closed owners/tokens remain tombstones. No address reuse or auto-close on
 // lookup, no IO/Source/current/physical operation under this mutex.
};
}
