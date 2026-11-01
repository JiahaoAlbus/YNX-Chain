// PUBLIC in-process C/C++ -> original Go LocalCallerClient transport controls.
// No QualifiedPayChannel, Main Source, wallet keys, business action or Root is
// constructed here. The original native Source owner supplies production fences.
#include "private_client_v1.h"
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

extern "C" ynx_link_private_client_registration_v1 *ynx_link_private_fixture_registration_v1(uint32_t mode);
extern "C" ynx_link_private_client_registration_borrow_v1 *ynx_link_private_fixture_borrow_v1(uint32_t mode);
extern "C" int32_t ynx_link_private_fixture_finish_v1(void);

namespace {
struct NativeSource {
    std::atomic<int32_t> native_error{0};
    std::atomic<int32_t> borrows{0};
    std::atomic<int32_t> checks{0};
    std::atomic<int32_t> releases{0};
    std::atomic<int32_t> fail_after_retain{0};
};
// Deliberately process-lifetime owners. A retained error partial is never made
// to appear released by destructing its original context before the assertion.
auto *original_sources = new std::vector<std::unique_ptr<NativeSource>>();
int32_t native_current(void *ctx) {
    auto *source = static_cast<NativeSource *>(ctx);
    source->checks.fetch_add(1);
    return source->native_error.load();
}
int32_t native_retain(void *ctx) {
    auto *source = static_cast<NativeSource *>(ctx);
    const auto code = source->native_error.load();
    if (code) return code;
    source->borrows.fetch_add(1);
    if (source->fail_after_retain) source->native_error = 52;
    return 0;
}
void native_release(void *ctx) {
    auto *source = static_cast<NativeSource *>(ctx);
    if (source->borrows.fetch_sub(1) <= 0) std::abort();
    source->releases.fetch_add(1);
}
NativeSource *source() {
    original_sources->emplace_back(std::make_unique<NativeSource>());
    return original_sources->back().get();
}
ynx_link_private_client_source_fence_v1 fence(NativeSource *owner) {
    return {owner, native_current, native_retain, native_release};
}
void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
std::string text(const uint8_t *value, size_t size) {
    require(size == 0 || value != nullptr, "owned DATA pointer missing");
    return size ? std::string(reinterpret_cast<const char *>(value), size) : std::string{};
}
struct Packet {
    ynx_link_private_client_packet_v1 *value = nullptr;
    ~Packet() { if (value) ynx_link_private_client_packet_free_v1(value); }
    Packet() = default;
    Packet(const Packet &) = delete;
    Packet &operator=(const Packet &) = delete;
};
ynx_link_private_client_holder_v1 *capture(ynx_link_private_client_registration_v1 *registration, NativeSource *owner, uint8_t query = 0) {
    auto selected = fence(owner);
    ynx_link_private_client_holder_v1 *holder = nullptr;
    const auto error = ynx_link_private_client_capture_v1(registration, &selected, query, &holder);
    // Retain the original out pointer BEFORE interpreting the return code.
    require(holder != nullptr, "capture discarded an owned holder");
    require(error == 0, "actual registered capture refused");
    require(owner->borrows == 1, "capture did not retain exactly one native borrow");
    return holder;
}
void drain(ynx_link_private_client_holder_v1 *holder, NativeSource *owner) {
    require(ynx_link_private_client_retire_v1(holder) == 0, "actual retire failed");
    require(ynx_link_private_client_current_local_v1(holder) != 0, "retired local caller remained current");
    require(ynx_link_private_client_join_v1(holder, 3000) == 0, "actual Join failed");
    require(owner->borrows == 1, "Join released native Source before Close/free");
    require(ynx_link_private_client_close_v1(holder) == 0, "actual Close failed");
    require(ynx_link_private_client_free_v1(holder) == 0, "drained holder free failed");
    require(owner->borrows == 0 && owner->releases == 1, "original Source release was missing or repeated");
}
void original_five_operations() {
    auto *registration = ynx_link_private_fixture_registration_v1(0);
    require(registration != nullptr, "normal Go fixture registration absent");
    const std::string json = "{ \"PUBLIC\":\"exact original bytes\" }\n";
    const std::vector<uint8_t> bytes(json.begin(), json.end());
    const std::string intent = "npi_" + std::string(48, 'a');
    const std::string invoice = "/v5/pay/invoices/0x" + std::string(40, '2') + "/original-invoice";
    const std::vector<std::string> actual_paths{
        "/v5/pay/invoice-intents/" + intent + "/merchant-member",
        invoice + "/settlements", invoice + "/refunds",
        "/v5/pay/invoice-intents/" + intent, invoice
    };
    for (uint8_t op = 0; op < 5; ++op) {
        auto *owner = source();
        auto *holder = capture(registration, owner);
        require(ynx_link_private_client_current_local_v1(holder) == 0, "local native lifetime failed");
        require(ynx_link_private_client_current_source_v1(holder) == 0, "original native Source current failed");
        require(ynx_link_private_client_recheck_v1(holder) == 0, "original native Source recheck failed");
        Packet packet;
        const auto before = owner->checks.load();
        const auto code = ynx_link_private_client_call_v1(holder, op, op < 3 ? bytes.data() : nullptr, op < 3 ? bytes.size() : 0, &packet.value);
        // Owned packet + any late error must both be retained; never discard
        // packet first simply because the C return code is nonzero.
        require(packet.value != nullptr, "Call discarded its owned packet");
        require(code == 0 && packet.value->error_code == 0, "actual original operation failed");
        require(packet.value->packet_present == 1, "original response was not retained");
        require(packet.value->status_code == 200, "actual HTTP status changed");
        require(text(packet.value->method, packet.value->method_size) == (op < 3 ? "POST" : "GET"), "actual request method changed");
        require(text(packet.value->request_path, packet.value->request_path_size) == actual_paths[op], "actual request target changed");
        const auto headers = text(packet.value->header_json, packet.value->header_json_size);
        require(headers.find("first") != std::string::npos && headers.find("second") != std::string::npos, "original multi-value headers collapsed");
        require(text(packet.value->content_type, packet.value->content_type_size) == "application/json", "original MIME changed");
        require(text(packet.value->cache_control, packet.value->cache_control_size) == "no-store", "original cache control changed");
        require(text(packet.value->body, packet.value->body_size) == "{\"PUBLIC\":\"original packet\"}", "original response bytes reencoded");
        require(owner->checks > before, "Call did not consult its actual native Source fence");
        drain(holder, owner);
    }
    std::cout << "{\"control\":\"five-actual-operations\",\"passed\":true,\"nativeReleaseCount\":1}\n";
}
void queries_and_local_refusals() {
    auto *registration = ynx_link_private_fixture_registration_v1(0);
    auto *owner = source();
    auto *holder = capture(registration, owner, 1);
    for (uint8_t op = 0; op < 3; ++op) {
        Packet packet;
        const uint8_t body[] = {'{', '}'};
        require(ynx_link_private_client_call_v1(holder, op, body, sizeof(body), &packet.value) != 0, "query-only holder dispatched POST");
        require(packet.value && !packet.value->dispatch_possible && !packet.value->packet_present, "query-only refusal invented dispatch/response");
    }
    drain(holder, owner);
    auto *writer = source();
    holder = capture(registration, writer);
    Packet packet;
    const uint8_t byte = 'x';
    require(ynx_link_private_client_call_v1(holder, 3, &byte, 1, &packet.value) != 0, "GET accepted a request body");
    require(packet.value && !packet.value->dispatch_possible, "invalid GET was marked sent");
    drain(holder, writer);
    auto *revoked = source();
    holder = capture(registration, revoked);
    revoked->native_error = 51;
    require(ynx_link_private_client_current_source_v1(holder) != 0, "native revocation was not observed");
    Packet refused;
    require(ynx_link_private_client_call_v1(holder, 0, &byte, 1, &refused.value) != 0, "revoked Source dispatched request");
    require(refused.value && !refused.value->dispatch_possible, "pre-write native refusal became uncertain dispatch");
    drain(holder, revoked);
    std::cout << "{\"control\":\"query-get-source-refusals\",\"passed\":true}\n";
}
void packet_and_late_error() {
    auto *registration = ynx_link_private_fixture_registration_v1(1);
    require(registration != nullptr, "late-error Go registration absent");
    auto *owner = source();
    auto *holder = capture(registration, owner);
    const uint8_t request[] = {'{', '}'};
    Packet packet;
    const auto code = ynx_link_private_client_call_v1(holder, 0, request, sizeof(request), &packet.value);
    require(packet.value != nullptr, "late failure discarded owned packet");
    require(code != 0 && packet.value->error_code != 0, "actual truncated response error disappeared");
    require(packet.value->packet_present && packet.value->dispatch_possible, "actual late response became non-dispatch");
    require(packet.value->status_code != 0 && packet.value->header_json_size != 0, "late packet lost original status/headers");
    require(text(packet.value->body, packet.value->body_size) == "abc", "late response prefix was discarded/replaced");
    Packet first;
    require(ynx_link_private_client_error_v1(holder, &first.value) != 0 && first.value, "sticky first error missing");
    require(first.value->error_code == packet.value->error_code, "sticky first error changed");
    drain(holder, owner);
    std::cout << "{\"control\":\"packet-and-late-error\",\"passed\":true,\"partialBodyBytes\":3}\n";
}
void capture_error_partials() {
    auto *registration = ynx_link_private_fixture_registration_v1(0);
    for (const bool retained : {false, true}) {
        auto *owner = source();
        if (retained) owner->fail_after_retain = 1;
        else owner->native_error = 51;
        auto original = fence(owner);
        ynx_link_private_client_holder_v1 *holder = nullptr;
        const auto code = ynx_link_private_client_capture_v1(registration, &original, 0, &holder);
        require(holder != nullptr, "failed capture discarded its original owned partial");
        require(code != 0, "failed original native Source became a transport grant");
        require(owner->borrows == (retained ? 1 : 0), "capture borrow ownership was lost on error");
        Packet first;
        require(ynx_link_private_client_error_v1(holder, &first.value) != 0 && first.value, "capture first cause missing");
        require(first.value->native_current_code == (retained ? 52 : 51), "capture native first cause was replaced");
        require(ynx_link_private_client_retire_v1(holder) == 0, "partial retire failed");
        require(ynx_link_private_client_join_v1(holder, 3000) == 0, "partial actual Join failed");
        require(ynx_link_private_client_close_v1(holder) == 0, "partial actual Close failed");
        require(owner->borrows == (retained ? 1 : 0), "partial Source released before explicit free");
        require(ynx_link_private_client_free_v1(holder) == 0, "partial native holder could not free after drain");
        require(owner->borrows == 0 && owner->releases == (retained ? 1 : 0), "partial released an unowned or duplicate Source borrow");
    }
    std::cout << "{\"control\":\"capture-error-partial-native-borrow\",\"passed\":true,\"retainedBeforeError\":true}\n";
}
void retained_close_debt() {
    auto *registration = ynx_link_private_fixture_registration_v1(2);
    auto *owner = source();
    auto *holder = capture(registration, owner);
    require(ynx_link_private_client_close_v1(holder) != 0, "Close fabricated a Join");
    require(owner->borrows == 1 && owner->releases == 0, "failed Close released native Source custody");
    require(ynx_link_private_client_free_v1(holder) != 0, "free removed an undrained holder");
    require(owner->borrows == 1 && owner->releases == 0, "failed free released original Source context");
    // Draining is a known precondition failure, not an attempted actual Close.
    // Keep its first cause while a later real Join permits the first Close.
    require(ynx_link_private_client_retire_v1(holder) == 0, "debt retire failed");
    require(ynx_link_private_client_join_v1(holder, 3000) == 0, "debt actual Join failed");
    require(owner->borrows == 1 && owner->releases == 0, "Join released Source before actual Close");
    require(ynx_link_private_client_close_v1(holder) == 0, "first actual Close after real Join failed");
    Packet first;
    require(ynx_link_private_client_error_v1(holder, &first.value) != 0 && first.value, "early Draining first cause disappeared");
    require(first.value->error_code == YNX_LINK_PRIVATE_DRAINING_V1, "early Draining was replaced by later cleanup status");
    require(owner->borrows == 1 && owner->releases == 0, "actual Close released Source before free");
    require(ynx_link_private_client_free_v1(holder) == 0, "drained closed holder could not free");
    require(owner->borrows == 0 && owner->releases == 1, "actual cleanup did not release original Source exactly once");
    std::cout << "{\"control\":\"close-debt-retains-original-source\",\"passed\":true,\"earlyDraining\":true,\"retainedUntilActualClose\":true,\"finalBorrowCount\":0,\"nativeReleaseCount\":1}\n";
}
void actual_registration_borrow() {
    auto *borrow = ynx_link_private_fixture_borrow_v1(0);
    require(borrow != nullptr, "normal Go owner did not mint actual registration borrow");
    require(ynx_link_private_client_registration_borrow_current_v1(borrow) == 0, "new original registration borrow was not current");
    ynx_link_private_client_registration_v1 *registration = nullptr;
    require(ynx_link_private_client_registration_from_borrow_v1(borrow, &registration) == 0 && registration, "held native borrow did not expose original registration");
    auto *owner = source();
    auto *holder = capture(registration, owner, 1);
    Packet packet;
    require(ynx_link_private_client_call_v1(holder, 3, nullptr, 0, &packet.value) == 0 && packet.value && packet.value->packet_present, "borrowed original registration could not perform fixed GET");
    drain(holder, owner);
    // The Go registration parent must still retain this native SourceLease
    // borrow, although this particular child has already drained and freed.
    require(ynx_link_private_fixture_finish_v1() != 0, "parent closed through an outstanding native registration borrow");
    require(ynx_link_private_client_registration_borrow_current_v1(borrow) != 0, "retired parent left native registration current");
    require(ynx_link_private_client_registration_borrow_release_v1(borrow) == 0, "original registration borrow release failed");
    require(ynx_link_private_client_registration_borrow_release_v1(borrow) != 0, "released registration borrow could be dropped twice");
    std::cout << "{\"control\":\"actual-registration-borrow-retains-parent\",\"passed\":true,\"parentCloseRefusedUntilBorrowRelease\":true}\n";
}
void subset_registration() {
    auto *registration = ynx_link_private_fixture_registration_v1(3);
    require(registration != nullptr, "actual subset registration absent");
    const std::string invoice = "/v5/pay/invoices/0x" + std::string(40, '2') + "/original-invoice";
    const uint8_t body[] = {'{', '}'};
    for (uint8_t op : {uint8_t{0}, uint8_t{3}}) {
        auto *owner = source();
        auto *holder = capture(registration, owner);
        Packet packet;
        require(ynx_link_private_client_call_v1(holder, op, op < 3 ? body : nullptr, op < 3 ? sizeof(body) : 0, &packet.value) != 0, "disabled absent-intent operation was dispatched");
        require(packet.value && !packet.value->dispatch_possible && !packet.value->packet_present, "disabled absent-intent slot invented a response");
        drain(holder, owner);
    }
    for (uint8_t op : {uint8_t{1}, uint8_t{2}, uint8_t{4}}) {
        auto *owner = source();
        auto *holder = capture(registration, owner, op == 4 ? 1 : 0);
        Packet packet;
        require(ynx_link_private_client_call_v1(holder, op, op < 3 ? body : nullptr, op < 3 ? sizeof(body) : 0, &packet.value) == 0, "enabled original invoice subset operation refused");
        require(packet.value && packet.value->packet_present && packet.value->status_code == 200, "actual subset response missing");
        const auto expected = invoice + (op == 1 ? "/settlements" : op == 2 ? "/refunds" : "");
        require(text(packet.value->request_path, packet.value->request_path_size) == expected, "subset retargeted the original invoice path");
        drain(holder, owner);
    }
    require(ynx_link_private_fixture_finish_v1() == 0, "actual subset registration did not drain");
    std::cout << "{\"control\":\"fixed-subset-registration\",\"passed\":true,\"enabledSlots\":[1,2,4],\"disabledSlots\":[0,3],\"inventedIntent\":false,\"fixtureDrained\":true}\n";
}
} // namespace

int main(int argc, char **argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--subset") {
            subset_registration();
            return 0;
        }
        require(argc == 1, "unknown private transport control selection");
        original_five_operations();
        queries_and_local_refusals();
        packet_and_late_error();
        capture_error_partials();
        retained_close_debt();
        actual_registration_borrow();
        require(ynx_link_private_fixture_finish_v1() == 0, "fixture failed actual child/registration drain");
        std::cout << "{\"transportOnly\":true,\"businessSourceQualified\":false,\"RootAdmission\":false,\"fixtureDrained\":true,\"earlyDrainingCauseRetained\":true}\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "FIRSTCAUSE: " << error.what() << '\n';
        (void)ynx_link_private_fixture_finish_v1();
        // Do not destruct process-lifetime original contexts retained by a
        // failed holder. Neither the test nor a helper fabricates their drain.
        std::cerr.flush();
        std::_Exit(1);
    }
}
