const { withProjectBuildGradle } = require("expo/config-plugins");

const block = `// YNX_SECURE_STORE_WRITE_BARRIER_BEGIN
// Verify on every Gradle configuration, including direct module compilation.
def ynxSecureStorePatch = providers.exec {
    workingDir(rootDir.parentFile)
    commandLine("node", "scripts/secure-store-native-patch.mjs", "--check")
}.standardOutput.asText.get()
if (findProject(":expo-secure-store") == null) {
    throw new GradleException("YNX SecureStore must compile from reviewed source, not a prebuilt AAR")
}
// YNX_SECURE_STORE_WRITE_BARRIER_END
`;

module.exports = function withYnxSecureStoreWriteBarrier(config) {
  return withProjectBuildGradle(config, mod => {
    if (mod.modResults.language !== "groovy") throw new Error("YNX SecureStore requires Groovy project build.gradle");
    const source = mod.modResults.contents;
    const start = source.indexOf("// YNX_SECURE_STORE_WRITE_BARRIER_BEGIN");
    if (start >= 0) {
      if (!source.includes(block) || source.indexOf("// YNX_SECURE_STORE_WRITE_BARRIER_BEGIN", start + 1) >= 0) {
        throw new Error("Unrecognized YNX SecureStore build gate");
      }
    } else mod.modResults.contents = source + "\n" + block;
    return mod;
  });
};
module.exports.block = block;
