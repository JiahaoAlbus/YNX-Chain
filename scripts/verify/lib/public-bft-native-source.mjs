// The native producer and the new Comet candidate are separate releases. Only
// the original protected approval may opt into an independently pinned source.
export function caddySourceIdentity(approval) {
  if (!Object.hasOwn(approval, "caddySource")) return {};
  const source = approval.caddySource;
  if (approval.custodyProfile !== "single-app-gateway/v1" || !source || typeof source !== "object" || Array.isArray(source) || Object.keys(source).sort().join() !== "manifestPath,manifestSha256") throw new Error("closed single-App Caddy source identity is required");
  const file = source.manifestPath;
  if (typeof file !== "string" || file.length > 4096 || !/^\/[A-Za-z0-9._/-]+$/.test(file) || file.includes("//") || file.endsWith("/") || file.split("/").some(part => part === "." || part === "..")) throw new Error("canonical absolute Caddy source manifest path is required");
  if (typeof source.manifestSha256 !== "string" || !/^[0-9a-f]{64}$/.test(source.manifestSha256) || /^0{64}$/.test(source.manifestSha256)) throw new Error("independent nonzero Caddy source manifest SHA256 is required");
  return {caddySource: {manifestPath: file, manifestSha256: source.manifestSha256}};
}

export function authoritativeIdentity(approval) {
  const names = ["authoritativeCommit", "authoritativeRelease", "authoritativeBinarySha256", "authoritativeSource"];
  if (!names.some(name => Object.hasOwn(approval, name)) && !Object.hasOwn(approval, "authoritativeRoles")) return {};
  const commit = approval.authoritativeCommit;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit) || /^0{40}$/.test(commit)) throw new Error("independent authoritative full commit is required");
  const release = approval.authoritativeRelease;
  if (release !== `ynx-chain-${commit.slice(0, 12)}` && release !== `ynx-network-surgical-${commit.slice(0, 12)}`) throw new Error("authoritative release differs from the approved native commit");
  const binary = approval.authoritativeBinarySha256;
  if (typeof binary !== "string" || !/^[0-9a-f]{64}$/.test(binary) || /^0{64}$/.test(binary)) throw new Error("independent authoritative running binary SHA256 is required");
  const source = approval.authoritativeSource;
  const paths = ["statePath", "integrityMarkerPath", "pauseMarkerPath", "mutationMarkerPath"];
  if (!source || typeof source !== "object" || Array.isArray(source) || Object.keys(source).sort().join() !== [...paths].sort().join()) throw new Error("closed original native source paths are required");
  for (const name of paths) if (typeof source[name] !== "string" || !/^\/[A-Za-z0-9._/-]+$/.test(source[name]) || source[name].includes("//") || source[name].split("/").some(part => part === "." || part === "..") || source[name].endsWith("/")) throw new Error("canonical original native source path is required");
  const directory = source.statePath.slice(0, source.statePath.lastIndexOf("/"));
  if (!source.statePath.endsWith("/devnet-state.json") || source.integrityMarkerPath !== `${directory}/devnet-state.integrity-version` || new Set(paths.map(name => source[name])).size !== paths.length) throw new Error("original native source/marker paths conflict");
  return {authoritativeCommit: commit, authoritativeRelease: release, authoritativeBinarySha256: binary,
    authoritativeSource: Object.fromEntries(paths.map(name => [name, source[name]]))};
}

export function authoritativeRoleIdentities(approval) {
  const primary = authoritativeIdentity(approval);
  if (!Object.hasOwn(approval, "authoritativeRoles")) return {};
  const roles = ["primary", "singapore", "silicon-valley", "seoul"], records = approval.authoritativeRoles;
  if (!primary.authoritativeCommit || !records || typeof records !== "object" || Array.isArray(records) || Object.keys(records).sort().join() !== [...roles].sort().join()) throw new Error("independent native role identities require all four original roles");
  const names = ["authoritativeCommit", "authoritativeRelease", "authoritativeBinarySha256", "authoritativeSource"];
  const result = {};
  for (const role of roles) {
    const record = records[role];
    if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).sort().join() !== [...names].sort().join()) throw new Error("closed original native role identity is required");
    result[role] = authoritativeIdentity(record);
  }
  if (JSON.stringify(result.primary) !== JSON.stringify(primary)) throw new Error("primary role must equal the independently approved snapshot authority");
  return {authoritativeRoles: result};
}

export function roleAuthoritativeIdentity(approval, role) {
  if (!["primary", "singapore", "silicon-valley", "seoul"].includes(role)) throw new Error("unknown original native role");
  return authoritativeRoleIdentities(approval).authoritativeRoles?.[role] ?? authoritativeIdentity(approval);
}

// Only the explicit native two-phase caller may late-bind a final operator
// genesis. The reviewed preparation pin covers the original custody/layout;
// it is never a substitute for the independently approved final plan pin.
export function operatorPreparationPin(approval, preparation = false) {
  const present = Object.hasOwn(approval, "operatorPreparationPlanSha256");
  if (!preparation && !present) return "";
  const pin = approval.operatorPreparationPlanSha256;
  if (!authoritativeIdentity(approval).authoritativeCommit || approval.custodyProfile !== "single-app-gateway/v1" || typeof pin !== "string" || !/^[0-9a-f]{64}$/.test(pin) || /^0{64}$/.test(pin)) throw new Error("explicit native single-App preparation requires an independent preparation operator plan SHA256");
  if (preparation && ["snapshotSourceSha256", "operatorPlanSha256", "candidateGenesisTime"].some(name => Object.hasOwn(approval, name))) throw new Error("preparation cannot contain future snapshot, final operator plan or genesis time authority");
  return pin;
}

export function validateAuthoritativeObservation(value, approval, role, transactionId) {
  const identity = roleAuthoritativeIdentity(approval, role);
  if (!identity.authoritativeCommit) throw new Error("independent native approval is required for process observations");
  const source = identity.authoritativeSource;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(transactionId || "") || value.transactionId !== transactionId || value.version !== "YNX-PUBLIC-BFT-NATIVE-IDENTITY/v1" || value.role !== role || value.commit !== approval.commit || value.authoritativeCommit !== identity.authoritativeCommit || value.authoritativeRelease !== identity.authoritativeRelease || value.authoritativeBinarySha256 !== identity.authoritativeBinarySha256 || value.dataPath !== source.statePath.slice(0, source.statePath.lastIndexOf("/")) || value.pauseMarkerPath !== source.pauseMarkerPath || value.mutationMarkerPath !== source.mutationMarkerPath || value.readOnly !== true || value.deployment !== false || value.nativeRootAuthorized !== false || !/^[1-9][0-9]*$/.test(value.mainPid || "") || !/^[0-9]+:[1-9][0-9]*$/.test(value.runningExecutableDeviceInode || "") || !/^[0-9a-f]{64}$/.test(value.unitSHA256 || "") || typeof value.runningExecutablePath !== "string" || !/^\/[A-Za-z0-9._/-]+$/.test(value.runningExecutablePath)) throw new Error("original native process observation differs from independent approval");
  return identity;
}
