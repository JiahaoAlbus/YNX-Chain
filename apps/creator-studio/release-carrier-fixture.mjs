import {cp, mkdtemp, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname, join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const rollbackCarrier = join(root, "release-candidates/live-20260823/studio");

async function applyCarrier(carrier, target) {
  const stage = `${target}.next`;
  const backup = `${target}.previous`;
  await rm(stage, {recursive: true, force: true});
  await cp(carrier, stage, {recursive: true});
  await rm(backup, {recursive: true, force: true});
  await rename(target, backup);
  await rename(stage, target);
  return backup;
}

const sha256 = async path => createHash("sha256").update(await readFile(path)).digest("hex");
const commands = Object.freeze({
  forward: ["node", "apps/creator-studio/release-carrier-fixture.mjs", "apply", "--carrier", "$CANDIDATE_STUDIO_DIR", "--target", "$STUDIO_RELEASE_DIR"],
  rollback: ["node", "apps/creator-studio/release-carrier-fixture.mjs", "apply", "--carrier", "apps/creator-studio/release-candidates/live-20260823/studio", "--target", "$STUDIO_RELEASE_DIR"],
});

if (process.argv[2] === "fixture") {
  const temporary = await mkdtemp(join(tmpdir(), "creator-release-fixture-"));
  const studio = join(temporary, "video/studio");
  const api = join(temporary, "video/api/sentinel.txt");
  const viewer = join(temporary, "video/viewer/sentinel.txt");
  await mkdir(dirname(api), {recursive: true});
  await mkdir(dirname(viewer), {recursive: true});
  await writeFile(api, "api-preserved");
  await writeFile(viewer, "viewer-preserved");
  await cp(rollbackCarrier, studio, {recursive: true});
  await applyCarrier(join(root, "dist"), studio);
  if (await readFile(api, "utf8") !== "api-preserved" || await readFile(viewer, "utf8") !== "viewer-preserved") throw new Error("Fixture modified a sibling Video route.");
  await applyCarrier(rollbackCarrier, studio);
  const rollbackHash = await sha256(join(studio, "app.js"));
  console.log(JSON.stringify({fixture: "passed", commands, rollbackAppSha256: rollbackHash}, null, 2));
} else {
  console.log(JSON.stringify({commands, requiredScope: "$STUDIO_RELEASE_DIR only; never /video/api or /video/viewer"}, null, 2));
}
