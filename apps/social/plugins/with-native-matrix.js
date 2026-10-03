const { withPodfile } = require("@expo/config-plugins");

// Autolinking registers the product module. This adds its exact upstream SDK
// pod, not an SPM dependency on the application target that Pods cannot import.
module.exports = function withNativeMatrix(config) {
  return withPodfile(config, (mod) => {
    const marker = "# YNX Social pinned Matrix Rust SDK";
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents = `${marker}\npod 'MatrixRustSDK', :podspec => File.join(__dir__, '../modules/native-matrix/ios/MatrixRustSDK.podspec')\n${mod.modResults.contents}`;
    }
    return mod;
  });
};
