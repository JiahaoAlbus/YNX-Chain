#include "cloud-finite-get-control-c.h"
#include "cloud-finite-get-control.hpp"

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <new>
#include <unistd.h>

struct ynx_cloud_finite_get_control {
    const pid_t pid = ::getpid();
    ynx::cloud_finite_get_detail::Control control;
    bool receive_selected = false, exception_unknown = false;
    ynx_cloud_control_snapshot first{};
};

namespace {
using Control = ynx::cloud_finite_get_detail::Control;

bool owned(const ynx_cloud_finite_get_control *owner) {
    return owner && owner->pid == ::getpid();
}

void remember(ynx_cloud_finite_get_control &owner, const char *detail, int error) {
    if (owner.first.first_error_present) return;
    const auto &first = owner.control.first_failure();
    if (first) {
        detail = first->detail.c_str();
        error = first->system_error;
    }
    if (!detail) return;
    owner.first.first_error_present = 1;
    owner.first.first_system_error = error;
    std::strncpy(owner.first.first_detail, detail, sizeof(owner.first.first_detail) - 1);
}

void copy_failure(ynx_cloud_control_snapshot &out, const ynx::cloud_finite_get_detail::ControlFailure &failure) {
    out.first_error_present = 1;
    out.first_system_error = failure.system_error;
    std::strncpy(out.first_detail, failure.detail.c_str(), sizeof(out.first_detail) - 1);
}
}

ynx::cloud_finite_get_detail::Control *ynx::cloud_finite_get_detail::borrow_accepted_control(ynx_cloud_finite_get_control *owner) {
    if (!owned(owner) || owner->first.first_error_present || owner->exception_unknown || owner->control.first_failure()) return nullptr;
    const auto life = owner->control.lifetime();
    return life.peer_bound && !life.retired ? &owner->control : nullptr;
}

ynx_cloud_finite_get_control *ynx_cloud_control_new(void) {
    try { return new ynx_cloud_finite_get_control; }
    catch (...) { return nullptr; }
}

int ynx_cloud_control_receive(ynx_cloud_finite_get_control *owner, int accepted_fd, int wake_fd,
    const ynx_cloud_control_expected_process *expected, uint32_t remaining_ms, uint8_t *marker) {
    if (marker) *marker = 0;
    if (!owned(owner)) return 0;
    if (owner->receive_selected || owner->control.lifetime().retired) {
        remember(*owner, "original Cloud descriptor receive already selected or retired", EINVAL);
        return 0;
    }
    owner->receive_selected = true;
    if (!marker || !expected || !expected->image_path || !expected->image_path_bytes ||
        expected->image_path_bytes > 4095 || !remaining_ms || remaining_ms > 30000) {
        remember(*owner, "bounded original Cloud accept inputs required", EINVAL);
        return 0;
    }
    try {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(remaining_ms);
        ynx::resource_current_detail::ExpectedProcess peer{expected->uid, expected->pid,
            {expected->start_kind, expected->start_a, expected->start_b},
            std::string(expected->image_path, expected->image_path_bytes), expected->image_bytes, {}};
        std::copy_n(expected->image_sha256, peer.image_sha256.size(), peer.image_sha256.begin());
        if (owner->control.receive_descriptor(accepted_fd, peer, deadline, *marker, wake_fd)) return 1;
        remember(*owner, "original Cloud descriptor receive failed", EIO);
    } catch (const std::bad_alloc &) {
        remember(*owner, "original Cloud descriptor receive allocation failed", ENOMEM);
    } catch (...) {
        remember(*owner, "original Cloud descriptor receive failed", EIO);
    }
    return 0;
}

int ynx_cloud_control_get_snapshot(const ynx_cloud_finite_get_control *owner, ynx_cloud_control_snapshot *out) {
    if (!out) return 0;
    *out = {};
    if (!owned(owner)) return 0;
    *out = owner->first;
    const auto &failure = owner->control.first_failure();
    if (!out->first_error_present && failure) copy_failure(*out, *failure);
    const auto life = owner->control.lifetime();
    out->descriptor_received = life.descriptor_received;
    out->peer_bound = life.peer_bound;
    out->retired = life.retired;
    out->close_unknown = life.close_unknown || owner->exception_unknown;
    out->local_closed = life.local_closed && !out->close_unknown;
    out->close_error = life.close_error ? life.close_error : owner->exception_unknown ? EIO : 0;
    return 1;
}

void ynx_cloud_control_retire(ynx_cloud_finite_get_control *owner) {
    if (owned(owner)) owner->control.retire();
}

int ynx_cloud_control_close(ynx_cloud_finite_get_control *owner) {
    if (!owned(owner) || owner->exception_unknown) return 0;
    try {
        const bool closed = owner->control.close();
        remember(*owner, nullptr, 0);
        return closed;
    } catch (...) {
        owner->exception_unknown = true;
        remember(*owner, "original Cloud descriptor close remains unknown", EIO);
        return 0;
    }
}

int ynx_cloud_control_free(ynx_cloud_finite_get_control **owner) {
    if (!owner || !owned(*owner) || (*owner)->exception_unknown || !(*owner)->control.lifetime().local_closed) return 0;
    delete *owner;
    *owner = nullptr;
    return 1;
}
