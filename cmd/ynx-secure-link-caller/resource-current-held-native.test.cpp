// PUBLIC real-kernel held-protocol controls, not a Go/Root/Source producer.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "resource_current_client_v2.h"
#include "resource-current-held-identity.hpp"
#include "resource-current-held-bound.hpp"
#include "resource-current-peer.hpp"
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fstream>
#include <future>
#include <iostream>
#include <memory>
#include <mutex>
#include <poll.h>
#include <signal.h>
#include <stdexcept>
#include <string>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

namespace {
namespace d = ynx::resource_current_detail;
using Client = ynx_link_resource_current_client_v2;
using Packet = ynx_link_resource_current_packet_v2;
using Life = ynx_link_resource_current_lifetime_v2;
using Clock = std::chrono::steady_clock;
std::string artifacts;unsigned serial = 0, controls = 0, retained_unknown = 0;
void check(bool ok, const std::string &why) { if (!ok) throw std::runtime_error(why); }
struct FD {
    int fd = -1;explicit FD(int n = -1) : fd(n) {}~FD() { if (fd >= 0) ::close(fd); }
    FD(const FD &) = delete;FD &operator=(const FD &) = delete;
    void reset(int n = -1) { if (fd >= 0) ::close(fd);fd = n; }
};
void write_all(int fd, const void *data, size_t n) {
    const auto *p = static_cast<const char *>(data);
    while (n) { ssize_t sent = ::write(fd, p, n);if (sent < 0 && errno == EINTR) continue;check(sent > 0, "fixture pipe/write failed");p += sent;n -= static_cast<size_t>(sent); }
}
void send_all(int fd, const std::string &raw) {
    size_t at = 0;
    while (at < raw.size()) {
#if defined(__linux__)
        constexpr int flags = MSG_NOSIGNAL;
#else
        constexpr int flags = 0;
#endif
        ssize_t n = ::send(fd, raw.data() + at, raw.size() - at, flags);if (n < 0 && errno == EINTR) continue;
        check(n > 0, "fixture socket send failed");at += static_cast<size_t>(n);
    }
}
struct Event { char code = 0;int value = 0, aux = 0; };
void emit(int fd, char code, int value = 0, int aux = 0) { Event e{code, value, aux};write_all(fd, &e, sizeof(e)); }
Event next(int fd) {
    Event event;size_t at = 0;const auto end = Clock::now() + std::chrono::seconds(4);
    while (at < sizeof(event)) {
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(end - Clock::now()).count();check(ms > 0, "fixture event deadline");
        struct pollfd p{fd, POLLIN, 0};int ready = ::poll(&p, 1, static_cast<int>(ms));if (ready < 0 && errno == EINTR) continue;
        check(ready > 0 && (p.revents & POLLIN), "fixture event closed/unavailable");
        ssize_t n = ::read(fd, reinterpret_cast<char *>(&event) + at, sizeof(event) - at);check(n > 0, "fixture event EOF");at += static_cast<size_t>(n);
    }
    check(event.code != '!', "child fixture failed; see owned FIRSTCAUSE");return event;
}
std::string quote(const std::string &s) {
    std::string out = "\"";const char *hex = "0123456789abcdef";
    for (unsigned char c : s) {
        if (c == '\\' || c == '"') { out += '\\';out += static_cast<char>(c); }
        else if (c < 0x20) { out += "\\u00";out += hex[c >> 4];out += hex[c & 15]; }
        else out += static_cast<char>(c);
    }
    return out + '"';
}
std::string json_identity(const d::HeldProcessIdentity &identity) {
    return "{\"pid\":" + std::to_string(identity.pid) + ",\"uid\":" + std::to_string(identity.uid) +
        ",\"startIdentity\":" + quote(identity.start_identity) + ",\"imagePath\":" + quote(identity.image_path) + ",\"imageSHA256\":" + quote(identity.image_sha256) + "}";
}
const char *operation(unsigned index) {
    static const char *values[]{"", "resource_current", "resource_current_retire", "resource_current_join", "resource_current_close"};
    check(index >= 1 && index <= 4, "fixture operation index");return values[index];
}
struct Remote {
    bool partial = true, retired = false, joined = false, closed = false;unsigned currents = 0, joins = 0;
};
std::string response_body(unsigned op, const std::string &id, Remote &remote, const std::string &mode,
                          d::HeldProcessIdentity server, d::HeldProcessIdentity caller) {
    std::string code, session = "PUBLIC_original_session";bool data = false;
    if (op == 1) {
        ++remote.currents;remote.partial = mode != "partial-false";
        data = mode != "partial-false" && mode != "partial-true" && !remote.retired;
        code = data ? "DATA_ONLY" : "UNAVAILABLE";
        if (remote.currents > 1) {
            if (mode == "session") session = "PUBLIC_foreign_session";
            if (mode == "server") ++server.pid;
            if (mode == "caller") caller.image_sha256[0] = caller.image_sha256[0] == '0' ? '1' : '0';
            if (mode == "partial-rollback") remote.partial = false;
        }
    } else if (op == 2) { remote.retired = true;code = "RETIRED"; }
    else if (op == 3) {
        ++remote.joins;
        if (mode == "pending" && remote.joins == 1) code = "PENDING";
        else { remote.joined = true;code = "DRAINED"; }
        if (mode == "rollback") { remote.retired = false;remote.joined = false;code = "PENDING"; }
    } else { remote.closed = true;code = mode == "wrong-close-ack" ? "DRAINED" : "CLOSED"; }
    std::string payload = "{\"code\":" + quote(code) + ",\"classification\":\"UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA\",\"authority\":false,\"registeredIssuer\":false,\"productionEnabled\":false";
    if (data) {
        const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count() - 1;
        payload += ",\"resourceCurrent\":{\"sourceId\":\"PUBLIC/source\",\"instanceId\":\"PUBLIC/instance\",\"resourceKey\":\"PUBLIC/resource\",\"epoch\":\"1\",\"sequence\":\"9007199254740993\",\"head\":\"" + std::string(64, 'a') +
            "\",\"status\":\"active\",\"issuedAtMs\":" + std::to_string(now) + ",\"expiresAtMs\":" + std::to_string(now + 20000) + "}";
    }
    auto boolean = [](bool value) { return value ? "true" : "false"; };
    payload += ",\"observation\":{\"sessionId\":" + quote(session) + ",\"server\":" + json_identity(server) + ",\"caller\":" + json_identity(caller) +
        ",\"lifetime\":{\"partialAcquired\":" + boolean(remote.partial) + ",\"retired\":" + boolean(remote.retired) + ",\"joined\":" + boolean(remote.joined) + ",\"physicalComplete\":" + boolean(remote.closed) + "}}}";
#if defined(__APPLE__)
    const char *credential = "darwin-LOCAL_PEERCRED-Xucred";
#else
    const char *credential = "linux-SO_PEERCRED";
#endif
    return "{\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":" + quote(id) + ",\"code\":\"OK\",\"peer\":{\"uid\":" + std::to_string(caller.uid) + ",\"gid\":" + std::to_string(::getegid()) +
        ",\"pid\":" + std::to_string(caller.pid) + ",\"credentialSource\":" + quote(credential) + ",\"nativeIPCVerified\":true,\"browserIdentityVerified\":false},\"result\":{\"payload\":" + payload + "}}";
}
void child_server(const std::string &path, const std::string &trace, const std::string &mode, int commands, int events, pid_t parent) {
    std::ofstream log(trace);FD listener(::socket(AF_UNIX, SOCK_STREAM, 0)), connection;
    struct sockaddr_un address{};address.sun_family = AF_UNIX;check(path.size() < sizeof(address.sun_path), "fixture socket path too long");std::strcpy(address.sun_path, path.c_str());
    check(listener.fd >= 0 && ::bind(listener.fd, reinterpret_cast<sockaddr *>(&address), sizeof(address)) == 0 && ::chmod(path.c_str(), 0600) == 0 && ::listen(listener.fd, 8) == 0, "fixture child listener failed");
    d::HeldProcessIdentity server, caller;std::string failure;
    check(d::observe_held_process(::getpid(), server, failure) && d::observe_held_process(parent, caller, failure), "fixture independent OS identity: " + failure);
    emit(events, 'L');Remote remote;unsigned accepts = 0, calls = 0;std::string input, waiting;
    const auto end = Clock::now() + std::chrono::seconds(20);
    while (Clock::now() < end) {
        struct pollfd fds[3]{{commands, POLLIN, 0}, {listener.fd, POLLIN, 0}, {connection.fd, POLLIN, 0}};
        int ready = ::poll(fds, 3, 1000);if (ready < 0 && errno == EINTR) continue;check(ready >= 0, "fixture child poll failed");
        if (fds[0].revents & POLLIN) {
            char command = 0;check(::read(commands, &command, 1) == 1, "fixture command closed");
            if (command == 'Q') { emit(events, 'Q', static_cast<int>(calls), static_cast<int>(accepts));continue; }
            if (command == 'Z') { log << "end calls=" << calls << " accepts=" << accepts << " remotePhysical=" << remote.closed << '\n';log.flush();return; }
            if (command == 'P') {
                check(::rename(path.c_str(), (path + ".old").c_str()) == 0, "fixture old endpoint preserve failed");
                FD replacement(::socket(AF_UNIX, SOCK_STREAM, 0));
                check(replacement.fd >= 0 && ::bind(replacement.fd, reinterpret_cast<sockaddr *>(&address), sizeof(address)) == 0 && ::chmod(path.c_str(), 0600) == 0 && ::listen(replacement.fd, 8) == 0, "fixture same-PID listener rebuild failed");
                listener.reset(replacement.fd);replacement.fd = -1;log << "same-pid endpoint rebuilt, old socket preserved\n";log.flush();emit(events, 'P');continue;
            }
            check(command == 'S' && !waiting.empty(), "unexpected fixture response release");send_all(connection.fd, waiting);waiting.clear();continue;
        }
        if (fds[1].revents & POLLIN) {
            int accepted = ::accept(listener.fd, nullptr, nullptr);check(accepted >= 0, "fixture accept failed");++accepts;
            if (connection.fd >= 0) { ::close(accepted);continue; }connection.reset(accepted);emit(events, 'A');
        }
        if (connection.fd >= 0 && (fds[2].revents & POLLIN)) {
            char bytes[4096];ssize_t n = ::recv(connection.fd, bytes, sizeof(bytes), 0);if (n <= 0) { connection.reset();continue; }input.append(bytes, static_cast<size_t>(n));
            const auto header = input.find("\r\n\r\n");if (header == std::string::npos) { check(input.size() < 4096, "oversized fixture request header");continue; }
            const auto length_at = input.find("Content-Length: ");check(length_at != std::string::npos && length_at < header, "fixture request length absent");
            const auto length = static_cast<size_t>(std::stoul(input.substr(length_at + 16)));check(length < 4096, "fixture request body bound");if (input.size() < header + 4 + length) continue;
            check(input.rfind("POST /v1/call HTTP/1.1\r\n", 0) == 0 && input.find("\r\nHost: localipc\r\n") < header && input.find("\r\nContent-Type: application/json\r\n") < header, "client changed original HTTP route/host/MIME");
            d::json_impl::Value request;check(d::json_impl::Parser(input.substr(header + 4, length)).parse(request) && d::json_impl::fields(request, {"version", "id", "operation", "payload"}), "fixture request shape");
            const auto &id = d::json_impl::field(request, "id"), &op = d::json_impl::field(request, "operation"), &payload = d::json_impl::field(request, "payload");
            check(d::json_impl::text(d::json_impl::field(request, "version"), "YNX-NETWORK-LOCAL-IPC/v1") && id.kind == d::json_impl::Value::Kind::string && d::json_impl::request_id_valid(id.text) && d::json_impl::fields(payload, {}), "fixture fixed original request envelope");
            unsigned index = 0;for (unsigned i = 1;i <= 4;++i) if (d::json_impl::text(op, operation(i))) index = i;check(index, "unregistered operation reached fixture");
            input.erase(0, header + 4 + length);++calls;const std::string body = response_body(index, id.text, remote, mode, server, caller);
            const std::string wire = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-PUBLIC-Held: original\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
            log << "operation " << index << " session=PUBLIC_original_session remotePhysical=" << remote.closed << '\n';log.flush();
            if (mode == "controlled" && index == 1 && remote.currents > 1) waiting = wire;
            else if (index == 4 && mode == "lost-close") connection.reset();
            else if (index == 4 && mode == "half-close") { send_all(connection.fd, wire.substr(0, wire.size() - body.size() / 2));(void)::shutdown(connection.fd, SHUT_WR); }
            else if (!(index == 4 && mode == "timeout-close")) send_all(connection.fd, wire);
            emit(events, 'R', static_cast<int>(index));
        }
    }
    throw std::runtime_error("fixture child lifetime deadline");
}
struct Server {
    pid_t pid = -1;FD commands, events;std::string path, root;
    explicit Server(const std::string &mode = "normal") {
        root = artifacts + "/c" + std::to_string(++serial);check(::mkdir(root.c_str(), 0700) == 0, "fixture directory create failed");path = root + "/s";check(path.size() < 104, "explicit artifacts root exceeds Unix socket path limit");
        int to[2], from[2];check(::pipe(to) == 0 && ::pipe(from) == 0, "fixture pipe failed");pid_t parent = ::getpid();pid = ::fork();check(pid >= 0, "fixture child fork failed");
        if (!pid) {
            ::close(to[1]);::close(from[0]);
            try { child_server(path, root + "/child.trace", mode, to[0], from[1], parent);::_exit(0); }
            catch (const std::exception &e) { std::ofstream failure(root + "/FIRSTCAUSE.txt");failure << e.what() << '\n';emit(from[1], '!');::_exit(2); }
        }
        ::close(to[0]);::close(from[1]);commands.reset(to[1]);events.reset(from[0]);expect('L');
    }
    ~Server() { if (pid > 0) { (void)::kill(pid, SIGTERM);int status;while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {} } }
    Event expect(char code) { Event e = next(events.fd);check(e.code == code, std::string("fixture expected ") + code + " got " + e.code);return e; }
    void call(unsigned op) { check(expect('R').value == static_cast<int>(op), "wrong actual wire operation order"); }
    void opened() { expect('A');call(1); }
    void command(char c) { write_all(commands.fd, &c, 1); }
    void counts(unsigned count) { command('Q');Event e = expect('Q');check(e.value == static_cast<int>(count) && e.aux == 1, "automatic retry/redial or lost expected original operation"); }
    void no_connection() { command('Q');Event e = expect('Q');check(e.value == 0 && e.aux == 0, "bound mismatch connected/dispatched to the endpoint"); }
    void finish() { command('Z');int status = 0;check(::waitpid(pid, &status, 0) == pid && WIFEXITED(status) && !WEXITSTATUS(status), "fixture child did not finish");pid = -1; }
};
struct Fence {
    std::atomic<int> holds{0}, releases{0}, reject{0}, reentry{0};Client *client = nullptr;
    std::mutex mutex;std::condition_variable changed;bool block_current = false, current_entered = false, allow_current = false;
    bool block_release = false, release_entered = false, allow_release = false;
    static int32_t retain(void *p) { ++static_cast<Fence *>(p)->holds;return 0; }
    static int32_t current(void *p) {
        auto &s = *static_cast<Fence *>(p);
        if (s.client) { Life life{};(void)ynx_link_resource_current_get_lifetime_v2(s.client, &life);(void)ynx_link_resource_current_current_local_v2(s.client);++s.reentry; }
        std::unique_lock<std::mutex> lock(s.mutex);if (s.block_current) { s.current_entered = true;s.changed.notify_all();s.changed.wait(lock, [&] { return s.allow_current; }); }return s.reject.load();
    }
    static void release(void *p) {
        auto &s = *static_cast<Fence *>(p);if (s.client) { Life life{};(void)ynx_link_resource_current_get_lifetime_v2(s.client, &life);++s.reentry; }
        std::unique_lock<std::mutex> lock(s.mutex);s.release_entered = true;s.changed.notify_all();if (s.block_release) s.changed.wait(lock, [&] { return s.allow_release; });--s.holds;++s.releases;
    }
    void unblock() { std::lock_guard<std::mutex> lock(mutex);allow_current = allow_release = true;changed.notify_all(); }
};
struct Owner {
    Fence fence;Client *client = nullptr;std::vector<const Packet *> packets;bool freed = false;
    ~Owner() { fence.unblock(); }
    void adopt(const Packet *packet) { if (packet) packets.push_back(packet); }
    int open(const ynx_link_resource_current_profile_v2 &profile) { const ynx_link_private_client_source_fence_v1 f{&fence, Fence::current, Fence::retain, Fence::release};const Packet *p = nullptr;int code = ynx_link_resource_current_open_v2(&profile, &f, &client, &p);fence.client = client;adopt(p);return code; }
    int open_bound(const ynx_link_resource_current_profile_v2 &profile, const d::HeldEndpointBinding &binding) { const ynx_link_private_client_source_fence_v1 f{&fence, Fence::current, Fence::retain, Fence::release};const Packet *p = nullptr;int code = d::open_bound_resource_current_v2(&profile, &f, binding, &client, &p);fence.client = client;adopt(p);return code; }
    std::pair<int, const Packet *> read() { const Packet *p = nullptr;int code = ynx_link_resource_current_read_v2(client, &p);adopt(p);return {code, p}; }
    std::pair<int, const Packet *> retire() { const Packet *p = nullptr;int code = ynx_link_resource_current_retire_v2(client, &p);adopt(p);return {code, p}; }
    void release(const Packet *packet) { check(packet && ynx_link_resource_current_release_packet_v2(client, packet) == 0, "owned r2 packet release failed");for (auto it = packets.begin();it != packets.end();++it) if (*it == packet) { packets.erase(it);return; }throw std::runtime_error("packet was not adopted"); }
    Life life() { Life out{};check(ynx_link_resource_current_get_lifetime_v2(client, &out) == 0, "lifetime diagnostic failed");return out; }
    void clear() { while (!packets.empty()) release(packets.back()); }
    void local_free() { check(packets.empty(), "local free still owns packet");check(ynx_link_resource_current_free_v2(client) == 0, "physically complete client did not free");freed = true;check(fence.holds == 0 && fence.releases == 1, "native original fence not dropped exactly once"); }
};
ynx_link_resource_current_profile_v2 make_profile(const Server &server) {
    ynx_link_resource_current_profile_v2 p{};p.version = 2;p.size = sizeof(p);p.peer.version = 1;p.peer.size = sizeof(p.peer);p.peer.peer_uid = ::geteuid();p.peer.peer_pid = server.pid;
    d::HeldProcessIdentity expected;d::ProcessStart start;std::string failure;
    check(d::observe_held_process(server.pid, expected, failure) && d::process_start(server.pid, start, failure), "fixture profile native process: " + failure);
    check(expected.image_path.size() < sizeof(p.peer.image_path) && expected.start_identity.size() < sizeof(p.expected_server_start_identity), "fixture profile identity bound");
    std::strcpy(p.peer.socket_path, server.path.c_str());std::strcpy(p.peer.image_path, expected.image_path.c_str());std::strcpy(p.expected_server_start_identity, expected.start_identity.c_str());
    p.peer.start_kind = start.kind;p.peer.start_a = start.a;p.peer.start_b = start.b;
    check(d::image_digest(expected.image_path, p.peer.image_bytes, p.peer.image_sha256, failure), failure);
    std::strcpy(p.peer.source_id, "PUBLIC/source");std::strcpy(p.peer.instance_id, "PUBLIC/instance");std::strcpy(p.peer.resource_key, "PUBLIC/resource");p.peer.timeout_ms = 1200;return p;
}
void passed(const char *label) { ++controls;std::cout << "{\"control\":\"" << label << "\",\"passed\":true}\n" << std::flush; }
// ACK packets are local debts. Each successful query below is followed by a
// distinct local probe, which must not emit another wire request.
void drain(Owner &owner, Server &server, unsigned initial_calls = 1, const Packet *retained_current = nullptr) {
    if (!retained_current) owner.clear();auto retired = owner.retire();check(retired.second, "Retire did not return its owned acknowledgement");server.call(2);owner.release(retired.second);
    const Packet *p = nullptr;uint8_t complete = 9;(void)ynx_link_resource_current_join_v2(owner.client, 1200, &complete, &p);owner.adopt(p);
    check(p && !complete && owner.life().remote_joined_ack, "Join acknowledgement erased packet debt");server.call(3);owner.release(p);p = nullptr;complete = 0;
    if (retained_current) {
        (void)ynx_link_resource_current_join_v2(owner.client, 0, &complete, &p);check(!complete && !p && owner.fence.holds == 1, "Join forgot an older owned Current packet");owner.release(retained_current);
    }
    (void)ynx_link_resource_current_join_v2(owner.client, 0, &complete, &p);check(complete && !p, "cached Join did not complete locally");
    complete = 9;(void)ynx_link_resource_current_close_v2(owner.client, &complete, &p);owner.adopt(p);check(p && !complete && owner.life().remote_close_ack && owner.fence.holds == 1, "Close acknowledgement dropped native parent before packet release");server.call(4);owner.release(p);p = nullptr;complete = 0;
    (void)ynx_link_resource_current_close_v2(owner.client, &complete, &p);check(complete && !p && owner.life().local_physical_complete, "CLOSED+packet drain did not physically complete");
    server.counts(initial_calls + 3);owner.local_free();server.finish();
}
void happy() {
    Server server;Owner owner;auto profile = make_profile(server);check(owner.open(profile) == 0 && owner.client && owner.packets.size() == 1, "first held Current/open failed");server.opened();
    std::strcpy(profile.expected_server_start_identity, "mutated-after-open");std::strcpy(profile.peer.resource_key, "PUBLIC/replaced-after-open");
    check(owner.packets[0]->transport.valid_current_data && owner.packets[0]->transport.body_complete && owner.life().remote_session_observed && owner.life().remote_partial_acquired, "first held DATA/lifetime missing");
    const Packet *original = owner.packets[0];auto next = owner.read();check(next.first == 0 && next.second && next.second->transport.valid_current_data, "same-fd subsequent Current failed");server.call(1);owner.release(next.second);
    drain(owner, server, 2, original);passed("same-fd-four-operations-two-stage-packet-drain");
}
void partial_unavailable() {
    for (const auto &mode : {"partial-true", "partial-false"}) {
        Server server(mode);Owner owner;check(owner.open(make_profile(server)) != 0 && owner.client && owner.packets.size() == 1, "known UNAVAILABLE lost partial owner/packet");server.opened();
        Life life = owner.life();check(life.remote_acquisition_possible && life.remote_session_observed && !life.remote_unknown && !life.remote_close_ack && owner.fence.holds == 1, "known published UNAVAILABLE was discarded/unknown");
        check(life.remote_partial_acquired == static_cast<uint8_t>(!std::strcmp(mode, "partial-true")), "partial flag changed");drain(owner, server);
    }
    passed("known-unavailable-with-and-without-reader-retains-attempt");
}
void pending_join() {
    Server server("pending");Owner owner;check(owner.open(make_profile(server)) == 0, "PENDING fixture open failed");server.opened();owner.clear();auto retired = owner.retire();server.call(2);owner.release(retired.second);
    const Packet *p = nullptr;uint8_t complete = 9;(void)ynx_link_resource_current_join_v2(owner.client, 1200, &complete, &p);owner.adopt(p);
    check(p && !complete && !owner.life().remote_unknown && !owner.life().remote_joined_ack, "known PENDING lost original debt");server.call(3);owner.release(p);server.counts(3);
    p = nullptr;(void)ynx_link_resource_current_join_v2(owner.client, 1200, &complete, &p);owner.adopt(p);check(p && !complete && owner.life().remote_joined_ack, "explicit same-session Join query did not drain");server.call(3);owner.release(p);
    p = nullptr;(void)ynx_link_resource_current_join_v2(owner.client, 0, &complete, &p);check(complete && !p, "Join cached probe failed");
    p = nullptr;(void)ynx_link_resource_current_close_v2(owner.client, &complete, &p);owner.adopt(p);check(p && !complete, "Close packet debt absent");server.call(4);owner.release(p);
    p = nullptr;(void)ynx_link_resource_current_close_v2(owner.client, &complete, &p);check(complete && !p, "Close local finalization failed");server.counts(5);owner.local_free();server.finish();passed("known-pending-needs-explicit-same-session-query");
}
void revoked_cleanup() {
    Server server;Owner owner;check(owner.open(make_profile(server)) == 0, "revocation fixture open failed");server.opened();owner.clear();owner.fence.reject = 91;
    auto rejected = owner.read();check(rejected.first != 0 && (!rejected.second || !rejected.second->transport.dispatch_possible), "revoked Source dispatched new Current");owner.clear();server.counts(1);
    drain(owner, server);passed("native-revocation-blocks-current-keeps-original-cleanup");
}
void inflight_retire() {
    Server server("controlled");Owner owner;check(owner.open(make_profile(server)) == 0, "inflight fixture open failed");server.opened();owner.clear();
    auto work = std::async(std::launch::async, [&] { return owner.read(); });server.call(1);auto retired = owner.retire();
    check(retired.first == YNX_LINK_RESOURCE_CURRENT_DRAINING_V1 && !retired.second && owner.life().local_retired, "inflight Retire wrote/forgot local fence");server.counts(2);server.command('S');auto response = work.get();
    check(response.first != 0 && response.second && response.second->transport.body_complete && !response.second->transport.valid_current_data && !owner.life().remote_unknown, "local Retire cut original complete response or guessed unknown");
    owner.release(response.second);drain(owner, server, 2);passed("inflight-current-retire-keeps-socket-and-original-response");
}
void packet_writer_barrier() {
    Server server;Owner owner;check(owner.open(make_profile(server)) == 0, "packet writer fixture open failed");server.opened();owner.clear();owner.fence.block_current = true;
    const Packet *published = nullptr;auto work = std::async(std::launch::async, [&] { return ynx_link_resource_current_read_v2(owner.client, &published); });
    {
        std::unique_lock<std::mutex> lock(owner.fence.mutex);if (!owner.fence.changed.wait_for(lock, std::chrono::seconds(2), [&] { return owner.fence.current_entered; })) { lock.unlock();owner.fence.unblock();throw std::runtime_error("native Current barrier absent"); }
    }
    // Only the pointer is observed through the fence-mutex publication. The
    // packet writer still owns every field until the async read has returned.
    bool held = published && ynx_link_resource_current_release_packet_v2(owner.client, published) == YNX_LINK_RESOURCE_CURRENT_DRAINING_V1;
    auto retired = owner.retire();bool busy = retired.first == YNX_LINK_RESOURCE_CURRENT_DRAINING_V1 && !retired.second;
    owner.fence.unblock();int code = work.get();owner.adopt(published);
    check(held && busy && code != 0 && published && !published->transport.dispatch_possible, "inflight packet/fd borrow was erased");owner.clear();server.counts(1);drain(owner, server);passed("inflight-packet-writer-borrow-cannot-release-or-close");
}
void release_barrier() {
    Server server;Owner owner;check(owner.open(make_profile(server)) == 0, "release barrier open failed");server.opened();owner.clear();auto retired = owner.retire();server.call(2);owner.release(retired.second);
    const Packet *p = nullptr;uint8_t complete = 0;(void)ynx_link_resource_current_join_v2(owner.client, 1200, &complete, &p);owner.adopt(p);server.call(3);owner.release(p);p = nullptr;
    (void)ynx_link_resource_current_join_v2(owner.client, 0, &complete, &p);check(complete && !p, "release fixture Join absent");
    (void)ynx_link_resource_current_close_v2(owner.client, &complete, &p);owner.adopt(p);server.call(4);owner.release(p);owner.fence.block_release = true;
    auto closer = std::async(std::launch::async, [&] { const Packet *out = nullptr;uint8_t done = 0;int code = ynx_link_resource_current_close_v2(owner.client, &done, &out);return std::make_pair(code, done); });
    {
        std::unique_lock<std::mutex> lock(owner.fence.mutex);if (!owner.fence.changed.wait_for(lock, std::chrono::seconds(2), [&] { return owner.fence.release_entered; })) { lock.unlock();owner.fence.unblock();throw std::runtime_error("physical release barrier absent"); }
    }
    p = nullptr;complete = 9;const int code = ynx_link_resource_current_close_v2(owner.client, &complete, &p);
    bool held = code == YNX_LINK_RESOURCE_CURRENT_DRAINING_V1 && !complete && !p && !owner.life().local_physical_complete && owner.fence.holds == 1 && ynx_link_resource_current_free_v2(owner.client) != 0;
    owner.fence.unblock();auto result = closer.get();check(held && result.second == 1 && owner.fence.holds == 0 && owner.fence.releases == 1, "CLOSED ACK erased still-running native release");
    server.counts(4);owner.local_free();server.finish();passed("remote-closed-plus-packet-drain-still-waits-native-release");
}
void retain_unknown(Owner *owner) {
    owner->clear();Life life = owner->life();check(life.remote_unknown && !life.local_physical_complete && owner->fence.holds == 1 && owner->fence.releases == 0, "remote UNKNOWN lost original native borrow");
    auto denied = owner->read();check(denied.first != 0 && (!denied.second || !denied.second->transport.dispatch_possible), "UNKNOWN dispatched another Current");owner->clear();
    const Packet *p = nullptr;uint8_t complete = 9;(void)ynx_link_resource_current_close_v2(owner->client, &complete, &p);owner->adopt(p);check(!complete && ynx_link_resource_current_free_v2(owner->client) != 0, "UNKNOWN close/free fabricated physical completion");owner->clear();
    ++retained_unknown;
    // Deliberately retain this heap owner/context until the isolated test
    // process exits. Test-server cleanup does NOT acknowledge the remote lease.
}
void lost_ack() {
    for (const auto &mode : {"lost-close", "half-close", "timeout-close"}) {
        Server server(mode);Owner *owner = new Owner;auto profile = make_profile(server);profile.peer.timeout_ms = 200;check(owner->open(profile) == 0, "UNKNOWN fixture open failed");server.opened();owner->clear();auto retired = owner->retire();server.call(2);owner->release(retired.second);
        const Packet *p = nullptr;uint8_t complete = 0;(void)ynx_link_resource_current_join_v2(owner->client, 1000, &complete, &p);owner->adopt(p);server.call(3);owner->release(p);p = nullptr;
        (void)ynx_link_resource_current_join_v2(owner->client, 0, &complete, &p);check(complete, "UNKNOWN fixture did not join");
        p = nullptr;complete = 9;int code = ynx_link_resource_current_close_v2(owner->client, &complete, &p);owner->adopt(p);server.call(4);
        check(code != 0 && !complete && p && p->transport.dispatch_possible, "lost Close ACK did not return owned UNKNOWN packet");
        if (!std::strcmp(mode, "half-close")) check(p->transport.packet_present && !p->transport.body_complete && p->transport.body_size > 0, "half Close prefix lost");
        int32_t native = 0, system = 0;check(ynx_link_resource_current_first_error_v2(owner->client, &native, &system) != 0, "ACK loss lost first cause");
        retain_unknown(owner);server.counts(4);server.finish();
    }
    passed("lost-half-timeout-close-ack-keeps-unknown-parent-no-redial");
}
void malformed_observations() {
    for (const auto &mode : {"session", "server", "caller", "partial-rollback", "rollback", "wrong-close-ack"}) {
        Server server(mode);Owner *owner = new Owner;check(owner->open(make_profile(server)) == 0, "malformed ACK fixture open failed");server.opened();owner->clear();
        unsigned total = 2;const Packet *packet = nullptr;int code = 0;uint8_t complete = 0;
        if (!std::strcmp(mode, "rollback") || !std::strcmp(mode, "wrong-close-ack")) {
            auto retired = owner->retire();server.call(2);owner->release(retired.second);code = ynx_link_resource_current_join_v2(owner->client, 1200, &complete, &packet);owner->adopt(packet);server.call(3);total = 3;
            if (!std::strcmp(mode, "wrong-close-ack")) {
                owner->release(packet);packet = nullptr;(void)ynx_link_resource_current_join_v2(owner->client, 0, &complete, &packet);check(complete && !packet, "wrong close ACK fixture Join failed");
                code = ynx_link_resource_current_close_v2(owner->client, &complete, &packet);owner->adopt(packet);server.call(4);total = 4;
            }
        } else { auto r = owner->read();code = r.first;packet = r.second;server.call(1); }
        check(code != 0 && packet && packet->transport.body_complete && !packet->transport.valid_current_data && !complete, "invalid session/identity/lifetime/operation ACK admitted");
        retain_unknown(owner);server.counts(total);server.finish();
    }
    passed("same-session-independent-os-lifetime-and-operation-ack-refusals");
}
d::HeldEndpointBinding endpoint_binding(const Server &server) {
    struct stat directory{}, socket{};
    check(::lstat(server.root.c_str(), &directory) == 0 && ::lstat(server.path.c_str(), &socket) == 0 && S_ISDIR(directory.st_mode) && S_ISSOCK(socket.st_mode), "fixture actual endpoint stat unavailable");
    return {static_cast<uint64_t>(directory.st_dev), static_cast<uint64_t>(directory.st_ino), static_cast<uint64_t>(socket.st_dev), static_cast<uint64_t>(socket.st_ino)};
}
void predispatch_partial_cleanup(Owner &owner, Server &server) {
    check(owner.client && owner.packets.empty() && owner.fence.holds == 1, "denied bound capture lost its original native partial");
    Life life = owner.life();check(!life.remote_acquisition_possible && !life.remote_session_observed && !life.remote_unknown, "prewrite endpoint refusal manufactured remote acquisition/UNKNOWN");
    auto retired = owner.retire();check(!retired.second, "prewrite cleanup sent remote Retire");
    const Packet *packet = nullptr;uint8_t complete = 0;(void)ynx_link_resource_current_join_v2(owner.client, 0, &complete, &packet);check(complete && !packet, "prewrite partial did not locally join");
    complete = 0;(void)ynx_link_resource_current_close_v2(owner.client, &complete, &packet);check(complete && !packet, "prewrite partial did not locally close");
    int32_t native = 0, system = 0;check(ynx_link_resource_current_first_error_v2(owner.client, &native, &system) == YNX_LINK_RESOURCE_CURRENT_DENIED_V1, "bound denial first cause changed during cleanup");
    server.no_connection();owner.local_free();server.finish();
}
void bound_endpoints() {
    {
        Server server;Owner owner;auto binding = endpoint_binding(server);
        check(owner.open_bound(make_profile(server), binding) == 0 && owner.client && owner.packets.size() == 1, "correct original four-stamp binding rejected");server.opened();
        binding.directory_inode ^= 1;binding.socket_inode ^= 1; // caller copy cannot retarget the captured binding
        owner.clear();auto result = owner.read();check(result.first == 0 && result.second && result.second->transport.valid_current_data, "private binding was not immutable after capture");server.call(1);owner.release(result.second);drain(owner, server, 2);
    }
    for (unsigned field = 0;field < 4;++field) {
        Server server;Owner owner;auto binding = endpoint_binding(server);
        if (field == 0) binding.directory_device ^= 1;
        else if (field == 1) binding.directory_inode ^= 1;
        else if (field == 2) binding.socket_device ^= 1;
        else binding.socket_inode ^= 1;
        check(owner.open_bound(make_profile(server), binding) == YNX_LINK_RESOURCE_CURRENT_DENIED_V1, "a wrong original endpoint stamp was accepted");predispatch_partial_cleanup(owner, server);
    }
    {
        Server server;Owner owner;const auto original = endpoint_binding(server);const auto profile = make_profile(server);
        d::ProcessStart before, after;std::string failure;check(d::process_start(server.pid, before, failure), failure);
        server.command('P');server.expect('P');const auto replacement = endpoint_binding(server);
        check(replacement.directory_device == original.directory_device && replacement.directory_inode == original.directory_inode && replacement.socket_inode != original.socket_inode &&
            d::process_start(server.pid, after, failure) && before.kind == after.kind && before.a == after.a && before.b == after.b, "fixture did not preserve same server process while replacing the actual socket");
        check(owner.open_bound(profile, original) == YNX_LINK_RESOURCE_CURRENT_DENIED_V1, "same PID/path replacement bypassed original endpoint binding");predispatch_partial_cleanup(owner, server);
    }
    passed("original-endpoint-four-stamps-prewrite-and-same-pid-replacement");
}
}
int main(int argc, char **argv) {
    ::signal(SIGPIPE, SIG_IGN);
    try {
        check(argc == 2 || (argc == 3 && std::string(argv[2]) == "--endpoint-bound"), "explicit owned artifacts directory and closed optional selector required");artifacts = argv[1];struct stat info{};
        check(::lstat(artifacts.c_str(), &info) == 0 && S_ISDIR(info.st_mode) && info.st_uid == ::geteuid() && (info.st_mode & 0777) == 0700, "private owned artifacts directory required");
        if (argc == 3) { bound_endpoints();std::cout << "{\"boundSummary\":true,\"controls\":1,\"boundCases\":6,\"actualGoServer\":false,\"transportOnly\":true,\"RootAdmission\":false,\"SourceAdmission\":false}\n";return 0; }
        happy();partial_unavailable();pending_join();revoked_cleanup();inflight_retire();packet_writer_barrier();release_barrier();lost_ack();malformed_observations();
        std::cout << "{\"summary\":true,\"controls\":" << controls << ",\"unknownParentsRetained\":" << retained_unknown << ",\"actualGoServer\":false,\"transportOnly\":true,\"RootAdmission\":false,\"SourceAdmission\":false}\n";return 0;
    } catch (const std::exception &e) { std::cerr << "FIRSTCAUSE: " << e.what() << '\n';return 1; }
}
