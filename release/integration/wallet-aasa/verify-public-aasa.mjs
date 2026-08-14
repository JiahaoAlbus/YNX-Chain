#!/usr/bin/env node
import { buildAASA, verifyAASA } from "./aasa-policy.mjs";

const url = process.argv[2];
if (!url) {
  process.stderr.write("Usage: verify-public-aasa.mjs https://host/.well-known/apple-app-site-association\n");
  process.exit(2);
}

try {
  const expected = buildAASA(process.env);
  const response = await fetch(url, { redirect: "manual" });
  if (!response.ok) throw new Error(`AASA endpoint returned HTTP ${response.status}`);
  const body = await response.text();
  const result = verifyAASA({
    body,
    contentType: response.headers.get("content-type"),
    redirected: response.status >= 300 && response.status < 400,
    expected,
  });
  process.stdout.write(`${JSON.stringify({ url, ...result })}\n`);
} catch (error) {
  process.stderr.write(`Public AASA verification failed closed: ${error.message}\n`);
  process.exitCode = 1;
}
