// PUBLIC startup-only integration. Production Auth context/loan/Source code is
// linked unchanged. The reviewed Auth PUBLIC Root-profile boundary is explicit;
// neither this server nor an HTTP packet is Root/Source qualification.
#include "private_client_startup_v1.h"
#include "pay_native_actual_context_private.hpp"
#include "pay_native_runtime_private.hpp"
#include "pay_root_transport_loan_private.hpp"
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <iostream>
#include <memory>
#include <poll.h>
#include <stdexcept>
#include <string>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <thread>
#include <unistd.h>
#include <utility>
#include <vector>

namespace {
void require(bool value, const char *message) {
    if (!value) throw std::runtime_error(message);
}
std::string public_original_read_path() {
    return "/v5/pay/invoices/0x" + std::string(40, '2') + "/original-invoice";
}

// One owned endpoint, one fixed GET. This is not a startup config installer or
// another daemon. It only witnesses that the original Go factory used the
// immutable profile returned by Auth's actual loan/context getters.
class PublicUnixServer final {
    int listener_ = -1;
    bool bound_ = false;
    std::atomic<bool> stop_{false};
    std::thread worker_;
    std::string directory_, socket_, request_;
    std::exception_ptr failure_;

    void serve() noexcept {
        try {
            const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(8);
            int connection = -1;
            while (!stop_.load() && std::chrono::steady_clock::now() < until) {
                pollfd waiting{listener_, POLLIN, 0};
                const auto n = ::poll(&waiting, 1, 50);
                if (n < 0 && errno == EINTR) continue;
                require(n >= 0, "PUBLIC Unix poll failed");
                if (!n) continue;
                if (stop_.load()) return;
                connection = ::accept(listener_, nullptr, nullptr);
                require(connection >= 0, "PUBLIC Unix accept failed");
                break;
            }
            if (stop_.load()) return;
            require(connection >= 0, "PUBLIC Unix GET never arrived");
            struct Close { int fd; ~Close() { ::close(fd); } } close{connection};
            timeval timeout{2, 0};
            require(::setsockopt(connection, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof timeout) == 0,
                    "PUBLIC Unix read timeout failed");
            require(::setsockopt(connection, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof timeout) == 0,
                    "PUBLIC Unix write timeout failed");
#ifdef __APPLE__
            int no_sigpipe = 1;
            require(::setsockopt(connection, SOL_SOCKET, SO_NOSIGPIPE, &no_sigpipe, sizeof no_sigpipe) == 0,
                    "PUBLIC Unix SIGPIPE bound failed");
#endif
            while (request_.find("\r\n\r\n") == std::string::npos && request_.size() < 16384) {
                require(std::chrono::steady_clock::now() < until, "PUBLIC Unix total read deadline elapsed");
                char data[1024];
                const auto n = ::recv(connection, data, sizeof data, 0);
                if (n < 0 && errno == EINTR) continue;
                require(n > 0, "PUBLIC Unix request was incomplete");
                request_.append(data, static_cast<size_t>(n));
            }
            require(request_.find("\r\n\r\n") != std::string::npos && request_.size() <= 16384,
                    "PUBLIC Unix header bound exceeded");
            require(request_.rfind("GET " + public_original_read_path() + " HTTP/1.1\r\n", 0) == 0,
                    "startup factory changed the fixed original GET");
            const std::string response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                "Cache-Control: no-store\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}";
            size_t sent = 0;
            while (sent < response.size()) {
                require(std::chrono::steady_clock::now() < until, "PUBLIC Unix total write deadline elapsed");
#ifdef MSG_NOSIGNAL
                constexpr int flags = MSG_NOSIGNAL;
#else
                constexpr int flags = 0;
#endif
                const auto n = ::send(connection, response.data() + sent, response.size() - sent, flags);
                if (n < 0 && errno == EINTR) continue;
                require(n > 0, "PUBLIC Unix response write failed");
                sent += static_cast<size_t>(n);
            }
        } catch (...) { failure_ = std::current_exception(); }
    }

public:
    PublicUnixServer() {
        try {
#ifdef __APPLE__
        char pattern[] = "/private/tmp/ynx-ls-XXXXXX";
#else
        char pattern[] = "/tmp/ynx-ls-XXXXXX";
#endif
        auto *created = ::mkdtemp(pattern);
        require(created != nullptr, "PUBLIC private directory creation failed");
        directory_ = created;
        socket_ = directory_ + "/s";
        require(::chmod(directory_.c_str(), 0700) == 0, "PUBLIC private directory mode failed");
        listener_ = ::socket(AF_UNIX, SOCK_STREAM, 0);
        require(listener_ >= 0, "PUBLIC Unix listener creation failed");
        sockaddr_un address{};
        address.sun_family = AF_UNIX;
        require(socket_.size() < sizeof address.sun_path, "PUBLIC Unix path exceeded platform bound");
        std::memcpy(address.sun_path, socket_.c_str(), socket_.size() + 1);
        require(::bind(listener_, reinterpret_cast<sockaddr *>(&address), sizeof address) == 0,
                "PUBLIC Unix bind failed");
        bound_ = true;
        require(::chmod(socket_.c_str(), 0600) == 0, "PUBLIC Unix endpoint mode failed");
        require(::listen(listener_, 1) == 0, "PUBLIC Unix listen failed");
        worker_ = std::thread([this] { serve(); });
    } catch (...) {
        if (listener_ >= 0) ::close(listener_);
        if (bound_) ::unlink(socket_.c_str());
        if (!directory_.empty()) ::rmdir(directory_.c_str());
        throw;
        }
    }
    PublicUnixServer(const PublicUnixServer &) = delete;
    PublicUnixServer &operator=(const PublicUnixServer &) = delete;
    ~PublicUnixServer() {
        stop_ = true;
        if (listener_ >= 0) ::shutdown(listener_, SHUT_RDWR);
        if (worker_.joinable()) worker_.join();
        if (listener_ >= 0) ::close(listener_);
        // Only this test's successfully created private directory/endpoint.
        if (bound_) ::unlink(socket_.c_str());
        if (!directory_.empty()) ::rmdir(directory_.c_str());
    }
    const std::string &socket_path() const noexcept { return socket_; }
    void join_original_get() {
        require(worker_.joinable(), "PUBLIC Unix worker already joined");
        worker_.join();
        if (failure_) std::rethrow_exception(failure_);
        require(request_.find("\r\nHost: public-native-startup\r\n") != std::string::npos,
                "Go startup did not use Auth's original service");
    }
};

struct PublicRoot final : ynx::wallet::pay::OriginalRootSource {
    const ynx::wallet::pay::Binding original;
    const std::string socket;
    std::atomic<int32_t> dead{0};
    PublicRoot(ynx::wallet::pay::Binding binding, std::string endpoint)
        : original(std::move(binding)), socket(std::move(endpoint)) {}
    int32_t current_native() noexcept override { return dead.load(); }
    bool matches_original_binding(const ynx::wallet::pay::Binding &value, bool query) noexcept override {
        return !dead.load() && query && value == original;
    }
};
// Actual operational Root admission stays false. This is the SAME explicit
// PUBLIC qualification seam used by Auth's own transport-loan control: only the
// Root profile producer boundary is supplied here. Its loan/context/Source
// inventory, getters, fence and constructor implementations are unchanged.
auto *public_roots = new std::vector<std::shared_ptr<PublicRoot>>();

ynx::wallet::pay::Binding original_binding() {
    using namespace ynx::wallet::pay;
    Binding value;
    value.network_id = std::string(64, '1');
    value.account = "0x" + std::string(40, '3');
    value.hash = "0x" + std::string(64, '4');
    value.member_hash = "0x" + std::string(64, '5');
    value.operation_id = "PUBLIC-original-startup";
    value.target.kind = Kind::settlement;
    value.target.merchant = "0x" + std::string(40, '2');
    value.target.invoice_id = "original-invoice";
    value.target.request_path = public_original_read_path() + "/settlements";
    validate_binding(value);
    return value;
}

struct Packet final {
    ynx_link_private_client_packet_v1 *value = nullptr;
    ~Packet() { if (value) ynx_link_private_client_packet_free_v1(value); }
};
std::string bytes(const uint8_t *value, size_t size) {
    require(!size || value, "owned startup packet DATA pointer missing");
    return size ? std::string(reinterpret_cast<const char *>(value), size) : std::string{};
}
void cleanup_startup(ynx_link_pay_native_startup_v1 *startup) {
    // A rejection before acquiring any owner may have a null output.
    if (!startup) return;
    require(ynx_link_pay_native_startup_retire_v1(startup) == 0, "startup partial retire failed");
    require(ynx_link_pay_native_startup_join_v1(startup, 3000) == 0, "startup partial Join failed");
    require(ynx_link_pay_native_startup_close_v1(startup) == 0, "startup partial Close failed");
    require(ynx_link_pay_native_startup_closed_v1(startup) == 1, "startup claimed cleanup before physical close");
    require(ynx_link_pay_native_startup_free_v1(startup) == 0, "startup partial free failed");
}
void denied_contexts() {
    ynx_link_pay_native_startup_v1 *foreign = nullptr;
    require(ynx_link_pay_native_startup_open_v1(
                reinterpret_cast<ynx_wallet_pay_actual_context_v1 *>(uintptr_t{1}), &foreign) != 0,
            "foreign context pointer became a startup profile");
    // Always adopt first: an open error may already own native/Go cleanup.
    cleanup_startup(foreign);

    auto root = std::make_shared<PublicRoot>(original_binding(), "/private/PUBLIC-never-dial.sock");
    public_roots->push_back(root);
    auto main = std::make_shared<ynx::wallet::pay::MainNativeEpoch>();
    ynx_wallet_pay_actual_context_v1 *context = nullptr;
    const auto captured = ynx::wallet::pay::capture_original_pay_actual_context(
        root, main, root->original, true, &context);
    require(context != nullptr, "Auth context capture discarded a partial");
    require(captured == 0, "Auth actual context capture failed");
    ynx_wallet_pay_ctx_retire_v1(context);
    ynx_link_pay_native_startup_v1 *retired = nullptr;
    require(ynx_link_pay_native_startup_open_v1(context, &retired) != 0,
            "retired authentic context opened a new startup");
    cleanup_startup(retired);
    require(ynx_wallet_pay_ctx_close_v1(context) == 0 && ynx_wallet_pay_ctx_closed_v1(context) == 1,
            "retired context's original owner could not close after startup drain");
}

void actual_startup_pipeline() {
    using namespace ynx::wallet::pay;
    // Heap ownership preserves original contexts/server on FIRSTCAUSE; no
    // finalizer is allowed to fabricate cleanup after an uncertain failure.
    auto *server = new PublicUnixServer;
    auto root = std::make_shared<PublicRoot>(original_binding(), server->socket_path());
    public_roots->push_back(root);
    auto main = std::make_shared<MainNativeEpoch>();
    ynx_wallet_pay_actual_context_v1 *context = nullptr;
    const auto captured = capture_original_pay_actual_context(root, main, root->original, true, &context);
    require(context != nullptr, "Auth context capture lost its owned output");
    require(captured == 0, "Auth actual Root/Main/binding context capture refused");
    ynx_wallet_pay_root_transport_loan_v1 *loan = nullptr, *same = nullptr;
    require(ynx_wallet_pay_ctx_get_original_loan_v1(context, &loan) == 0 && loan,
            "actual context did not retain its original transport loan");
    require(ynx_wallet_pay_ctx_get_original_loan_v1(context, &same) == 0 && same == loan,
            "actual context replaced its fixed original loan");

    ynx_link_pay_native_startup_v1 *startup = nullptr;
    const auto opened = ynx_link_pay_native_startup_open_v1(context, &startup);
    require(startup != nullptr, "Go startup open discarded its original owner");
    require(opened == 0, "ctx-only Go New/Register/Borrow startup refused");
    ynx_wallet_pay_source_lease_v1 *source = nullptr;
    const auto adopted = ynx_link_pay_native_startup_adopt_source_v1(startup, &source);
    require(source != nullptr, "actual Auth constructor discarded its original Source output");
    require(adopted == 0, "actual fixed Auth Source constructor refused the original borrow");
    require(ynx_wallet_pay_source_lease_current_v1(source) == 0,
            "actual Source did not retain its Root/Main/registration current");
    ynx_wallet_pay_source_lease_v1 *duplicate = nullptr;
    const auto duplicate_code = ynx_link_pay_native_startup_adopt_source_v1(startup, &duplicate);
    require(duplicate_code != 0 && duplicate == nullptr, "startup repeated its one-shot constructor handoff");
    Packet first;
    require(ynx_link_pay_native_startup_error_v1(startup, &first.value) != 0 && first.value,
            "startup duplicate-handoff first cause was not retained");
    const auto first_code = first.value->error_code;

    ynx_link_private_client_registration_v1 *registration = nullptr;
    ynx_link_private_client_source_fence_v1 fence{};
    require(borrow_original_pay_runtime(source, root->original, true, &registration, &fence) == 0,
            "original Auth Source could not expose its own registered transport");
    require(fence.ctx == source, "Source constructor changed native fence context identity");
    ynx_link_private_client_holder_v1 *holder = nullptr;
    const auto child = ynx_link_private_client_capture_v1(registration, &fence, 1, &holder);
    require(holder != nullptr, "native child capture lost its original owned partial");
    require(child == 0, "native child rejected the actual Source's registration");
    Packet response;
    const auto called = ynx_link_private_client_call_v1(holder, YNX_LINK_PRIVATE_GET_INVOICE_V1,
                                                      nullptr, 0, &response.value);
    require(response.value != nullptr, "actual startup GET discarded its packet");
    require(called == 0 && response.value->packet_present && response.value->status_code == 200,
            "actual startup did not reach its registered Unix endpoint");
    require(bytes(response.value->request_path, response.value->request_path_size) == public_original_read_path()
                && bytes(response.value->body, response.value->body_size) == "{}",
            "ctx-only startup changed the original path/opaque response DATA");
    server->join_original_get();
    require(ynx_link_private_client_retire_v1(holder) == 0
                && ynx_link_private_client_join_v1(holder, 3000) == 0
                && ynx_link_private_client_close_v1(holder) == 0
                && ynx_link_private_client_free_v1(holder) == 0,
            "actual startup transport child did not drain");

    require(ynx_link_pay_native_startup_retire_v1(startup) == 0, "actual startup retire failed");
    require(ynx_link_pay_native_startup_join_v1(startup, 20) != 0,
            "startup Join passed while actual Source still held its registration borrow");
    require(ynx_link_pay_native_startup_closed_v1(startup) == 0
                && ynx_wallet_pay_ctx_closed_v1(context) == 0,
            "startup fabricated parent/context drain through retained Source");
    ynx_wallet_pay_source_lease_drop_v1(source);
    require(ynx_wallet_pay_source_lease_drained_v1(source) == 1,
            "actual Source drop did not physically return its original registration borrow");
    require(ynx_link_pay_native_startup_join_v1(startup, 3000) == 0
                && ynx_link_pay_native_startup_close_v1(startup) == 0
                && ynx_link_pay_native_startup_closed_v1(startup) == 1,
            "startup could not truly drain after actual Source release");
    Packet retained;
    require(ynx_link_pay_native_startup_error_v1(startup, &retained.value) != 0 && retained.value
                && retained.value->error_code == first_code,
            "later cleanup replaced the original one-shot constructor first cause");
    require(ynx_link_pay_native_startup_free_v1(startup) == 0, "physically drained startup could not free");
    require(ynx_wallet_pay_ctx_closed_v1(context) == 0,
            "Go startup closed its borrowed original Auth context");
    ynx_wallet_pay_ctx_retire_v1(context);
    require(ynx_wallet_pay_ctx_close_v1(context) == 0 && ynx_wallet_pay_ctx_closed_v1(context) == 1,
            "original Native owner could not close its context after Go drain");
    delete server;
}
} // namespace

