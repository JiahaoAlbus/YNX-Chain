import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const patches = [
  {
    package: "react-native-webview 13.16.1",
    url: new URL("../node_modules/react-native-webview/android/build.gradle", import.meta.url),
    legacy: '        classpath("com.android.tools.build:gradle:7.0.4")',
  },
  {
    package: "@walletconnect/react-native-compat 2.23.10",
    url: new URL("../node_modules/@walletconnect/react-native-compat/android/build.gradle", import.meta.url),
    legacy: '    classpath "com.android.tools.build:gradle:7.2.1"',
  },
  {
    package: "react-native-safe-area-context 5.7.0",
    url: new URL("../node_modules/react-native-safe-area-context/android/build.gradle", import.meta.url),
    legacy: '        classpath("com.android.tools.build:gradle:7.3.1")',
  },
];

for (const patch of patches) {
  const marker = `${patch.legacy.match(/^\s*/u)[0]}// YNX: use the root Expo/RN Android Gradle Plugin; do not create a legacy AGP classpath.`;
  const source = await readFile(patch.url, "utf8");
  if (source.includes(marker)) {
    if (source.includes(patch.legacy)) throw new Error(`${patch.package} Android patch is ambiguous`);
    continue;
  }
  const matches = source.split(patch.legacy).length - 1;
  if (matches !== 1) {
    const digest = createHash("sha256").update(source).digest("hex");
    throw new Error(`${patch.package} Android source changed (legacy AGP matches=${matches}, sha256=${digest})`);
  }
  await writeFile(patch.url, source.replace(patch.legacy, marker), "utf8");
  console.log(`patched ${patch.package} Android build to use the root Expo/RN toolchain`);
}
