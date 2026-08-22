const { withAndroidManifest } = require("expo/config-plugins");

const AUTHORIZE_SCHEME = "ynxwallet";
const EXACT_HOSTS = ["authorize", "action", "open"];
const UNIVERSAL_ROUTE = Object.freeze({scheme:"https",host:"www.ynxweb4.com",path:"/dapp/wallet/open"});

function applyExactIntentFilters(manifest) {
    const activities = manifest.application?.[0]?.activity ?? [];
    const main = activities.find((activity) =>
      [".MainActivity", "com.ynxweb4.wallet.MainActivity"].includes(activity.$?.["android:name"]),
    );
    if (!main) throw new Error("YNX Wallet MainActivity is missing");

    const filters = main["intent-filter"] ?? [];
    main["intent-filter"] = filters.filter((filter) => {
      const routes = filter.data ?? [];
      const hasWalletScheme = routes.some((data) => data.$?.["android:scheme"] === AUTHORIZE_SCHEME);
      const hasHost = routes.some((data) => typeof data.$?.["android:host"] === "string");
      return !hasWalletScheme || hasHost;
    });

    const walletFilters = main["intent-filter"].filter((filter) =>
      (filter.data ?? []).some((data) => data.$?.["android:scheme"] === AUTHORIZE_SCHEME),
    );
    if (walletFilters.length !== 1) throw new Error("YNX Wallet requires one exact host-bound intent filter");
    const filter = walletFilters[0];
    const hosts = (filter.data ?? []).map((data) => data.$?.["android:host"]).sort();
    if (JSON.stringify(hosts) !== JSON.stringify([...EXACT_HOSTS].sort())) {
      throw new Error("YNX Wallet intent-filter hosts do not match the canonical routes");
    }
    const actions = (filter.action ?? []).map((action) => action.$?.["android:name"]);
    const categories = (filter.category ?? []).map((category) => category.$?.["android:name"]);
    if (!actions.includes("android.intent.action.VIEW") ||
        !categories.includes("android.intent.category.DEFAULT") ||
        !categories.includes("android.intent.category.BROWSABLE")) {
      throw new Error("YNX Wallet exact intent filter must be VIEW, DEFAULT and BROWSABLE");
    }
    const universalFilters = main["intent-filter"].filter((candidate) => (candidate.data ?? []).some((data) => data.$?.["android:scheme"] === UNIVERSAL_ROUTE.scheme));
    if (universalFilters.length !== 1) throw new Error("YNX Wallet requires one exact universal-link intent filter");
    const universal = universalFilters[0],routes=universal.data??[];
    if (routes.length!==1||routes[0].$?.["android:host"]!==UNIVERSAL_ROUTE.host||routes[0].$?.["android:path"]!==UNIVERSAL_ROUTE.path||universal.$?.["android:autoVerify"]!=="true") throw new Error("YNX Wallet universal-link route is not exact or verified");
    const universalActions=(universal.action??[]).map((action)=>action.$?.["android:name"]),universalCategories=(universal.category??[]).map((category)=>category.$?.["android:name"]);
    if(!universalActions.includes("android.intent.action.VIEW")||!universalCategories.includes("android.intent.category.DEFAULT")||!universalCategories.includes("android.intent.category.BROWSABLE"))throw new Error("YNX Wallet universal link must be VIEW, DEFAULT and BROWSABLE");
    return manifest;
}

module.exports = function withYnxAndroidExactIntentFilters(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest = applyExactIntentFilters(mod.modResults.manifest);
    return mod;
  });
};
module.exports.applyExactIntentFilters = applyExactIntentFilters;