namespace ynx::wallet::pay {
int32_t read_original_pay_root_transport_profile(const std::shared_ptr<OriginalRootSource> &actual,
    const Binding &binding, bool query, root_physical::TransportProfile &out) noexcept {
    try {
        auto root = std::dynamic_pointer_cast<PublicRoot>(actual);
        if (!root || root->current_native() || !root->matches_original_binding(binding, query)) return 1;
        root_physical::TransportProfile profile;
        profile.protected_resource_ref = "PUBLIC-native-startup-only";
        profile.socket_path = root->socket;
        profile.service = "public-native-startup";
        profile.peer_uid = static_cast<uint32_t>(::getuid());
        profile.peer_pid = ::getpid();
        profile.timeout_ms = 2000;
        profile.maximum_header_bytes = 8192;
        profile.maximum_response_bytes = 1024;
        auto &route = profile.routes[4];
        route.enabled = true;
        route.method = "GET";
        route.path = public_original_read_path();
        route.maximum_body_bytes = 0;
        route.timeout_ms = 2000;
        out = std::move(profile);
        return 0;
    } catch (...) { return 1; }
}
} // namespace ynx::wallet::pay

int main() {
    try {
        denied_contexts();
        actual_startup_pipeline();
        std::cout << "{\"control\":\"actual-ctx-only-startup\",\"passed\":true,"
            "\"actualUnixGETs\":1,\"fixedOriginalContext\":true,\"sourceCtorOnce\":true,"
            "\"foreignAndRetiredContextsRefused\":true,\"actualSourceDrain\":true,"
            "\"normalQualificationBoundaryFixture\":true,\"RootAdmission\":false,"
            "\"SourceAdmission\":false,\"actualMainApproval\":false,\"realFunds\":false}\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "FIRSTCAUSE: " << error.what() << '\n';
        std::cerr.flush();
        std::_Exit(1);
    } catch (...) {
        std::cerr << "FIRSTCAUSE: nonstandard original native exception\n";
        std::cerr.flush();
        std::_Exit(1);
    }
}
