#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [action, sourceFlag, sourceDir, baseFlag, baseURLValue, receiptFlag, receiptOutput] = process.argv.slice(2);
if (
  action !== "upload"
  || sourceFlag !== "--source-dir"
  || baseFlag !== "--base-url"
  || receiptFlag !== "--receipt-output"
  || !process.env.YNX_DATA_FABRIC_FIXTURE_WEB_ROOT
) throw new Error("unexpected immutable uploader fixture arguments");
const baseURL = new URL(baseURLValue);
const webRoot = path.resolve(process.env.YNX_DATA_FABRIC_FIXTURE_WEB_ROOT);
const destination = path.resolve(webRoot, `.${baseURL.pathname}`);
if (!destination.startsWith(`${webRoot}${path.sep}`) || fs.existsSync(destination)) throw new Error("fixture destination is unsafe or already exists");
fs.mkdirSync(destination, {recursive: true, mode: 0o755});
const sha256 = (body) => crypto.createHash("sha256").update(body).digest("hex");
const objects = [];
for (const name of fs.readdirSync(sourceDir).sort()) {
  const source = path.join(sourceDir, name);
  if (!fs.statSync(source).isFile() || path.basename(name) !== name) throw new Error("fixture source contains an invalid entry");
  const body = fs.readFileSync(source);
  fs.writeFileSync(path.join(destination, name), body, {mode: 0o644, flag: "wx"});
  objects.push({
    path: name,
    url: `${baseURLValue.replace(/\/$/, "")}/${name}`,
    bytes: body.length,
    sha256: sha256(body),
    etag: `"sha256:${sha256(body)}"`,
  });
}
if (process.env.YNX_DATA_FABRIC_FIXTURE_TAMPER_HOSTED === "1") {
  const archive = objects.find((object) => object.path.endsWith("-linux-amd64.tar.gz"));
  fs.appendFileSync(path.join(destination, archive.path), "changed-after-upload");
}
if (process.env.YNX_DATA_FABRIC_FIXTURE_ADD_SOURCE_OBJECT === "1") {
  fs.writeFileSync(path.join(sourceDir, "unexpected-object"), "unexpected");
}
const receipt = {
  schema: "ynx-data-fabric-immutable-hosting-receipt/v1",
  provider: "loopback-content-addressed-fixture",
  immutable: true,
  baseURL: baseURLValue.replace(/\/$/, ""),
  objects,
};
fs.writeFileSync(receiptOutput, `${JSON.stringify(receipt, null, 2)}\n`, {mode: 0o600, flag: "wx"});
