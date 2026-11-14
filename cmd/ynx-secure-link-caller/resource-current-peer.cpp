#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "resource-current-peer.hpp"
#include <algorithm>
#include <array>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <limits>
#include <sstream>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#include <bsm/libbsm.h>
#include <libproc.h>
#include <mach/vm_prot.h>
#include <sys/ucred.h>
#elif defined(__linux__)
#include <linux/magic.h>
#include <openssl/evp.h>
#include <sys/vfs.h>
#else
#error resource_current requires Darwin or Linux kernel process identity
#endif

namespace ynx::resource_current_detail {
#if defined(YNX_LINK_PUBLIC_PEER_CLOSE_TEST)
int fixture_peer_close(int fd);
#endif
namespace {
constexpr uint64_t image_limit = 128ULL << 20;

int close_file(int fd) {
#if defined(YNX_LINK_PUBLIC_PEER_CLOSE_TEST)
    return fixture_peer_close(fd);
#else
    return ::close(fd);
#endif
}

struct FD {
    int value = -1;
    int *first_close_error = nullptr;
    ~FD() { finish(); }
    bool finish() {
        const int original = value;value = -1;
        if (original < 0 || close_file(original) == 0) return true;
        if (first_close_error && !*first_close_error) *first_close_error = errno ? errno : EIO;
        return false;
    }
    explicit FD(int *error = nullptr) : first_close_error(error) {}
    FD(const FD &) = delete;
    FD &operator=(const FD &) = delete;
};
bool denied(std::string &failure, const char *reason) { failure = reason; return false; }
bool same_file(const struct stat &a, const struct stat &b) {
    return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size &&
#if defined(__APPLE__)
        a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
        a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec;
#else
        a.st_mtim.tv_sec == b.st_mtim.tv_sec && a.st_mtim.tv_nsec == b.st_mtim.tv_nsec &&
        a.st_ctim.tv_sec == b.st_ctim.tv_sec && a.st_ctim.tv_nsec == b.st_ctim.tv_nsec;
#endif
}
bool digest_fd(int fd, uint64_t expected, uint8_t output[32], std::string &failure) {
    struct stat before{}, after{};
    if (::fstat(fd, &before) || !S_ISREG(before.st_mode) || before.st_size <= 0 ||
        static_cast<uint64_t>(before.st_size) > image_limit || static_cast<uint64_t>(before.st_size) != expected)
        return denied(failure, "bounded actual executable file required");
#if defined(__APPLE__)
    CC_SHA256_CTX context;
    if (CC_SHA256_Init(&context) != 1) return denied(failure, "image digest unavailable");
#else
    struct Digest {
        EVP_MD_CTX *p = EVP_MD_CTX_new();
        ~Digest() { EVP_MD_CTX_free(p); }
    } context;
    if (!context.p || EVP_DigestInit_ex(context.p, EVP_sha256(), nullptr) != 1)
        return denied(failure, "image digest unavailable");
#endif
    std::array<uint8_t, 16384> buffer{};
    uint64_t at = 0;
    while (at < expected) {
        size_t count = static_cast<size_t>(std::min<uint64_t>(buffer.size(), expected - at));
        ssize_t size = ::pread(fd, buffer.data(), count, static_cast<off_t>(at));
        if (size < 0 && errno == EINTR) continue;
        if (size <= 0) return denied(failure, "actual executable short read");
#if defined(__APPLE__)
        if (CC_SHA256_Update(&context, buffer.data(), static_cast<CC_LONG>(size)) != 1)
#else
        if (EVP_DigestUpdate(context.p, buffer.data(), static_cast<size_t>(size)) != 1)
#endif
            return denied(failure, "actual executable digest failed");
        at += static_cast<uint64_t>(size);
    }
    uint8_t extra = 0;
    if (::pread(fd, &extra, 1, static_cast<off_t>(expected)) != 0 || ::fstat(fd, &after) || !same_file(before, after))
        return denied(failure, "actual executable changed during digest");
#if defined(__APPLE__)
    if (CC_SHA256_Final(output, &context) != 1) return denied(failure, "actual executable digest failed");
#else
    unsigned size = 0;
    if (EVP_DigestFinal_ex(context.p, output, &size) != 1 || size != 32) return denied(failure, "actual executable digest failed");
#endif
    return true;
}
#if defined(__linux__)
bool linux_start(int fd, int32_t pid, ProcessStart &out, std::string &failure) {
    std::array<char, 8193> raw{};
    ssize_t size = ::pread(fd, raw.data(), raw.size(), 0);
    if (size <= 0 || size >= static_cast<ssize_t>(raw.size())) return denied(failure, "bounded original proc stat required");
    std::string text(raw.data(), static_cast<size_t>(size));
    const auto prefix = std::to_string(pid) + " (";
    const size_t close = text.rfind(')');
    if (text.compare(0, prefix.size(), prefix) || close == std::string::npos || close + 2 >= text.size() || text[close + 1] != ' ')
        return denied(failure, "original proc stat malformed");
    std::istringstream fields(text.substr(close + 2));
    std::string value;
    for (unsigned i = 0; i <= 19; ++i) if (!(fields >> value)) return denied(failure, "original process start missing");
    uint64_t ticks = 0;
    if (value.empty()) return denied(failure, "original process start missing");
    for (char c : value) {
        if (c < '0' || c > '9' || ticks > (UINT64_MAX - static_cast<unsigned>(c - '0')) / 10)
            return denied(failure, "original process start invalid");
        ticks = ticks * 10 + static_cast<unsigned>(c - '0');
    }
    if (!ticks) return denied(failure, "original process start invalid");
    out = {YNX_LINK_RESOURCE_CURRENT_LINUX_START_V1, ticks, 0};
    return true;
}
#endif

struct SocketIdentity {
    dev_t device{};
    ino_t inode{};
    bool operator==(const SocketIdentity &other) const { return device == other.device && inode == other.inode; }
};

bool socket_identity(int fd, SocketIdentity &out, std::string &failure) {
    struct stat info{};
    sockaddr_un peer{};
    socklen_t address_size = sizeof(peer);
    int type = 0;
    socklen_t type_size = sizeof(type);
    if (::fstat(fd, &info) || !S_ISSOCK(info.st_mode) ||
        ::getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &type_size) || type_size != sizeof(type) || type != SOCK_STREAM ||
        ::getpeername(fd, reinterpret_cast<sockaddr *>(&peer), &address_size) || peer.sun_family != AF_UNIX)
        return denied(failure, "connected original Unix stream required");
    out = {info.st_dev, info.st_ino};
    return true;
}
}

