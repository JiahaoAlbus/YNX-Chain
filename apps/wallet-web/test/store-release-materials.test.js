import test from "node:test";
import {verifyReleaseMaterials} from "../store/verify-release-materials.mjs";

test("store release materials stay versioned, complete, and truth bounded",async()=>{
  await verifyReleaseMaterials();
});
