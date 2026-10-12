# Native Testnet starter destination binding

Status: SOURCE_ONLY. Parent e5da4989423adeb9786dd793787005e85875756d.

The existing SDK starter creation command now requires the active project runtime. Its selected workspace folder must resolve to the project root or a real subdirectory. The confirmation displays the exact destination. After confirmation the command rechecks canonical project root/folder, runtime session/workspace and the displayed first workspace folder before issuing the existing atomic no-overwrite edit. Changed symlink targets, switched runtime or workspace folder refuse creation. No libraries, transactions or new network execution are introduced.

Tools 0.2.2 uses the existing validated versioned directory preparation and retains prior version files.

102 relevant tests and static check passed. Tests execute actual extension source with controlled VSCode API plus real directories/symlinks, including supported root/subfolder creation, external destination refusal, inside/outside folder redirection, changed real runtime root and workspace/session changes. Old source produced two preserved failures. All 71 frontend/protocol/package build inputs remain unchanged; the exact previously built frontend artifact is reused. No browser/build rerun claimed.

Actual Linux OpenVSCode creation/save/reopen, configured real model, Wallet signing/deployment, capacity, installed/public acceptance and MONSTER remain unverified. Shared authority and formal Host release belong to A. Network/package-egress/LXD remain stopped.
