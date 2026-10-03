import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("./WalletScanner.tsx",import.meta.url),"utf8"),start=source.indexOf("export function WalletScanner("),end=source.indexOf("return <Modal",start);
const handler=source.slice(start,end).replace("export function","function")+"return {allowCamera,dismiss};}\nreturn WalletScanner({locale:'en',accept(){},close:closeHandler});";
function harness(){
  const state:unknown[]=[],effects:Array<()=>void|(()=>void)>=[],cleanups:Array<()=>void>=[];let index=0,calls=0,closed=0,resolve!:(value:unknown)=>void,reject!:(error:Error)=>void;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no}),context={useMemo:(factory:()=>unknown)=>factory(),createStyles:()=>({}),isRTL:()=>false,useRef:(value:unknown)=>({current:value}),useState:(initial:unknown)=>{const position=index++;state[position]=initial;return[initial,(value:unknown)=>{state[position]=value}]},useEffect:(effect:()=>void|(()=>void))=>effects.push(effect),useCameraPermissions:()=>[{granted:false,canAskAgain:true},()=>{calls++;return pending}],scannerCopy:()=>""};
  const compiled=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const ui=new Function(...Object.keys(context),"closeHandler",compiled)(...Object.values(context),()=>{closed++});for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup)}
  return{ui,state,resolve,reject,calls:()=>calls,closed:()=>closed,unmount:()=>cleanups.forEach(cleanup=>cleanup())};
}
test("actual scanner permission handler rejects synchronous duplicate activation",async()=>{const h=harness(),first=h.ui.allowCamera(),second=h.ui.allowCamera();assert.equal(h.calls(),1);h.resolve({granted:true});await Promise.all([first,second]);assert.equal(h.state[3],false);h.unmount()});
for(const boundary of ["dismiss","unmount"]){test(`closed scanner cannot begin a new permission request or publish late denial after ${boundary}`,async()=>{const h=harness(),pending=h.ui.allowCamera();if(boundary==="dismiss")h.ui.dismiss();else h.unmount();await h.ui.allowCamera();assert.equal(h.calls(),1);const before=[...h.state];h.reject(Error("permission unavailable"));await pending;assert.deepEqual(h.state,before);if(boundary==="dismiss")assert.equal(h.closed(),1)})}
