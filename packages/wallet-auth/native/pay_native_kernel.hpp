#pragma once
#include <cstdint>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace ynx::wallet::pay {
enum class Kind { terms, settlement, refund };
enum class Operation { post_terms, post_settlement, post_refund, get_intent, get_invoice };
enum class ProtectedPurpose {pay_query,invoice_terms,invoice_settlement,invoice_refund};
struct Target final {
 uint32_t version=1;
 std::string service="pay";
 Kind kind=Kind::terms;
 std::optional<std::string> intent_id,merchant,invoice_id;
 std::string request_path;
 bool operator==(const Target&)const;
};
struct Binding final {
 std::string network_id,account,hash,member_hash,operation_id;
 Target target;
 bool operator==(const Binding&)const;
};
struct Packet final {
 std::string method,request_path,content_type,cache_control;
 uint32_t status=0;
 std::vector<uint8_t> body;
};
struct Failure final {std::string code;};
struct Exchange final {std::optional<Packet>packet;std::optional<Failure>error;};

// PRIVATE native-only upstream ABI, not an SDK provider/JSON setter. P01's
// normal protected inventory must return this from its genuine selected account
// and original signed-member custody. The class is never constructed from JS.
// A normal implementation must independently check Root/approval/current and
// both original hashes. Query loans MUST NOT approve/sign/open private keys.
class ProtectedLoan {
public:
 virtual ~ProtectedLoan()=default;
 virtual Binding read_original()const=0;
 virtual bool query_only()const noexcept=0;
 virtual ProtectedPurpose protected_purpose()const noexcept=0;
 virtual std::vector<uint8_t> read_original_member()const=0;
 virtual std::vector<uint8_t> read_original_envelope()const=0;
 virtual void current()=0;
 virtual void recheck()=0;
 // Actual registered Pay Source/LINK only, no Core transfer/fetch fallback.
 // Never retries. A supplied raw packet is retained even with a late failure.
 virtual Exchange exchange(Operation)=0;
 virtual void retire()=0;
 virtual void join()=0;
 virtual void close()=0;
 // Includes original actor-side Main child debt even after native channel
 // close succeeded. A failed/unsettled actor Promise cannot authorize free.
 virtual bool cleanup_debt_retained()const noexcept{return false;}
protected: ProtectedLoan()=default;
};

class Owner final {
public:
 Owner(Binding selector,bool query);
 ~Owner();
 Owner(const Owner&)=delete;Owner&operator=(const Owner&)=delete;
 // Adopt before interpreting upstream error; no native partial is abandoned.
 void adopt(std::unique_ptr<ProtectedLoan>);
 void initialize();
 Binding read_original();
 void current();void recheck();
 Packet packet(Operation,const Target&,const std::vector<uint8_t>&member);
 void retire();void join();void close();void drain_partial();
 std::optional<Packet> retained_packet()const;
 std::optional<Failure> first_failure()const;
 void fail(std::string);
private:
 void check_locked();void remember_locked(const Failure&);
 mutable std::mutex mutex_;
 std::condition_variable changed_;
 Binding selected_;bool query_,ready_=false,retired_=false;
 bool attempted_=false,joined_=false,close_selected_=false;
 bool close_attempted_=false;
 size_t in_flight_=0;
 std::unique_ptr<ProtectedLoan> loan_;
 std::vector<uint8_t> member_;
 std::optional<Failure> first_,close_first_;
 std::optional<Packet> packet_;
};
void validate_binding(const Binding&);
std::string hash_original(const std::vector<uint8_t>&);
std::string method(Operation);std::string path(Operation,const Target&);
} // namespace
