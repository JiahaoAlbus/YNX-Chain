const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", {fatal: true});
const VAULT_DOMAIN = "YNX_BROWSER_SIGNER_VAULT_V1";
const PBKDF2_ITERATIONS = 600_000;
const vaultFields = ["cipher", "ciphertext", "domain", "iterations", "iv", "kdf", "salt", "version"];

export async function sealSignerVault({accountSecret, deviceSecret}, password, cryptoImpl = globalThis.crypto) {
  const crypto = validCrypto(cryptoImpl);
  const account = validSecret(accountSecret, "account secret");
  const device = validSecret(deviceSecret, "device secret");
  const passwordBytes = validPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(crypto, passwordBytes, salt, PBKDF2_ITERATIONS);
  const plaintext = textEncoder.encode(JSON.stringify({
    accountSecret: bytesToBase64Raw(account),
    deviceSecret: bytesToBase64Raw(device),
  }));
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      {name: "AES-GCM", iv, additionalData: textEncoder.encode(VAULT_DOMAIN), tagLength: 128},
      key,
      plaintext,
    ));
    return Object.freeze({
      domain: VAULT_DOMAIN,
      version: 1,
      kdf: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
      cipher: "AES-256-GCM",
      salt: bytesToBase64Raw(salt),
      iv: bytesToBase64Raw(iv),
      ciphertext: bytesToBase64Raw(ciphertext),
    });
  } finally {
    passwordBytes.fill(0);
    plaintext.fill(0);
  }
}

export async function openSignerVault(vault, password, cryptoImpl = globalThis.crypto) {
  const crypto = validCrypto(cryptoImpl);
  validVault(vault);
  const passwordBytes = validPassword(password);
  const salt = base64RawToBytes(vault.salt, 16, "vault salt");
  const iv = base64RawToBytes(vault.iv, 12, "vault IV");
  const ciphertext = base64RawToBytes(vault.ciphertext, undefined, "vault ciphertext");
  if (ciphertext.length < 17 || ciphertext.length > 4096) throw new Error("YNX signer vault is invalid");
  const key = await deriveKey(crypto, passwordBytes, salt, vault.iterations);
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      {name: "AES-GCM", iv, additionalData: textEncoder.encode(VAULT_DOMAIN), tagLength: 128},
      key,
      ciphertext,
    ));
    const parsed = JSON.parse(textDecoder.decode(plaintext));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "accountSecret,deviceSecret") {
      throw new Error("invalid payload");
    }
    return Object.freeze({
      accountSecret: base64RawToBytes(parsed.accountSecret, 32, "account secret"),
      deviceSecret: base64RawToBytes(parsed.deviceSecret, 32, "device secret"),
    });
  } catch {
    throw new Error("YNX signer vault unlock failed");
  } finally {
    passwordBytes.fill(0);
    if (plaintext) plaintext.fill(0);
  }
}

async function deriveKey(crypto, passwordBytes, salt, iterations) {
  const source = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name: "PBKDF2", hash: "SHA-256", salt, iterations},
    source,
    {name: "AES-GCM", length: 256},
    false,
    ["encrypt", "decrypt"],
  );
}

function validCrypto(value) {
  if (!value?.subtle || typeof value.getRandomValues !== "function") throw new Error("Web Crypto is required for the YNX signer vault");
  return value;
}

function validSecret(value, label) {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error(`${label} must be 32 bytes`);
  return value;
}

function validPassword(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 1024) throw new Error("vault password must contain 12 to 1024 characters");
  return textEncoder.encode(value);
}

function validVault(vault) {
  if (!vault || typeof vault !== "object" || Array.isArray(vault) || Object.keys(vault).sort().join(",") !== vaultFields.join(",")) {
    throw new Error("YNX signer vault is invalid");
  }
  if (vault.domain !== VAULT_DOMAIN || vault.version !== 1 || vault.kdf !== "PBKDF2-SHA256" || vault.iterations !== PBKDF2_ITERATIONS || vault.cipher !== "AES-256-GCM") {
    throw new Error("YNX signer vault is invalid");
  }
}

function bytesToBase64Raw(value) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  return globalThis.btoa(binary).replace(/=+$/u, "");
}

function base64RawToBytes(value, size, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+$/u.test(value)) throw new Error(`${label} is invalid`);
  const padded = value + "=".repeat((4 - value.length % 4) % 4);
  let binary;
  try {
    binary = globalThis.atob(padded);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (size !== undefined && decoded.length !== size) throw new Error(`${label} is invalid`);
  return decoded;
}
