#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <exception>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace ynx::wallet::product {
// Custody ONLY. This type deliberately has no admission/Root/ready setter.
// The independent authenticated ProductSource must fence each original read
// before begin and again after retain_result. A caller guard is not authority.
class ReadCustody final {
 struct State;
 public:
 class Read final {
  friend class ReadCustody;
  std::shared_ptr<State> parent_;
  uint64_t id_;
  std::atomic<bool> cancelled_{false};
  std::mutex mutex_;
  std::shared_ptr<const std::vector<uint8_t>> result_;
  std::exception_ptr first_;
  bool first_present_=false,finished_=false;
  Read(std::shared_ptr<State>,uint64_t);
  public:
  ~Read();
  Read(const Read&)=delete;
  Read&operator=(const Read&)=delete;
  void current()const;
  bool cancelled()const noexcept;
  // Owned exact original bytes, retained BEFORE any post-read current check.
  // No decoding, price reconstruction or receipt/authority promotion.
  void retain_result(std::vector<uint8_t>);
  std::shared_ptr<const std::vector<uint8_t>> retained_result();
  void fail(std::exception_ptr)noexcept;
  void finish()noexcept;
 };
 private:
 std::shared_ptr<State> state_;
 public:
 ReadCustody();
 ~ReadCustody();
 ReadCustody(const ReadCustody&)=delete;
 ReadCustody&operator=(const ReadCustody&)=delete;
 std::shared_ptr<Read> begin();
 void lifecycle_current()const; // NOT ProductSource qualification/current.
 void retire()noexcept;
 void join();
 // Called only after an actual downstream close has settled. Selection is
 // one-shot; failure never permits a second uncertain close attempt.
 void select_close();
 void settle_close(std::exception_ptr,bool error_present)noexcept;
 bool closed()const noexcept;
 bool close_selected()const noexcept;
 size_t active()const noexcept;
 void assert_safe_to_close()const;
};
}
