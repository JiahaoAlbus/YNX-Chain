// Pin executable provenance independently from product integration/deployment.
export const OPENVSCODE = Object.freeze({
  version: "1.109.5",
  commit: "072586267e68ece9a47aa43f8c108e0dcbf44622",
  architecture: "linux-arm64",
  release: "https://github.com/gitpod-io/openvscode-server/releases/tag/openvscode-server-v1.109.5",
  archive: "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v1.109.5/openvscode-server-v1.109.5-linux-arm64.tar.gz",
  sha256: "36d9c14036489b63de84ebace837fcacf7e60e669a0dc715802c5443684ea4dc",
  license: "MIT",
  licenseURL: "https://raw.githubusercontent.com/gitpod-io/openvscode-server/openvscode-server-v1.109.5/LICENSE.txt",
  licenseSha256: "9480271317925265e806a9a196aaa33410a962fa9d4d1e248a4a5187bc8c9df9",
  noticesURL: "https://raw.githubusercontent.com/gitpod-io/openvscode-server/openvscode-server-v1.109.5/ThirdPartyNotices.txt",
  noticesSha256: "00860feaf9ce3371670e5c399153b760a5f4f1a242e0b7a13be938d11f15b0a4",
  baseImage: "node@sha256:a0ddbc73510e98f5e824fd64266ffe1c2c343ba9cf260d95ca2985ad632a3f3e",
  marketplace: "https://open-vsx.org/vscode/gallery",
  authentication: "private-loopback-without-connection-token; verified-owner-project-session-proxy-required",
});

export const CORE_LIMITS = Object.freeze({
  activeGlobal: 8, activePerOwner: 2, files: 256, sourceBytes: 2 * 1024 * 1024,
  memoryBytes: 2 * 1024 * 1024 * 1024, cpus: 2, pids: 256,
  diskBytes: 1024 * 1024 * 1024, maxSessionMs: 4 * 60 * 60 * 1000,
});
export const OPENVSCODE_X64 = Object.freeze({ ...OPENVSCODE, architecture: "linux-x64",
  archive: "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v1.109.5/openvscode-server-v1.109.5-linux-x64.tar.gz",
  sha256: "b433bf4f0227321a7014d8460d10a8f958adc0f45aa79bd889e84e65e8f88363",
  baseImage: null,
});
