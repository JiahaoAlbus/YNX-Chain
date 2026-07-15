const { withAppBuildGradle } = require("expo/config-plugins");

const credentialBlock = `def ynxReleaseSigningValues = [
    System.getenv("YNX_ANDROID_KEYSTORE_PATH"),
    System.getenv("YNX_ANDROID_KEY_ALIAS"),
    System.getenv("YNX_ANDROID_STORE_PASSWORD"),
    System.getenv("YNX_ANDROID_KEY_PASSWORD")
]
def ynxReleaseSigningConfigured = ynxReleaseSigningValues.every { it != null && !it.isEmpty() }
def ynxReleaseSigningPartiallyConfigured = ynxReleaseSigningValues.any { it != null && !it.isEmpty() }
if (ynxReleaseSigningPartiallyConfigured && !ynxReleaseSigningConfigured) {
    throw new GradleException("YNX Android release signing requires path, alias, store password, and key password")
}

`;

const defaultSigningConfig = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
`;

const releaseConfig = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (ynxReleaseSigningConfigured) {
                storeFile file(System.getenv("YNX_ANDROID_KEYSTORE_PATH"))
                storeType System.getenv("YNX_ANDROID_KEYSTORE_TYPE") ?: "PKCS12"
                storePassword System.getenv("YNX_ANDROID_STORE_PASSWORD")
                keyAlias System.getenv("YNX_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("YNX_ANDROID_KEY_PASSWORD")
            }
        }
    }
`;

function replaceExactlyOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`YNX release signing plugin expected exactly one ${label}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

module.exports = function withYnxAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("YNX Android release signing requires a Groovy app/build.gradle");
    }

    let source = mod.modResults.contents;
    source = replaceExactlyOnce(
      source,
      "android {\n",
      `${credentialBlock}android {\n`,
      "android block",
    );
    source = replaceExactlyOnce(
      source,
      defaultSigningConfig,
      releaseConfig,
      "default signingConfigs block",
    );
    source = replaceExactlyOnce(
      source,
      "            signingConfig signingConfigs.debug\n            def enableShrinkResources",
      "            signingConfig ynxReleaseSigningConfigured ? signingConfigs.release : null\n            def enableShrinkResources",
      "default release signing assignment",
    );
    mod.modResults.contents = source;
    return mod;
  });
};
