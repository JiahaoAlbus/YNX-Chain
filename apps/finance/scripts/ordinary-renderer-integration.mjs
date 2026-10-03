import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const PUBLIC_BASE='17d2d6dd0f9e30c7639bb5ccdf919c4896280e6c';
export const OWNER_SOURCE='e8bd1dca1c8276e6c15fa818a102e9a8bcb69311';
const APP='apps/finance/web/app.js';
const digest=value=>createHash('sha256').update(value).digest('hex');
const root=fileURLToPath(new URL('../../../',import.meta.url));
export function gitApp(commit){return execFileSync('git',['show',`${commit}:${APP}`],{cwd:root,maxBuffer:1024*1024}).toString('utf8')}
function unique(source,marker){const at=source.indexOf(marker);if(at<0||source.indexOf(marker,at+marker.length)>=0)throw Error(`ORDINARY_MARKER_NOT_UNIQUE:${marker}`);return at}
function line(source,marker){const at=unique(source,marker),end=source.indexOf('\n',at);if(end<0)throw Error('ORDINARY_LINE_UNTERMINATED');return source.slice(at,end+1)}
function between(source,start,end){const at=unique(source,start),stop=unique(source,end);if(stop<=at)throw Error('ORDINARY_RANGE_INVALID');return source.slice(at,stop)}
export function frozenRendererCapsule(){
  const base=gitApp(PUBLIC_BASE),owner=gitApp(OWNER_SOURCE);
  const changes=[
    {id:'receipt-source-and-navigation',before:line(base,'function renderReceipts('),after:between(owner,'function financeNavigationURL(','function renderReceipts(')+line(owner,'function renderReceipts(')},
    {id:'planning-source-and-selection',before:between(base,'function renderPlanning(','function renderPrivacy('),after:between(owner,'function readablePlanningRecord(','function renderPrivacy(')},
    {id:'support-source-and-navigation',before:line(base,'function renderSupport('),after:line(owner,'function renderSupport(')}
  ].map(row=>({...row,beforeSha256:digest(row.before),afterSha256:digest(row.after),beforeBytes:Buffer.byteLength(row.before),afterBytes:Buffer.byteLength(row.after)}));
  return {schemaVersion:1,kind:'FINANCE_ORDINARY_RENDERER_INTEGRATION',publicBase:PUBLIC_BASE,ownerSource:OWNER_SOURCE,path:APP,baseAppSha256:digest(base),changes,productionWriteAllowed:false,wholeCheckoutReplacementAllowed:false};
}
export function integrateOrdinaryRenderers(target,capsule=frozenRendererCapsule()){
  if(typeof target!=='string')throw Error('ORDINARY_TARGET_INVALID');
  const canonical=frozenRendererCapsule();
  if(JSON.stringify(capsule)!==JSON.stringify(canonical))throw Error('ORDINARY_CAPSULE_UNTRUSTED');
  // All old ranges must still be exact before any transformation. A concurrent
  // ordinary renderer change requires explicit review, never fuzzy overwrite.
  for(const change of canonical.changes)unique(target,change.before);
  for(const marker of ['function financeNavigationURL(','function readablePlanningRecord('])if(target.includes(marker))throw Error(`ORDINARY_HELPER_COLLISION:${marker}`);
  let result=target;
  for(const change of canonical.changes)result=result.replace(change.before,change.after);
  return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--manifest')console.log(JSON.stringify(frozenRendererCapsule(),null,2));
  else if(args.length===2&&args[0]==='--target')process.stdout.write(integrateOrdinaryRenderers(readFileSync(args[1],'utf8')));
  else throw Error('Use --manifest or --target <read-only input app.js>; output is stdout only.');
}
