// PUBLIC kernel control. The byte sequences below are fixture DATA, not a Cloud wire.
#include "cloud-finite-get-control.hpp"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdexcept>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
#if defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_C_TEST)
#include "cloud-finite-get-control-c.h"
#include <condition_variable>
#include <mutex>
#include <thread>
extern "C" int fixture_cloud_c_receive(ynx_cloud_finite_get_control **, int, int,
    const ynx_cloud_control_expected_process *, uint8_t, int);
extern "C" int fixture_cloud_c_close(ynx_cloud_finite_get_control **, int, int, int, int);
#endif

#if !defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_TEST)
#error This fixture requires explicit PUBLIC test compilation.
#endif

namespace ynx::cloud_finite_get_detail {
namespace {
bool inject_close_error = false;
unsigned close_calls = 0;
#if defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_C_TEST)
enum class WakeTest { off, blocked, both_ready };
std::mutex wake_mutex;
std::condition_variable wake_changed;
WakeTest wake_test = WakeTest::off;
bool receive_waiting = false, wake_written = false;
#endif
}
int fixture_cloud_control_close(int fd) {
    ++close_calls;
    const int result = ::close(fd);
    if (result || !inject_close_error) return result;
    inject_close_error = false;
    errno = EIO;
    return -1;
}
#if defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_C_TEST)
void fixture_cloud_control_before_wait(int) {
    std::unique_lock<std::mutex> lock(wake_mutex);
    if (wake_test == WakeTest::off) return;
    receive_waiting = true;
    wake_changed.notify_one();
    if (wake_test == WakeTest::both_ready) wake_changed.wait(lock, [] { return wake_written; });
}
#endif
}

