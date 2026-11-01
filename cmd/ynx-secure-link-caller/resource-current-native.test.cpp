// PUBLIC kernel transport fixture. This is not P09 Go, Auth, Root or Source.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "resource_current_client_v1.h"
#include "resource-current-peer.hpp"
#include <atomic>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <future>
#include <iostream>
#include <mutex>
#include <poll.h>
#include <signal.h>
#include <sstream>
#include <stdexcept>
#include <string>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>
#if defined(__APPLE__)
#include <libproc.h>
#include <sys/proc_info.h>
#else
#include <limits.h>
#endif

namespace {
using Client = ynx_link_resource_current_client_v1;
using Packet = ynx_link_resource_current_packet_v1;
namespace detail = ynx::resource_current_detail;
using Clock = std::chrono::steady_clock;
void require(bool ok, const std::string &message) { if (!ok) throw std::runtime_error(message); }
std::string directory, executable;
unsigned case_number = 0, controls = 0;

struct FD {
    int value = -1;
    FD() = default;
    explicit FD(int fd) : value(fd) {}
    ~FD() { if (value >= 0) ::close(value); }
    FD(const FD &) = delete;
    FD &operator=(const FD &) = delete;
    void reset(int fd = -1) { if (value >= 0) ::close(value); value = fd; }
};
void write_all(int fd, const void *raw, size_t length) {
    const auto *bytes = static_cast<const char *>(raw);
    while (length) {
        ssize_t n = ::write(fd, bytes, length);
        if (n < 0 && errno == EINTR) continue;
        require(n > 0, "fixture write failed"); bytes += n; length -= static_cast<size_t>(n);
    }
}
void send_all(int fd, const std::string &raw) {
    size_t at = 0;
    while (at < raw.size()) {
#if defined(__linux__)
        constexpr int flags = MSG_NOSIGNAL;
#else
        constexpr int flags = 0;
#endif
        ssize_t n = ::send(fd, raw.data() + at, raw.size() - at, flags);
        if (n < 0 && errno == EINTR) continue;
        require(n > 0, "fixture send failed"); at += static_cast<size_t>(n);
    }
}
struct Event { char code = 0; int value = 0; };
void event(int fd, char code, int value = 0) { Event e{code, value}; write_all(fd, &e, sizeof(e)); }
Event receive_event(int fd, int milliseconds = 4000) {
    Event e; size_t at = 0;const auto end = Clock::now() + std::chrono::milliseconds(milliseconds);
    while (at < sizeof(e)) {
        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(end - Clock::now()).count();
        require(remaining > 0, "fixture event deadline");
        struct pollfd p{fd, POLLIN, 0};int ready = ::poll(&p, 1, static_cast<int>(remaining));
        if (ready < 0 && errno == EINTR) continue;
        require(ready > 0 && (p.revents & POLLIN), "fixture event unavailable");
        ssize_t n = ::read(fd, reinterpret_cast<char *>(&e) + at, sizeof(e) - at);
        require(n > 0, "fixture event closed");at += static_cast<size_t>(n);
    }
    require(e.code != '!', "child fixture failure (see owned trace)");return e;
}

std::string current_image(pid_t pid) {
#if defined(__APPLE__)
    char path[PROC_PIDPATHINFO_MAXSIZE]{};
    require(::proc_pidpath(pid, path, sizeof(path)) > 0, "kernel image path unavailable");return path;
#else
    char path[PATH_MAX]{};const std::string link = "/proc/" + std::to_string(pid) + "/exe";
    ssize_t n = ::readlink(link.c_str(), path, sizeof(path));
    require(n > 0 && static_cast<size_t>(n) < sizeof(path), "kernel image path unavailable");return {path, static_cast<size_t>(n)};
#endif
}
bool child_socket_open(pid_t pid, int fd) {
#if defined(__APPLE__)
    struct socket_fdinfo info{};
    return ::proc_pidfdinfo(pid, fd, PROC_PIDFDSOCKETINFO, &info, sizeof(info)) == sizeof(info) && info.psi.soi_family == AF_UNIX;
#else
    const std::string path = "/proc/" + std::to_string(pid) + "/fd/" + std::to_string(fd);
    char link[256]{};ssize_t n = ::readlink(path.c_str(), link, sizeof(link));
    return n >= 8 && std::string(link, static_cast<size_t>(n)).rfind("socket:[", 0) == 0;
#endif
}
std::string frame(const std::string &id, pid_t client, const std::string &mode) {
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count() - 1;
#if defined(__APPLE__)
    const char *credential = "darwin-LOCAL_PEERCRED-Xucred";
#else
    const char *credential = "linux-SO_PEERCRED";
#endif
    return "{\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":\"" + (mode == "wrong-id" ? "wrong" : id) +
        "\",\"code\":\"OK\",\"peer\":{\"uid\":" + std::to_string(::geteuid()) + ",\"gid\":" + std::to_string(::getegid()) +
        ",\"pid\":" + std::to_string(client + (mode == "reflection" ? 1 : 0)) + ",\"credentialSource\":\"" + credential +
        "\",\"nativeIPCVerified\":true,\"browserIdentityVerified\":false},\"result\":{\"payload\":{\"code\":\"DATA_ONLY\","
        "\"classification\":\"UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA\",\"authority\":false,\"registeredIssuer\":false,"
        "\"productionEnabled\":false,\"resourceCurrent\":{\"sourceId\":\"PUBLIC/source\",\"instanceId\":\"PUBLIC/instance\","
        "\"resourceKey\":\"" + std::string(mode == "resource" ? "PUBLIC/other" : "PUBLIC/resource") +
        "\",\"epoch\":\"1\",\"sequence\":\"9007199254740993\",\"head\":\"" + std::string(64, 'a') +
        "\",\"status\":\"active\",\"issuedAtMs\":" + std::to_string(now) + ",\"expiresAtMs\":" + std::to_string(now + 20000) + "}}}}";
}
std::string wire_response(const std::string &body, const std::string &mode) {
    const std::string start = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-PUBLIC-Original: exact\r\n";
    if (mode == "clte") return start + "Content-Length: " + std::to_string(body.size()) + "\r\nTransfer-Encoding: chunked\r\n\r\n" + body;
    if (mode == "header-bound") return start + "X-PUBLIC-Large: " + std::string(4096, 'x') + "\r\nContent-Length: 0\r\n\r\n";
    if (mode == "body-bound") return start + "Content-Length: 16385\r\n\r\n";
    if (mode == "truncated") return start + "Content-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body.substr(0, 31);
    if (mode == "chunked" || mode == "chunk-extension" || mode == "chunk-trailer") {
        std::ostringstream size;size << std::hex << body.size();
        return start + "Transfer-Encoding: chunked\r\n\r\n" + size.str() + (mode == "chunk-extension" ? ";x=y" : "") +
            "\r\n" + body + "\r\n0\r\n" + (mode == "chunk-trailer" ? "X-PUBLIC: no\r\n" : "") + "\r\n";
    }
    if (mode == "bad-frame") return start + "Content-Length: 2\r\n\r\n{}";
    return start + "Content-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
}
int listener(const std::string &path) {
    require(path.size() < sizeof(((sockaddr_un *)nullptr)->sun_path), "owned socket path exceeds platform limit");
    FD socket(::socket(AF_UNIX, SOCK_STREAM, 0));require(socket.value >= 0, "child socket creation failed");
    struct sockaddr_un address{};address.sun_family = AF_UNIX;std::memcpy(address.sun_path, path.c_str(), path.size() + 1);
    require(::bind(socket.value, reinterpret_cast<sockaddr *>(&address), sizeof(address)) == 0 && ::chmod(path.c_str(), 0600) == 0 && ::listen(socket.value, 8) == 0,
        "child private listener failed");int out = socket.value;socket.value = -1;return out;
}

// Child owns the real listener and accepted endpoint. The parent never mints
// a fake peer identity. Pipes are test scheduling only, never client inputs.
void serve_child(const std::string &path, const std::string &trace, const std::string &mode, int command, int events, pid_t client) {
    std::ofstream log(trace);FD server(listener(path)), connection;unsigned requests = 0, accepts = 0;std::string pending, waiting;
    event(events, 'L');
    const auto end = Clock::now() + std::chrono::seconds(15);
    while (Clock::now() < end) {
        struct pollfd p[3]{{command, POLLIN, 0}, {server.value, POLLIN, 0}, {connection.value, POLLIN, 0}};
        int n = ::poll(p, 3, 1000);if (n < 0 && errno == EINTR) continue;require(n >= 0, "child poll failed");
        if (p[0].revents & POLLIN) {
            char c = 0;require(::read(command, &c, 1) == 1, "child command closed");
            if (c == 'Q') { event(events, 'Q', static_cast<int>(accepts));continue; }
            if (c == 'Z') { log << "done accepts=" << accepts << " requests=" << requests << '\n';log.flush();return; }
            if (c == 'D') { connection.reset();event(events, 'D');continue; }
            if (c == 'P') {
                require(::rename(path.c_str(), (path + ".old").c_str()) == 0, "fixture endpoint rename failed");
                server.reset(listener(path));event(events, 'P');continue;
            }
            if (c == 'E') {
                require(connection.value >= 0 && ::fcntl(connection.value, F_SETFD, 0) == 0, "fixture exec descriptor preservation failed");
                log << "exec acceptedfd=" << connection.value << '\n';log.flush();event(events, 'E', connection.value);
                server.reset();::execl("/bin/sleep", "sleep", "10", static_cast<char *>(nullptr));throw std::runtime_error("fixture exec failed");
            }
            require(c == 'S' && !waiting.empty(), "fixture unexpected response release");
            send_all(connection.value, waiting);waiting.clear();continue;
        }
        if (p[1].revents & POLLIN) {
            int fd = ::accept(server.value, nullptr, nullptr);require(fd >= 0, "child accept failed");
            if (connection.value >= 0) { ::close(fd);++accepts;event(events, 'A', fd);continue; }
            connection.reset(fd);++accepts;log << "accept " << accepts << " fd=" << fd << '\n';log.flush();event(events, 'A', fd);
        }
        if (connection.value >= 0 && (p[2].revents & POLLIN)) {
            char bytes[4096];ssize_t got = ::recv(connection.value, bytes, sizeof(bytes), 0);
            if (got <= 0) { connection.reset();continue; }pending.append(bytes, static_cast<size_t>(got));
            const size_t header = pending.find("\r\n\r\n");if (header == std::string::npos) { require(pending.size() < 4096, "fixture oversized request header");continue; }
            const auto cl = pending.find("Content-Length: ");require(cl != std::string::npos && cl < header, "fixture request length absent");
            const size_t length = static_cast<size_t>(std::stoul(pending.substr(cl + 16)));require(length < 4096, "fixture request too large");
            if (pending.size() < header + 4 + length) continue;
            ++requests;const std::string id = "lrc-" + std::to_string(requests);
            const std::string body = "{\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":\"" + id + "\",\"operation\":\"resource_current\",\"payload\":{}}";
            const std::string expected = "POST /v1/call HTTP/1.1\r\nHost: localipc\r\nContent-Type: application/json\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
            require(pending.substr(0, header + 4 + length) == expected, "client changed fixed original resource_current request");
            pending.erase(0, header + 4 + length);log << "request " << requests << " exact=true\n";log.flush();
            const std::string response = wire_response(frame(id, client, mode), mode);
            if (mode == "controlled") waiting = response;
            else { send_all(connection.value, response);if (mode == "truncated") (void)::shutdown(connection.value, SHUT_WR); }
            event(events, 'R', static_cast<int>(requests));
        }
    }
    throw std::runtime_error("child lifetime deadline");
}

struct Server {
    pid_t pid = -1;int accepted_fd = -1;FD command, events;std::string path, own_directory;bool execed = false;
    explicit Server(const std::string &mode = "normal") {
        own_directory = directory + "/c" + std::to_string(++case_number);require(::mkdir(own_directory.c_str(), 0700) == 0, "own fixture directory failed");
        path = own_directory + "/s";require(path.size() < 104, "artifact root must provide a socket path below 104 bytes; no fallback");
        int commands[2], notices[2];require(::pipe(commands) == 0 && ::pipe(notices) == 0, "fixture pipes failed");
        const pid_t parent = ::getpid();pid = ::fork();require(pid >= 0, "fixture fork failed");
        if (!pid) {
            ::close(commands[1]);::close(notices[0]);
            try { serve_child(path, own_directory + "/child.trace", mode, commands[0], notices[1], parent);::_exit(0); }
            catch (const std::exception &e) { std::ofstream log(own_directory + "/FIRSTCAUSE.txt");log << e.what() << '\n';event(notices[1], '!');::_exit(2); }
        }
        ::close(commands[0]);::close(notices[1]);command.reset(commands[1]);events.reset(notices[0]);expect('L');
    }
    ~Server() { if (pid > 0) { (void)::kill(pid, SIGTERM);int status = 0;while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {} } }
    Event expect(char code) { Event e = receive_event(events.value);require(e.code == code, std::string("fixture expected ") + code + " got " + e.code);if (code == 'A') accepted_fd = e.value;return e; }
    void send(char c) { write_all(command.value, &c, 1); }
    void accepted() { expect('A'); }
    void no_redial() { send('Q');require(expect('Q').value == 1, "client opened another connection"); }
    void finish() {
        require(!execed, "exec fixture uses process cleanup");send('Z');int status = 0;
        require(::waitpid(pid, &status, 0) == pid && WIFEXITED(status) && WEXITSTATUS(status) == 0, "child fixture did not drain");pid = -1;
    }
};

struct Fence {
    std::atomic<int> holds{0}, retains{0}, releases{0}, currents{0}, rejection{0}, reject_at{0}, retain_error{0}, reentries{0};
    Client *client = nullptr;
    std::mutex mutex;std::condition_variable changed;
    bool block_release = false, release_entered = false, allow_release = false;
    bool block_current = false, current_entered = false, allow_current = false;
    static int32_t retain(void *p) { auto &s = *static_cast<Fence *>(p);++s.retains;int err = s.retain_error.load();if (!err) ++s.holds;return err; }
    static int32_t current(void *p) {
        auto &s = *static_cast<Fence *>(p);int n = ++s.currents;
        if (s.client) { uint8_t done = 0;(void)ynx_link_resource_current_current_local_v1(s.client);(void)ynx_link_resource_current_join_v1(s.client, 0, &done);++s.reentries; }
        {
            std::unique_lock<std::mutex> guard(s.mutex);
            if (s.block_current) { s.current_entered = true;s.changed.notify_all();s.changed.wait(guard, [&] { return s.allow_current; }); }
        }
        if (s.rejection.load()) return s.rejection.load();return s.reject_at.load() == n ? 77 : 0;
    }
    static void release(void *p) {
        auto &s = *static_cast<Fence *>(p);
        if (s.client) { (void)ynx_link_resource_current_current_local_v1(s.client);int32_t native = 0, system = 0;(void)ynx_link_resource_current_first_error_v1(s.client, &native, &system);++s.reentries; }
        std::unique_lock<std::mutex> guard(s.mutex);s.release_entered = true;s.changed.notify_all();
        if (s.block_release) s.changed.wait(guard, [&] { return s.allow_release; });--s.holds;++s.releases;
    }
    ynx_link_private_client_source_fence_v1 descriptor() { return {this, current, retain, release}; }
    void unblock() { std::lock_guard<std::mutex> guard(mutex);allow_release = allow_current = true;changed.notify_all(); }
};
struct OwnedClient {
    Fence fence;Client *value = nullptr;std::vector<const Packet *> packets;bool freed = false;
    ~OwnedClient() {
        fence.unblock();if (!value || freed) return;
        for (const auto *p : packets) (void)ynx_link_resource_current_release_packet_v1(value, p);
        (void)ynx_link_resource_current_retire_v1(value);uint8_t done = 0;(void)ynx_link_resource_current_join_v1(value, 2000, &done);
        if (done) { (void)ynx_link_resource_current_close_v1(value, &done);if (done) (void)ynx_link_resource_current_free_v1(value); }
    }
    int open(const ynx_link_resource_current_profile_v1 &profile) { const auto f = fence.descriptor();int code = ynx_link_resource_current_open_v1(&profile, &f, &value);fence.client = value;return code; }
    std::pair<int, const Packet *> read() { const Packet *p = nullptr;int code = ynx_link_resource_current_read_v1(value, &p);if (p) packets.push_back(p);return {code, p}; }
    void release(const Packet *p) {
        require(ynx_link_resource_current_release_packet_v1(value, p) == 0, "owned packet release failed");
        for (auto it = packets.begin();it != packets.end();++it) if (*it == p) { packets.erase(it);return; }throw std::runtime_error("unadopted packet");
    }
    void finish() {
        require(value, "cleanup missing adopted client");require(packets.empty(), "cleanup still owns packet");
        (void)ynx_link_resource_current_retire_v1(value);uint8_t done = 0;(void)ynx_link_resource_current_join_v1(value, 2000, &done);require(done == 1, "client did not physically join");
        done = 0;(void)ynx_link_resource_current_close_v1(value, &done);require(done == 1, "client did not physically close");
        const int before = fence.releases.load();done = 0;(void)ynx_link_resource_current_close_v1(value, &done);require(done == 1 && fence.releases == before, "Close repeated fence release");
        require(ynx_link_resource_current_free_v1(value) == 0, "client free failed");freed = true;
        require(ynx_link_resource_current_current_local_v1(value) == YNX_LINK_RESOURCE_CURRENT_CLOSED_V1, "freed tombstone revived");
        require(fence.holds == 0 && fence.releases == (fence.retain_error ? 0 : 1), "fence release/borrow count incorrect");
    }
};
ynx_link_resource_current_profile_v1 profile(const Server &server) {
    ynx_link_resource_current_profile_v1 p{};p.version = 1;p.size = sizeof(p);p.peer_uid = ::geteuid();p.peer_pid = server.pid;
    detail::ProcessStart start;std::string failure;require(detail::process_start(server.pid, start, failure), failure);
    p.start_kind = start.kind;p.start_a = start.a;p.start_b = start.b;
    require(executable.size() < sizeof(p.image_path) && server.path.size() < sizeof(p.socket_path), "fixture profile bound");
    std::memcpy(p.image_path, executable.c_str(), executable.size() + 1);std::memcpy(p.socket_path, server.path.c_str(), server.path.size() + 1);
    require(detail::image_digest(executable, p.image_bytes, p.image_sha256, failure), failure);
    std::strcpy(p.source_id, "PUBLIC/source");std::strcpy(p.instance_id, "PUBLIC/instance");std::strcpy(p.resource_key, "PUBLIC/resource");p.timeout_ms = 1500;return p;
}
void control(const std::string &name) { ++controls;std::cout << "{\"control\":\"" << name << "\",\"passed\":true}\n" << std::flush; }
std::string bytes(const Packet *p) { return {reinterpret_cast<const char *>(p->body), p->body_size}; }

void same_connection() {
    Server server;OwnedClient client;auto p = profile(server);require(client.open(p) == 0, "good kernel peer open failed");server.accepted();
    std::strcpy(p.resource_key, "mutated-after-open");p.image_sha256[0] ^= 1;
    for (int i = 1;i <= 3;++i) {
        auto r = client.read();require(r.first == 0 && r.second && r.second->valid_current_data && r.second->body_complete && r.second->packet_present && r.second->dispatch_possible, "good actual read failed");
        require(std::string(r.second->request_id) == "lrc-" + std::to_string(i) && bytes(r.second).find("9007199254740993") != std::string::npos, "owned original frame/id changed");
        require(std::string(reinterpret_cast<const char *>(r.second->headers_original), r.second->headers_original_size).find("X-PUBLIC-Original: exact\r\n") != std::string::npos, "original header bytes lost");
        require(server.expect('R').value == i, "peer observed wrong request count");client.release(r.second);
    }
    require(client.fence.reentries >= 12, "native current/release callbacks did not reenter outside locks");server.no_redial();client.finish();server.finish();control("same-fd-original-wire-and-immutable-profile");
}
void identity_refusals() {
    for (const auto &kind : {"uid", "pid", "start", "hash", "image-size"}) {
        Server server;OwnedClient client;auto p = profile(server);
        if (!std::strcmp(kind, "uid")) p.peer_uid ^= 1;
        else if (!std::strcmp(kind, "pid")) p.peer_pid = ::getpid();
        else if (!std::strcmp(kind, "start")) ++p.start_a;
        else if (!std::strcmp(kind, "hash")) p.image_sha256[0] ^= 1;
        else ++p.image_bytes;
        require(client.open(p) != 0, std::string("accepted wrong expected ") + kind);
        if (client.value) client.finish();else require(client.fence.retains == 0, "invalid profile retained a Source");
        server.finish();
    }
    control("kernel-peer-profile-refusals-not-simulated-pid-reuse");
}
void data_refusals() {
    for (const auto &mode : {"reflection", "resource", "wrong-id", "bad-frame", "clte", "chunk-extension", "chunk-trailer", "header-bound", "body-bound"}) {
        Server server(mode);OwnedClient client;require(client.open(profile(server)) == 0, "negative HTTP fixture open failed");server.accepted();
        auto r = client.read();require(r.first != 0 && r.second && !r.second->valid_current_data && r.second->dispatch_possible, std::string("accepted invalid actual carrier: ") + mode);
        if (!std::strcmp(mode, "reflection") || !std::strcmp(mode, "resource") || !std::strcmp(mode, "wrong-id") || !std::strcmp(mode, "bad-frame")) require(r.second->body_complete == 1, "complete bad DATA body lost");
        server.expect('R');client.release(r.second);server.no_redial();client.finish();server.finish();
    }
    control("actual-http-frame-reflection-resource-and-independent-bounds");
}
void chunked_and_partial() {
    for (const auto &mode : {"chunked", "truncated"}) {
        Server server(mode);OwnedClient client;require(client.open(profile(server)) == 0, "body fixture open failed");server.accepted();auto r = client.read();require(r.second, "packet not adopted");
        if (!std::strcmp(mode, "chunked")) require(r.first == 0 && r.second->body_complete && r.second->valid_current_data, "bounded original chunked body rejected");
        else require(r.first != 0 && r.second->packet_present && !r.second->body_complete && r.second->body_size == 31 && r.second->partial_response_bytes == 31 && !r.second->valid_current_data, "late truncated prefix/cause lost");
        server.expect('R');client.release(r.second);server.no_redial();client.finish();server.finish();
    }
    control("chunked-positive-and-truncated-owned-prefix");
}
void actual_write_and_late_fence() {
    {
        Server server;OwnedClient client;require(client.open(profile(server)) == 0, "write fence open failed");server.accepted();client.fence.reject_at = client.fence.currents + 2;
        auto r = client.read();require(r.first == YNX_LINK_RESOURCE_CURRENT_NATIVE_CURRENT_V1 && r.second && !r.second->dispatch_possible && !r.second->packet_present && r.second->native_current_code == 77, "actual-write native fence did not preserve zero dispatch/cause");
        server.no_redial();client.release(r.second);client.finish();server.finish();
    }
    {
        Server server("controlled");OwnedClient client;require(client.open(profile(server)) == 0, "late fence open failed");server.accepted();
        auto work = std::async(std::launch::async, [&] { return client.read(); });server.expect('R');client.fence.rejection = 91;server.send('S');auto r = work.get();
        require(r.first == YNX_LINK_RESOURCE_CURRENT_NATIVE_CURRENT_V1 && r.second && r.second->body_complete && r.second->packet_present && r.second->body_size > 31 && !r.second->valid_current_data && r.second->native_current_code == 91, "late revoke erased complete original response/cause");
        int32_t native = 0, system = 0;require(ynx_link_resource_current_first_error_v1(client.value, &native, &system) == r.first && native == 91, "first native cause changed");
        client.release(r.second);client.finish();server.finish();
    }
    control("actual-write-zero-dispatch-and-late-complete-revocation");
}
void endpoint_and_disconnect() {
    for (char command : {'P', 'D'}) {
        Server server;OwnedClient client;require(client.open(profile(server)) == 0, "endpoint fixture open failed");server.accepted();server.send(command);server.expect(command);
        auto r = client.read();require(r.first != 0 && r.second && !r.second->dispatch_possible, "replaced/disconnected endpoint dispatched");client.release(r.second);
        auto again = client.read();require(again.first != 0 && !again.second, "terminal client revived");server.no_redial();client.finish();server.finish();
    }
    control("replaced-endpoint-idle-disconnect-terminal-no-redial");
}
void retire_and_packet_debt() {
    Server server("controlled");OwnedClient client;require(client.open(profile(server)) == 0, "retire fixture open failed");server.accepted();
    auto work = std::async(std::launch::async, [&] { return client.read(); });server.expect('R');(void)ynx_link_resource_current_retire_v1(client.value);auto r = work.get();
    require(r.first != 0 && r.second && r.second->dispatch_possible, "inflight retire lost UNKNOWN packet");
    uint8_t done = 7;require(ynx_link_resource_current_join_v1(client.value, 0, &done) == YNX_LINK_RESOURCE_CURRENT_DRAINING_V1 && done == 0, "Join ignored owned packet debt");
    done = 7;require(ynx_link_resource_current_close_v1(client.value, &done) == YNX_LINK_RESOURCE_CURRENT_DRAINING_V1 && done == 0 && client.fence.holds == 1, "Close released live Source borrow");
    require(ynx_link_resource_current_free_v1(client.value) != 0, "free erased undrained owner");client.release(r.second);server.no_redial();client.finish();server.finish();control("inflight-retire-packet-debt-then-exact-cleanup");
}
void physical_release_barrier() {
    Server server;OwnedClient client;require(client.open(profile(server)) == 0, "release fixture open failed");server.accepted();
    (void)ynx_link_resource_current_retire_v1(client.value);uint8_t joined = 0;(void)ynx_link_resource_current_join_v1(client.value, 1000, &joined);require(joined, "release fixture did not join");
    client.fence.block_release = true;
    auto close = std::async(std::launch::async, [&] { uint8_t done = 0;int code = ynx_link_resource_current_close_v1(client.value, &done);return std::make_pair(code, done); });
    {
        std::unique_lock<std::mutex> guard(client.fence.mutex);
        if (!client.fence.changed.wait_for(guard, std::chrono::seconds(2), [&] { return client.fence.release_entered; })) { guard.unlock();client.fence.unblock();throw std::runtime_error("release callback was not entered"); }
    }
    uint8_t done = 7;const int competing = ynx_link_resource_current_close_v1(client.value, &done);
    const bool held = competing == YNX_LINK_RESOURCE_CURRENT_DRAINING_V1 && done == 0 && client.fence.holds == 1 &&
        ynx_link_resource_current_current_local_v1(client.value) != YNX_LINK_RESOURCE_CURRENT_CLOSED_V1 && ynx_link_resource_current_free_v1(client.value) != 0;
    client.fence.unblock();const auto result = close.get();require(held && result.first == 0 && result.second == 1 && client.fence.releases == 1, "Close advertised physical close before original release returned");
    client.finish();server.finish();control("release-callback-physical-close-barrier-and-reentry");
}
void inflight_packet_release() {
    Server server;OwnedClient client;require(client.open(profile(server)) == 0, "packet barrier fixture open failed");server.accepted();
    client.fence.block_current = true;
    const Packet *exposed = nullptr;
    auto work = std::async(std::launch::async, [&] { return ynx_link_resource_current_read_v1(client.value, &exposed); });
    {
        std::unique_lock<std::mutex> guard(client.fence.mutex);
        if (!client.fence.changed.wait_for(guard, std::chrono::seconds(2), [&] { return client.fence.current_entered; })) { guard.unlock();client.fence.unblock();throw std::runtime_error("read did not reach native fence barrier"); }
    }
    // The fence mutex publishes the already assigned out pointer. No packet
    // fields are inspected until the read has returned and its writer joined.
    const bool reserved = exposed && ynx_link_resource_current_release_packet_v1(client.value, exposed) == YNX_LINK_RESOURCE_CURRENT_DRAINING_V1;
    (void)ynx_link_resource_current_retire_v1(client.value);uint8_t done = 7;
    (void)ynx_link_resource_current_join_v1(client.value, 0, &done);const bool undrained = done == 0;
    client.fence.unblock();const int code = work.get();
    if (exposed) client.packets.push_back(exposed);
    require(reserved && undrained && code != 0 && exposed && !exposed->dispatch_possible, "inflight packet release erased active owner/writer");
    client.release(exposed);client.finish();server.finish();control("inflight-packet-release-refuses-until-read-publishes");
}
void concurrent_stop_close() {
    // Bounded adjacent native interleavings; no production hooks. The socket
    // pair is owned only by this test and must survive concurrent retire/close.
    for (unsigned round = 0;round < 8;++round) {
        Server server;OwnedClient client;require(client.open(profile(server)) == 0, "close race fixture open failed");server.accepted();
        (void)ynx_link_resource_current_retire_v1(client.value);uint8_t joined = 0;(void)ynx_link_resource_current_join_v1(client.value, 1000, &joined);require(joined, "close race fixture join failed");
        std::atomic<bool> start{false};
        auto closer = std::async(std::launch::async, [&] { while (!start.load()) std::this_thread::yield();uint8_t done = 0;int code = ynx_link_resource_current_close_v1(client.value, &done);return std::make_pair(code, done); });
        auto stopper = std::async(std::launch::async, [&] { while (!start.load()) std::this_thread::yield();for (unsigned i = 0;i < 256;++i) (void)ynx_link_resource_current_retire_v1(client.value); });
        start = true;
        bool isolated = true;
        for (unsigned i = 0;i < 32;++i) {
            int descriptors[2];if (::socketpair(AF_UNIX, SOCK_STREAM, 0, descriptors)) { isolated = false;break; }
            FD a(descriptors[0]), b(descriptors[1]);const char sent = 'p';char received = 0;
#if defined(__linux__)
            constexpr int flags = MSG_NOSIGNAL;
#else
            constexpr int flags = 0;
#endif
            if (::send(a.value, &sent, 1, flags) != 1 || ::recv(b.value, &received, 1, MSG_DONTWAIT) != 1 || received != sent) isolated = false;
        }
        stopper.get();const auto result = closer.get();require(isolated && result.first == 0 && result.second == 1, "retire/close affected a separately owned descriptor");
        client.finish();server.finish();
    }
    control("concurrent-retire-close-owned-descriptor-isolation");
}
void retain_partial_and_fork() {
    {
        Server server;OwnedClient client;client.fence.retain_error = 63;
        require(client.open(profile(server)) == YNX_LINK_RESOURCE_CURRENT_NATIVE_CURRENT_V1 && client.value, "retain rejection missing nonnull partial");
        int32_t native = 0, system = 0;require(ynx_link_resource_current_first_error_v1(client.value, &native, &system) == YNX_LINK_RESOURCE_CURRENT_NATIVE_CURRENT_V1 && native == 63, "retain cause changed");
        client.finish();server.finish();
    }
    {
        Server server;OwnedClient client;require(client.open(profile(server)) == 0, "fork fixture open failed");server.accepted();
        pid_t child = ::fork();require(child >= 0, "local inherited handle fork failed");
        if (!child) { const Packet *p = nullptr;const bool denied = ynx_link_resource_current_current_local_v1(client.value) != 0 &&
            ynx_link_resource_current_read_v1(client.value, &p) != 0 && !p && ynx_link_resource_current_retire_v1(client.value) != 0;::_exit(denied ? 0 : 3); }
        int status = 0;require(::waitpid(child, &status, 0) == child && WIFEXITED(status) && !WEXITSTATUS(status), "fork child reused original client");
        auto r = client.read();require(r.first == 0 && r.second, "fork rejection shutdown parent's connection");server.expect('R');client.release(r.second);client.finish();server.finish();
    }
    control("retain-failure-partial-and-fork-local-rejection");
}
void actual_peer_exec() {
    Server server;OwnedClient client;require(client.open(profile(server)) == 0, "exec fixture open failed");server.accepted();
    require(child_socket_open(server.pid, server.accepted_fd), "pre-exec accepted socket not observable");
    const pid_t same_pid = server.pid;detail::ProcessStart before, after;std::string failure;require(detail::process_start(same_pid, before, failure), failure);
    server.send('E');const int preserved = server.expect('E').value;server.execed = true;
    bool changed = false;const auto end = Clock::now() + std::chrono::seconds(2);
    while (Clock::now() < end) { if (current_image(same_pid) != executable) { changed = true;break; }std::this_thread::yield(); }
    require(changed && detail::process_start(same_pid, after, failure) && before.kind == after.kind && before.a == after.a && before.b == after.b, "fixture did not exec same original process lifetime");
    require(child_socket_open(same_pid, preserved), "exec test only disconnected; actual accepted fd did not survive");
    auto r = client.read();require(r.first != 0 && r.second && !r.second->dispatch_possible && !r.second->valid_current_data, "same-PID executable transition remained admitted");
    require(child_socket_open(same_pid, preserved), "exec rejection relied on remote fd closing");client.release(r.second);client.finish();control("actual-same-pid-exec-changed-image-with-live-socket");
}
}

int main(int argc, char **argv) {
    ::signal(SIGPIPE, SIG_IGN);
    try {
        require(argc == 2, "explicit owned artifact directory required");directory = argv[1];
        struct stat own{};require(::lstat(directory.c_str(), &own) == 0 && S_ISDIR(own.st_mode) && own.st_uid == ::geteuid() && (own.st_mode & 0777) == 0700,
            "owned private artifact directory required");
        executable = current_image(::getpid());
        same_connection();identity_refusals();data_refusals();chunked_and_partial();actual_write_and_late_fence();endpoint_and_disconnect();retire_and_packet_debt();physical_release_barrier();inflight_packet_release();concurrent_stop_close();retain_partial_and_fork();actual_peer_exec();
        std::cout << "{\"summary\":true,\"controls\":" << controls << ",\"transportOnly\":true,\"actualGoServer\":false,\"RootAdmission\":false,\"SourceAdmission\":false}\n";return 0;
    } catch (const std::exception &e) { std::cerr << "FIRSTCAUSE: " << e.what() << '\n';return 1; }
}