bool process_start(int32_t pid, ProcessStart &out, std::string &failure) {
    if (pid <= 0) return denied(failure, "positive process PID required");
#if defined(__APPLE__)
    struct proc_bsdinfo info{};
    if (::proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info) || info.pbi_pid != static_cast<uint32_t>(pid) ||
        !info.pbi_start_tvsec || info.pbi_start_tvusec >= 1000000)
        return denied(failure, "kernel process start unavailable");
    out = {YNX_LINK_RESOURCE_CURRENT_DARWIN_START_V1, info.pbi_start_tvsec, info.pbi_start_tvusec};
    return true;
#else
    FD directory, stat;
    std::string name = "/proc/" + std::to_string(pid);
    directory.value = ::open(name.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (directory.value < 0) return denied(failure, "original proc directory unavailable");
    stat.value = ::openat(directory.value, "stat", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    return stat.value >= 0 ? linux_start(stat.value, pid, out, failure) : denied(failure, "original proc stat unavailable");
#endif
}

bool image_digest(const std::string &path, uint64_t &bytes, uint8_t digest[32], std::string &failure) {
    FD file;
    file.value = ::open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    struct stat info{};
    if (file.value < 0 || ::fstat(file.value, &info) || info.st_size <= 0 || static_cast<uint64_t>(info.st_size) > image_limit)
        return denied(failure, "bounded image pin file unavailable");
    const uint64_t size = static_cast<uint64_t>(info.st_size);
    if (!digest_fd(file.value, size, digest, failure)) return false;
    bytes = size;
    return true;
}

struct PeerLease::Impl {
    const pid_t owner = ::getpid();
    ExpectedProcess expected;
    FD image, proc_root, proc_directory, proc_stat;
    struct stat image_stat{};
    SocketIdentity data_socket, control_socket;
    bool prepare_selected = false, prepared = false, bind_selected = false, captured = false;
    bool has_control = false, closed = false;
    int close_error = 0;
#if defined(__APPLE__)
    audit_token_t token{};
    uint64_t region = 0;
#endif
    bool peer(int fd, std::string &failure, bool first) {
        uint32_t uid = 0;
        int32_t pid = 0;
#if defined(__APPLE__)
        struct xucred credentials{};
        socklen_t size = sizeof(credentials);
        if (::getsockopt(fd, SOL_LOCAL, LOCAL_PEERCRED, &credentials, &size) || size != sizeof(credentials) ||
            credentials.cr_version != XUCRED_VERSION) return denied(failure, "original socket credentials unavailable");
        size = sizeof(pid);
        if (::getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) || size != sizeof(pid)) return denied(failure, "original socket PID unavailable");
        uid = credentials.cr_uid;
        audit_token_t actual{};
        size = sizeof(actual);
        if (::getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &actual, &size) || size != sizeof(actual) ||
            audit_token_to_pid(actual) != pid) return denied(failure, "original socket audit identity unavailable");
        if (first) token = actual;
        else if (std::memcmp(&token, &actual, sizeof(token))) return denied(failure, "original socket process generation changed");
#else
        (void)first;
        struct ucred credentials{};
        socklen_t size = sizeof(credentials);
        if (::getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &credentials, &size) || size != sizeof(credentials))
            return denied(failure, "original socket credentials unavailable");
        uid = credentials.uid; pid = credentials.pid;
