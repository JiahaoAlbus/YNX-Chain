#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "cloud-finite-get-control.hpp"

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

namespace ynx::cloud_finite_get_detail {
#if defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_TEST)
int fixture_cloud_control_close(int fd);
#endif
namespace {
using Clock = std::chrono::steady_clock;

bool wait_ready(int fd, short events, Control::Deadline deadline) {
    for (;;) {
        const auto now = Clock::now();
        if (now >= deadline) { errno = ETIMEDOUT; return false; }
        const auto left = std::chrono::ceil<std::chrono::milliseconds>(deadline - now).count();
        pollfd event{fd, events, 0};
        const int result = ::poll(&event, 1, static_cast<int>(left));
        if (result < 0 && errno == EINTR) continue;
        if (result < 0) return false;
        if (!result) { errno = ETIMEDOUT; return false; }
        if (event.revents & (events | POLLHUP)) return true; // Read a pending prefix or observe EOF.
        errno = event.revents & POLLNVAL ? EBADF : EIO;
        return false;
    }
}

bool nonzero(const std::array<uint8_t, 32> &digest) {
    return std::any_of(digest.begin(), digest.end(), [](uint8_t byte) { return byte != 0; });
}

bool same_owner(const std::weak_ptr<const void> &held, const void *address, const std::shared_ptr<const void> &candidate) {
    return candidate && candidate.get() == address && !held.expired() &&
        !held.owner_before(candidate) && !candidate.owner_before(held);
}

int close_socket(int fd) {
#if defined(YNX_LINK_PUBLIC_CLOUD_CONTROL_TEST)
    return fixture_cloud_control_close(fd);
#else
    return ::close(fd);
#endif
}
}

struct Control::Impl {
    const pid_t owner = ::getpid();
    resource_current_detail::PeerLease peer;
    int data = -1, control = -1;
    bool receive_selected = false, bind_selected = false, close_selected = false;
    const void *request_address = nullptr, *loan_address = nullptr;
    std::weak_ptr<const void> request, loan;
    std::array<uint8_t, 32> channel_sha256{}, proof_sha256{};
    ControlLifetime life;
    std::optional<ControlFailure> first;

    bool fail(std::string detail, int error = 0) {
        if (!first) first.emplace(ControlFailure{std::move(detail), error});
        return false;
    }

    bool bounded(Deadline deadline) {
        const auto now = Clock::now();
        if (deadline > now && deadline - now <= std::chrono::seconds(30)) return true;
        return fail("Cloud control deadline outside bound", deadline <= now ? ETIMEDOUT : EINVAL);
    }

    bool exact(const OriginalBinding &b) {
        if (!same_owner(request, request_address, b.request) || !same_owner(loan, loan_address, b.loan) ||
            b.channel_sha256 != channel_sha256 || b.proof_sha256 != proof_sha256)
            return fail("same held Cloud request, channel, proof and loan required");
        return true;
    }

    void close_error(int error) {
        life.close_unknown = true;
        if (!life.close_error) life.close_error = error ? error : EIO;
    }

    void close_fd(int &slot) {
        const int original = slot;
        slot = -1; // A failed close is UNKNOWN; never retry a potentially reused numeric FD.
        if (original >= 0 && close_socket(original)) close_error(errno);
    }

