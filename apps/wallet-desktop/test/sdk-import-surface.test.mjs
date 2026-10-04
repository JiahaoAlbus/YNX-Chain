import test from "node:test";
import assert from "node:assert/strict";
import {sdkImports,exportSyntax,sourceExportSurface} from "../scripts/sdk-import-surface.mjs";
import {fileURLToPath} from "node:url";
test("runtime SDK imports exclude both declaration and specifier type imports and retain alias identity",()=>{assert.deepEqual(sdkImports('import type {OnlyType} from "@ynx-chain/wallet-auth"; import {actual as local,type Shape} from "@ynx-chain/wallet-auth";'),[{name:"actual",local:"local",line:1}]);});
test("namespace and default imports stay distinct from named imports and unrelated imports are ignored",()=>{assert.deepEqual(sdkImports('import Default,* as ns from "@ynx-chain/wallet-auth"; import {irrelevant} from "different";'),[{name:"default",local:"Default",line:1},{name:"*",local:"ns",line:1}]);});
test("source export syntax distinguishes local, star and named reexports",()=>{assert.deepEqual(exportSyntax('export const {a,b:renamed}=source; export function f(){} export default 1; export * from "./star.js"; export {remote as alias} from "./named.js"; export type T=string;'),{names:["a","renamed","f","default"],stars:["./star.js"],named:[{source:"./named.js",imported:"remote",exported:"alias"}]});});
test("static local-barrel audit never executes SDK-like module bodies or default through export star",async()=>{
  // Read immutable throwing source fixtures, with no module evaluation.
  const result=await sourceExportSurface(fileURLToPath(new URL("fixtures/sdk-import-surface/entry.js",import.meta.url)));assert.deepEqual(result.names,["alias","value"]);assert.equal(result.files.length,2);assert.equal(result.unresolved.length,0);
});
test("cyclic source barrels reach a fixed point without executing either body",async()=>{const result=await sourceExportSurface(fileURLToPath(new URL("fixtures/sdk-import-surface/cycle-a.js",import.meta.url)));assert.deepEqual(result.names,["a","b"]);assert.equal(result.files.length,2);});
test("external star exports remain explicitly unresolved instead of being admitted",async()=>{const result=await sourceExportSurface(fileURLToPath(new URL("fixtures/sdk-import-surface/external.js",import.meta.url)));assert.equal(result.unresolved.length,1);assert.equal(result.unresolved[0].specifier,"external-source-not-loaded");});
