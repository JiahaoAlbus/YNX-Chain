import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("download origin separates mutable current metadata from immutable artifacts",async()=>{
  const source=await readFile(new URL("../deploy/downloads.ynxweb4.com.caddy",import.meta.url),"utf8");
  assert.match(source,/path \/wallet\/current\.json/u);
  assert.match(source,/max-age=300, must-revalidate/u);
  assert.match(source,/\^\/wallet\/sha256-\[0-9a-f\]\{64\}/u);
  assert.match(source,/max-age=31536000, immutable/u);
  assert.match(source,/redir @root https:\/\/www\.ynxweb4\.com\/dapp\/wallet\/open-download 308/u);
  assert.doesNotMatch(source,/header Cache-Control "public, max-age=31536000, immutable"/u);
});

