import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const cardRoot=new URL("./",import.meta.url);
const source=(path:string)=>readFileSync(new URL(path,cardRoot),"utf8");

test("Card release source never directly opens a bare YNX Wallet authorization route",()=>{
  const releaseSources=["GuestExperience.tsx","productWalletRuntime.ts","../App.tsx"].map(source);
  for(const value of releaseSources)assert.doesNotMatch(value,/Linking\.openURL\(\s*["'`]ynxwallet:\/\/authorize["'`]/,"bare YNX Wallet authorization route is forbidden");
  assert.match(releaseSources[0],/connectYNXWallet\(\)/,"Guest UI must delegate YNX Wallet authorization to the canonical factory");
  assert.match(releaseSources[2],/connection\.beginYNX\(\)/,"App must use the canonical root factory rather than construct a route");
});
