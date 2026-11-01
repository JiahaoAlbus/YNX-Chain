#pragma once
#include "ProtectedMobilePQ.h"
#include <cstdint>
#include <thread>
#include <string>
#include <vector>
#include <atomic>
#include <memory>
namespace ynx::mobilepq {
constexpr size_t MemberMax=98304, PublicMax=2097152;
struct Cause { bool present=false; int32_t code=0; };
struct Outcome {
 std::string state="unprepared";
 bool signEntered=false, submitEntered=false, restoreEntered=false, storageConfirmed=false, memberRetained=false;
 bool queryEntered=false, querySelected=false, submissionSelected=false, reviewSelected=false, cancelled=false, closed=false;
 int32_t primitiveStatus=-1; uint32_t primitiveCleanup=0;
 Cause firstCause,cleanupCause;
 bool projectionAvailable=false;YNXMobilePQProjection projection{};
 // Native-only retained originals. JSI must never export these vectors.
 std::vector<uint8_t> member,review,submission,query;
};
/* Never owned by JS numbers. The module worker retains each session, including
 * failed partials, until release succeeds. No destructor guesses cleanup. */
class CustodySession final {
 public:
  explicit CustodySession(uint32_t mode,std::shared_ptr<std::atomic<bool>> runtimeLive=nullptr);
  ~CustodySession()=default;
  CustodySession(const CustodySession&)=delete;
  bool prepare(const std::string& reference);
  bool signOnce();
  bool submitSignedOnce();
  bool queryOriginal();
  bool restoreRegisteredEmptyOnce();
  bool saveOriginal(); // local ACK only; never a replacement signature/send
  bool cancel();
  bool retire();
  bool close();
  Outcome copyOriginalPublicOutcome() const;
  Outcome copyProjection() const;
  bool released() const { return released_; }
  // Revocation requests may arrive on JS while the worker is busy. These only
  // close gates, never call Auth/crypto or publish an outcome off-thread.
  void requestCancel(){cancelRequested_.store(true);}
  void requestRetire(){retireRequested_.store(true);}
 private:
  bool thread() const;
  bool fail(int32_t code); bool cleanup(int32_t code);
  bool current(uint32_t phase);
  bool open(); bool releaseLoan(); bool captureMember();
  bool copyPublic(uint32_t kind,std::vector<uint8_t>& out,bool& selected);
  bool projection();
  bool retireOwned();
  std::thread::id thread_; uint32_t mode_;
  YNXMobilePQCapture* capture_=nullptr; YNXMobilePQLoan* loan_=nullptr;
  uint64_t owner_=0; bool prepared_=false,retired_=false,released_=false;
  bool busy_=false,closeEntered_=false,ownerClosed_=false;
  std::atomic<bool> cancelRequested_{false},retireRequested_{false};
  std::shared_ptr<std::atomic<bool>> runtimeLive_;
  YNXMobilePQInputs inputs_{}; Outcome outcome_;
};
}
