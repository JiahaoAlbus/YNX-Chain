import {pathToFileURL} from "node:url";
import {runCompatibilityLab} from "../src/compatibility-lab.js";

const fixture = process.argv[2];
const scenarios = fixture ? (await import(pathToFileURL(fixture).href)).scenarios : {};
try { process.stdout.write(`${JSON.stringify(await runCompatibilityLab({scenarios, failOnSkipped: Boolean(fixture)}), null, 2)}\n`); }
catch (error) { process.stdout.write(`${JSON.stringify({code: error.code, details: error.details}, null, 2)}\n`); process.exitCode = 2; }
