#include "ai-mobile-v6-transport.hpp"
// The normal image resolves these ORIGINAL neutral C functions from its ONE
// approved Go archive. Do not compile another bridge/provider into that image.
extern "C" {
#include "bridge.h"
}
#include <openssl/core_names.h>
#include <openssl/evp.h>
#include <openssl/params.h>
#include <openssl/provider.h>
#include <openssl/x509.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fcntl.h>
#include <limits>
#include <mutex>
#include <netdb.h>
#include <poll.h>
#include <pthread.h>
#include <stdexcept>
#include <sys/socket.h>
#include <unistd.h>

namespace ynx::ai_mobile_v6::physical {
namespace {
using Clock = std::chrono::steady_clock;
constexpr size_t maximum_header = 262144, maximum_body = 1U << 20, maximum_request_body = 2U << 20;
constexpr size_t maximum_owners = 16;
std::atomic<size_t> owned_slots{0};

struct Raised final : std::exception {
    Code code;
    int32_t native;
    int error;
    const char *message;
    Raised(Code c, const char *m, int e, int32_t n) noexcept : code(c), native(n), error(e), message(m) {}
    const char *what() const noexcept override { return message; }
};
[[noreturn]] void raise(Code code, const char *message, int error = 0, int32_t native = 0) {
    throw Raised(code, message, error, native);
}
int64_t wall_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}
bool digest(const std::string &s) {
    return s.size() == 64 && std::all_of(s.begin(), s.end(), [](unsigned char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}
bool dns_name(const std::string &s) {
    if (s.empty() || s.size() > 253 || s.front() == '.' || s.back() == '.') return false;
    size_t begin = 0;
    for (size_t i = 0; i <= s.size(); ++i) {
        if (i == s.size() || s[i] == '.') {
            if (i == begin || i - begin > 63 || s[begin] == '-' || s[i - 1] == '-') return false;
            begin = i + 1;
        } else if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9') || s[i] == '-')) return false;
    }
    return true;
}
struct Origin { std::string authority, host, port; };
bool origin(const std::string &s, Origin &out) {
    if (s.size() > 512 || s.compare(0, 8, "https://") != 0) return false;
    out.authority = s.substr(8);
    if (out.authority.empty() || out.authority.find_first_of("/@?#%\\ \r\n\t") != std::string::npos || out.authority.find('\0') != std::string::npos) return false;
    const size_t colon = out.authority.find(':');
    out.host = out.authority.substr(0, colon);out.port = "443";
    if (!dns_name(out.host)) return false;
    if (colon != std::string::npos) {
        out.port = out.authority.substr(colon + 1);
        if (out.port.empty() || out.port.size() > 5 || out.port[0] == '0') return false;
        uint32_t number = 0;
        for (char c : out.port) { if (c < '0' || c > '9') return false;number = number * 10 + static_cast<uint32_t>(c - '0'); }
        if (number == 0 || number > 65535 || number == 443) return false;
    }
    return true;
}
bool validate(const Material &m, Origin &target, std::string &why) {
    if (!origin(m.service_origin, target) || m.peer_san != target.host || !dns_name(m.local_san) ||
        m.client_certificate_fd < 0 || m.client_private_key_fd < 0 ||
        m.root_certificate_pem.empty() || m.root_certificate_pem.size() > 65536 ||
        !digest(m.client_certificate_sha256) || m.credential_epoch == 0 || m.credential_until_unix_ms <= wall_ms() ||
        !digest(m.peer_spki_sha256) || m.policy_epoch == 0 || m.roots.empty() || m.roots.size() > 2 ||
        m.timeout_ms == 0 || m.timeout_ms > 30000 || m.max_response_body_bytes == 0 || m.max_response_body_bytes > maximum_body ||
        m.max_response_header_bytes == 0 || m.max_response_header_bytes > maximum_header ||
        m.max_request_header_bytes == 0 || m.max_request_header_bytes > maximum_header ||
        m.max_request_body_bytes == 0 || m.max_request_body_bytes > maximum_request_body ||
        m.request_body_original.size() > m.max_request_body_bytes) {
        why = "fixed native target/profile unavailable";return false;
    }
    for (const auto &root : m.roots) if (!digest(root.certificate_sha256) || root.until_unix_ms <= wall_ms()) {
        why = "fixed native root acceptance unavailable";return false;
    }
    return wire::check_request_head(m.request_head_original, m.method, m.path, target.authority,
        m.request_body_original.size(), m.max_request_header_bytes, why);
}
std::string peer_spki_sha256(SSL *ssl) {
    X509 *peer = SSL_get0_peer_certificate(ssl);
    X509_PUBKEY *spki = peer ? X509_get_X509_PUBKEY(peer) : nullptr;
    const int length = spki ? i2d_X509_PUBKEY(spki, nullptr) : 0;
    if (length <= 0 || length > 16384) raise(Code::tls, "actual peer SPKI unavailable or oversized");
    std::array<unsigned char, 16384> der{};unsigned char *cursor = der.data();
    if (i2d_X509_PUBKEY(spki, &cursor) != length || cursor != der.data() + length) raise(Code::tls, "actual peer SPKI copy failed");
    // Fetch one explicit SHA256 implementation, not an implicit/config-selected
    // digest. This uses no second TLS context/provider and changes no defaults.
    EVP_MD *md = EVP_MD_fetch(nullptr, "SHA256", "provider=default");
    if (!md) raise(Code::unavailable, "fixed SPKI SHA256 unavailable");
    const OSSL_PROVIDER *provider = EVP_MD_get0_provider(md);char *version = nullptr;
    OSSL_PARAM parameters[] = {OSSL_PARAM_construct_utf8_ptr(OSSL_PROV_PARAM_VERSION, &version, 0), OSSL_PARAM_construct_end()};
    const bool pinned = provider && std::strcmp(OSSL_PROVIDER_get0_name(provider), "default") == 0 &&
        OSSL_PROVIDER_get_params(provider, parameters) == 1 && version && std::strcmp(version, "3.6.4") == 0 && EVP_MD_get_size(md) == 32;
    std::array<unsigned char, 32> hash{};unsigned int written = 0;
    const bool ok = pinned && EVP_Digest(der.data(), static_cast<size_t>(length), hash.data(), &written, md, nullptr) == 1 && written == hash.size();
    EVP_MD_free(md);
    if (!ok) raise(Code::unavailable, "fixed SPKI SHA256 failed");
    static const char digits[] = "0123456789abcdef";std::string value(64, '0');
    for (size_t i = 0; i < hash.size(); ++i) { value[2 * i] = digits[hash[i] >> 4];value[2 * i + 1] = digits[hash[i] & 15]; }
    return value;
}
} // namespace

struct RequestOwner::State : std::enable_shared_from_this<RequestOwner::State> {
    Material material;
    native_loan::OriginalAttempt *source;
    Origin target;
    Packet packet;
    mutable std::mutex mutex;
    std::condition_variable changed;
    const pid_t owner_pid = ::getpid();
    std::atomic<bool> retired{false};
    Clock::time_point deadline;
    Failure first;
    bool ready = false, packet_released = false, started = false;
    bool worker_launched = false, launch_decided = false, worker_joined = false, reaper_done = false;
    bool borrowed = false, borrow_unknown = false, cleanup_unknown = false, closing = false, closed = false;
    bool slot = false;
    size_t callbacks = 0;
    pthread_t worker{};
    // Only helper-owned dup numbers can be stored here. An ambiguous close is
    // retained as an unresolved debt, never retried against a potentially
    // reused descriptor number. The original Auth FDs remain untouched.
    ynx_credential_fd_cleanup credential_cleanup{-1, -1, 0};

    State(const Material &m, native_loan::OriginalAttempt *f) : material(m), source(f) {}
    ~State() {
        // No destructor guesses physical drain or releases an unresolved native
        // borrow. The normal Native inventory MUST retain a partial/debt owner.
        if (slot && closed) owned_slots.fetch_sub(1);
    }
    void remember(Failure failure) {
        std::lock_guard<std::mutex> lock(mutex);
        if (first.code == Code::ok) first = std::move(failure);
    }
    void remember_code(Code code, const char *message, int error = 0, int32_t native = 0) {
        std::lock_guard<std::mutex> lock(mutex);
        remember_locked(code, message, error, native);
    }
    void remember_locked(Code code, const char *message, int error = 0, int32_t native = 0) noexcept {
        if (first.code != Code::ok) return;
        first.code = code;first.native_code = native;first.system_errno = error;
        try { first.message.assign(message); } catch (...) { /* numeric first cause remains owned */ }
    }
    Failure first_copy() const { std::lock_guard<std::mutex> lock(mutex);return first; }
    void check_time() const {
        if (::getpid() != owner_pid) raise(Code::denied, "foreign process owner");
        if (retired.load()) raise(Code::cancelled, "original request retired");
        if (Clock::now() >= deadline) raise(Code::timeout, "original request deadline elapsed", ETIMEDOUT);
        if (wall_ms() >= material.credential_until_unix_ms) raise(Code::tls, "original TLS credential acceptance window elapsed");
    }
    Code current(bool record) {
        native_loan::OriginalAttempt *fence = nullptr;
        {
            std::lock_guard<std::mutex> lock(mutex);
            if (::getpid() != owner_pid) return Code::denied;
            if (closed || closing) return Code::closed;
            if (retired.load()) return first.code == Code::ok ? Code::cancelled : first.code;
            if (!borrowed || borrow_unknown || cleanup_unknown) return Code::source_current;
            fence = source;++callbacks;
        }
        int32_t native = 0;bool threw = false;
        try { native = native_loan::current_before_write(fence); } catch (...) { threw = true; }
        std::lock_guard<std::mutex> lock(mutex);
        --callbacks;changed.notify_all();
        if (threw || native) {
            if (record) remember_locked(Code::source_current, threw ? "native source current threw" : "original native source current rejected", 0, native);
            if (record) retired.store(true);
            return Code::source_current;
        }
        return retired.load() ? Code::cancelled : Code::ok;
    }
    void current_or_raise() {
        check_time();const Code code = current(true);
        if (code != Code::ok) {
            const Failure observed = first_copy();
            if (observed.code != Code::ok) raise(observed.code, "original native source current rejected", observed.system_errno, observed.native_code);
            raise(code, "original request no longer current");
        }
        check_time();
    }
    void wait_fd(int fd, short events) {
        for (;;) {
            check_time();const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
            // No asynchronous close of a copied fd number: only this worker
            // closes its socket. Retire is observed in bounded poll slices.
            pollfd p{fd, events, 0};const int result = ::poll(&p, 1, static_cast<int>(std::min<int64_t>(25, std::max<int64_t>(1, left))));
            if (result < 0 && errno == EINTR) continue;
            if (result < 0) raise(Code::unavailable, "native socket poll failed", errno);
            if (!result) continue;
            if (p.revents & POLLNVAL) raise(Code::unavailable, "native socket invalid", EBADF);
            if (p.revents & (events | POLLHUP | POLLERR)) return;
        }
    }
    struct Session {
        State &state;
        SSL_CTX *context = nullptr;
        SSL *ssl = nullptr;
        int fd = -1;
        std::array<uint8_t, 16384> read_buffer{};
        size_t read_at = 0, read_size = 0;
        explicit Session(State &s) : state(s) {}
        ~Session() {
            // Pending SSL read/write arguments stay alive until AFTER SSL_free.
            if (ssl) SSL_free(ssl);
            if (context) SSL_CTX_free(context);
            if (fd >= 0 && ::close(fd)) {
                const int saved = errno;
                std::lock_guard<std::mutex> lock(state.mutex);
                state.cleanup_unknown = true;
                state.remember_locked(Code::cleanup_unknown, "native socket close unknown", saved);
            }
        }
    };
    void gate(Session &session) {
        check_time();ynx_tls_state actual{};std::array<char, 256> error{};
        if (ynx_snapshot(session.ssl, material.peer_san.c_str(), 0, &actual, error.data(), error.size()) != 1 ||
            !actual.verified || !actual.mutual || !actual.chain_pq || actual.resumed ||
            std::strcmp(actual.protocol, "TLSv1.3") || std::strcmp(actual.group, "SecP384r1MLKEM1024") ||
            std::strcmp(actual.cipher, "TLS_AES_256_GCM_SHA384") || std::strcmp(actual.signature, "mldsa87") ||
            material.local_san != actual.local_san || material.peer_san != actual.peer_san || actual.not_after <= wall_ms() / 1000)
            raise(Code::tls, "actual fixed PQ/SAN/chain profile rejected");
        bool trusted = false;
        for (const auto &root : material.roots) if (root.certificate_sha256 == actual.root_fingerprint && wall_ms() < root.until_unix_ms) trusted = true;
        if (!trusted) raise(Code::tls, "actual root acceptance window rejected");
        const std::string spki = peer_spki_sha256(session.ssl);
        packet.peer_spki_sha256 = spki;packet.peer_certificate_sha256 = actual.peer_fingerprint;packet.root_certificate_sha256 = actual.root_fingerprint;
        if (spki != material.peer_spki_sha256) raise(Code::spki, "actual peer SPKI rejected");
    }
    void dial(Session &session) {
        check_time();std::array<char, 256> error{};
        ynx_credential_fd_cleanup cleanup{-1, -1, 0};errno = 0;
        session.context = ynx_ctx_new_fds(material.client_certificate_fd, material.client_private_key_fd,
            reinterpret_cast<const unsigned char *>(material.root_certificate_pem.data()), material.root_certificate_pem.size(),
            material.client_certificate_sha256.c_str(), 0, &cleanup, error.data(), error.size());
        const int credential_errno = errno;
        if (cleanup.close_unknown) {
            {
                std::lock_guard<std::mutex> lock(mutex);credential_cleanup = cleanup;cleanup_unknown = true;
            }
            raise(Code::cleanup_unknown, "native credential dup close unknown", credential_errno);
        }
        if (!session.context) raise(Code::tls, "fixed native TLS credentials/profile unavailable");
        check_time();addrinfo hints{};hints.ai_family = AF_UNSPEC;hints.ai_socktype = SOCK_STREAM;hints.ai_protocol = IPPROTO_TCP;addrinfo *addresses = nullptr;
        // getaddrinfo is deliberately NOT force-cancelled. Its real thread and
        // original Source borrow remain debts until it returns and is joined.
        const int resolved = ::getaddrinfo(target.host.c_str(), target.port.c_str(), &hints, &addresses);
        std::unique_ptr<addrinfo, decltype(&::freeaddrinfo)> held(addresses, ::freeaddrinfo);
        check_time();if (resolved || !addresses) raise(Code::unavailable, "original target resolution failed", resolved == EAI_SYSTEM ? errno : 0);
        addrinfo *selected = addresses;
        while (selected && selected->ai_family != AF_INET && selected->ai_family != AF_INET6) selected = selected->ai_next;
        if (!selected) raise(Code::unavailable, "original target address unavailable");
        // Exactly ONE TCP candidate and ONE handshake, never endpoint fallback
        // or replay after a connection/profile/SPKI/source failure.
#if defined(__linux__)
        session.fd = ::socket(selected->ai_family, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, selected->ai_protocol);
#else
        session.fd = ::socket(selected->ai_family, SOCK_STREAM, selected->ai_protocol);
#endif
        if (session.fd < 0) raise(Code::unavailable, "original socket unavailable", errno);
        if (::fcntl(session.fd, F_SETFD, FD_CLOEXEC) || ::fcntl(session.fd, F_SETFL, O_NONBLOCK)) raise(Code::unavailable, "original socket flags failed", errno);
#if defined(__APPLE__)
        int one = 1;if (::setsockopt(session.fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one))) raise(Code::unavailable, "original socket SIGPIPE policy failed", errno);
#endif
        check_time();if (::connect(session.fd, selected->ai_addr, selected->ai_addrlen)) {
            if (errno != EINPROGRESS) raise(Code::unavailable, "original target connect failed", errno);
            wait_fd(session.fd, POLLOUT);int failure = 0;socklen_t size = sizeof(failure);
            if (::getsockopt(session.fd, SOL_SOCKET, SO_ERROR, &failure, &size) || failure) raise(Code::unavailable, "original target connect failed", failure ? failure : errno);
        }
        check_time();session.ssl = ynx_ssl_new(session.context, session.fd, 0, material.peer_san.c_str());
        if (!session.ssl) raise(Code::tls, "original TLS endpoint unavailable");
        for (;;) {
            check_time();error.fill(0);errno = 0;const int result = ynx_handshake(session.ssl, error.data(), error.size());
            if (result == 1) break;
            if (result == 2 || result == 3) { wait_fd(session.fd, result == 2 ? POLLIN : POLLOUT);continue; }
            raise(Code::tls, "original PQ handshake failed", errno);
        }
        gate(session);
    }
    void write_original(Session &session, const void *bytes, size_t length) {
        const auto *data = static_cast<const uint8_t *>(bytes);size_t at = 0;
        while (at < length) {
            gate(session);current_or_raise();std::array<char, 256> error{};size_t written = 0;
            packet.dispatch_possible = true;packet.unknown = true;
            errno = 0;const int result = ynx_write(session.ssl, data + at, length - at, &written, error.data(), error.size());
            if (written > length - at) raise(Code::protocol, "native original write exceeded bound");
            if (result == 1 && written) { at += written;continue; }
            if (result == 2 || result == 3) { wait_fd(session.fd, result == 2 ? POLLIN : POLLOUT);continue; }
            raise(Code::tls, "original request write failed", errno);
        }
    }
    void write_request(Session &session) {
        // SAME immutable Native HTTP head and opaque SDK entity, each sent once
        // in order. A late current error after the head retains UNKNOWN; it
        // cannot become a retry or a replacement envelope/member/signature.
        write_original(session, material.request_head_original.data(), material.request_head_original.size());
        write_original(session, material.request_body_original.data(), material.request_body_original.size());
    }
    struct Reader final : wire::Reader {
        State &state;Session &session;
        Reader(State &s, Session &c) : state(s), session(c) {}
        size_t read(uint8_t *out, size_t capacity) override {
            if (!capacity) return 0;
            for (;;) {
                state.check_time();
                if (session.read_at != session.read_size) {
                    const size_t size = std::min(capacity, session.read_size - session.read_at);
                    std::memcpy(out, session.read_buffer.data() + session.read_at, size);session.read_at += size;return size;
                }
                session.read_at = session.read_size = 0;size_t size = 0;std::array<char, 256> error{};errno = 0;
                const int result = ynx_read(session.ssl, session.read_buffer.data(), session.read_buffer.size(), &size, error.data(), error.size());
                if (size > session.read_buffer.size()) raise(Code::protocol, "native response read exceeded bound");
                if (result == 1 && size) { session.read_size = size;continue; }
                if (result == 0) return 0;
                if (result == 2 || result == 3) { state.wait_fd(session.fd, result == 2 ? POLLIN : POLLOUT);continue; }
                raise(Code::tls, "original response read failed", errno);
            }
        }
    };
    void run() noexcept {
        try {
            {
                Session session(*this);dial(session);write_request(session);Reader reader(*this, session);
                wire::Limits limits{material.max_response_header_bytes, material.max_response_body_bytes,
                    material.max_response_header_bytes + material.max_response_body_bytes + (64U << 10)};
                std::string reason;
                if (!wire::read_response(reader, limits, packet.response, reason)) raise(Code::protocol, "original response framing/budget rejected");
                // Complete entity DATA is already owned even if either late
                // native target/source observation now fails.
                gate(session);current_or_raise();
                if (packet.response.status_code >= 300 && packet.response.status_code < 400) raise(Code::redirect, "original redirect not followed");
            } // actual SSL/socket cleanup happens before readiness publication
        } catch (const Raised &e) { remember_code(e.code, e.message, e.error, e.native); }
          catch (...) { remember_code(Code::unavailable, "original worker failed"); }
        std::lock_guard<std::mutex> lock(mutex);
        packet.failure = first;packet.unknown = packet.dispatch_possible && first.code != Code::ok;
        ready = true;changed.notify_all();
    }
    void reap() noexcept {
        bool launched = false;
        {
            std::unique_lock<std::mutex> lock(mutex);changed.wait(lock, [&] { return launch_decided; });launched = worker_launched;
        }
        const int result = launched ? ::pthread_join(worker, nullptr) : 0;
        std::lock_guard<std::mutex> lock(mutex);
        if (result) {
            cleanup_unknown = true;
            remember_locked(Code::cleanup_unknown, "original worker join unknown", result);
        } else worker_joined = true;
        // After this point the reaper NEVER accesses Source/SSL/socket/packet.
        // Its shared State reference protects only bookkeeping teardown; Close
        // does not free State under it or claim all process threads have exited.
        reaper_done = true;changed.notify_all();
    }
    bool launch() {
        auto *reaper_hold = new std::shared_ptr<State>(shared_from_this());pthread_attr_t attributes;
        int result = ::pthread_attr_init(&attributes);
        if (result) { delete reaper_hold;return false; }
        result = ::pthread_attr_setdetachstate(&attributes, PTHREAD_CREATE_DETACHED);pthread_t reaper{};
        if (!result) result = ::pthread_create(&reaper, &attributes, [](void *raw) -> void * {
            std::unique_ptr<std::shared_ptr<State>> held(static_cast<std::shared_ptr<State> *>(raw));(*held)->reap();return nullptr;
        }, reaper_hold);
        ::pthread_attr_destroy(&attributes);
        if (result) { delete reaper_hold;return false; }
        int created = 0;
        try {
            auto *worker_hold = new std::shared_ptr<State>(shared_from_this());
            created = ::pthread_create(&worker, nullptr, [](void *raw) -> void * {
                std::unique_ptr<std::shared_ptr<State>> held(static_cast<std::shared_ptr<State> *>(raw));(*held)->run();return nullptr;
            }, worker_hold);
            if (created) delete worker_hold;
        } catch (...) { created = ENOMEM; }
        {
            std::lock_guard<std::mutex> lock(mutex);started = created == 0;worker_launched = started;launch_decided = true;
            if (!started) { if (first.code == Code::ok) first = Failure{Code::unavailable, 0, created, "original worker unavailable"};packet.failure = first;ready = true; }
            changed.notify_all();
        }
        return created == 0;
    }
    void no_worker(Failure failure) {
        std::lock_guard<std::mutex> lock(mutex);if (first.code == Code::ok) first = std::move(failure);
        packet.failure = first;ready = worker_joined = reaper_done = true;changed.notify_all();
    }
};

RequestOwner::RequestOwner(std::shared_ptr<State> state) : state_(std::move(state)) {}
RequestOwner::~RequestOwner() = default;

Code RequestOwner::start(native_loan::OriginalAttempt *fence, std::shared_ptr<RequestOwner> &out) {
    out.reset();std::shared_ptr<State> s;
    try {
        size_t count = owned_slots.load();
        while (count < maximum_owners && !owned_slots.compare_exchange_weak(count, count + 1)) {}
        if (count >= maximum_owners) return Code::bounds;
        try { s = std::make_shared<State>(Material{}, fence);s->slot = true;out = std::shared_ptr<RequestOwner>(new RequestOwner(s)); }
        catch (...) { owned_slots.fetch_sub(1);if (s) s->slot = false;return Code::unavailable; }
        if (!fence) { s->no_worker(Failure{Code::denied, 0, 0, "original Native attempt unavailable"});return Code::denied; }
        int32_t retained = 0;
        try { retained = native_loan::retain_original(fence); }
        catch (...) { s->borrow_unknown = true;s->no_worker(Failure{Code::cleanup_unknown, 0, 0, "native source retain unknown"});return Code::cleanup_unknown; }
        if (retained) { s->no_worker(Failure{Code::source_current, retained, 0, "original native source retain rejected"});return Code::source_current; }
        { std::lock_guard<std::mutex> lock(s->mutex);s->borrowed = true; }
        const int32_t copied = native_loan::read_original_material(fence, s->material);
        if (copied) { s->no_worker(Failure{Code::source_current, copied, 0, "same original Native material rejected"});return Code::source_current; }
        const Material &material = s->material;
        s->deadline = Clock::now() + std::chrono::milliseconds(material.timeout_ms);
        std::string why;
        if (!validate(material, s->target, why)) {
            s->no_worker(Failure{Code::denied, 0, 0, "fixed original request/profile denied"});return Code::denied;
        }
        // Reserve all retained DATA/error storage before any network dispatch.
        s->packet.response.headers_original.reserve(material.max_response_header_bytes + 1);
        s->packet.response.trailers_original.reserve(material.max_response_header_bytes + 1);
        s->packet.response.body.reserve(material.max_response_body_bytes + 1);
        s->first.message.reserve(256);s->packet.failure.message.reserve(256);
        s->packet.peer_spki_sha256.reserve(64);s->packet.peer_certificate_sha256.reserve(64);s->packet.root_certificate_sha256.reserve(64);
        s->packet.policy_epoch = material.policy_epoch;
        const Code current = s->current(true);
        if (current != Code::ok) { auto first = s->first_copy();if (first.code == Code::ok) first = Failure{current, 0, 0, "original request no longer current"};s->no_worker(std::move(first));return current; }
        if (!s->launch()) {
            // If the reaper exists it publishes the original no-worker join.
            std::lock_guard<std::mutex> lock(s->mutex);
            if (!s->launch_decided) { s->launch_decided = true;s->worker_joined = s->reaper_done = true; }
            if (s->first.code == Code::ok) s->first = Failure{Code::unavailable, 0, 0, "original worker launch failed"};
            s->packet.failure = s->first;s->ready = true;s->changed.notify_all();return s->first.code;
        }
        return Code::ok;
    } catch (...) {
        if (s) s->no_worker(Failure{Code::unavailable, 0, 0, "original request allocation failed"});
        return Code::unavailable;
    }
}
Code RequestOwner::current_local() const {
    const auto s = state_;if (!s || ::getpid() != s->owner_pid) return Code::denied;
    std::lock_guard<std::mutex> lock(s->mutex);
    if (s->closed || s->closing) return Code::closed;
    if (s->retired.load()) return Code::cancelled;
    return s->first.code;
}
Code RequestOwner::current_source() { const auto s = state_;return s ? s->current(true) : Code::denied; }
Code RequestOwner::wait_response(uint32_t timeout, const Packet **out) {
    if (!out) return Code::denied;*out = nullptr;const auto s = state_;
    if (!s || ::getpid() != s->owner_pid || timeout > 30000) return Code::denied;
    std::unique_lock<std::mutex> lock(s->mutex);
    if (!s->ready && timeout) s->changed.wait_for(lock, std::chrono::milliseconds(timeout), [&] { return s->ready; });
    if (!s->ready) return Code::draining;
    if (s->closed || s->packet_released) return Code::closed;
    *out = &s->packet;return s->packet.failure.code;
}
Code RequestOwner::release_packet(const Packet *packet) {
    const auto s = state_;if (!s || ::getpid() != s->owner_pid || packet != &s->packet) return Code::denied;
    std::lock_guard<std::mutex> lock(s->mutex);
    if (!s->ready) return Code::draining;
    if (s->packet_released) return Code::denied;
    s->packet_released = true;s->changed.notify_all();return Code::ok;
}
Code RequestOwner::retire() {
    const auto s = state_;if (!s || ::getpid() != s->owner_pid) return Code::denied;
    s->retired.store(true);s->changed.notify_all();return Code::ok;
}
Code RequestOwner::join(uint32_t timeout, bool *completed) {
    if (!completed) return Code::denied;*completed = false;const auto s = state_;
    if (!s || ::getpid() != s->owner_pid || timeout > 30000) return Code::denied;
    std::unique_lock<std::mutex> lock(s->mutex);
    if (!s->retired.load()) return Code::draining;
    auto drained = [&] { return s->worker_joined && s->reaper_done && s->callbacks == 0 && s->packet_released && !s->closing; };
    if (!drained() && timeout) s->changed.wait_for(lock, std::chrono::milliseconds(timeout), drained);
    if (s->borrow_unknown || s->cleanup_unknown) return s->first.code == Code::ok ? Code::cleanup_unknown : s->first.code;
    if (!drained()) return Code::draining;
    *completed = true;return s->first.code;
}
Code RequestOwner::close(bool *completed) {
    if (!completed) return Code::denied;*completed = false;const auto s = state_;
    if (!s || ::getpid() != s->owner_pid) return Code::denied;native_loan::OriginalAttempt *fence = nullptr;bool release = false;
    {
        std::lock_guard<std::mutex> lock(s->mutex);
        if (s->closed) { *completed = true;return s->first.code; }
        if (s->borrow_unknown || s->cleanup_unknown) return s->first.code == Code::ok ? Code::cleanup_unknown : s->first.code;
        if (!s->retired.load() || !s->worker_joined || !s->reaper_done || s->callbacks || !s->packet_released || s->closing) return Code::draining;
        s->closing = true;fence = s->source;release = s->borrowed;if (release) ++s->callbacks;
    }
    bool threw = false;
    if (release) try { native_loan::release_after_physical_join(fence); } catch (...) { threw = true; }
    std::lock_guard<std::mutex> lock(s->mutex);
    if (release) --s->callbacks;s->closing = false;
    if (threw) {
        s->cleanup_unknown = true;s->remember_locked(Code::cleanup_unknown, "native source release unknown");
        s->changed.notify_all();return s->first.code;
    }
    s->borrowed = false;s->closed = true;*completed = true;s->changed.notify_all();return s->first.code;
}
Failure RequestOwner::first_error() const { return state_ ? state_->first_copy() : Failure{Code::denied, 0, 0, "missing original owner"}; }
Lifecycle RequestOwner::lifetime() const {
    Lifecycle out;const auto s = state_;if (!s || ::getpid() != s->owner_pid) return out;
    std::lock_guard<std::mutex> lock(s->mutex);out.started = s->started;out.retired = s->retired.load();out.response_ready = s->ready;
    out.worker_joined = s->worker_joined;out.response_released = s->packet_released;out.reaper_bookkeeping_complete = s->reaper_done;
    out.source_callbacks_inflight = s->callbacks;out.closing = s->closing;out.physical_complete = s->closed;
    out.source_borrow_held = s->borrowed;out.cleanup_unknown = s->cleanup_unknown || s->borrow_unknown;return out;
}
} // namespace ynx::ai_mobile_v6::physical
