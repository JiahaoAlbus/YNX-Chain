export const PACKAGE_SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function requirePackageSourceCommit(value) {
  if (typeof value !== "string" || !PACKAGE_SOURCE_COMMIT_PATTERN.test(value)) {
    const error = new Error("PACKAGE_SOURCE_COMMIT_REQUIRED: YNX_WALLET_WEB_SOURCE_COMMIT must be a full 40-character lowercase Git commit SHA");
    error.code = "PACKAGE_SOURCE_COMMIT_REQUIRED";
    throw error;
  }
  return value;
}
