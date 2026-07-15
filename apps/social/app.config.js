const path = require("path");

module.exports = {
  expo: {
    name: "YNX Social",
    slug: "ynx-social",
    version: "1.0.0",
    orientation: "portrait",
    icon: path.resolve(__dirname, "assets/icon.png"),
    userInterfaceStyle: "light",
    scheme: "ynxsocial",
    splash: { image: path.resolve(__dirname, "assets/splash.png"), resizeMode: "contain", backgroundColor: "#FFFFFF" },
    ios: {
      bundleIdentifier: "com.ynx.social",
      supportsTablet: true,
      infoPlist: {
        NSContactsUsageDescription: "YNX Social matches locally selected contact hashes only after you allow access.",
        NSPhotoLibraryUsageDescription: "Choose an image to share in a Social post or message."
      }
    },
    android: {
      package: "com.ynx.social",
      adaptiveIcon: { foregroundImage: path.resolve(__dirname, "assets/adaptive-icon.png"), backgroundColor: "#FFFFFF" },
      permissions: ["READ_CONTACTS", "READ_MEDIA_IMAGES"]
    },
    plugins: ["expo-secure-store", ["expo-image-picker", { photosPermission: "Choose images you explicitly share in YNX Social." }], ["expo-contacts", { contactsPermission: "Match contacts only after you explicitly allow YNX Social." }]],
    extra: { product: "social", chainId: "ynx_6423-1", evmChainId: 6423, asset: "YNXT" }
  }
};