#endif
        return uid == expected.uid && pid == expected.pid ? true : denied(failure, "original socket UID/PID mismatch");
    }
    bool start(std::string &failure) {
        ProcessStart actual;
#if defined(__APPLE__)
        struct proc_bsdinfo info{};
        if (::proc_pidinfo(expected.pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info) ||
            info.pbi_pid != static_cast<uint32_t>(expected.pid) || info.pbi_uid != expected.uid)
            return denied(failure, "original kernel process unavailable");
        actual = {YNX_LINK_RESOURCE_CURRENT_DARWIN_START_V1, info.pbi_start_tvsec, info.pbi_start_tvusec};
#else
        if (!linux_start(proc_stat.value, expected.pid, actual, failure)) return false;
#endif
        return actual.kind == expected.start.kind && actual.a == expected.start.a && actual.b == expected.start.b ? true :
            denied(failure, "original process start mismatch");
    }
#if defined(__APPLE__)
    bool mapped_main(std::string &failure, bool first) {
        char path[PROC_PIDPATHINFO_MAXSIZE]{};
        if (::proc_pidpath_audittoken(&token, path, sizeof(path)) <= 0 || std::string(path) != expected.image_path)
            return denied(failure, "original executable audit path changed");
        uint64_t address = first ? 0 : region;
        for (unsigned i = 0; i < (first ? 128U : 1U); ++i) {
            struct proc_regionwithpathinfo info{};
            if (::proc_pidinfo(expected.pid, PROC_PIDREGIONPATHINFO, address, &info, sizeof(info)) != sizeof(info))
                return denied(failure, "original executable vnode region unavailable");
            const auto &map = info.prp_prinfo;
            const auto &node = info.prp_vip.vip_vi.vi_stat;
            if (!map.pri_size || map.pri_address > UINT64_MAX - map.pri_size || map.pri_address + map.pri_size <= address)
                return denied(failure, "original executable region bound invalid");
            if ((map.pri_protection & VM_PROT_EXECUTE) && strnlen(info.prp_vip.vip_path, sizeof(info.prp_vip.vip_path)) < sizeof(info.prp_vip.vip_path) &&
                expected.image_path == info.prp_vip.vip_path &&
                node.vst_dev == static_cast<uint32_t>(image_stat.st_dev) && node.vst_ino == image_stat.st_ino &&
                node.vst_size == image_stat.st_size) { region = map.pri_address; return true; }
            address = map.pri_address + map.pri_size;
        }
        return denied(failure, "original main executable vnode not found within bound");
    }
