import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceCommit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) throw new Error("usage: build-wallet-go-sdk.mjs <40-char source commit>");

const version = "0.1.0";
const output = path.join(root, "release/wallet-cli/go-sdk", `ynx-wallet-go-sdk-${version}.tgz`);
const source = fs.readFileSync(path.join(root, "sdk/wallet/go/sessionproof.go"), "utf8");
const test = fs.readFileSync(path.join(root, "sdk/wallet/go/sessionproof_test.go"), "utf8")
  .replace("../../../packages/wallet-auth/testdata/product-session-http-proof-v1.json", "testdata/product-session-http-proof-v1.json");
const example = fs.readFileSync(path.join(root, "examples/wallet-go-sdk/main.go"), "utf8");
const vector = fs.readFileSync(path.join(root, "packages/wallet-auth/testdata/product-session-http-proof-v1.json"), "utf8");
const manifest = {
  schemaVersion: 1,
  module: "github.com/JiahaoAlbus/YNX-Chain/sdk/wallet/go",
  version,
  sourceCommit,
  protocol: "YNX_PRODUCT_SESSION_HTTP_PROOF_V1",
  evmChainId: "0x1917",
  minimumRuntime: "Go 1.25.0",
  signingClass: "unsigned_go_module_testnet_candidate",
  productionSigned: false,
  downloadHosted: false,
  deployedPublic: false,
};
const entries = new Map([
  ["package/MANIFEST.json", `${JSON.stringify(manifest, null, 2)}\n`],
  ["package/README.md", "# YNX Wallet Go SDK\n\nFrozen Product Session HTTP proof consumer for YNX Wallet integrations. This module does not define a new Auth protocol, persist keys, claim balances, or create transactions. Requires Go 1.25.0 or later.\n"],
  ["package/go.mod", "module github.com/JiahaoAlbus/YNX-Chain/sdk/wallet/go\n\ngo 1.25.0\n"],
  ["package/sessionproof.go", source],
  ["package/sessionproof_test.go", test],
  ["package/testdata/product-session-http-proof-v1.json", vector],
  ["package/examples/real-consumer/main.go", example],
]);

const blocks = [];
for (const name of [...entries.keys()].sort()) {
  const content = Buffer.from(entries.get(name));
  const header = tarHeader(name, content.length);
  blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
}
blocks.push(Buffer.alloc(1024));
const archive = zlib.gzipSync(Buffer.concat(blocks), {level: 9, mtime: 0});
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, archive);
console.log(JSON.stringify({path: path.relative(root, output), bytes: archive.length, sha256: crypto.createHash("sha256").update(archive).digest("hex"), ...manifest}));

function tarHeader(name, size) {
  if (Buffer.byteLength(name) > 100) throw new Error(`tar entry name too long: ${name}`);
  const header = Buffer.alloc(512);
  write(header, name, 0, 100);
  write(header, octal(0o644, 8), 100, 8);
  write(header, octal(0, 8), 108, 8);
  write(header, octal(0, 8), 116, 8);
  write(header, octal(size, 12), 124, 12);
  write(header, octal(0, 12), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  write(header, "ustar\0", 257, 6);
  write(header, "00", 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  write(header, `${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}

function octal(value, width) {
  const encoded = value.toString(8);
  if (encoded.length > width - 1) throw new Error(`tar numeric field overflow: ${value}`);
  return `${encoded.padStart(width - 1, "0")}\0`;
}

function write(buffer, value, offset, length) {
  const encoded = Buffer.from(value);
  if (encoded.length > length) throw new Error(`tar field overflow: ${value}`);
  encoded.copy(buffer, offset);
}