namespace {
namespace cloud = ynx::cloud_finite_get_detail;
namespace peer = ynx::resource_current_detail;
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;

enum class Case { complete, partial, foreign_control, foreign_binding, close_unknown, extra_rights, before_binding,
    c_bridge, c_bridge_canceled, c_bridge_both_ready, c_bridge_unknown };
const std::vector<uint8_t> inbound{0, 8, 0, 19, 27};
const std::vector<uint8_t> outbound{0, 5, 0, 12};
constexpr uint8_t fixture_marker = 0xf3;

void require(bool ok, const std::string &message) {
    if (!ok) throw std::runtime_error(message);
}

void require_control(bool ok, const cloud::Control &control, const char *message) {
    if (ok) return;
    const auto &first = control.first_failure();
    throw std::runtime_error(std::string(message) + (first ? ": " + first->detail + " / " + std::to_string(first->system_error) : ""));
}

class FD {
public:
    explicit FD(int fd = -1) : value(fd) {}
    ~FD() { if (value >= 0) ::close(value); }
    FD(const FD &) = delete;
    FD &operator=(const FD &) = delete;
    int get() const { return value; }
    void close() {
        if (value < 0) return;
        const int selected = value;
        value = -1;
        require(::close(selected) == 0, "fixture descriptor close failed");
    }
private:
    int value;
};

class Child {
public:
    explicit Child(pid_t process) : pid(process) {}
    ~Child() {
        if (pid > 0) {
            ::kill(pid, SIGKILL);
            while (::waitpid(pid, nullptr, 0) < 0 && errno == EINTR) {}
        }
    }
    void wait() {
        int status = 0;
        pid_t result;
        do { result = ::waitpid(pid, &status, 0); } while (result < 0 && errno == EINTR);
        require(result == pid, "fixture child was not reaped");
        pid = -1;
        require(WIFEXITED(status) && WEXITSTATUS(status) == 0, "fixture child did not exit normally");
    }
private:
    pid_t pid;
};

void ready(int fd) {
    pollfd event{fd, POLLIN, 0};
    int result;
    do { result = ::poll(&event, 1, 2000); } while (result < 0 && errno == EINTR);
    require(result == 1 && event.revents & (POLLIN | POLLHUP), "fixture input wait failed");
}

void send_bytes(int fd, const uint8_t *bytes, size_t length) {
    while (length) {
        const auto result = ::write(fd, bytes, length);
        if (result < 0 && errno == EINTR) continue;
        require(result > 0, "fixture output write failed");
        bytes += result;
        length -= static_cast<size_t>(result);
    }
}

std::vector<uint8_t> read_bytes(int fd, size_t length) {
    std::vector<uint8_t> result(length);
    size_t offset = 0;
    while (offset != length) {
        ready(fd);
        const auto count = ::read(fd, result.data() + offset, length - offset);
        if (count < 0 && errno == EINTR) continue;
        require(count > 0, "fixture input read failed");
        offset += static_cast<size_t>(count);
    }
    return result;
}

void transfer(int data, const int *fds, size_t count) {
    uint8_t marker = fixture_marker;
    iovec byte{&marker, 1};
    alignas(cmsghdr) unsigned char ancillary[CMSG_SPACE(2 * sizeof(int))]{};
    msghdr message{};
    message.msg_iov = &byte;
    message.msg_iovlen = 1;
    message.msg_control = ancillary;
    message.msg_controllen = CMSG_SPACE(count * sizeof(int));
    auto *item = CMSG_FIRSTHDR(&message);
    item->cmsg_level = SOL_SOCKET;
    item->cmsg_type = SCM_RIGHTS;
    item->cmsg_len = CMSG_LEN(count * sizeof(int));
    std::memcpy(CMSG_DATA(item), fds, count * sizeof(int));
    require(::sendmsg(data, &message, 0) == 1, "fixture SCM send failed");
}

void child_exchange(const sockaddr_un &endpoint, Case mode, int foreign, int listener, int pipe_read, int pipe_write) {
    ::close(listener);
    ::close(pipe_write);
    FD data(::socket(AF_UNIX, SOCK_STREAM, 0));
    require(data.get() >= 0 && ::connect(data.get(), reinterpret_cast<const sockaddr *>(&endpoint), sizeof(endpoint)) == 0,
            "fixture child data dial failed");
    if (mode == Case::c_bridge_canceled) {
        require(read_bytes(pipe_read, 1) == std::vector<uint8_t>{'Q'}, "fixture cancellation quit barrier differs");
        data.close();
        require(::close(pipe_read) == 0, "fixture cancellation barrier close failed");
        return;
    }
    int pair[2];
    require(::socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0, "fixture child control pair failed");
    FD control(pair[0]), sent(pair[1]);
    const int fds[2] = {mode == Case::foreign_control ? foreign : sent.get(), control.get()};
    transfer(data.get(), fds, mode == Case::extra_rights ? 2 : 1);
    sent.close();
    if (mode == Case::c_bridge_both_ready) {
        require(read_bytes(pipe_read, 1) == std::vector<uint8_t>{'Q'}, "fixture simultaneous readiness quit barrier differs");
        control.close();
        data.close();
        require(::close(pipe_read) == 0, "fixture simultaneous readiness barrier close failed");
        return;
    }
    if (mode == Case::complete || mode == Case::close_unknown) {
        send_bytes(control.get(), inbound.data(), inbound.size());
        require(read_bytes(control.get(), outbound.size()) == outbound, "fixture child response differs");
    } else if (mode == Case::partial) {
        send_bytes(control.get(), inbound.data(), 3);
        require(::shutdown(control.get(), SHUT_WR) == 0, "fixture control half-close failed");
    }
    if (mode != Case::foreign_control && mode != Case::extra_rights) {
        ready(control.get());
        uint8_t byte;
        require(::read(control.get(), &byte, 1) == 0, "fixture did not observe physical control EOF");
    }
    require(read_bytes(pipe_read, 1) == std::vector<uint8_t>{'Q'}, "fixture parent quit barrier differs");
    control.close();
    data.close();
    require(::close(pipe_read) == 0, "fixture child barrier close failed");
}

#if defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_C_TEST)
// UNKNOWN means this exact handle remains owned until process exit.
ynx_cloud_finite_get_control *retained_unknown = nullptr;

void c_bridge_exchange(int data, const peer::ExpectedProcess &expected, Case mode) {
    ynx_cloud_control_expected_process profile{expected.uid, expected.pid, expected.start.kind, expected.start.a,
        expected.start.b, expected.image_path.data(), expected.image_path.size(), expected.image_bytes, {}};
    std::memcpy(profile.image_sha256, expected.image_sha256.data(), expected.image_sha256.size());
    const bool both_ready = mode == Case::c_bridge_both_ready;
    const bool canceled = mode == Case::c_bridge_canceled || both_ready, unknown = mode == Case::c_bridge_unknown;
    int wake[2] = {-1, -1};
    if (canceled) require(::pipe(wake) == 0, "fixture listener wake pipe failed");
    FD wake_read(wake[0]), wake_write(wake[1]);
    std::thread signal;
    bool write_ok = false;
    if (both_ready) ready(data);
    if (canceled) {
        cloud::wake_test = both_ready ? cloud::WakeTest::both_ready : cloud::WakeTest::blocked;
        cloud::receive_waiting = false;
        cloud::wake_written = false;
        signal = std::thread([&] {
            std::unique_lock<std::mutex> lock(cloud::wake_mutex);
            if (!cloud::wake_changed.wait_for(lock, 1500ms, [] { return cloud::receive_waiting; })) return;
            const uint8_t stop = 'X';
            ssize_t count;
            do { count = ::write(wake_write.get(), &stop, 1); } while (count < 0 && errno == EINTR);
            write_ok = count == 1;
            cloud::wake_written = true;
            cloud::wake_changed.notify_one();
        });
    }
    ynx_cloud_finite_get_control *owner = nullptr;
    const bool received = fixture_cloud_c_receive(&owner, data, wake_read.get(), &profile, fixture_marker, canceled);
    if (signal.joinable()) signal.join();
    cloud::wake_test = cloud::WakeTest::off;
    require(received, "C11 original descriptor or cancellation contract failed");
    auto *accepted = cloud::borrow_accepted_control(owner);
    require(canceled ? accepted == nullptr : accepted && accepted == cloud::borrow_accepted_control(owner), "C11 bridge detached original C++ owner");
    const auto before = cloud::close_calls;
    if (unknown) cloud::inject_close_error = true;
    require(fixture_cloud_c_close(&owner, data, wake_read.get(), canceled, unknown), "C11 immutable first or physical close contract failed");
    require(cloud::close_calls == before + (canceled ? 1 : 2), "C11 original descriptors closed more than once");
    if (canceled) {
        require(write_ok && read_bytes(wake_read.get(), 1) == std::vector<uint8_t>{'X'}, "C11 consumed the original wake byte");
        wake_write.close();
        wake_read.close();
    }
    if (unknown) retained_unknown = owner;
}
#endif

void exchange(const sockaddr_un &endpoint, int listener, const std::string &image, Case mode) {
    int foreign_pair[2];
    require(::socketpair(AF_UNIX, SOCK_STREAM, 0, foreign_pair) == 0, "fixture foreign control pair failed");
    FD foreign(foreign_pair[0]), foreign_other(foreign_pair[1]);
    int pipe_fds[2];
    require(::pipe(pipe_fds) == 0, "fixture quit barrier failed");
    FD pipe_read(pipe_fds[0]), pipe_write(pipe_fds[1]);
    const auto pid = ::fork();
    require(pid >= 0, "fixture fork failed");
    if (!pid) {
        try {
            child_exchange(endpoint, mode, foreign.get(), listener, pipe_read.get(), pipe_write.get());
            _exit(0);
        } catch (const std::exception &e) { std::fprintf(stderr, "fixture child: %s\n", e.what()); _exit(1); }
    }
    Child child(pid);
    pipe_read.close();
    foreign.close();
    foreign_other.close();
    peer::ExpectedProcess expected;
    expected.uid = ::geteuid();
    expected.pid = pid;
    expected.image_path = image;
    std::string failure;
    require(peer::process_start(pid, expected.start, failure), "actual child start unavailable: " + failure);
    require(peer::image_digest(image, expected.image_bytes, expected.image_sha256.data(), failure), "actual fixture image unavailable: " + failure);
    ready(listener);
    FD data(::accept(listener, nullptr, nullptr));
    require(data.get() >= 0, "fixture child data accept failed");
#if defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_C_TEST)
    if (mode == Case::c_bridge || mode == Case::c_bridge_canceled || mode == Case::c_bridge_both_ready || mode == Case::c_bridge_unknown) {
        c_bridge_exchange(data.get(), expected, mode);
        const uint8_t quit = 'Q';
        send_bytes(pipe_write.get(), &quit, 1);
        pipe_write.close();
        child.wait();
        data.close();
        return;
    }
#endif
    cloud::OriginalBinding binding{std::make_shared<int>(1), std::make_shared<int>(2), {}, {}};
    binding.channel_sha256[0] = 18;
    binding.proof_sha256[0] = 19;
    cloud::Control control;
    uint8_t marker = 0;
    const bool bound = control.receive_descriptor(data.get(), expected, Clock::now() + 2s, marker);
    if (mode == Case::foreign_control || mode == Case::extra_rights) {
        require(!bound && !marker && !control.lifetime().peer_bound && control.lifetime().descriptor_received && control.first_failure(), "foreign or extra descriptor admitted");
    } else {
        require_control(bound && marker == fixture_marker && !control.lifetime().original_bound, control, "actual Cloud local pair not held");
        std::vector<uint8_t> frame;
        if (mode == Case::before_binding) {
            require(!control.read_frame(binding, inbound.size(), Clock::now() + 2s, frame) && frame.empty() &&
                !control.bind_original(binding), "frame attempted before original Cloud request/loan existed");
        } else {
            require_control(control.bind_original(binding) && control.lifetime().original_bound, control, "original Cloud request/loan not held");
        }
        if (mode == Case::foreign_binding) {
            auto foreign_binding = binding;
            // Same address, different control block must still be rejected.
            foreign_binding.loan = std::shared_ptr<const void>(binding.loan.get(), [](const void *) {});
            require(!control.read_frame(foreign_binding, inbound.size(), Clock::now() + 2s, frame) && frame.empty() &&
                !control.current(binding), "foreign opaque loan used original Cloud stream");
        } else if (mode != Case::before_binding) {
            const bool read = control.read_frame(binding, inbound.size(), Clock::now() + 2s, frame);
            if (mode == Case::partial) {
                require(!read && !control.lifetime().read_complete && frame == std::vector<uint8_t>(inbound.begin(), inbound.begin() + 3) &&
                    control.first_failure() && control.first_failure()->system_error == ENOTCONN, "original partial read or first error lost");
                size_t written = 0;
                require(!control.write_frame(binding, outbound, Clock::now() + 2s, written) && !written, "partial input allowed control write");
            } else {
                require_control(read && frame == inbound && control.lifetime().read_complete, control, "original frame read differs");
                size_t written = 0;
                require_control(control.write_frame(binding, outbound, Clock::now() + 2s, written) && written == outbound.size() &&
                    control.lifetime().write_complete, control, "original frame write differs");
                require(!control.write_frame(binding, outbound, Clock::now() + 2s, written) && !written, "one original write was replayed");
            }
        }
    }
    const auto before = cloud::close_calls;
    if (mode == Case::close_unknown) cloud::inject_close_error = true;
    control.retire();
    const bool closed = control.close();
    const auto selected = cloud::close_calls;
    require(selected == before + 2 && closed == control.close() && cloud::close_calls == selected &&
        ::fcntl(data.get(), F_GETFD) >= 0, "physical close retried or touched original HTTP descriptor");
    const auto lifetime = control.lifetime();
    require(lifetime.retired && lifetime.local_closed == closed, "physical close observation differs");
    if (mode == Case::close_unknown) {
        require(!closed && lifetime.close_unknown && lifetime.close_error == EIO && control.first_failure() &&
            control.first_failure()->detail == "one original Cloud control write after read required", "unknown close erased first failure or reported closed");
    } else require(closed && !lifetime.close_unknown, "original local descriptors did not close");
    const uint8_t quit = 'Q';
    send_bytes(pipe_write.get(), &quit, 1);
    pipe_write.close();
    child.wait();
    data.close();
}
}