    bool receive_rights(Deadline deadline, uint8_t &marker) {
        uint8_t received_marker = 0;
        alignas(cmsghdr) unsigned char ancillary[CMSG_SPACE(4 * sizeof(int))]{};
        iovec payload{&received_marker, 1};
        msghdr message{};
        ssize_t count;
        for (;;) {
            if (!wait_ready(data, POLLIN, deadline)) return fail("Cloud control descriptor receive unavailable", errno);
            message.msg_iov = &payload;
            message.msg_iovlen = 1;
            message.msg_control = ancillary;
            message.msg_controllen = sizeof(ancillary);
            message.msg_flags = 0;
            int flags = MSG_DONTWAIT;
#ifdef MSG_CMSG_CLOEXEC
            flags |= MSG_CMSG_CLOEXEC;
#endif
            count = ::recvmsg(data, &message, flags);
            if (count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) continue;
            if (count < 0) return fail("Cloud control descriptor receive failed", errno);
            break;
        }
        bool exact_ancillary = count == 1 && !(message.msg_flags & (MSG_CTRUNC | MSG_TRUNC));
        size_t rights = 0;
        for (auto *item = CMSG_FIRSTHDR(&message); item; item = CMSG_NXTHDR(&message, item)) {
            if (item->cmsg_level != SOL_SOCKET || item->cmsg_type != SCM_RIGHTS || item->cmsg_len < CMSG_LEN(0)) {
                exact_ancillary = false;
                continue;
            }
            const size_t bytes = item->cmsg_len - CMSG_LEN(0);
            if (bytes != sizeof(int)) exact_ancillary = false;
            for (size_t offset = 0; offset + sizeof(int) <= bytes; offset += sizeof(int)) {
                int fd;
                std::memcpy(&fd, CMSG_DATA(item) + offset, sizeof(fd));
                if (++rights == 1) control = fd;
                else close_fd(fd);
            }
        }
        life.descriptor_received = rights != 0;
        if (!exact_ancillary || rights != 1) return fail("exactly one original Cloud SCM descriptor required");
        if (::fcntl(control, F_SETFD, FD_CLOEXEC) < 0) return fail("Cloud control CLOEXEC setup failed", errno);
        marker = received_marker;
        return true;
    }

