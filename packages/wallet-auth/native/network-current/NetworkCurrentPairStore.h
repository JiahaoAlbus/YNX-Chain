#pragma once
#include "original-host-dirfd-journal.h"
#include <memory>
#include <exception>
#include <string>
#include <vector>
#include <cstdint>
#include <thread>

// Private storage ONLY. Original Root capture supplies the held journal and
// op64; this library has no path-opening constructor or Source/grant factory.
namespace ynx::auth::network_current {
struct PairIntent {
 std::string originalOperation64;
 std::string resourceKey;
 std::string protectedResourceRef;
 std::string descriptorOriginal;
 std::string bindingOriginal;
 std::string current9Original;
 std::string statementE8Original; // binary SOLE E8, not JSON reinterpretation
};
enum class PairQueryState { unknown, entered_only, complete };
struct PairQuery {
 PairQueryState state=PairQueryState::unknown;
 std::string current9Original;
 std::string envelopeOriginal; // public partial retained before a late error
 std::exception_ptr error;
};
std::string encodeOriginalCurrentPairIntent(const PairIntent&);

class NetworkCurrentPairStore {
 std::shared_ptr<ynx_auth_private::HostDirfdJournal> journal_;
 PairIntent intent_;
 std::string entered_,expectedEnvelope_;
 bool signingSelected_=false,enteredRetained_=false;
 bool publicationSelected_=false,published_=false,retired_=false;
 bool closeSelected_=false,closeResult_=false;
 std::exception_ptr first_;
 const std::thread::id thread_=std::this_thread::get_id();
 void thread()const;
 [[noreturn]] void reject(const char*);
 void current();
 void matching(const std::string&,const std::string&)const;
 void remember(std::exception_ptr);
public:
 NetworkCurrentPairStore(std::shared_ptr<ynx_auth_private::HostDirfdJournal>,PairIntent);
 NetworkCurrentPairStore(const NetworkCurrentPairStore&)=delete;
 NetworkCurrentPairStore&operator=(const NetworkCurrentPairStore&)=delete;
 void retainSigningIntentOnce();
 // No third record / fictional transaction: durable entered is already the
 // immutable before-IO marker for this SAME terminal operation.
 void retainPublicationIntentOnce(const std::string&current9,const std::string&envelope);
 void publishOriginalPairOnce(const std::string&current9,const std::string&envelope);
 PairQuery readOriginalPair();
 // A poisoned writer cannot be read by pretending its unknown bit is reset.
 // Use separately held Root-selected recovery reader below, after its genuine
 // lock/owner transition. This method only reports the original local state.
 PairQuery querySameOriginalLocal()const;
 void retire();
 void join(); // synchronous primitive; no background worker can outlive a call
 bool close();
 bool unknown()const{thread();return bool(first_);}
 std::exception_ptr firstCause()const{thread();return first_;}
};

// Existing-only readonly owner is acquired by Root's original recovery path.
// Caller must revalidate Root/descriptor/current qualification independently;
// these bytes never revive a private key or grant a renewed effect window.
class NetworkCurrentPairRecoveryReader {
 std::shared_ptr<ynx_auth_private::HostDirfdJournal> reader_;
 PairIntent intent_;
 std::string entered_;
 bool closeSelected_=false,closeResult_=false;
 std::exception_ptr first_;
 const std::thread::id thread_=std::this_thread::get_id();
public:
 NetworkCurrentPairRecoveryReader(std::shared_ptr<ynx_auth_private::HostDirfdJournal>,PairIntent);
 PairQuery querySameOriginal();
 bool close();
};
}
