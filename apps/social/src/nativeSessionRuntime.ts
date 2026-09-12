import { Platform, Linking } from "react-native";
import * as SecureStore from "expo-secure-store";
import { getRandomBytes } from "expo-crypto";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import registry from "./vendor/product-session-registry.json";
import { ProductSessionGatewayFetchAdapter, productPlatformBinding } from "./vendor/product-session-native.mjs";
import { createNativeSessionController } from "./nativeSessionController";

const authority = "https://wallet-auth.ynxweb4.com";
const scopes = Object.freeze(["account:read", "profile:link"]);
const protectedOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
let singleton: ReturnType<typeof createNativeSessionController> | undefined;

export function nativeSocialSession() {
  if (singleton) return singleton;
  if (Platform.OS !== "android" && Platform.OS !== "ios") throw new Error("This client requires native protected storage");
  const platform = Platform.OS;
  const binding = productPlatformBinding(registry, "social", platform);
  if (binding.applicationId !== "com.ynx.social") throw new Error("The registry does not match this installed application");
  const namespace = `${authority}|${platform}|${scopes.join(",")}`;
  const keyFor = (key: string) => `ynx.social.ps.v2.${bytesToHex(sha256(utf8ToBytes(`${namespace}|${key}`)))}`;
  const available = async () => { if (!await SecureStore.isAvailableAsync()) throw new Error("Protected storage is unavailable"); };
  const storage = {
    securityLevel: "os-protected" as const,
    async get(key: string) { await available(); return SecureStore.getItemAsync(keyFor(key)); },
    async set(key: string, value: string) { await available(); await SecureStore.setItemAsync(keyFor(key), value, protectedOptions); },
    async remove(key: string) { await available(); await SecureStore.deleteItemAsync(keyFor(key)); },
  };
  const unverified = () => { throw new Error("Wallet installation has not been verified"); };
  const gateway = new ProductSessionGatewayFetchAdapter({
    endpoint: authority, fetch: (url, init) => fetch(url, init as RequestInit),
    walletInstalled: unverified, schemeRegistered: unverified, timeoutMs: 10000,
  });
  singleton = createNativeSessionController({
    registry, platform, scopes, storage, gateway,
    tokenFactory: () => base64url(getRandomBytes(32)),
    openURL: async url => { await Linking.openURL(url); },
    async device(create) {
      let raw = await storage.get("product-device");
      if (!raw && !create) return null;
      if (!raw) {
        let secret = getRandomBytes(32);
        while (!p256.utils.isValidSecretKey(secret)) secret = getRandomBytes(32);
        try {
          raw = JSON.stringify({ id: `social-${bytesToHex(getRandomBytes(12))}`, secret: bytesToHex(secret) });
          await storage.set("product-device", raw);
          if (await storage.get("product-device") !== raw) throw new Error("Protected device storage readback failed");
        } finally { secret.fill(0); }
      }
      const parsed = JSON.parse(raw) as { id: string; secret: string };
      if (!/^social-[a-f0-9]{24}$/.test(parsed.id) || !/^[a-f0-9]{64}$/.test(parsed.secret)) throw new Error("Stored product device requires recovery");
      const bytes = hexToBytes(parsed.secret);
      let key: string;
      try { key = base64url(p256.getPublicKey(bytes, true)); } finally { bytes.fill(0); }
      return {
        id: parsed.id, key,
        async sign(input) {
          if (input.algorithm !== "p256-sha256" || input.deviceKey !== key || !["challenge", "http-proof"].includes(input.purpose)) throw new Error("Product signer binding mismatch");
          const current = await storage.get("product-device");
          if (current !== raw) throw new Error("Product device changed; recover the Wallet session");
          const secret = hexToBytes((JSON.parse(current) as { secret: string }).secret);
          try { return base64url(p256.sign(utf8ToBytes(input.payload), secret, { format: "der" })); }
          finally { secret.fill(0); }
        },
      };
    },
  });
  return singleton;
}
