# Code OSS/OpenVSX first slice preparation

This is a runtime/permission design boundary, not an activated feature or a release claim. No server binary, marketplace extension, shared auth route, deployment, or user migration was installed by this repair.

## Independent runtime

Select one immutable OpenVSCode Server release artifact for each supported Linux architecture before provisioning. Its receipt must include upstream release URL, version, SHA-256, artifact architecture, LICENSE.txt and bundled ThirdPartyNotices.txt digests. Mount source project, user data and extensions separately under one stable owner/project mapping; keep legacy guest revisions and offline edits until an explicitly reviewed link/migration. Extension host, terminal, LSP and debugger run inside the owner-scoped non-root runtime, never in the production gateway process. CPU/memory/disk limits, reviewed package/extension egress and unit/container shutdown receipts apply independently.

An extension download is executable code admission. Persist publisher/name/version, engine range, target platform, verified digest, source URL, upstream license/provenance, install result, activation event and uninstall/upgrade result per owner. OpenVSX API/gallery is the registry target; external VSIX requires its own applicable license and immutable digest. Never repoint to the Microsoft Marketplace or reuse Microsoft-distributed licensed binaries as a Code OSS deployment shortcut.

## Shared gateway boundary owned by A

Bind the server to a private listener and use a private connection-token file. OpenVSCode's container example disables token admission by default, so that default must not be copied. The gateway must validate current backend/Wallet owner identity, owner/project/runtime tuple, admission/revocation and websocket access before proxying. A is the sole owner of those shared auth/router/deployment changes. Host sockets, production credentials and another owner's volumes cannot enter the runtime. Raw token-bearing URLs cannot become user-visible public launch links or receipt logs.

## First runnable acceptance after the stop repair

Use a separate candidate and one harmless licensed OpenVSX extension. Prove an actual remote extension-host process and activation event, one language completion/definition request, real compile/run, installation of one exact library, terminal Stop, extension update/disable/uninstall, restart persistence and different-owner denial. Export exact runtime and extension receipts. A visual editor, extension manifest, HTTP 200 or library installation receipt alone is insufficient.

## Primary sources checked 2026-10-01

- [OpenVSCode Server upstream](https://github.com/gitpod-io/openvscode-server): independent browser server, non-root image user and explicit connection-token options.
- [Using OpenVSX in VS Code](https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code): product.json gallery adapter endpoints.
- [VS Code FAQ](https://code.visualstudio.com/docs/supporting/faq): Code OSS versus Microsoft distribution and Marketplace/extension usage boundaries.