int main(int argc, char **argv) {
    try {
        bool c_bridge = false;
#if defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_C_TEST)
        c_bridge = argc == 3 && std::strcmp(argv[2], "--c-bridge") == 0;
#endif
        require((argc == 2 || c_bridge) && argv[1][0] == '/' && std::strlen(argv[1]) < 104, "absolute owned Unix fixture socket required");
        sockaddr_un address{};
        address.sun_family = AF_UNIX;
        std::strcpy(address.sun_path, argv[1]);
        FD listener(::socket(AF_UNIX, SOCK_STREAM, 0));
        require(listener.get() >= 0 && ::bind(listener.get(), reinterpret_cast<const sockaddr *>(&address), sizeof(address)) == 0 &&
            ::listen(listener.get(), 1) == 0, "fixture listener setup failed");
        std::unique_ptr<char, decltype(&std::free)> image(::realpath(argv[0], nullptr), std::free);
        require(static_cast<bool>(image), "fixture image path unavailable");
        if (c_bridge) {
            for (auto mode : {Case::c_bridge, Case::c_bridge_canceled, Case::c_bridge_both_ready, Case::c_bridge_unknown})
                exchange(address, listener.get(), image.get(), mode);
        } else {
            for (auto mode : {Case::complete, Case::partial, Case::foreign_control, Case::foreign_binding, Case::close_unknown, Case::extra_rights, Case::before_binding})
                exchange(address, listener.get(), image.get(), mode);
        }
        listener.close();
        require(::unlink(argv[1]) == 0, "fixture listener path cleanup failed");
        if (c_bridge) std::puts("{\"c11Bridge\":true,\"borrowedWakeCancellation\":true,\"firstCauseRetained\":true,\"unknownFreeRefused\":true,\"localClose\":true,\"transportOnly\":true}");
        else std::puts("{\"kernel\":true,\"independentChild\":true,\"samePeerDataAndSCMControl\":true,\"frameIO\":true,\"physicalClose\":true,\"transportOnly\":true,\"partialRetained\":true,\"foreignControlRejected\":true,\"transcriptSubstitutionRejected\":true,\"closeUnknownRetained\":true,\"extraRightsRejected\":true}");
        return 0;
    } catch (const std::exception &e) {
        std::fprintf(stderr, "%s\n", e.what());
        return 1;
    }
}
