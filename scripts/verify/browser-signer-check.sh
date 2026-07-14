#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ ! -d sdk/browser/node_modules ]]; then
  npm --prefix sdk/browser ci --ignore-scripts --no-audit --no-fund
fi

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const lock = JSON.parse(await readFile("sdk/browser/package-lock.json", "utf8"));
assert.equal(lock.lockfileVersion, 3);
assert.equal(lock.packages[""].dependencies["@noble/curves"], "2.2.0");
assert.equal(lock.packages[""].dependencies["@noble/hashes"], "2.2.0");
assert.equal(lock.packages["node_modules/@noble/curves"].version, "2.2.0");
assert.equal(lock.packages["node_modules/@noble/hashes"].version, "2.2.0");
assert.equal(lock.packages["node_modules/@noble/curves"].integrity, "sha512-T/BoHgFXirb0ENSPBquzX0rcjXeM6Lo892a2jlYJkqk83LqZx0l1Of7DzlKJ6jkpvMrkHSnAcgb5JegL8SeIkQ==");
assert.equal(lock.packages["node_modules/@noble/hashes"].integrity, "sha512-IYqDGiTXab6FniAgnSdZwgWbomxpy9FtYvLKs7wCUs2a8RkITG+DFGO1DM9cr+E3/RgADRpFjrKVaJ1z6sjtEg==");
NODE

npm --prefix sdk/browser test
npm --prefix sdk/browser ls --all --ignore-scripts >/dev/null
go test ./internal/appgateway -run '^TestBrowserSignerVectorsVerifyInGo$'

echo "browser-signer-check passed: ynx1 derivation, low-S ownership proof, Ed25519 device/Square signatures, encrypted vault tamper rejection, and Go interoperability"
