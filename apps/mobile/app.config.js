const base = require("./app.json").expo;

const product = process.env.YNX_MOBILE_PRODUCT || "integration";
const products = {
  integration: {
    name: "YNX Internal",
    slug: "ynx-internal",
    scheme: "ynx",
    bundleIdentifier: "com.ynxweb4.mobile",
  },
  social: {
    name: "YNX Social",
    slug: "ynx-social",
    scheme: "ynxsocial",
    bundleIdentifier: "com.ynxweb4.social",
  },
  wallet: {
    name: "YNX Wallet",
    slug: "ynx-wallet",
    scheme: "ynxwallet",
    bundleIdentifier: "com.ynxweb4.wallet",
  },
};

if (!Object.prototype.hasOwnProperty.call(products, product)) {
  throw new Error(`Unsupported YNX_MOBILE_PRODUCT: ${product}`);
}

const selected = products[product];

module.exports = {
  ...base,
  name: selected.name,
  slug: selected.slug,
  scheme: selected.scheme,
  ios: {
    ...base.ios,
    bundleIdentifier: selected.bundleIdentifier,
  },
  android: {
    ...base.android,
    package: selected.bundleIdentifier,
  },
  extra: {
    ...(base.extra || {}),
    product,
    internalAcceptanceShell: product === "integration",
  },
};
