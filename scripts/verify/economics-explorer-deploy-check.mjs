import fs from "node:fs";

const deploy = fs.readFileSync("scripts/deploy/deploy-economics-explorer.sh", "utf8");
const installer = fs.readFileSync("scripts/deploy/remote/install-economics-explorer.sh", "utf8");

for (const [source, required] of [
  [deploy, [
    "GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build",
    "YNX_STABLE_RESERVE_SOURCE_COMMIT",
    "YNX_STABLE_RESERVE_ADAPTER_RELEASE_CLASS",
    "reserve_mode=\"preserve\"",
    "shasum -a 256",
    "ynx_transport_scp economics-explorer-upload",
    "ynx_transport_ssh economics-explorer-install",
  ]],
  [installer, [
    "sha256sum -c SHA256SUMS",
    "backup=\"/var/backups/ynx-chain/$release\"",
    "rollback()",
    "systemctl stop ynx-explorerd.service",
    "mv -f \"${destination}.${release}.restore\"",
    "previous binary and configuration restored",
    "for attempt in $(seq 1 12)",
    "public reserve endpoint did not prove the expected release",
    "systemctl restart ynx-explorerd.service",
    "YNX_STABLE_RESERVE_UNAVAILABLE",
    "externalReserveAttested",
  ]],
]) {
  for (const value of required) {
    if (!source.includes(value)) {
      throw new Error(`scoped Explorer deploy is missing required gate: ${value}`);
    }
  }
}

for (const forbidden of [
  "systemctl restart ynx-chaind",
  "systemctl restart ynx-indexerd",
  "/usr/local/bin/ynx-chaind",
  "/usr/local/bin/ynx-indexerd",
  "ynx-faucetd",
  "ynx-stablecoind",
]) {
  if (deploy.includes(forbidden) || installer.includes(forbidden)) {
    throw new Error(`scoped Explorer deploy crosses its service boundary: ${forbidden}`);
  }
}

console.log("scoped Explorer deploy verified: checksum, backup, rollback, fail-closed reserve and single-service boundary");
