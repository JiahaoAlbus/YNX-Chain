import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const runtime=new URL("../src/runtime-config.js",import.meta.url);
const app=new URL("../src/app.js",import.meta.url);

test("release config consumes the accepted bundled endpoint boundary and fails private services closed",async()=>{
  const source=await readFile(runtime,"utf8");
  assert.match(source,/1\.0\.0-p0\.2/);
  assert.match(source,/3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5/);
  assert.match(source,/appGateway:"UNAVAILABLE"/);
  assert.match(source,/payProductApi:"PENDING"/);
  assert.match(source,/YNX_APP_GATEWAY_URL=""/);
  assert.match(source,/YNX_PAY_API_URL=""/);
});

test("browser source contains no loopback, emulator, HTTP production or Node-only runtime dependency",async()=>{
  const source=`${await readFile(runtime,"utf8")}\n${await readFile(app,"utf8")}`;
  assert.doesNotMatch(source,/localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|example\.com/);
  assert.doesNotMatch(source,/http:\/\//);
  assert.doesNotMatch(source,/node:crypto|node:fs|node:path/);
});

test("English is the first-run primary language while saved user choice remains supported",async()=>{
  const source=await readFile(app,"utf8");
  assert.match(source,/locale:locales\.includes\(savedLocale\)\?savedLocale:"en"/);
  assert.match(source,/aiLanguage:locales\.includes\(savedAI\)\?savedAI:"en"/);
});
