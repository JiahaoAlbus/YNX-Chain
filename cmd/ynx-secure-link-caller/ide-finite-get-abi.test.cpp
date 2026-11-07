// PUBLIC four-Origin definitions below exist only in this test translation unit.
// The real Auth registry, ticket/loan body, CABI and original PQ transport are linked.
#ifndef YNX_LINK_IDE_FINITE_GET_ABI_PUBLIC_CONTROLS
#error PUBLIC ABI controls cannot enter a normal producer
#endif
#ifndef YNX_LINK_IDE_FINITE_GET_PUBLIC_CONTROLS
#error Original loopback fixture guard required
#endif
#define main ynx_original_transport_controls_not_executed
#include "ide-finite-get-transport.test.cpp"
#undef main
#include "ide_finite_get_transport_v1.h"
#include "ide_finite_get_auth_mother_internal.hpp"

namespace abi_public {
struct Input final {
    // Reuse only the original fixture's FD container, not its mock SourceFence.
    PublicSource fds;
    Material expected;
    std::array<uint8_t, 32> root, client, spki;
    std::string server = "localhost", local = "wallet.ynx.test", full = "PUBLIC-only";
    uint64_t wall, mono;
    uint16_t port;
    std::atomic<int> target_calls{0}, request_calls{0}, deny_target_call{0};
    std::atomic<int> target_destroyed{0}, request_destroyed{0};
    std::atomic<bool> current{true};
    Input(const std::string &certs, const Server &s) : fds(certs), expected(material(certs, s, prefix)),
        root(hashBytes(fileBytes(certs + "/root.cert.der"))), client(hashBytes(fileBytes(certs + "/client.cert.der"))),
        spki(hashBytes(fileBytes(certs + "/server.spki.der"))),
        wall(static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count()) + 15000),
        mono(static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now().time_since_epoch()).count()) + 15000000000ULL), port(s.port()) {}
};
ynx_auth_ide_get_bytes_v1 bytes(const std::string &s) { return {reinterpret_cast<const uint8_t *>(s.data()), s.size()}; }
}
namespace ynx::auth::ide_get {
struct OriginalTargetQualification::Storage { std::shared_ptr<abi_public::Input> input; };
struct OriginalRequestCustody::Storage { std::shared_ptr<abi_public::Input> input; };
OriginalTargetQualification::OriginalTargetQualification() : storage_(new Storage) {}
OriginalRequestCustody::OriginalRequestCustody() : storage_(new Storage) {}
OriginalTargetQualification::~OriginalTargetQualification() { if (storage_->input) ++storage_->input->target_destroyed; }
OriginalRequestCustody::~OriginalRequestCustody() { if (storage_->input) ++storage_->input->request_destroyed; }
int32_t OriginalTargetQualification::assert_current_original() const noexcept {
    auto &s = *storage_->input;const int call = ++s.target_calls;
    return !s.current || call == s.deny_target_call ? YNX_AUTH_IDE_GET_DENIED : 0;
}
int32_t OriginalRequestCustody::assert_current_original() const noexcept {
    auto &s = *storage_->input;++s.request_calls;return s.current ? 0 : YNX_AUTH_IDE_GET_DENIED;
}
int32_t OriginalTargetQualification::read_native_target_original(ynx_auth_ide_finite_get_view_v1 *v, ynx_auth_ide_finite_get_credential_view_v1 *c) const noexcept {
    if (!v || !c) return YNX_AUTH_IDE_GET_DENIED;auto &s = *storage_->input;
    *v = {};v->version = 1;v->size = sizeof(*v);v->service_origin = abi_public::bytes(s.expected.service_origin);
    v->server_name = abi_public::bytes(s.server);v->port = s.port;
    const auto ref = abi_public::bytes(s.full);v->registered_cloud = {ref, ref, ref, ref, ref};
    v->response_header_limit = 4096;v->response_entity_limit = 4096;
    std::copy(s.spki.begin(), s.spki.end(), v->expected_spki_der_sha256);
    v->expires_unix_ms = s.wall;v->expires_monotonic_ns = s.mono;
    *c = {};c->version = 1;c->size = sizeof(*c);c->root_certificate_pem = abi_public::bytes(s.fds.publicRootPEM);
    std::copy(s.root.begin(), s.root.end(), c->root_certificate_sha256);
    std::copy(s.client.begin(), s.client.end(), c->client_certificate_sha256);
    c->registered_root_epoch = 1;c->registered_root_until_unix_ms = s.wall;
    c->registered_credential_epoch = 1;c->registered_credential_until_unix_ms = s.wall;
    c->client_certificate_fd = s.fds.credentialFDs[0];c->client_private_key_fd = s.fds.credentialFDs[1];
    c->local_san = abi_public::bytes(s.local);c->peer_san = abi_public::bytes(s.server);return 0;
}
int32_t OriginalRequestCustody::read_native_request_original(ynx_auth_ide_finite_get_view_v1 *v) const noexcept {
    if (!v) return YNX_AUTH_IDE_GET_DENIED;auto &s = *storage_->input;
    v->original_path = abi_public::bytes(s.expected.path);v->original_operation_id = abi_public::bytes(s.expected.original_operation_id);
    v->original_v4_proof_header = abi_public::bytes(s.expected.proof_header);return 0;
}
// These are PUBLIC test friends of the actual sealed classes, never normal Origin implementations.
class OriginalTargetProducer final { public: static std::shared_ptr<OriginalTargetQualification> fixture(const std::shared_ptr<abi_public::Input> &s) {
    auto p = std::shared_ptr<OriginalTargetQualification>(new OriginalTargetQualification);p->storage_->input = s;return p;
} };
class OriginalRequestProducer final { public: static std::shared_ptr<OriginalRequestCustody> fixture(const std::shared_ptr<abi_public::Input> &s) {
    auto p = std::shared_ptr<OriginalRequestCustody>(new OriginalRequestCustody);p->storage_->input = s;return p;
} };
}
namespace {
using Client = ynx_link_ide_finite_get_v4_client;
using CPacket = ynx_link_ide_finite_get_v4_packet;
using ynx::auth::ide_get::TicketSource;
struct Actual final {
    std::shared_ptr<abi_public::Input> input;
    ynx_auth_ide_finite_get_ticket_v1 *ticket = nullptr;
    Client *client = nullptr;CPacket *packet = nullptr;
    Actual(const std::string &certs, Server &server) : input(std::make_shared<abi_public::Input>(certs, server)) {
        int32_t error = -1;
        ticket = TicketSource::open_original(ynx::auth::ide_get::OriginalTargetProducer::fixture(input),
            ynx::auth::ide_get::OriginalRequestProducer::fixture(input), &error);
        check(ticket && error == 0 && input->target_calls == 2 && input->request_calls == 2, "actual Mother original constructor failed");
    }
    // No destructor pretends to discharge UNKNOWN debt. Actual Mother custody
    // retains Input and its FDs until explicit physical close/free succeeds.
    int open() { const int rc = ynx_link_ide_finite_get_open_original_v1(ticket, &client);check(client != nullptr, "nonnull client must be adopted before status");return rc; }
    int wait() { const int rc = ynx_link_ide_finite_get_wait_original_v1(client, 3000, &packet);check(packet != nullptr, "nonnull original packet must be adopted before status");return rc; }
    ynx_link_ide_get_packet_view_v1 view() {
        ynx_link_ide_get_packet_view_v1 v{};check(ynx_link_ide_finite_get_packet_view_v1_read(client, packet, &v) == 0, "own original packet view failed");return v;
    }
    void release() { auto *p = packet;check(ynx_link_ide_finite_get_packet_release_v1(client, p) == 0, "own packet release failed");packet = nullptr;
        check(ynx_link_ide_finite_get_packet_release_v1(client, p) == 1, "packet released twice"); }
    void finish(int first = 0, int authFirst = 0) {
        uint8_t done = 0;const int joined = ynx_link_ide_finite_get_join_original_v1(client, 3000, &done);
        check(done && (joined == 0 || joined == first), "actual original worker did not join");
        check(ynx_link_ide_finite_get_close_original_v1(client, &done) == first && done, "actual Auth loan physical close failed");
        ynx_link_ide_get_lifetime_v1 life{};
        check(ynx_link_ide_finite_get_lifetime_v1_read(client, &life) == 0 && life.closed && life.physical_complete && !life.auth_loan_held && !life.source_borrow_held && !life.cleanup_unknown,
            "closed CABI still owes an actual Auth/worker loan");
        check(ynx_link_ide_finite_get_close_original_v1(client, &done) == first && done, "repeat close changed first cause or released loan twice");
        check(input->fds.originalFDsIntact(), "actual CABI moved/closed original credential FDs");
        check(ynx_link_ide_finite_get_free_original_v1(client) == 0, "physically closed CABI could not free");
        ynx_link_ide_get_failure_v1 failure{};check(ynx_link_ide_finite_get_first_error_v1(client, &failure) == 1, "freed CABI remained recognized");client = nullptr;
        check(TicketSource::close_original(ticket, &done) == authFirst && done, "Mother ticket still owes a loan or normal close aborted ticket");
        check(TicketSource::free_original(ticket) == 0, "closed Mother ticket free failed");ticket = nullptr;
        check(input->target_destroyed == 1 && input->request_destroyed == 1, "original Mother custody did not release exactly once");
    }
};
std::string text(ynx_link_ide_get_bytes_v1 b) { return b.size ? std::string(reinterpret_cast<const char *>(b.data), b.size) : std::string(); }
ynx_link_ide_get_failure_v1 first(Client *c) { ynx_link_ide_get_failure_v1 f{};check(ynx_link_ide_finite_get_first_error_v1(c, &f) == 0, "first error view failed");return f; }
void requestOnce(Server &server, const Actual &a) {
    server.stop();server.healthy();const auto requests = server.requests();
    check(server.accepts() == 1 && server.handshakes() == 1 && requests.size() == 1, "CABI replayed/redialed original GET");requireRequest(requests[0], a.input->expected);
}
void realGetAndDebt(const std::string &certs) {
    Server s1(certs), s2(certs);Actual a(certs, s1), b(certs, s2);
    check(a.open() == 0 && b.open() == 0 && a.wait() == 0 && b.wait() == 0, "actual CABI PQ GET failed");
    for (Actual *x : {&a, &b}) {
        const auto v = x->view();
        check(v.version == 1 && v.size == sizeof(v) && v.status_code == 200 && v.body_complete && v.dispatch_possible && !v.unknown && v.failure.code == 0 &&
            text(v.entity_original) == originalBody && text(v.headers_original) == originalHeaders() && v.trailers_original.size == 0 &&
            text(v.peer_spki_sha256) == hexHash(fileBytes(certs + "/server.spki.der")) && text(v.peer_certificate_sha256) == hexHash(fileBytes(certs + "/server.cert.der")) &&
            text(v.root_certificate_sha256) == hexHash(fileBytes(certs + "/root.cert.der")) && v.policy_epoch == 1, "actual packet original bytes/PQ pin projection changed");
        check(x->input->target_calls == 4 && x->input->request_calls == 4, "worker invoked actor-only Origin methods");
        check(ynx_link_ide_finite_get_current_original_v1(x->client) == 0, "original actor full Source current failed");
        CPacket *same = nullptr;check(ynx_link_ide_finite_get_wait_original_v1(x->client, 0, &same) == 0 && same == x->packet, "probe minted a second packet reference");
    }
    ynx_link_ide_get_packet_view_v1 wrong{};wrong.version = 99;
    check(ynx_link_ide_finite_get_packet_view_v1_read(a.client, b.packet, &wrong) == 1 && wrong.version == 0 && !wrong.entity_original.data &&
        ynx_link_ide_finite_get_packet_release_v1(a.client, b.packet) == 1, "cross-client packet identity accepted");
    uint8_t done = 1;
    check(ynx_link_ide_finite_get_free_original_v1(a.client) == 5 && ynx_link_ide_finite_get_join_original_v1(a.client, 0, &done) == 5 && !done,
        "held packet lost native debt");
    check(ynx_link_ide_finite_get_close_original_v1(a.client, &done) == 5 && !done && first(a.client).code == 0, "DRAINING poisoned success first cause");
    check(TicketSource::free_original(a.ticket) == 2, "Mother freed ticket while actual LINK loan held");
    const std::array<CPacket *, 2> stalePackets{{a.packet, b.packet}};
    const std::array<Client *, 2> staleClients{{a.client, b.client}};
    a.release();b.release();a.finish();b.finish();requestOnce(s1, a);requestOnce(s2, b);
    Server s3(certs);Actual c(certs, s3);
    check(c.open() == 0 && c.wait() == 0, "fresh packet ABA fixture GET failed");
    for (size_t i = 0; i < stalePackets.size(); ++i) {
        ynx_link_ide_get_packet_view_v1 staleView{};staleView.version = 99;
        check(c.client != staleClients[i] && c.packet != stalePackets[i], "freed original opaque identity was recycled");
        check(ynx_link_ide_finite_get_packet_view_v1_read(c.client, stalePackets[i], &staleView) == 1 && staleView.version == 0 &&
            !staleView.entity_original.data && ynx_link_ide_finite_get_packet_release_v1(c.client, stalePackets[i]) == 1,
            "released old packet reached fresh original attempt");
    }
    check(text(c.view().entity_original) == originalBody && c.view().body_complete, "stale packet call consumed fresh packet");
    c.release();c.finish();requestOnce(s3, c);
}
void foreignAndNull(const std::string &) {
    auto *foreignTicket = reinterpret_cast<ynx_auth_ide_finite_get_ticket_v1 *>(uintptr_t(0x1110));
    auto *foreignClient = reinterpret_cast<Client *>(uintptr_t(0x2220));
    auto *foreignPacket = reinterpret_cast<CPacket *>(uintptr_t(0x3330));
    check(ynx_link_ide_finite_get_open_original_v1(nullptr, nullptr) == 1, "null out accepted");
    for (auto *ticket : {static_cast<ynx_auth_ide_finite_get_ticket_v1 *>(nullptr), foreignTicket}) {
        Client *partial = nullptr;check(ynx_link_ide_finite_get_open_original_v1(ticket, &partial) == 6 && partial, "foreign/null ticket partial not published/adoptable");
        auto f = first(partial);check(f.code == 6 && f.auth_code == 2, "actual Auth refusal first cause lost");
        ynx_link_ide_get_lifetime_v1 life{};check(ynx_link_ide_finite_get_lifetime_v1_read(partial, &life) == 0 && !life.started && !life.auth_loan_held && !life.physical_complete, "no-loan partial invented physical completion");
        CPacket *p = foreignPacket;check(ynx_link_ide_finite_get_wait_original_v1(partial, 0, &p) == 6 && !p, "partial invented response");
        uint8_t done = 0;check(ynx_link_ide_finite_get_join_original_v1(partial, 0, &done) == 6 && done, "no-worker partial join failed");
        check(ynx_link_ide_finite_get_close_original_v1(partial, &done) == 6 && done && ynx_link_ide_finite_get_close_original_v1(partial, &done) == 6 && done, "no-loan close lost cause");
        check(ynx_link_ide_finite_get_free_original_v1(partial) == 0 && ynx_link_ide_finite_get_free_original_v1(partial) == 1, "partial free repeated");
    }
    for (Client *c : {static_cast<Client *>(nullptr), foreignClient}) {
        uint8_t done = 9;CPacket *p = foreignPacket;ynx_link_ide_get_packet_view_v1 v{};v.version = 99;ynx_link_ide_get_lifetime_v1 life{};life.version = 99;
        check(ynx_link_ide_finite_get_current_original_v1(c) == 1 && ynx_link_ide_finite_get_wait_original_v1(c, 0, &p) == 1 && !p &&
            ynx_link_ide_finite_get_packet_view_v1_read(c, foreignPacket, &v) == 1 && v.version == 0 &&
            ynx_link_ide_finite_get_packet_release_v1(c, foreignPacket) == 1 && ynx_link_ide_finite_get_abort_original_v1(c) == 1 &&
            ynx_link_ide_finite_get_join_original_v1(c, 0, &done) == 1 && !done && ynx_link_ide_finite_get_close_original_v1(c, &done) == 1 && !done &&
            ynx_link_ide_finite_get_lifetime_v1_read(c, &life) == 1 && life.version == 0 && ynx_link_ide_finite_get_free_original_v1(c) == 1,
            "null/foreign opaque pointer was dereferenced or output retained");
    }
    // A freed opaque identity must never designate a subsequent live attempt.
    // Retain old values across actual new inventory publications, without
    // dereferencing them or substituting a simulated allocator/registry.
    std::vector<Client *> stale;
    for (size_t attempt = 0; attempt < 256; ++attempt) {
        Client *fresh = nullptr;
        check(ynx_link_ide_finite_get_open_original_v1(nullptr, &fresh) == 6 && fresh,
            "ABA fixture partial client not published");
        for (Client *old : stale) {
            CPacket *packet = foreignPacket;
            const int current = ynx_link_ide_finite_get_current_original_v1(old);
            const int abort = ynx_link_ide_finite_get_abort_original_v1(old);
            const int wait = ynx_link_ide_finite_get_wait_original_v1(old, 0, &packet);
            check(current == 1 && abort == 1 && wait == 1 && !packet,
                "freed client ABA reached fresh attempt: iteration=" + std::to_string(attempt) +
                " current=" + std::to_string(current) + " abort=" + std::to_string(abort) + " wait=" + std::to_string(wait));
        }
        check(first(fresh).code == 6, "stale calls changed fresh partial first cause");
        uint8_t done = 0;
        check(ynx_link_ide_finite_get_close_original_v1(fresh, &done) == 6 && done &&
            ynx_link_ide_finite_get_free_original_v1(fresh) == 0, "ABA fixture original partial did not drain");
        stale.push_back(fresh);
    }
}
void actualPartialClaim(const std::string &certs) {
    Server server(certs);Actual a(certs, server);
    a.input->deny_target_call = a.input->target_calls + 2; // after actual loan publication, second full-current check
    check(a.open() == 6, "post-publication Auth claim refusal lost");
    ynx_link_ide_get_lifetime_v1 life{};check(ynx_link_ide_finite_get_lifetime_v1_read(a.client, &life) == 0 && life.auth_loan_held && !life.started && !life.physical_complete,
        "nonnull actual Auth partial loan not adopted first");
    ynx_auth_ide_finite_get_loan_v1 *again = nullptr;
    check(ynx_auth_ide_finite_get_claim_original_v1(a.ticket, &again) == 2 && !again, "failed original claim was replayable");
    uint8_t closed = 1;check(TicketSource::close_original(a.ticket, &closed) == 1 && !closed && TicketSource::free_original(a.ticket) == 2,
        "partial loan silently discharged parent debt");
    check(first(a.client).code == 6 && first(a.client).auth_code == 2, "partial Auth first cause changed");a.finish(6, 2);
    server.stop();server.healthy();check(server.accepts() == 0 && server.requests().empty(), "rejected partial claim dispatched HTTP");
}
void actorAndPartialCause(const std::string &certs) {
    {
        Server server(certs);Actual a(certs, server);check(a.open() == 0 && a.wait() == 0, "actor fixture GET failed");
        const int target = a.input->target_calls, request = a.input->request_calls;int wrong = -1;
        std::thread other([&] { wrong = ynx_link_ide_finite_get_current_original_v1(a.client); });other.join();
        check(wrong == 6 && a.input->target_calls == target && a.input->request_calls == request && first(a.client).code == 6 && first(a.client).auth_code == 2,
            "wrong actor reached Origin or lost original refusal");
        check(ynx_auth_ide_finite_get_current_original_v1(a.ticket) == 0, "wrong actor check mutated Mother ticket into fabricated Origin denial");
        a.release();a.finish(6, 0);requestOnce(server, a);
    }
    {
        Server server(certs, ServerMode::partial);Actual a(certs, server);check(a.open() == 0, "partial response original open failed");
        const int code = a.wait();const auto v = a.view();const auto before = first(a.client);const std::string originalMessage = text(before.message);
        check(code != 0 && code != 5 && before.code == code && text(v.entity_original) == originalBody && !v.body_complete && v.dispatch_possible && v.unknown,
            "nonempty partial response/cause was discarded");
        uint8_t done = 1;(void)ynx_link_ide_finite_get_join_original_v1(a.client, 0, &done);check(!done, "partial packet debt joined early");
        (void)ynx_link_ide_finite_get_close_original_v1(a.client, &done);check(!done && first(a.client).code == before.code && text(first(a.client).message) == originalMessage,
            "DRAINING swallowed original partial cause");
        check(ynx_link_ide_finite_get_abort_original_v1(a.client) == 0, "explicit original abort failed");
        check(first(a.client).code == before.code && first(a.client).native_code == before.native_code && first(a.client).system_errno == before.system_errno,
            "abort replaced first cause");
        a.release();a.finish(before.code, 2);requestOnce(server, a);
    }
}
}
#ifdef YNX_LINK_IDE_FINITE_GET_ABI_FIXTURE_ONLY
int ynx_original_abi_controls_not_executed(int argc, char **argv) {
#else
int main(int argc, char **argv) {
#endif
    (void)::signal(SIGPIPE, SIG_IGN);
    try {
        check(argc == 2 || argc == 3, "explicit owned PUBLIC certificate directory and optional exact control selector required");
        check(std::string(ynx_runtime_version()).rfind("OpenSSL 3.6.4 ", 0) == 0, "wrong actual native runtime");
        const std::array<std::pair<const char *, void (*)(const std::string &)>, 4> controls{{
            {"actual-mother-loan-cabi-pq-get-crosspacket-and-debt", realGetAndDebt},
            {"null-foreign-handles-adopt-partial-before-status", foreignAndNull},
            {"actual-mother-post-publication-claim-failure-and-once-only-drain", actualPartialClaim},
            {"actor-source-current-and-partial-firstcause-abort-physical-drain", actorAndPartialCause},
        }};
        size_t executed = 0;
        for (const auto &control : controls) {
            if (argc == 3 && std::string(argv[2]) != control.first) continue;
            try { control.second(argv[1]); } catch (const std::exception &e) { std::cerr << control.first << ": " << e.what() << '\n';return 1; }
            std::cout << "{\"control\":\"" << control.first << "\",\"passed\":true}\n" << std::flush;
            ++executed;
        }
        check(executed != 0, "unknown exact ABI control selector");
        std::cout << "{\"summary\":true,\"controls\":" << executed << ",\"actualPQ\":" << (argc == 2 ? "true" : "false") << ",\"actualAuthMotherBody\":true,\"normalOriginMethodsImplemented\":false,\"oldTransportControlsExecuted\":0,\"RootAdmission\":false,\"SourceAdmission\":false}\n";return 0;
    } catch (const std::exception &e) { std::cerr << e.what() << '\n';return 2; }
}
