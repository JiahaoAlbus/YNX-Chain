import { HDNodeWallet, Mnemonic, wordlists } from "ethers";
import { walletIdentity } from "@ynx-chain/wallet-auth";

export const MOBILE_MNEMONIC_PATH = "m/44'/60'/0'/0/0";
export type MnemonicWordCount = 12 | 24;
export type MnemonicAccountMaterial = Readonly<{
  entropyHex: string; phrase: string; secretHex: string; path: typeof MOBILE_MNEMONIC_PATH;
  wordCount: MnemonicWordCount; account: string; accountPublicKey: string;
}>;
export class WalletMnemonicError extends Error {
  readonly code: "MNEMONIC_INVALID" | "MNEMONIC_WORD_COUNT_UNSUPPORTED" | "MNEMONIC_PASSPHRASE_UNSUPPORTED" | "MNEMONIC_ENTROPY_INVALID";
  constructor(code: WalletMnemonicError["code"]) {
    super(code === "MNEMONIC_PASSPHRASE_UNSUPPORTED" ? "Passphrase-protected recovery phrases are not supported. Do not omit their passphrase." : "Use a valid English recovery phrase with 12 or 24 words and its checksum.");
    this.code=code;
  }
}
/** Sensitive local custody material, never a public manifest/session payload. */
export function mobileMnemonicFromEntropy(entropyHex: string, assertCurrent: () => void = () => {}): MnemonicAccountMaterial {
  assertCurrent();
  if (typeof entropyHex !== "string" || !/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(entropyHex)) throw new WalletMnemonicError("MNEMONIC_ENTROPY_INVALID");
  const mnemonic = Mnemonic.fromEntropy("0x" + entropyHex, "", wordlists.en);
  const wallet = HDNodeWallet.fromMnemonic(mnemonic, MOBILE_MNEMONIC_PATH);
  const secretHex = wallet.privateKey.slice(2), identity = walletIdentity(secretHex);
  assertCurrent();
  return Object.freeze({ entropyHex, phrase: mnemonic.phrase, secretHex, path: MOBILE_MNEMONIC_PATH,
    wordCount: mnemonic.phrase.split(" ").length as MnemonicWordCount, ...identity });
}
export function importMobileMnemonic(phrase: string, passphrase = "", assertCurrent: () => void = () => {}): MnemonicAccountMaterial {
  assertCurrent();
  if (passphrase !== "") throw new WalletMnemonicError("MNEMONIC_PASSPHRASE_UNSUPPORTED");
  if (typeof phrase !== "string" || phrase.length > 512 || /[\uD800-\uDFFF]/u.test(phrase)) throw new WalletMnemonicError("MNEMONIC_INVALID");
  const normalized = phrase.normalize("NFKD").trim().split(/\s+/u).join(" ");
  const count = normalized.split(" ").length;
  if (count !== 12 && count !== 24) throw new WalletMnemonicError("MNEMONIC_WORD_COUNT_UNSUPPORTED");
  if (!Mnemonic.isValidMnemonic(normalized, wordlists.en)) throw new WalletMnemonicError("MNEMONIC_INVALID");
  const entropy = Mnemonic.fromPhrase(normalized, "", wordlists.en).entropy.slice(2);
  return mobileMnemonicFromEntropy(entropy, assertCurrent);
}
export async function createMobileMnemonic(wordCount: MnemonicWordCount, randomBytes: (count: number) => Promise<Uint8Array>, assertCurrent: () => void): Promise<MnemonicAccountMaterial> {
  assertCurrent();
  if (wordCount !== 12 && wordCount !== 24) throw new WalletMnemonicError("MNEMONIC_WORD_COUNT_UNSUPPORTED");
  let bytes: Uint8Array | undefined;
  try {
    bytes = await randomBytes(wordCount === 12 ? 16 : 32); assertCurrent();
    if (!(bytes instanceof Uint8Array) || bytes.length !== (wordCount === 12 ? 16 : 32)) throw new WalletMnemonicError("MNEMONIC_ENTROPY_INVALID");
    return mobileMnemonicFromEntropy(Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""), assertCurrent);
  } finally { bytes?.fill(0); }
}
