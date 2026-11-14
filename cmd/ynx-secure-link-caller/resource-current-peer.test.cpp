// PUBLIC kernel fixture for the private native peer lease.
#include "resource-current-peer.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdexcept>
#include <string>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

#if !defined(YNX_LINK_PUBLIC_PEER_CLOSE_TEST)
#error This fixture requires explicit PUBLIC test compilation.
#endif

namespace ynx::resource_current_detail {
namespace {
bool inject_close = false;
int injected_fd = -1;
unsigned close_calls = 0;
}

int fixture_peer_close(int fd) {
    ++close_calls;
    const int result = ::close(fd);
    if (!inject_close || result) return result;
    inject_close = false;
    injected_fd = fd;
    errno = EIO;
    return -1;
}
}

namespace {
namespace peer = ynx::resource_current_detail;

void require(bool ok, const std::string &message) {
    if (!ok) throw std::runtime_error(message);
}

struct FD {
    int value;
    explicit FD(int fd) : value(fd) { require(fd >= 0, "fixture FD unavailable"); }
    ~FD() { if (value >= 0) ::close(value); }
    FD(const FD &) = delete;
    FD &operator=(const FD &) = delete;
    void close() {
        const int fd = value;
        value = -1;
        require(fd >= 0 && ::close(fd) == 0, "fixture FD close failed");
    }
};

struct Child {
    pid_t pid;
    ~Child() { if (pid > 0) { ::kill(pid, SIGKILL); while (::waitpid(pid, nullptr, 0) < 0 && errno == EINTR) {} } }
    void wait() {
        int status = 0;
        pid_t reaped;
        do { reaped = ::waitpid(pid, &status, 0); } while (reaped < 0 && errno == EINTR);
        require(reaped == pid, "original child wait failed");
        pid = -1;
        require(WIFEXITED(status) && WEXITSTATUS(status) == 0, "original child exit differs");
    }
};

void send_byte(int fd, char value) {
    require(::write(fd, &value, 1) == 1, "fixture barrier write failed");
}

void wait_readable(int fd) {
    pollfd wait{fd, POLLIN, 0};
    int result;
    do { result = ::poll(&wait, 1, 5000); } while (result < 0 && errno == EINTR);
    require(result == 1 && wait.revents & (POLLIN | POLLHUP), "fixture barrier timeout");
}

char read_byte(int fd) {
    wait_readable(fd);
    char value = 0;
    require(::read(fd, &value, 1) == 1, "fixture barrier read failed");
    return value;
}

sockaddr_un address(const char *path) {
    sockaddr_un out{};
    out.sun_family = AF_UNIX;
    require(std::strlen(path) < sizeof(out.sun_path), "fixture socket path exceeds bound");
    std::strcpy(out.sun_path, path);
    return out;
}

int open_socket() { return ::socket(AF_UNIX, SOCK_STREAM, 0); }

void transfer(int data, int control) {
    char mark = 'L';
    iovec vector{&mark, 1};
    alignas(cmsghdr) char ancillary[CMSG_SPACE(sizeof(control))]{};
    msghdr message{};
    message.msg_iov = &vector;
    message.msg_iovlen = 1;
    message.msg_control = ancillary;
    message.msg_controllen = sizeof(ancillary);
    auto *c = CMSG_FIRSTHDR(&message);
    c->cmsg_len = CMSG_LEN(sizeof(control));
    c->cmsg_level = SOL_SOCKET;
    c->cmsg_type = SCM_RIGHTS;
    std::memcpy(CMSG_DATA(c), &control, sizeof(control));
    require(::sendmsg(data, &message, 0) == 1, "fixture SCM send failed");
}

int receive(int data) {
    wait_readable(data);
    char mark = 0;
    iovec vector{&mark, 1};
    alignas(cmsghdr) char ancillary[CMSG_SPACE(sizeof(int))]{};
    msghdr message{};
    message.msg_iov = &vector;
    message.msg_iovlen = 1;
    message.msg_control = ancillary;
    message.msg_controllen = sizeof(ancillary);
    require(::recvmsg(data, &message, 0) == 1 && mark == 'L' && !(message.msg_flags & MSG_CTRUNC), "fixture SCM receive failed");
    auto *c = CMSG_FIRSTHDR(&message);
    require(c && c->cmsg_len == CMSG_LEN(sizeof(int)) && c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS &&
        !CMSG_NXTHDR(&message, c), "fixture SCM framing differs");
    int fd = -1;
    std::memcpy(&fd, CMSG_DATA(c), sizeof(fd));
    return fd;
}

void connect_to(int fd, const sockaddr_un &target) {
    require(::connect(fd, reinterpret_cast<const sockaddr *>(&target), sizeof(target)) == 0, "fixture data connect failed");
}

void child(int in, int out, const char *socket_path, const char *alternate) {
    send_byte(out, 'R');
    require(read_byte(in) == 'G', "fixture child did not receive connect selection");
    const auto target = address(socket_path);
    FD first(open_socket()), second(open_socket());
    connect_to(first.value, target);
    connect_to(second.value, target);
    int pair1[2], pair2[2];
    require(::socketpair(AF_UNIX, SOCK_STREAM, 0, pair1) == 0 && ::socketpair(AF_UNIX, SOCK_STREAM, 0, pair2) == 0, "fixture socketpair failed");
    FD control1(pair1[0]), sent1(pair1[1]), control2(pair2[0]), sent2(pair2[1]);
    transfer(first.value, sent1.value);
    transfer(second.value, sent2.value);
    sent1.close();
    sent2.close();
    require(read_byte(in) == 'E', "fixture child did not receive exec selection");
    const auto in_text = std::to_string(in), out_text = std::to_string(out);
    const auto first_text = std::to_string(first.value), second_text = std::to_string(second.value);
    const auto c1_text = std::to_string(control1.value), c2_text = std::to_string(control2.value);
    ::execl(alternate, alternate, "exec-child", in_text.c_str(), out_text.c_str(), first_text.c_str(), second_text.c_str(),
        c1_text.c_str(), c2_text.c_str(), static_cast<char *>(nullptr));
    throw std::runtime_error("fixture could not exec alternate image");
}

void control(const char *executable, const char *socket_path, const char *alternate) {
    const auto target = address(socket_path);
    FD listener(open_socket());
    require(::fcntl(listener.value, F_SETFD, FD_CLOEXEC) == 0 &&
        ::bind(listener.value, reinterpret_cast<const sockaddr *>(&target), sizeof(target)) == 0 &&
        ::listen(listener.value, 2) == 0, "fixture Unix listen failed");
    int command[2], event[2];
    require(::pipe(command) == 0 && ::pipe(event) == 0, "fixture pipes unavailable");
    FD read_command(command[0]), write_command(command[1]), read_event(event[0]), write_event(event[1]);
    const auto in = std::to_string(read_command.value), out = std::to_string(write_event.value);
    Child original{::fork()};
    require(original.pid >= 0, "fixture fork failed");
    if (original.pid == 0) {
        ::close(write_command.value);
        ::close(read_event.value);
        ::execl(executable, executable, "child", in.c_str(), out.c_str(), socket_path, alternate, static_cast<char *>(nullptr));
        ::_exit(126);
    }
    read_command.close();
    write_event.close();
    require(read_byte(read_event.value) == 'R', "original child exec did not finish");
    std::string failure;
    peer::ExpectedProcess expected{};
    expected.uid = ::geteuid();
    expected.pid = original.pid;
    expected.image_path = executable;
    require(peer::process_start(expected.pid, expected.start, failure), failure);
    require(peer::image_digest(executable, expected.image_bytes, expected.image_sha256.data(), failure), failure);
    auto bad_start = expected;
    ++bad_start.start.a;
    peer::PeerLease start_refusal;
    require(!start_refusal.prepare(bad_start, failure) && start_refusal.close(failure), "wrong process start admitted or debt lost");
    peer::PeerLease lease, wrong_image, wrong_control;
    require(lease.prepare(expected, failure), "prepare original: " + failure);
    auto bad_image = expected;
    bad_image.image_sha256[0] ^= 1;
    require(wrong_image.prepare(bad_image, failure), "image control preparation: " + failure);
    require(wrong_control.prepare(expected, failure), "control peer preparation: " + failure);
    send_byte(write_command.value, 'G');
    wait_readable(listener.value);
    FD data(::accept(listener.value, nullptr, nullptr));
    wait_readable(listener.value);
    FD other_data(::accept(listener.value, nullptr, nullptr));
    FD control_fd(receive(data.value)), other_control(receive(other_data.value));
    int local_pair[2];
    require(::socketpair(AF_UNIX, SOCK_STREAM, 0, local_pair) == 0, "fixture local pair unavailable");
    FD local0(local_pair[0]), local1(local_pair[1]);
    require(!wrong_control.bind(data.value, local0.value, failure) && wrong_control.close(failure), "locally created control peer admitted");
    require(!wrong_image.bind(data.value, control_fd.value, failure) && wrong_image.close(failure), "wrong expected image admitted or debt lost");
    require(lease.bind(data.value, control_fd.value, failure), "bind original: " + failure);
    require(lease.current(data.value, control_fd.value, failure), "current original: " + failure);
    require(!lease.current(other_data.value, control_fd.value, failure) && !lease.current(data.value, other_control.value, failure) &&
        !lease.current(data.value, failure), "second connection or missing control admitted");
    require(!lease.bind(data.value, control_fd.value, failure), "original lease rebound");
    peer::PeerLease close_uncertain;
    require(close_uncertain.prepare(expected, failure) && close_uncertain.bind(data.value, control_fd.value, failure), "close control peer bind failed");
    peer::inject_close = true;
    require(!close_uncertain.current(data.value, control_fd.value, failure) && !peer::inject_close && errno == EIO,
        "temporary close uncertainty lost or observation published");
    FD replacement(::open("/dev/null", O_RDONLY | O_CLOEXEC));
    if (replacement.value != peer::injected_fd) {
        require(::dup2(replacement.value, peer::injected_fd) == peer::injected_fd, "fixture did not reuse the uncertain descriptor number");
        replacement.close();
        replacement.value = peer::injected_fd;
    }
    require(!close_uncertain.close(failure) && errno == EIO && ::fcntl(peer::injected_fd, F_GETFD) >= 0,
        "original close uncertainty lost or closed a reused descriptor number");
    const auto attempts = peer::close_calls;
    require(!close_uncertain.close(failure) && errno == EIO && peer::close_calls == attempts, "unknown close was retried");
    replacement.close();
    send_byte(write_command.value, 'E');
    require(read_byte(read_event.value) == 'X', "same child did not exec different image");
    peer::ProcessStart after{};
    require(peer::process_start(expected.pid, after, failure) && expected.start.kind == after.kind && expected.start.a == after.a &&
        expected.start.b == after.b, "exec changed original process lifetime");
    require(!lease.current(data.value, control_fd.value, failure), "same child exec admitted on original connected FDs");
    require(lease.close(failure) && lease.close(failure), "original process descriptor close failed");
    require(::fcntl(data.value, F_GETFD) >= 0 && ::fcntl(control_fd.value, F_GETFD) >= 0, "lease closed borrowed sockets");
    send_byte(write_command.value, 'Q');
    original.wait();
    wait_readable(data.value);
    char byte;
    require(::read(data.value, &byte, 1) == 0 && ::read(control_fd.value, &byte, 1) == 0, "original connected sockets did not reach EOF");
    other_control.close(); control_fd.close(); other_data.close(); data.close(); listener.close();
    require(::unlink(socket_path) == 0, "fixture Unix endpoint cleanup failed");
    std::printf("{\"kernel\":true,\"independentChild\":true,\"samePidExec\":true,\"exactDataAndSCMControl\":true,\"childExit\":0,\"physicalClose\":true,\"publicTemporaryCloseFault\":true,\"transportOnly\":true}\n");
}
}

int main(int argc, char **argv) {
    try {
        if (argc == 6 && std::string(argv[1]) == "child") child(std::stoi(argv[2]), std::stoi(argv[3]), argv[4], argv[5]);
        else if (argc == 8 && std::string(argv[1]) == "exec-child") {
            send_byte(std::stoi(argv[3]), 'X');
            require(read_byte(std::stoi(argv[2])) == 'Q', "fixture exec child did not receive close selection");
            for (int i = 2; i < argc; ++i) require(::close(std::stoi(argv[i])) == 0, "fixture exec child close failed");
        } else if (argc == 3) control(argv[0], argv[1], argv[2]);
        else throw std::runtime_error("fixture arguments differ");
        return 0;
    } catch (const std::exception &e) {
        std::fprintf(stderr, "%s\n", e.what());
        return 1;
    }
}
