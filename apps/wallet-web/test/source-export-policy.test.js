import assert from "node:assert/strict";
import test from "node:test";
import {isReviewerSourcePath} from "../store/source-export-policy.mjs";

test("reviewer source export includes every immutable local build input",()=>{
  for(const path of ["apps/wallet-web/vendor/wallet-address-authority.js","apps/wallet-web/scripts/build.mjs","apps/wallet-web/store/rebuild-reviewer-source.mjs","packages/wallet-auth/src/product-session-gateway-client.js"]){
    assert.equal(isReviewerSourcePath(path),true,path);
  }
  for(const path of ["apps/wallet-web/artifacts/candidate.zip","apps/wallet-web/evidence/runtime.json","apps/wallet-web/node_modules/esbuild/index.js","apps/wallet/android/app/build.gradle"]){
    assert.equal(isReviewerSourcePath(path),false,path);
  }
});
