#!/usr/bin/env node
import { buildAASA } from "./aasa-policy.mjs";

try {
  process.stdout.write(`${JSON.stringify(buildAASA(process.env))}\n`);
} catch (error) {
  process.stderr.write(`AASA generation refused: ${error.message}\n`);
  process.exitCode = 1;
}