    bool stream_io(uint8_t *input, const uint8_t *output, size_t size, Deadline deadline, size_t &progress) {
#ifdef SO_NOSIGPIPE
        const int yes = 1;
        if (output && ::setsockopt(control, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof(yes)))
            return fail("Cloud control SIGPIPE protection failed", errno);
#endif
        while (progress < size) {
            if (!wait_ready(control, output ? POLLOUT : POLLIN, deadline))
                return fail(output ? "Cloud control write unavailable" : "Cloud control read unavailable", errno);
            ssize_t count;
            if (output) {
                int flags = MSG_DONTWAIT;
#ifdef MSG_NOSIGNAL
                flags |= MSG_NOSIGNAL;
#endif
                count = ::send(control, output + progress, size - progress, flags);
            } else {
                iovec chunk{input + progress, size - progress};
                msghdr message{};
                message.msg_iov = &chunk;
                message.msg_iovlen = 1;
                count = ::recvmsg(control, &message, MSG_DONTWAIT);
                if (count > 0 && (message.msg_flags & (MSG_CTRUNC | MSG_TRUNC))) {
                    progress += static_cast<size_t>(count);
                    return fail("Cloud control stream carried unexpected ancillary DATA");
                }
            }
            if (count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) continue;
            if (count <= 0) return fail(output ? "Cloud control write incomplete" : "Cloud control read incomplete", count ? errno : ENOTCONN);
            progress += static_cast<size_t>(count);
        }
        return true;
    }
};

Control::Control() : state(new Impl) {}
Control::~Control() {
    if (state->owner == ::getpid()) close();
    else {
        if (state->control >= 0) ::close(state->control);
        if (state->data >= 0) ::close(state->data);
    }
}

bool Control::receive_descriptor(int fd, const resource_current_detail::ExpectedProcess &expected,
                                 Deadline deadline, uint8_t &marker) {
    marker = 0;
    auto &s = *state;
    if (s.owner != ::getpid()) return false;
    if (s.receive_selected || s.life.retired) return s.fail("original Cloud control descriptor already selected or retired");
    s.receive_selected = true;
    if (fd < 0) return s.fail("original Cloud data socket required");
    if (!s.bounded(deadline)) return false;
    std::string failure;
    if (!s.peer.prepare(expected, failure)) return s.fail(std::move(failure));
    s.data = ::fcntl(fd, F_DUPFD_CLOEXEC, 0);
    if (s.data < 0) return s.fail("Cloud original data socket duplication failed", errno);
    uint8_t observed_marker;
    if (!s.receive_rights(deadline, observed_marker)) return false;
    if (!s.peer.bind(s.data, s.control, failure)) return s.fail(std::move(failure));
    s.life.peer_bound = true;
    marker = observed_marker;
    return true;
}

bool Control::bind_original(const OriginalBinding &binding) {
    auto &s = *state;
    if (s.owner != ::getpid() || s.first) return false;
    if (s.bind_selected || !s.life.peer_bound || s.life.retired) return s.fail("original Cloud request binding unavailable or already selected");
    s.bind_selected = true;
    if (!binding.request || !binding.loan || !nonzero(binding.channel_sha256) || !nonzero(binding.proof_sha256))
        return s.fail("original Cloud request binding required");
    std::string failure;
    if (!s.peer.current(s.data, s.control, failure)) return s.fail(std::move(failure));
    s.request = binding.request;
    s.request_address = binding.request.get();
    s.loan = binding.loan;
    s.loan_address = binding.loan.get();
    s.channel_sha256 = binding.channel_sha256;
    s.proof_sha256 = binding.proof_sha256;
    if (!s.peer.current(s.data, s.control, failure)) return s.fail(std::move(failure));
    s.life.original_bound = true;
    return true;
}

bool Control::current(const OriginalBinding &binding) {
    auto &s = *state;
    if (s.owner != ::getpid() || s.first) return false;
    if (!s.life.original_bound || s.life.retired) return s.fail("Cloud control is unbound or retired");
    if (!s.exact(binding)) return false;
    std::string failure;
    return s.peer.current(s.data, s.control, failure) || s.fail(std::move(failure));
}

bool Control::read_frame(const OriginalBinding &binding, size_t size, Deadline deadline, std::vector<uint8_t> &original) {
    original.clear();
    auto &s = *state;
    if (s.owner != ::getpid() || s.first) return false;
    if (s.life.read_selected) return s.fail("original Cloud control read already selected");
    s.life.read_selected = true;
    if (!size || size > max_frame_bytes) return s.fail("Cloud control read size outside bound", EINVAL);
    if (!s.bounded(deadline) || !current(binding)) return false;
    original.resize(size);
    size_t progress = 0;
    const bool complete = s.stream_io(original.data(), nullptr, size, deadline, progress);
    original.resize(progress);
    s.life.read_complete = complete;
    return complete && current(binding);
}

bool Control::write_frame(const OriginalBinding &binding, const std::vector<uint8_t> &original,
                          Deadline deadline, size_t &written) {
    written = 0;
    auto &s = *state;
    if (s.owner != ::getpid() || s.first) return false;
    if (!s.life.read_complete || s.life.write_selected) return s.fail("one original Cloud control write after read required");
    s.life.write_selected = true;
    if (original.empty() || original.size() > max_frame_bytes) return s.fail("Cloud control write size outside bound", EINVAL);
    if (!s.bounded(deadline) || !current(binding)) return false;
    s.life.write_complete = s.stream_io(nullptr, original.data(), original.size(), deadline, written);
    // A complete write is observable even when the receiver immediately closes.
    // Its bytes still need the SDK protocol and Auth owner to establish meaning.
    return s.life.write_complete;
}

void Control::retire() {
    if (state->owner == ::getpid()) state->life.retired = true;
}

bool Control::close() {
    auto &s = *state;
    if (s.owner != ::getpid()) return false;
    if (s.close_selected) return s.life.local_closed;
    s.close_selected = true;
    retire();
    s.close_fd(s.control);
    s.close_fd(s.data);
    std::string failure;
    if (!s.peer.close(failure)) {
        s.close_error(errno);
        s.fail(std::move(failure), s.life.close_error);
    }
    if (s.life.close_unknown) s.fail("original Cloud descriptor close remains unknown", s.life.close_error);
    s.life.local_closed = !s.life.close_unknown;
    return s.life.local_closed;
}

ControlLifetime Control::lifetime() const {
    return state->owner == ::getpid() ? state->life : ControlLifetime{};
}

const std::optional<ControlFailure> &Control::first_failure() const {
    return state->first;
}
}
