// PUBLIC Origin definitions are imported only for this test executable. Actual
// Auth ticket/loan, original C bridge and actual PQ worker bodies are linked.
#ifndef YNX_LINK_IDE_FINITE_GET_FINISH_PUBLIC_CONTROLS
#error Finish PUBLIC controls cannot enter a normal Native image
#endif
#define YNX_LINK_IDE_FINITE_GET_ABI_FIXTURE_ONLY
#include "ide-finite-get-abi.test.cpp"
#include "ide_finite_get_finish_private_v1.h"

namespace finish_public {
using Status = ynx_link_ide_get_finish_status_v1;
int finish(ynx_auth_ide_finite_get_ticket_v1 *ticket, Client *client, uint32_t ms, Status &s) {
    s = {};return ynx_link_ide_finite_get_finish_ticket_original_v1(ticket, client, ms, &s);
}
void closedFalse(const Status &s) {
    check(s.version == 1 && s.size == sizeof(s) && !s.finished && !s.physical_complete,
          "foreign/unopened pair manufactured finish/physical success");
}
void ticketDrop(Actual &a, int authCode = 0) {
    check(a.input->fds.originalFDsIntact(), "finish moved or closed original credential FDs");
    check(ynx_link_ide_finite_get_free_original_v1(a.client) == 0, "finish left completed LINK client unfreeable");a.client = nullptr;
    uint8_t closed = 0;check(TicketSource::close_original(a.ticket, &closed) == authCode && closed, "finish did not physically release actual Auth loan");
    check(TicketSource::free_original(a.ticket) == 0, "actual closed original ticket failed free");a.ticket = nullptr;
    check(a.input->target_destroyed == 1 && a.input->request_destroyed == 1, "original sealed custody did not drop exactly once");
}
void exactPair(const std::string &certs) {
    Server firstServer(certs), otherServer(certs);Actual a(certs, firstServer), other(certs, otherServer);
    check(a.open() == 0 && a.wait() == 0, "pair fixture actual PQ request failed");
    // Both fixture operations use the same textual operation ID. That DATA is
    // deliberately insufficient to select another ticket's native attempt.
    check(a.input->expected.original_operation_id == other.input->expected.original_operation_id, "pair test needs identical operation DATA");
    const int target = a.input->target_calls, request = a.input->request_calls;Status s{};
    const auto foreign = reinterpret_cast<ynx_auth_ide_finite_get_ticket_v1 *>(uintptr_t(0x12340));
    const auto unopened = reinterpret_cast<Client *>(uintptr_t(0x56780));
    for (auto *ticket : {static_cast<ynx_auth_ide_finite_get_ticket_v1 *>(nullptr), foreign, other.ticket}) {
        check(finish(ticket, a.client, 0, s) == 1, "wrong/null/foreign/other original ticket accepted");closedFalse(s);
    }
    for (auto *client : {static_cast<Client *>(nullptr), unopened}) {
        check(finish(a.ticket, client, 0, s) == 1, "unopened/foreign client accepted");closedFalse(s);
    }
    check(ynx_link_ide_finite_get_finish_ticket_original_v1(a.ticket, a.client, 0, nullptr) == 1, "null finish out accepted");
    check(finish(a.ticket, a.client, 30001, s) == 1, "unbounded finish timeout accepted");closedFalse(s);
    check(a.input->target_calls == target && a.input->request_calls == request && first(a.client).code == 0,
          "wrong pair/progress invoked Source or poisoned the original attempt");
    a.release();check(finish(a.ticket, a.client, 3000, s) == 0 && s.finished && s.physical_complete && s.response_known &&
        s.response_released && s.worker_joined && !s.auth_loan_held && !s.cleanup_unknown && !s.first_code,
        "same actual original ticket/client did not finish");
    ticketDrop(a);requestOnce(firstServer, a);
    uint8_t closed = 0;check(TicketSource::close_original(other.ticket, &closed) == 0 && closed && TicketSource::free_original(other.ticket) == 0,
        "unopened other ticket cleanup failed");other.ticket = nullptr;
    otherServer.stop();otherServer.healthy();check(otherServer.accepts() == 0, "wrong pair dispatched another original target");
}

struct Gate final {
    std::mutex mutex;std::condition_variable changed;bool entered = false, released = false;
    void wait() {std::unique_lock<std::mutex> lock(mutex);entered = true;changed.notify_all();
        check(changed.wait_until(lock, Clock::now() + 3s, [this] {return released;}), "PUBLIC response barrier did not release");}
    void release() {std::lock_guard<std::mutex> lock(mutex);released = true;changed.notify_all();}
    ~Gate() {release();}
};
void noReadyAndPacketDebt(const std::string &certs) {
    Gate gate;Server server(certs, ServerMode::normal, [&] {gate.wait();});Actual a(certs, server);
    struct Release final {Gate &gate;~Release(){gate.release();}} release{gate};
    check(a.open() == 0 && server.waitRequest(), "pre-ready fixture did not write one actual GET");
    Status s{};const int beforeTarget = a.input->target_calls;
    check(finish(a.ticket, a.client, 0, s) == 5 && !s.finished && !s.physical_complete && !s.response_known,
        "pre-ready finish retired original worker or manufactured completion");
    check(first(a.client).code == 0 && a.input->target_calls == beforeTarget, "pre-ready DRAINING reached Source or became sticky");
    ynx_link_ide_get_lifetime_v1 life{};check(ynx_link_ide_finite_get_lifetime_v1_read(a.client, &life) == 0 && !life.retired && life.started,
        "pre-ready probe called join/retire before original response");
    gate.release();check(a.wait() == 0, "pre-ready probe prevented actual response");
    const auto v = a.view();check(v.body_complete && !v.unknown && text(v.entity_original) == originalBody && text(v.headers_original) == originalHeaders(),
        "finish probe changed complete original response bytes");
    check(finish(a.ticket, a.client, 0, s) == 5 && s.response_known && !s.response_released && !s.physical_complete && !s.finished && first(a.client).code == 0,
        "held original packet debt was auto-released or progress became first cause");
    a.release();check(finish(a.ticket, a.client, 3000, s) == 0 && s.finished && s.physical_complete && !s.auth_loan_held,
        "released original packet did not allow physical finish");
    ticketDrop(a);requestOnce(server, a);
}
void successAndOnce(const std::string &certs) {
    Server server(certs);Actual a(certs, server);check(a.open() == 0 && a.wait() == 0, "success actual PQ request failed");
    auto v = a.view();check(v.status_code == 200 && v.body_complete && v.dispatch_possible && !v.unknown && !v.failure.code &&
        text(v.entity_original) == originalBody && text(v.headers_original) == originalHeaders() && !v.trailers_original.size,
        "actual full original body/header response changed before finish");
    a.release();Status s{};check(finish(a.ticket, a.client, 3000, s) == 0 && s.finished && s.physical_complete && !s.auth_loan_held,
        "known same-operation response with real join/close not finished");
    check(finish(a.ticket, a.client, 0, s) == 7 && !s.finished && s.physical_complete, "closed finish ACK was reminted; SDK must cache its unique once result");
    auto *oldClient = a.client;auto *oldTicket = a.ticket;ticketDrop(a);requestOnce(server, a);
    Server unused(certs);
    // Real Auth allocation/free may reuse a raw ticket address. The immutable
    // LINK client operand must still reject every previously closed pair.
    for (int i = 0; i < 64; ++i) {
        Actual fresh(certs, unused);
        check(finish(oldTicket, oldClient, 0, s) == 1 && !s.finished &&
          finish(fresh.ticket, oldClient, 0, s) == 1 && !s.finished, "old/ABA ticket reached a fresh or closed attempt");
        uint8_t closed = 0;check(TicketSource::close_original(fresh.ticket, &closed) == 0 && closed && TicketSource::free_original(fresh.ticket) == 0,
          "actual unopened ticket ABA fixture cleanup failed");fresh.ticket = nullptr;
    }
    unused.stop();unused.healthy();check(unused.accepts() == 0, "stale pair created network attempt");
}
void partialUnknown(const std::string &certs) {
    Server server(certs, ServerMode::partial);Actual a(certs, server);check(a.open() == 0, "partial original open failed");
    const int code = a.wait();auto v = a.view();const auto error = first(a.client);const auto message = text(error.message);
    check(code != 0 && code != 5 && !v.body_complete && v.unknown && v.dispatch_possible && text(v.entity_original) == originalBody,
        "partial response lost actual original bytes/error");
    Status s{};(void)finish(a.ticket, a.client, 0, s);check(!s.finished && !s.physical_complete, "partial packet debt counted complete");
    a.release();const int final = finish(a.ticket, a.client, 3000, s);
    check(final == error.code && !s.finished && s.physical_complete && !s.response_known && !s.auth_loan_held && s.first_code == error.code,
        "physical join/close was mislabeled known logical completion for partial UNKNOWN");
    check(first(a.client).code == error.code && text(first(a.client).message) == message, "finish replaced original partial first cause");
    ticketDrop(a);requestOnce(server, a);
}
void liveClaimIgnoresFailedDuplicate(const std::string &certs) {
    Server server(certs);Actual a(certs, server);check(a.open() == 0 && a.wait() == 0, "live claim fixture PQ failed");a.release();
    Client *partial = nullptr;
    check(ynx_link_ide_finite_get_open_original_v1(a.ticket, &partial) == 6 && partial && partial != a.client,
        "duplicate actual claim must publish its refused cleanup-owning partial");
    ynx_link_ide_get_lifetime_v1 life{};
    check(ynx_link_ide_finite_get_lifetime_v1_read(partial, &life) == 0 && !life.started && !life.auth_loan_held && first(partial).code == 6,
        "failed duplicate partial secretly acquired a live Auth claim");
    Status status{};const int code = finish(a.ticket, a.client, 3000, status);
    check(code == 0 && status.finished && status.physical_complete && !status.auth_loan_held,
        "unclaimed duplicate partial falsely denied the one real original claim: code=" + std::to_string(code));
    uint8_t done = 0;
    check(ynx_link_ide_finite_get_join_original_v1(partial, 0, &done) == 6 && done &&
        ynx_link_ide_finite_get_close_original_v1(partial, &done) == 6 && done && first(partial).code == 6 &&
        ynx_link_ide_finite_get_free_original_v1(partial) == 0,
        "unclaimed duplicate partial failed original first-cause cleanup");
    ticketDrop(a);requestOnce(server, a);
}

void zeroDispatchAndLateRevoke(const std::string &certs) {
    {
        Server server(certs);Actual a(certs, server);a.input->deny_target_call = a.input->target_calls + 2;
        check(a.open() == 6, "actual post-claim Source refusal not reached");Status s{};
        check(finish(a.ticket, a.client, 0, s) == 1 && !s.finished && !s.physical_complete,
            "failed-open partial was accepted as a live finish request");
        uint8_t done = 0;check(ynx_link_ide_finite_get_join_original_v1(a.client, 0, &done) == 6 && done &&
          ynx_link_ide_finite_get_close_original_v1(a.client, &done) == 6 && done, "failed-open original partial did not physically clean up");
        check(finish(a.ticket, a.client, 0, s) == 7 && !s.finished && s.physical_complete && !s.response_known && !s.auth_loan_held,
            "no-worker zero-dispatch physical cleanup became known read success");
        ticketDrop(a, 2);server.stop();server.healthy();check(server.accepts() == 0, "rejected original Source dispatched");
    }
    {
        std::shared_ptr<abi_public::Input> input;Server server(certs, ServerMode::revoke, [&] {check(input != nullptr, "late revoke fixture missing owned input");input->current = false;});
        Actual a(certs, server);input = a.input;check(a.open() == 0 && a.wait() == 0, "late original actor Source fixture did not retain full response");
        const auto response = a.view();check(response.body_complete && text(response.entity_original) == originalBody, "late source test lost full original raw bytes");
        a.release();Status s{};const int code = finish(a.ticket, a.client, 3000, s);
        check(code == 6 && !s.finished && s.physical_complete && !s.auth_loan_held && s.first_code == 6,
            "late actual Source current error was converted to complete despite physical cleanup");
        ticketDrop(a, 2);requestOnce(server, a);
    }
}
}
int main(int argc, char **argv) {
    (void)::signal(SIGPIPE, SIG_IGN);
    try {
        check(argc == 2 || argc == 3, "explicit owned PUBLIC cert directory and optional exact new control selector required");
        check(std::string(ynx_runtime_version()).rfind("OpenSSL 3.6.4 ", 0) == 0, "wrong native PQ runtime");
        const std::array<std::pair<const char *, void (*)(const std::string &)>, 6> groups{{
            {"finish-exact-original-pair-and-no-textual-operation-grant", finish_public::exactPair},
            {"finish-pre-ready-and-packet-debt-no-retire-no-sticky", finish_public::noReadyAndPacketDebt},
            {"finish-known-full-raw-success-closed-once-and-ticket-aba", finish_public::successAndOnce},
            {"finish-partial-unknown-physical-complete-is-not-finished", finish_public::partialUnknown},
            {"finish-zero-dispatch-and-late-source-cause-not-grant", finish_public::zeroDispatchAndLateRevoke},
            {"finish-live-claim-ignores-unclaimed-duplicate-partial", finish_public::liveClaimIgnoresFailedDuplicate},
        }};
        size_t executed = 0;
        for (const auto &group : groups) {if (argc == 3 && std::string(argv[2]) != group.first) continue;
            try {group.second(argv[1]);} catch (const std::exception &e) {std::cerr << group.first << ": " << e.what() << '\n';return 1;}
            std::cout << "{\"control\":\"" << group.first << "\",\"passed\":true}\n" << std::flush;++executed;}
        check(executed == (argc == 3 ? 1U : groups.size()), "exact finish control selector matched no controls");
        std::cout << "{\"summary\":true,\"controls\":" << executed << ",\"actualPQ\":true,\"actualAuthMotherBody\":true,\"normalOriginMethodsImplemented\":false,\"oldTransportControlsExecuted\":0,\"oldABIControlsExecuted\":0,\"RootAdmission\":false,\"SourceAdmission\":false}\n";
        return 0;
    } catch (const std::exception &e) {std::cerr << e.what() << '\n';return 1;}
}
