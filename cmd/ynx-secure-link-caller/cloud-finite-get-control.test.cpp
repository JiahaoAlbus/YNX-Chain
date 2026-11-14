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

#if !defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_TEST)
#error This fixture requires explicit PUBLIC test compilation.
#endif

namespace ynx::cloud_finite_get_detail {
namespace {
bool inject_close_error = false;
unsigned close_calls = 0;
}
int fixture_cloud_control_close(int fd) {
    ++close_calls;
    const int result = ::close(fd);
    if (result || !inject_close_error) return result;
    inject_close_error = false;
    errno = EIO;
    return -1;
}
}

namespace {
namespace cloud = ynx::cloud_finite_get_detail;
namespace peer = ynx::resource_current_detail;
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;

enum class Case { complete, partial, foreign_control, foreign_binding, close_unknown, extra_rights, before_binding };
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
    int pair[2];
    require(::socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0, "fixture child control pair failed");
    FD control(pair[0]), sent(pair[1]);
    const int fds[2] = {mode == Case::foreign_control ? foreign : sent.get(), control.get()};
    transfer(data.get(), fds, mode == Case::extra_rights ? 2 : 1);
    sent.close();
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
        require(argc == 2 && argv[1][0] == '/' && std::strlen(argv[1]) < 104, "absolute owned Unix fixture socket required");
        sockaddr_un address{};
        address.sun_family = AF_UNIX;
        std::strcpy(address.sun_path, argv[1]);
        FD listener(::socket(AF_UNIX, SOCK_STREAM, 0));
        require(listener.get() >= 0 && ::bind(listener.get(), reinterpret_cast<const sockaddr *>(&address), sizeof(address)) == 0 &&
            ::listen(listener.get(), 1) == 0, "fixture listener setup failed");
        std::unique_ptr<char, decltype(&std::free)> image(::realpath(argv[0], nullptr), std::free);
        require(static_cast<bool>(image), "fixture image path unavailable");
        for (auto mode : {Case::complete, Case::partial, Case::foreign_control, Case::foreign_binding, Case::close_unknown, Case::extra_rights, Case::before_binding})
            exchange(address, listener.get(), image.get(), mode);
        listener.close();
        require(::unlink(argv[1]) == 0, "fixture listener path cleanup failed");
        std::puts("{\"kernel\":true,\"independentChild\":true,\"samePeerDataAndSCMControl\":true,\"frameIO\":true,\"physicalClose\":true,\"transportOnly\":true,\"partialRetained\":true,\"foreignControlRejected\":true,\"transcriptSubstitutionRejected\":true,\"closeUnknownRetained\":true,\"extraRightsRejected\":true}");
        return 0;
    } catch (const std::exception &e) {
        std::fprintf(stderr, "%s\n", e.what());
        return 1;
    }
}