#endif
    bool finish(FD &fd) {
        if (fd.finish()) return true;
        if (!close_error) close_error = errno ? errno : EIO;
        return false;
    }

    bool executable(std::string &failure, bool first) {
        FD actual(&close_error);
#if defined(__APPLE__)
        if (!mapped_main(failure, first)) return false;
        actual.value = ::open(expected.image_path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
#else
        (void)first;
        // This is deliberately the held proc-directory's kernel magic link,
        // not a readlink result reopened as a caller-controlled filesystem path.
        std::array<char, 4096> path{};
        ssize_t size = ::readlinkat(proc_directory.value, "exe", path.data(), path.size());
        if (size <= 0 || size >= static_cast<ssize_t>(path.size()) || expected.image_path.compare(0, expected.image_path.size(), path.data(), static_cast<size_t>(size)))
            return denied(failure, "original executable kernel path changed");
        actual.value = ::openat(proc_directory.value, "exe", O_RDONLY | O_CLOEXEC);
#endif
        FD named(&close_error);
#if defined(__linux__)
        named.value = ::open(expected.image_path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
#endif
        struct stat info{}, held{};
        bool ok = actual.value >= 0 && !::fstat(actual.value, &info) && same_file(info, image_stat) &&
            !::fstat(image.value, &held) && same_file(held, image_stat);
#if defined(__linux__)
        struct stat named_info{};
        ok = ok && named.value >= 0 && !::fstat(named.value, &named_info) && same_file(named_info, image_stat);
#endif
        uint8_t digest[32]{};
        if (!ok) denied(failure, "original executable file identity changed");
        else if (!digest_fd(actual.value, expected.image_bytes, digest, failure)) ok = false;
        else if (std::memcmp(digest, expected.image_sha256.data(), sizeof(digest))) ok = denied(failure, "original executable checksum changed");
        const int operation_error = errno;
        const bool actual_closed = finish(actual);
        const bool named_closed = finish(named);
        if (!ok) errno = operation_error;
        else if (!actual_closed || !named_closed) {
            errno = close_error;
            return denied(failure, "original peer descriptor close failed; no retry");
        }
        return ok;
    }

    bool channels(int data, int control, std::string &failure, bool first) {
        SocketIdentity actual_data, actual_control;
        if (!socket_identity(data, actual_data, failure) || !peer(data, failure, first)) return false;
        if (control >= 0) {
            if (!socket_identity(control, actual_control, failure) || !peer(control, failure, false)) return false;
            if (actual_data == actual_control) return denied(failure, "separate original control socket required");
        }
        if (first) {
            data_socket = actual_data;
            control_socket = actual_control;
            has_control = control >= 0;
        } else if (!(data_socket == actual_data) || has_control != (control >= 0) ||
            (has_control && !(control_socket == actual_control))) {
            return denied(failure, "original connected socket identity changed");
        }
        return true;
    }
};

PeerLease::PeerLease() : state(new Impl) {}
PeerLease::~PeerLease() = default;
bool PeerLease::capture(int fd, const ynx_link_resource_current_profile_v1 &profile, std::string &failure) {
    const auto path_size = strnlen(profile.image_path, sizeof(profile.image_path));
    ExpectedProcess expected{profile.peer_uid, profile.peer_pid, {profile.start_kind, profile.start_a, profile.start_b},
        std::string(profile.image_path, path_size), profile.image_bytes, {}};
    std::copy_n(profile.image_sha256, expected.image_sha256.size(), expected.image_sha256.begin());
    // The existing outbound entry already owns the connected data socket.
    // It never treats locally created sideband credentials as the remote peer.
    return prepare(expected, failure) && bind(fd, -1, failure);
}

bool PeerLease::prepare(const ExpectedProcess &expected, std::string &failure) {
    if (state->owner != ::getpid() || state->closed || state->prepare_selected)
        return denied(failure, "original process preparation already selected or unavailable");
    state->prepare_selected = true;
#if defined(__APPLE__)
    const bool start_valid = expected.start.kind == YNX_LINK_RESOURCE_CURRENT_DARWIN_START_V1 && expected.start.b < 1000000;
#else
    const bool start_valid = expected.start.kind == YNX_LINK_RESOURCE_CURRENT_LINUX_START_V1 && expected.start.b == 0;
#endif
    if (expected.pid <= 0 || !expected.start.a || !start_valid || !expected.image_bytes || expected.image_bytes > image_limit ||
        expected.image_path.empty() || expected.image_path.front() != '/' || expected.image_path.size() > 4095 ||
        expected.image_path.find('\0') != std::string::npos ||
        std::all_of(expected.image_sha256.begin(), expected.image_sha256.end(), [](uint8_t byte) { return byte == 0; }))
        return denied(failure, "independently expected process identity required");
    state->expected = expected;
#if defined(__linux__)
    state->proc_root.value = ::open("/proc", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    struct statfs fs{};
    if (state->proc_root.value < 0 || ::fstatfs(state->proc_root.value, &fs) || fs.f_type != PROC_SUPER_MAGIC)
        return denied(failure, "original procfs lease unavailable");
    const auto pid = std::to_string(expected.pid);
    state->proc_directory.value = ::openat(state->proc_root.value, pid.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    struct stat directory{};
    if (state->proc_directory.value < 0 || ::fstat(state->proc_directory.value, &directory) || directory.st_uid != expected.uid)
        return denied(failure, "original proc-directory lease unavailable");
    state->proc_stat.value = ::openat(state->proc_directory.value, "stat", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (state->proc_stat.value < 0) return denied(failure, "original proc stat unavailable");
    if (!state->start(failure)) return false;
    state->image.value = ::openat(state->proc_directory.value, "exe", O_RDONLY | O_CLOEXEC);
#else
    if (!state->start(failure)) return false;
    state->image.value = ::open(expected.image_path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
#endif
    if (state->image.value < 0 || ::fstat(state->image.value, &state->image_stat) || !S_ISREG(state->image_stat.st_mode))
        return denied(failure, "original executable lease unavailable");
    if (!state->start(failure)) return false;
    state->prepared = true;
    return true;
}

bool PeerLease::bind(int data, int control, std::string &failure) {
    if (state->owner != ::getpid() || !state->prepared || state->closed || state->close_error || state->bind_selected)
        return denied(failure, "original socket binding already selected or unavailable");
    state->bind_selected = true;
    if (!state->channels(data, control, failure, true) || !state->start(failure) || !state->executable(failure, true) ||
        !state->start(failure) || !state->channels(data, control, failure, false)) return false;
    state->captured = true;
    return true;
}
bool PeerLease::current(int fd, std::string &failure) {
    return current(fd, -1, failure);
}

bool PeerLease::current(int data, int control, std::string &failure) {
    if (state->owner != ::getpid() || !state->captured || state->closed || state->close_error)
        return denied(failure, "original peer is not captured or close is unknown");
    return state->channels(data, control, failure, false) && state->start(failure) && state->executable(failure, false) &&
        state->start(failure) && state->channels(data, control, failure, false);
}
bool PeerLease::close(std::string &failure) {
    if (state->owner != ::getpid()) return denied(failure, "original process lease belongs to another process");
    if (!state->closed) {
        state->closed = true;
        state->finish(state->image);
        state->finish(state->proc_stat);
        state->finish(state->proc_directory);
        state->finish(state->proc_root);
    }
    if (state->close_error) {
        errno = state->close_error;
        return denied(failure, "original peer descriptor close remains unknown; no retry");
    }
    return true;
}
}
