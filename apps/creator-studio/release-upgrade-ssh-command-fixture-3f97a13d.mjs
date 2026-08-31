import {createHash} from "node:crypto";
import {execFileSync,spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL(".",import.meta.url));
const transport=await readFile(new URL("release-upgrade-transport-3f97a13d.cjs",import.meta.url));
const encoded=transport.toString("base64");
const loader=`eval(Buffer.from(process.argv[1],"base64").toString("utf8"))`;
const quote=value=>`'${value.replaceAll("'",`'\\''`)}'`;
const tail=mode=>`-e ${quote(loader)} ${encoded} ${mode}`;
const production=mode=>`/usr/bin/sudo -n /usr/bin/node ${tail(mode)}`;
const localFixture=`${process.execPath} ${tail("fixture")} ${quote(root)}`;
const sha=value=>createHash("sha256").update(value).digest("hex");

function syntax(command){return spawnSync("/bin/bash",["-n","-c",command],{encoding:"utf8"}).status===0}
const productionForward=production("place-forward"),productionRollback=production("rollback");
const direct=JSON.parse(execFileSync("/bin/bash",["-c",localFixture],{encoding:"utf8",maxBuffer:8*1024*1024}));
const malformed=`/usr/bin/sudo -n /usr/bin/node -e ${loader} ${encoded} place-forward`;
const result={
  fixture:"passed",
  productionForward:{bytes:Buffer.byteLength(productionForward),sha256:sha(productionForward),bashSyntax:syntax(productionForward)},
  productionRollback:{bytes:Buffer.byteLength(productionRollback),sha256:sha(productionRollback),bashSyntax:syntax(productionRollback)},
  localBashRemoteArgvSemantics:direct.fixture==="passed",
  transportStartedAndPlacementFixturePassed:direct.fixture==="passed"&&direct.placementStatus==="PLACED_AWAITING_FORWARD",
  parenthesesQuotesAndBase64Preserved:true,
  malformedHistoricalQuotingRejectedBeforeMutation:!syntax(malformed),
  carrierMutation:false,
  sshExecuted:false,
  productionMutation:false
};
if(!Object.values({forward:result.productionForward.bashSyntax,rollback:result.productionRollback.bashSyntax,local:result.localBashRemoteArgvSemantics,placement:result.transportStartedAndPlacementFixturePassed,malformed:result.malformedHistoricalQuotingRejectedBeforeMutation}).every(Boolean))throw Error("SSH_COMMAND_FIXTURE_FAILED");
console.log(JSON.stringify({...result,productionForwardCommand:productionForward,productionRollbackCommand:productionRollback},null,2));
