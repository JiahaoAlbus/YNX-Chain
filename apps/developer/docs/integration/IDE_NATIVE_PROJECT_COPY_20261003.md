# Native selected-context project boundary

Status: SOURCE_ONLY. Parent 59260ad705a6cca35e56eb76efee96bae43e0aa8.

Copy Selected Context requires the active runtime session/workspace and verifies the editor file's real path inside that workspace before and after its confirmation dialog. It rechecks document version, runtime session and workspace after the final asynchronous path check and before clipboard write. Project-outside files, symlink swaps, runtime changes and document changes do not produce a clipboard capture. Cancellation remains local; model sending remains separately reviewed on Tools.

Tools 0.2.1 uses a directory derived from the validated bundled publisher/name/version. Existing 0.1.0 and 0.2.0 files are preserved. Current-version modifications and symlinks still refuse overwrite. No new driver, network or package install is introduced.

100 relevant tests and static check passed. Native commands run from actual extension source in a controlled VSCode VM; file containment and symlink behavior use real temporary files. The existing versioned bundle copy uses the real filesystem. Two old-source failures are preserved. Frontend/protocol and package inputs are unchanged across all 71 recorded build inputs; the exact 59260ad70 artifact is reused. No browser or compile rerun is claimed in this native/backend-only batch.

Formal publication, actual Linux OpenVSCode extension selection/copy/apply/save/reopen, configured real model, installed-device acceptance, capacity and MONSTER remain unverified. A owns the formal release and shared authority configuration. Network/package-egress/LXD remain stopped.
