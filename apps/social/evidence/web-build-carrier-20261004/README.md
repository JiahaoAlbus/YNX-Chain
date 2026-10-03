# Exact static Web build carrier, not a release lease

Source: bfe10c9fdf26946bda8504080acf9c59abe13d8c.
Source tree: 60706395412f390e287ef3f7bec31d8f5dae218c.
Build: node web/build.mjs from apps/social with committed web, src, package.json
and package-lock.json inputs. Existing installed dependencies were read-only.
No vendor rewrite, shared source modification or publication occurred.

First export accidentally omitted required src inputs and failed. build.txt
retains that orchestration failure. Two subsequent fresh complete exports built
successfully; their generated 27-file size/SHA manifests compare equal. Output
contains 13382233 static bytes. Dependency build provenance is not independently
proved by these successful builds.

The durable static-prebuilt-candidate.tar.gz is 3342237 bytes, SHA256
1075160612a09a639a9469fa5b9cbed71319d195400dd7e19b553ef7f45796af.
It contains .vercel/output/static, minimal version-3 output configuration and
candidate-manifest.json. The packaging helper rejects existing destination,
symlinks, special files and missing required output files. No secrets, real
sessions, data directories, OS state or deployment credentials are included.

Official format reference:
https://vercel.com/docs/build-output-api/configuration
https://vercel.com/docs/build-output-api/primitives

The minimal static configuration is NOT the protected production callback
routing/security policy. The original builder explicitly leaves the Matrix
callback mount to A. No apps/social/vercel.json or shared/Host configuration was
modified. candidate-manifest deployable/activationApproved/HostExecutionApproved
remain false; executor, lease, current deployment and rollback remain null.

Single executable release blocker: the sole controller/release owner composes
the exact admitted callback route and no-store/no-referrer/query-free logging
contract, pins current deployment and rollback, and supplies the separate
Social-only single-use lease/executor. That composition changes the final
artifact identity and requires its own immutable freeze. Do not deploy this
static-only archive by itself or treat a format carrier as lease approval.

Planned post-release checks remain real source-bound public non-sensitive
identity/logo, late/no-provider, guest/URL/single-tab/no-blank/captured console,
followed by separately confirmed installed/private lifecycle and MONSTER.
No public release, account request, signature, transaction or crypto activation
occurred; this checkpoint does not complete the Social goal.
